import { Console } from 'console';

const Client_WS = require('ws');
const Client_EventEmitter = require('events').EventEmitter;
const client_util = require('util');

const SOCKET_RECONNECT_TIMER = 10000; // 10 seconds

const SocketManagerClient = function(id) {
    this.id = id || null;
    this.open = false;
    this.socket = undefined;
    this.messageHandlers = [];
};

client_util.inherits(SocketManagerClient, Client_EventEmitter);

SocketManagerClient.prototype.connect = function(endpoint) {
    if (!endpoint) return 'SocketManagerClient: Must provide an endpoint to connect to';
    this.endpoint = endpoint;

    this.socket = new Client_WS(this.endpoint);
    this.socket.onopen = this.onopen.bind(this);
    this.socket.onerror = this.onerror.bind(this);
    this.emit('connect');
};

SocketManagerClient.prototype.onopen = function() {
    this.open = true;
    this.socket.onmessage = this.messageMgr.bind(this);
    this.socket.onclose = this.onclose.bind(this);
    this.emit('open');
};

SocketManagerClient.prototype.register = function(token, metadata) {
    if (!this.id) return;
    const obj = {
        action: 'register',
        payload: {
            id: this.id,
            token,
            metadata
        }
    };
    this.send.call(this, JSON.stringify(obj));
};

SocketManagerClient.prototype.onerror = function(error) {
    // Log error
    // this.emit('info', 'Connection to ' + this.endpoint + ' failed.');

    // Try again
    setTimeout(this.connect.bind(this, this.endpoint), 10000);
};

SocketManagerClient.prototype.onclose = function() {
    // this.emit('info', 'Disconnected from ' + this.endpoint);
    this.open = false;
    this.socket.close();
    this.connect.call(this, this.endpoint);
    this.emit('close');
};

SocketManagerClient.prototype.messageMgr = function(message) {
    let msg;

    try {
        msg = JSON.parse(message.data);
        if (!msg || !msg.action) throw 'Invalid message object from server';
    } catch (ex) {
        this.emit('error', 'Invalid message object from server');
    }

    // Ping Pong
    if (msg.action === 'ping') {
        return this.socket.send(JSON.stringify({ action: 'pong' }));
    }

    if (msg.action === 'registered') return this.emit('registered');

    if (msg.action === 'updateId' && msg.payload) {
        this.id = msg.payload;
        // this.emit('debug', 'Updated id to ' + msg.payload);
        return;
    }

    if (msg.action === 'error')
        return this.emit('error', {
            id: msg.senderId,
            message: msg.payload
        });

    this.messageHandlers.forEach(handler => {
        handler(message);
    });
};

SocketManagerClient.prototype.onMessage = function(handler) {
    this.messageHandlers.push(handler);
};

SocketManagerClient.prototype.removeOnMessage = function(handler) {
    let index = this.messageHandlers.indexOf(handler);
    if (index > -1) this.messageHandlers.splice(index, 1);
};

SocketManagerClient.prototype.sendToClient = function(message) {
    if (this.open)
        this.socket.send(
            JSON.stringify({
                action: 'directMessage',
                senderId: this.id,
                recipientId: message.recipientId,
                payload: message.payload
            })
        );
};

SocketManagerClient.prototype.sendToClientAccount = function(message) {
    if (this.open)
        this.socket.send(
            JSON.stringify({
                action: 'directMessageAccount',
                senderId: this.id,
                recipientId: message.recipientId,
                accountId: message.accountId,
                payload: message.payload
            })
        );
};

SocketManagerClient.prototype.send = function(message) {
    if (this.open) this.socket.send(message);
};

module.exports = SocketManagerClient;
