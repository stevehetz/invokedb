import { EventEmitter } from 'events';
import WebSocket, { WebSocketServer } from 'ws';
import env from '@app/env';
import { WsAction, WsMessage, WsRegisterPayload } from './ws-message';

const FIRST_PING_DELAY_MS = 2000;
const PING_INTERVAL_MS = 10000;
const CLIENT_COUNT_LOG_INTERVAL_MS = 10000;

/** What `authenticate` resolves to for a backend process that sent the shared server token. */
const SECURE = 'secure';

export interface WsAuthMiddleware {
    /** Resolves to the caller's account for a valid login token, or a falsy value. */
    validate_token(token: string): Promise<any>;
}

export interface WsHostOptions {
    require_auth?: boolean;
    auth_middleware?: WsAuthMiddleware;
}

/** A connected socket, as the broker tracks it. */
export interface WsClient {
    socket: WebSocket;
    id?: string;
    ponged: boolean;
    ping_pong_timeout?: NodeJS.Timeout;
    is_secure_client?: boolean;
    account?: any;
    metadata?: Record<string, any>;
}

export type WsClientMessageHandler = (client: WsClient, message: string) => void;

/**
 * The websocket broker. Backend processes and browsers connect and register with an id; the
 * broker then relays direct messages between them, and pings each client to drop dead ones.
 *
 * Events: `info`, `error`.
 */
export class SocketServerManager extends EventEmitter {
    id: string | null;
    port: number | undefined;
    socket_host: WebSocketServer | undefined;
    /** Registered clients by id (`<name>` or `<name>_<n>` for multi clients). */
    client_registry: Record<string, WsClient> = {};
    private broadcast_clients: WsClient[] = [];
    private message_handlers: WsClientMessageHandler[] = [];
    private require_auth = false;
    private auth_middleware: WsAuthMiddleware | null = null;
    private client_count_cache = 0;
    private interval: NodeJS.Timeout | null = null;

    constructor(id?: string) {
        super();
        this.id = id || null;
    }

    /** Starts the websocket server. */
    start_host(port: number, opts: WsHostOptions = {}) {
        this.port = port;
        this.require_auth = opts.require_auth || this.require_auth;
        this.auth_middleware = opts.auth_middleware || null;
        if (!this.port) throw new Error('SocketServerManager: No port provided to host');
        this.socket_host = new WebSocketServer({ port: this.port });
        this.socket_host.on('connection', socket => this.on_connection(socket));
        this.emit('info', 'Websocket server is running');
        this.interval = setInterval(() => {
            if (this.client_count_cache !== this.socket_host.clients.size) {
                this.client_count_cache = this.socket_host.clients.size;
                this.emit('info', `websocket clients: ${this.client_count_cache}`);
            }
        }, CLIENT_COUNT_LOG_INTERVAL_MS);
    }

    /** Stops the server and closes every connection. */
    stop_host(): Promise<void> {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        if (!this.socket_host) return Promise.resolve();
        this.socket_host.clients.forEach(socket => socket.terminate());
        return new Promise(resolve => this.socket_host.close(() => resolve()));
    }

    on_client_message(handler: WsClientMessageHandler) {
        this.message_handlers.push(handler);
    }

    /** Broadcasts a message to every client that subscribed to broadcasts. */
    broadcast(sender_id: string | null, action: WsAction, payload?: unknown) {
        this.broadcast_clients.forEach(c => this.send_to_client(sender_id, c, action, payload));
    }

    /** Sends a message to one client. */
    send_to_client(
        sender_id: string | null,
        client: WsClient,
        action: WsAction,
        payload?: unknown
    ) {
        const obj: WsMessage = { senderId: sender_id, action };
        if (payload) obj.payload = payload;
        try {
            if (client.socket && client.socket.readyState === WebSocket.OPEN) {
                client.socket.send(JSON.stringify(obj));
            }
        } catch (ex) {
            this.emit('error', ex.message);
        }
    }

    private on_connection(socket: WebSocket) {
        const client: WsClient = { socket, ponged: true };
        client.ping_pong_timeout = setTimeout(
            () => this.check_for_client_pong(client),
            FIRST_PING_DELAY_MS
        );

        socket.on('close', () => this.on_client_close(client));
        socket.on('error', error => this.on_client_error(client, error));
        socket.on('message', data => this.handle_client_message(client, data.toString()));
    }

    private on_client_close(client: WsClient) {
        if (client.ping_pong_timeout) clearTimeout(client.ping_pong_timeout);
        client.socket.terminate();
        this.unsubscribe_client(client);
        this.unregister_client(client);
    }

    private on_client_error(client: WsClient, error: Error) {
        client.socket.terminate();
        this.unsubscribe_client(client);
        this.unregister_client(client);
        this.handle_server_error(error, 'Error with ' + client.id + ', closing connection');
        this.broadcast(this.id, 'clients', this.socket_host.clients.size);
    }

    /** Pings the client, and drops it if it didn't answer the last ping. */
    private check_for_client_pong(client: WsClient) {
        if (client.ponged) {
            client.ponged = false;
            this.send_to_client(this.id, client, 'ping');
            client.ping_pong_timeout = setTimeout(
                () => this.check_for_client_pong(client),
                PING_INTERVAL_MS
            );
        } else {
            client.socket.terminate();
            this.unsubscribe_client(client);
        }
    }

    /** Handles every message a client sends, and passes it on to the right handler. */
    private handle_client_message(client: WsClient, message: string) {
        let msg: WsMessage;

        try {
            msg = JSON.parse(message);
            if (!msg || !msg.action) throw new Error('Invalid message object');
        } catch {
            this.send_error(client, 'Invalid message object');
            return;
        }

        if (msg.action === 'pong') {
            client.ponged = true;
            return;
        }

        if (msg.action === 'register' && msg.payload) {
            this.register_client(client, msg.payload as WsRegisterPayload);
            return;
        }

        if (!client.id || !this.client_registry[client.id]) {
            this.send_error(client, 'Client not registered');
            return;
        }

        switch (msg.action) {
            case 'subscribe':
                return this.subscribe_client(client);
            case 'directMessage':
                return this.send_direct_message(client, msg);
            case 'directMessageAccount':
                return this.send_direct_message_account(client, msg);
            case 'totalClients':
                return this.send_to_client(
                    this.id,
                    client,
                    'clients',
                    this.socket_host.clients.size
                );
            case 'broadcast':
                // TODO: Broadcast
                this.emit('error', 'have not implemented broadcast yet');
                return;
            case 'toServer':
                this.message_handlers.forEach(handler => handler(client, message));
                return;
        }
    }

    private subscribe_client(client: WsClient) {
        this.unsubscribe_client(client);
        this.broadcast_clients.push(client);
        this.emit('info', client.id + ' has subscribed to broadcasts');
    }

    private unsubscribe_client(client: WsClient) {
        const remaining = this.broadcast_clients.filter(c => c.id !== client.id);
        if (remaining.length !== this.broadcast_clients.length) {
            this.emit('info', client.id + ' has unsubscribed from broadcasts');
            this.broadcast_clients = remaining;
        }
    }

    /**
     * Resolves to `SECURE` for the shared server token, otherwise to whatever the auth middleware
     * makes of it (the caller's account, or a falsy value).
     */
    private async authenticate(token: string): Promise<any> {
        if (token && token === env.HORIZON_WS_SERVER_TOKEN) return SECURE;
        return this.auth_middleware.validate_token(token);
    }

    /** A client has sent its registration: authenticate it if needed, then register it. */
    private register_client(client: WsClient, payload: WsRegisterPayload) {
        const { id, token, metadata } = payload;
        if (!this.require_auth) {
            this.add_to_registry(client, id);
            return;
        }

        this.authenticate(token).then(
            res => {
                if (!res) {
                    this.send_to_client(this.id, client, 'authentication_failed');
                    return;
                }
                if (res === SECURE) {
                    client.is_secure_client = true;
                } else {
                    client.is_secure_client = false;
                    client.account = res;
                }
                client.metadata = metadata;
                this.add_to_registry(client, id);
            },
            err => {
                this.emit('info', err);
                this.send_to_client(this.id, client, 'authentication_failed');
            }
        );
    }

    /**
     * Ids look like `<name>`, `<name>|multi` or `<name>_<n>`. A plain `<name>` replaces any client
     * already registered under it; the other two get the next free `<name>_<n>`.
     */
    private add_to_registry(client: WsClient, id: string) {
        let arr = id.split('|');
        let client_id = arr[0];
        const flag = arr[1] || null;
        let index: string | undefined;
        if (!flag) {
            arr = id.split('_');
            client_id = arr[0];
            index = arr[1];
        }

        if (flag !== 'multi' && this.client_registry[client_id]) {
            this.emit('info', 'found a client with this id, removing the old one');
            this.unregister_client(this.client_registry[client_id]);
        }

        if (flag === 'multi' || index !== undefined) {
            const base_id = client_id;
            const indexes = Object.keys(this.client_registry)
                .filter(k => base_id === k.split('_')[0])
                .map(k => parseInt(k.split('_')[1], 10))
                .filter(n => !isNaN(n))
                .sort((a, b) => a - b);
            const latest = indexes.length === 0 ? -1 : indexes[indexes.length - 1];
            client_id += '_' + (latest + 1);
        }

        this.client_registry[client_id] = client;
        client.id = client_id;
        this.send_to_client(this.id, client, 'registered');
        this.send_to_client(this.id, client, 'updateId', client_id);
    }

    private unregister_client(client: WsClient) {
        if (this.client_registry[client.id]) {
            delete this.client_registry[client.id];
        }
    }

    private handle_server_error(error: unknown, message: string) {
        this.send_status(message);
        this.emit('error', message);
        if (error) this.emit('error', error);
    }

    /** Relays a message from one client to every client registered under `recipientId`. */
    private send_direct_message(sender_client: WsClient, msg: WsMessage) {
        const { senderId, recipientId, payload } = msg;
        if (!senderId || !recipientId || !payload) {
            this.send_error(sender_client, 'You must pass a senderId, recipientId and payload.');
            return;
        }

        this.relay(sender_client, senderId, recipientId, payload, () => true);
    }

    /** Like `send_direct_message`, but only to recipients signed in to account `accountId`. */
    private send_direct_message_account(sender_client: WsClient, msg: WsMessage) {
        const { senderId, recipientId, accountId, payload } = msg;
        if (!senderId || !recipientId || !accountId || !payload) {
            this.send_error(
                sender_client,
                'You must pass a senderId, recipientId, accountId, and payload.'
            );
            return;
        }

        this.relay(
            sender_client,
            senderId,
            recipientId,
            payload,
            client => client.account?.id === accountId
        );
    }

    private relay(
        sender_client: WsClient,
        sender_id: string,
        recipient_id: string,
        payload: unknown,
        accept: (client: WsClient) => boolean
    ) {
        const recipients = Object.keys(this.client_registry)
            .filter(id => id.split('_')[0] === recipient_id)
            .map(id => this.client_registry[id])
            .filter(accept);

        if (recipients.length === 0) {
            this.send_error(sender_client, 'Client not found in registry: ' + recipient_id);
            return;
        }
        recipients.forEach(recipient =>
            this.send_to_client(sender_id, recipient, 'directMessage', payload)
        );
    }

    private send_error(client: WsClient, message: string) {
        this.send_to_client(this.id, client, 'error', message);
    }

    private send_status(message: string) {
        this.broadcast(this.id, 'status', message);
    }
}
