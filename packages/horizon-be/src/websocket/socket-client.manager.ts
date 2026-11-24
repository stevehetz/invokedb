import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { WsMessage } from './ws-message';

const RECONNECT_DELAY_MS = 10000;

export type WsMessageHandler = (message: WebSocket.MessageEvent) => void;

/**
 * A websocket client of the broker (`SocketServerManager`). Reconnects by itself, answers the
 * broker's pings, and passes every other message to the `on_message` handlers.
 *
 * Events: `connect`, `open`, `close`, `registered`, `error`.
 */
export class SocketClientManager extends EventEmitter {
    id: string | null;
    open = false;
    socket: WebSocket | undefined;
    endpoint: string | undefined;
    private message_handlers: WsMessageHandler[] = [];

    constructor(id?: string) {
        super();
        this.id = id || null;
    }

    connect(endpoint: string) {
        if (!endpoint) {
            this.emit('error', 'SocketClientManager: Must provide an endpoint to connect to');
            return;
        }
        this.endpoint = endpoint;

        this.socket = new WebSocket(this.endpoint);
        this.socket.onopen = () => this.on_open();
        this.socket.onerror = () => this.on_error();
        this.emit('connect');
    }

    /** Closes the connection for good (no reconnect). */
    disconnect() {
        this.open = false;
        if (!this.socket) return;
        this.socket.onopen = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket.onmessage = null;
        this.socket.terminate();
        this.socket = undefined;
    }

    register(token: string, metadata?: Record<string, unknown>) {
        if (!this.id) return;
        this.send({
            action: 'register',
            payload: { id: this.id, token, metadata }
        });
    }

    on_message(handler: WsMessageHandler) {
        this.message_handlers.push(handler);
    }

    remove_on_message(handler: WsMessageHandler) {
        const index = this.message_handlers.indexOf(handler);
        if (index > -1) this.message_handlers.splice(index, 1);
    }

    send_to_client(message: { recipientId: string; payload: unknown }) {
        this.send({
            action: 'directMessage',
            senderId: this.id,
            recipientId: message.recipientId,
            payload: message.payload
        });
    }

    send_to_client_account(message: { recipientId: string; accountId: unknown; payload: unknown }) {
        this.send({
            action: 'directMessageAccount',
            senderId: this.id,
            recipientId: message.recipientId,
            accountId: message.accountId,
            payload: message.payload
        });
    }

    send(message: WsMessage) {
        if (this.open && this.socket) this.socket.send(JSON.stringify(message));
    }

    private on_open() {
        this.open = true;
        this.socket.onmessage = message => this.handle_message(message);
        this.socket.onclose = () => this.on_close();
        this.emit('open');
    }

    private on_error() {
        // Try again later
        setTimeout(() => this.connect(this.endpoint), RECONNECT_DELAY_MS);
    }

    private on_close() {
        this.open = false;
        this.socket.close();
        this.connect(this.endpoint);
        this.emit('close');
    }

    private handle_message(message: WebSocket.MessageEvent) {
        let msg: WsMessage;

        try {
            msg = JSON.parse(message.data.toString());
            if (!msg || !msg.action) throw new Error('Invalid message object from server');
        } catch {
            this.emit('error', 'Invalid message object from server');
            return;
        }

        if (msg.action === 'ping') {
            this.send({ action: 'pong' });
            return;
        }

        if (msg.action === 'registered') {
            this.emit('registered');
            return;
        }

        if (msg.action === 'updateId' && msg.payload) {
            this.id = msg.payload as string;
            return;
        }

        if (msg.action === 'error') {
            this.emit('error', { id: msg.senderId, message: msg.payload });
            return;
        }

        this.message_handlers.forEach(handler => handler(message));
    }
}
