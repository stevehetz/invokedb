import EventEmitter from 'event-emitter';

const SOCKET_RECONNECT_TIMER = 10000; // 10 seconds
// After a connection that was working drops (a server restart, say)
const SOCKET_RECONNECT_AFTER_CLOSE = 1000;

/**
 * One websocket connection that reconnects by itself. Only the current socket
 * (`this.socket`) may change the manager's state: events from a socket that has
 * been replaced are ignored, and there is at most one reconnect pending.
 */
class SocketManager {
    /** @param {string} [id] */
    constructor(id) {
        this.id = id || null;
        /** @type {string | undefined} */
        this.endpoint = undefined;
        /** @type {WebSocket | undefined} */
        this.socket = undefined;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.reconnect_timer = null;
        this.was_open = false;
        /** @type {((data: any) => void)[]} */
        this.messageHandlers = [];
        this.events = EventEmitter();
    }

    get open() {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    /**
     * @param {string} event
     * @param {(...args: any[]) => void} listener
     */
    on(event, listener) {
        this.events.on(event, listener);
        return this;
    }

    /**
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
        this.events.emit(event, ...args);
    }

    /** @param {string} endpoint */
    connect(endpoint) {
        if (!endpoint)
            throw new Error(
                'SocketManager: Must provide an endpoint to connect to'
            );
        this.endpoint = endpoint;
        this.clear_reconnect();
        // Never two connections at once (#378): a socket still open or connecting is
        // closed, and its events are already ignored once it's no longer `this.socket`
        this.close_socket();

        const socket = new WebSocket(endpoint);
        this.socket = socket;
        this.was_open = false;
        socket.onopen = () => this.onopen(socket);
        socket.onerror = () => this.onerror(socket);
        socket.onclose = () => this.onclose(socket);
        socket.onmessage = message => this.messageMgr(socket, message);
        this.emit('connect');
    }

    close_socket() {
        const old = this.socket;
        this.socket = undefined;
        if (!old) return;
        old.onopen = old.onerror = old.onclose = old.onmessage = null;
        if (
            old.readyState === WebSocket.OPEN ||
            old.readyState === WebSocket.CONNECTING
        ) {
            try {
                old.close();
            } catch (ex) {
                // Already closing: nothing to do
            }
        }
    }

    clear_reconnect() {
        if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
        this.reconnect_timer = null;
    }

    // The one reconnect path: a single pending timer, whatever led to it
    /** @param {number} delay */
    schedule_reconnect(delay) {
        if (this.reconnect_timer) return;
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null;
            this.connect(this.endpoint);
        }, delay);
    }

    /** @param {WebSocket} socket */
    onopen(socket) {
        if (socket !== this.socket) return;
        this.was_open = true;
        this.emit('open');
    }

    /** @param {string} token */
    register(token) {
        if (!this.id) return;
        const obj = {
            action: 'register',
            payload: {
                id: this.id,
                token: token
            }
        };
        this.send(JSON.stringify(obj));
    }

    /** @param {WebSocket} socket */
    onerror(socket) {
        if (socket !== this.socket) return;
        this.emit('info', 'Connection to ' + this.endpoint + ' failed.');
        // A close event follows; the reconnect is scheduled once, by whichever
        // of the two comes first
        this.schedule_reconnect(SOCKET_RECONNECT_TIMER);
    }

    /** @param {WebSocket} socket */
    onclose(socket) {
        if (socket !== this.socket) return;
        this.emit('debug', 'Disconnected from ' + this.endpoint);
        this.schedule_reconnect(
            this.was_open
                ? SOCKET_RECONNECT_AFTER_CLOSE
                : SOCKET_RECONNECT_TIMER
        );
        this.emit('close');
    }

    /**
     * @param {WebSocket} socket
     * @param {MessageEvent} message
     */
    messageMgr(socket, message) {
        if (socket !== this.socket) return;
        let msg;

        try {
            msg = JSON.parse(message.data);
        } catch (ex) {
            msg = null;
        }
        if (!msg || !msg.action) {
            console.log('Invalid message object from server');
            return;
        }

        // Ping Pong
        if (msg.action === 'ping') {
            return this.send(JSON.stringify({ action: 'pong' }));
        }

        if (msg.action === 'registered') return this.emit('registered');

        if (msg.action === 'updateId' && msg.payload) {
            this.id = msg.payload;
            return this.emit('debug', 'Updated id to ' + msg.payload);
        }

        if (msg.action === 'error')
            return this.emit('error', {
                id: msg.senderId,
                message: msg.payload
            });

        this.messageHandlers.forEach(handler => {
            const data = message.data;
            handler(data);
        });
    }

    /** @param {(data: any) => void} handler */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /** @param {(data: any) => void} handler */
    removeOnMessage(handler) {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) this.messageHandlers.splice(index, 1);
    }

    /**
     * Sends only on an open socket; otherwise the message is dropped. The one
     * message sent unprompted, `register`, is sent again on every open.
     * @param {string} message
     */
    send(message) {
        if (!this.open) return;
        this.socket.send(message);
    }
}

export default SocketManager;
