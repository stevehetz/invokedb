/**
 * This socket manager can be used as a helper
 * for both a server and a client websocket
 */

import { parse } from 'path';
import logger from '@app/logger';

const Server_WS = require('ws');
const WebSocketServer = Server_WS.Server;
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const env = require('@app/env').default;

const SocketManagerServer = function (id) {
    this.id = id || null;
    this.client_count_cache = 0;
    this.open = false;
    this.socket = undefined;
    this.socketHost = undefined;
    this.messageHandlers = [];
    this.clientRegistry = {};
    this.broadcastClients = [];
    this.require_auth = false;
    this.interval = null;
};

util.inherits(SocketManagerServer, EventEmitter);

////// SERVER //////

/**
 * Starts the websocket server
 */
SocketManagerServer.prototype.startHost = function (port, opts) {
    this.port = port;
    this.require_auth = opts.require_auth || this.require_auth;
    this.auth_middleware = opts.auth_middleware || null;
    if (!this.port) throw 'SocketManagerServer: No port provided to host';
    this.socketHost = new WebSocketServer({ port: this.port });
    this.socketHost.on('connection', this.onConnection.bind(this));
    this.emit('info', 'Websocket server is running');
    this.interval = setInterval(() => {
        if (this.client_count_cache !== this.socketHost.clients.size) {
            this.client_count_cache = this.socketHost.clients.size;
            this.emit('info', `websocket clients: ${this.client_count_cache}`);
        }
    }, 10000);
};

/**
 * Handle a new server connection
 */
SocketManagerServer.prototype.onConnection = function (socket) {
    const client: any = {};
    client.ponged = true;
    client.socket = socket;
    client.pingPongTimeout = setTimeout(() => {
        this.checkForClientPong.call(this, client);
    }, 2000);

    socket.on('close', this.onClientClose.bind(this, client));
    socket.on('error', this.onClientError.bind(this, client));
    socket.on('message', this.clientMessageMgr.bind(this, client));
};

/**
 * Client closes a connection
 */
SocketManagerServer.prototype.onClientClose = function (client) {
    if (client.pingPongTimeout) clearTimeout(client.pingPongTimeout);
    client.socket.terminate();
    this.unsubscribeClient(client);
    this.unregisterClient(client);
    // this.emit('debug', 'closed connection with ' + client.id);
};

/**
 * Client has an error
 */
SocketManagerServer.prototype.onClientError = function (client, error) {
    client.socket.terminate();
    this.unsubscribeClient(client);
    this.unregisterClient(client);
    this.handleServerError(error, 'Error with ' + client.id + ', closing connection');
    this.broadcast(this.id, 'clients', this.socketHost.clients.size);
};

/**
 * Handle ping pong with client to make
 * sure they are still there
 */
SocketManagerServer.prototype.checkForClientPong = function (client) {
    if (client.ponged) {
        client.ponged = false;
        this.sendToClient(this.id, client, 'ping');
        client.pingPongTimeout = setTimeout(() => {
            this.checkForClientPong.call(this, client);
        }, 10000);
    } else {
        // this.emit('debug', 'Client never ponged backed, terminating');
        client.socket.terminate();
        this.unsubscribeClient(client);
    }
};

/**
 * Main handler for all incoming messages from the client.
 * This function will analyze the message and may eventually
 * pass it along to the appropriate handler
 */
SocketManagerServer.prototype.clientMessageMgr = function (client, message) {
    let msg;

    try {
        msg = JSON.parse(message);
        if (!msg || !msg.action) throw 'Invalid message object';
    } catch (ex) {
        this.sendError(client, 'Invalid message object');
    }

    if (!msg) return;

    if (msg.action === 'pong') return (client.ponged = true);

    if (msg.action === 'register' && msg.payload) {
        return this.registerClient.call(this, client, msg.payload);
    }

    if (!client.id || !this.clientRegistry[client.id])
        return this.sendError(client, 'Client not registered');

    if (msg.action === 'subscribe') return this.subscribeClient(client);

    if (msg.action === 'directMessage') return this.sendDirectMessage.call(this, client, msg);

    if (msg.action === 'directMessageAccount')
        return this.sendDirectMessageAccount.call(this, client, msg);

    if (msg.action === 'totalClients') {
        return this.sendToClient(this.id, client, 'clients', this.socketHost.clients.size);
    }

    // TODO: Broadcast
    if (msg.action === 'broadcast') return this.emit('error', 'have not implemented broadcast yet');

    if (msg.action === 'toServer')
        return this.messageHandlers.forEach(handler => {
            handler(client, message);
        });
};

/**
 * Subscribes client to broadcast messages
 */
SocketManagerServer.prototype.subscribeClient = function (client) {
    this.unsubscribeClient(client);
    this.broadcastClients.push(client);
    this.emit('info', client.id + ' has subscribed to broadcasts');
};

/**
 * Removes subscription
 */
SocketManagerServer.prototype.unsubscribeClient = function (client) {
    try {
        this.broadcastClients.forEach((c, a, i) => {
            if (c.id === client.id) {
                this.emit('info', c.id + ' has unsubscribed from broadcasts');
                this.broadcastClients.splice(i, 1);
            }
        });
    } catch (ex) {
        this.handleServerError(ex, ex.message);
    }
};

/**
 * Auth Middleware
 */
SocketManagerServer.prototype.authenticate = function (token) {
    return new Promise((resolve, reject) => {
        try {
            if (token && token === env.HORIZON_WS_SERVER_TOKEN) {
                resolve('secure');
            } else {
                this.auth_middleware.validate_token(token).then(res => {
                    resolve(res);
                });
            }
        } catch (ex) {
            this.emit('error', ex);
            reject('error while authenticating');
        }
    });
};

/**
 * A client has passed registration info.
 * Try and Register this client
 */
SocketManagerServer.prototype.registerClient = function (client, payload) {
    const self = this;
    const { id, token, metadata } = payload;
    if (self.require_auth) {
        self.authenticate(token).then(
            res => {
                if (res) {
                    if (res === 'secure') {
                        client.is_secure_client = true;
                    } else {
                        client.is_secure_client = false;
                        client.account = res;
                    }
                    client.metadata = metadata;
                    _registerClient();
                } else {
                    self.sendToClient(self.id, client, 'authentication_failed');
                }
            },
            err => {
                self.emit('info', err);
                self.sendToClient(self.id, client, 'authentication_failed');
            }
        );
    } else {
        _registerClient();
    }

    function _registerClient() {
        let arr = id.split('|');
        let clientId = arr[0];
        const flag = arr[1] || null;
        let index;
        if (!flag) {
            arr = id.split('_');
            clientId = arr[0];
            index = arr[1];
        }

        if (flag !== 'multi' && self.clientRegistry[clientId]) {
            self.emit('info', 'found a client with this id, removing the old one');
            self.unregisterClient(self.clientRegistry[clientId]);
        }

        const getSubIds = (cid, reg) => {
            return Object.keys(reg).filter(k => cid === k.split('_')[0]);
        };

        if (flag === 'multi' || index !== undefined) {
            const subIds = getSubIds(clientId, self.clientRegistry);
            const indexes = subIds.map(_id => parseInt(_id.split('_')[1], 10)).sort();
            const latest = indexes.length === 0 ? -1 : indexes[indexes.length - 1];
            clientId += '_' + (latest + 1);
        }

        self.clientRegistry[clientId] = client;
        client.id = clientId;
        self.sendToClient(self.id, client, 'registered');
        self.sendToClient(self.id, client, 'updateId', clientId);
        // self.emit('info', 'Registered client with id ' + clientId);
    }
};

/**
 * Unregister the client after closing
 */
SocketManagerServer.prototype.unregisterClient = function (client) {
    if (this.clientRegistry[client.id]) {
        delete this.clientRegistry[client.id];
        // this.emit('debug', 'client with id ' + client.id + ' has been removed');
    }
};

/**
 * Handle server error
 */
SocketManagerServer.prototype.handleServerError = function (error, message) {
    this.sendStatus(message);
    this.emit('error', message);
    if (error) this.emit('error', error);
};

/**
 * Used to send a message from 1
 * client to another client
 */
SocketManagerServer.prototype.sendDirectMessage = function (senderClient, msg) {
    const { senderId, recipientId, payload } = msg;
    if (!senderId || !recipientId || !payload)
        return this.sendError(senderClient, 'You must pass a senderId, recipientId and payload.');

    const recipientClients = Object.keys(this.clientRegistry)
        .filter(id => {
            const split = id.split('_');
            if (split[0] === recipientId) {
                return true;
            }
        })
        .map(id => this.clientRegistry[id]);

    if (recipientClients.length === 0) {
        this.sendError(senderClient, 'Client not found in registry: ' + recipientId);
    } else {
        recipientClients.forEach(recipient => {
            // this.emit('debug', `Sending a direct message to recipient with id: ${recipient.id}`);
            this.sendToClient(senderId, recipient, 'directMessage', payload);
        });
    }
};

/**
 * Used to send a message from 1
 * client to another client with a specific account
 */
SocketManagerServer.prototype.sendDirectMessageAccount = function (senderClient, msg) {
    const { senderId, recipientId, accountId, payload } = msg;
    if (!senderId || !recipientId || !accountId || !payload)
        return this.sendError(
            senderClient,
            'You must pass a senderId, recipientId, accountId, and payload.'
        );

    const recipientClients = Object.keys(this.clientRegistry)
        .filter(id => {
            const split = id.split('_');
            const client = this.clientRegistry[id];
            if (split[0] === recipientId && client.account.id === accountId) {
                return true;
            }
        })
        .map(id => this.clientRegistry[id]);

    if (recipientClients.length === 0) {
        this.sendError(senderClient, 'Client not found in registry: ' + recipientId);
    } else {
        recipientClients.forEach(recipient => {
            // this.emit('debug', `Sending a direct message to recipient with id: ${recipient.id}`);
            this.sendToClient(senderId, recipient, 'directMessage', payload);
        });
    }
};

/**
 * Error notifier
 */
SocketManagerServer.prototype.sendError = function (client, message) {
    this.sendToClient(this.id, client, 'error', message);
};

/**
 * Status notifier
 */
SocketManagerServer.prototype.sendStatus = function (message) {
    this.broadcast(this.id, 'status', message);
};

/**
 * Broadcast message to all clients who subscribed
 * to broadcast messages
 */
SocketManagerServer.prototype.broadcast = function (senderId, action, payload) {
    this.broadcastClients.forEach(c => {
        this.sendToClient(senderId, c, action, payload);
    });
};

/**
 * Send message to a client
 */
SocketManagerServer.prototype.sendToClient = function (senderId, client, action, payload) {
    let obj: any = {};
    obj.senderId = senderId;
    obj.action = action;
    if (payload) obj.payload = payload;
    try {
        if (client.socket && client.socket.readyState === Server_WS.OPEN) {
            client.socket.send(JSON.stringify(obj));
        }
    } catch (ex) {
        this.emit('error', ex.message);
    }
};

SocketManagerServer.prototype.onClientMessage = function (handler) {
    this.messageHandlers.push(handler);
};

/*SocketManagerServer.prototype.sendMessageToClients = function(message) {
	this.socketHost.clients.forEach(client => {
		client.send(message);
	});
};*/

module.exports = SocketManagerServer;
