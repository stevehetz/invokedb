import EventEmitter from 'event-emitter';

const SOCKET_RECONNECT_TIMER = 10000; // 10 seconds

let SocketManager = function(id) {
    this.id = id || null;
    this.open = false;
    this.socket = undefined;
    this.messageHandlers = [];
};

EventEmitter(SocketManager.prototype);

SocketManager.prototype.connect = function(endpoint) {
    if (!endpoint) 'SocketManager: Must provide an endpoint to connect to';
    this.endpoint = endpoint;

    this.socket = new WebSocket(this.endpoint);
    this.socket.onopen = this.onopen.bind(this);
    this.socket.onerror = this.onerror.bind(this);
    this.emit('connect');
};

SocketManager.prototype.onopen = function() {
    this.open = true;
    this.socket.onmessage = this.messageMgr.bind(this);
    this.socket.onclose = this.onclose.bind(this);
    this.emit('open');
};

SocketManager.prototype.register = function(token) {
    if (!this.id) return;
    let obj = {
        action: 'register',
        payload: {
            id: this.id,
            token: token
        }
    };
    this.send.call(this, JSON.stringify(obj));
};

SocketManager.prototype.onerror = function(error) {
    // Log error
    this.emit('info', 'Connection to ' + this.endpoint + ' failed.');

    // Try again
    setTimeout(this.connect.bind(this, this.endpoint), 10000);
};

SocketManager.prototype.onclose = function() {
    this.emit('debug', 'Disconnected from ' + this.endpoint);
    this.open = false;
    this.socket.close();
    this.connect.call(this, this.endpoint);
    this.emit('close');
};

SocketManager.prototype.messageMgr = function(message) {
    let msg;

    try {
        msg = JSON.parse(message.data);
        if (!msg || !msg.action) throw 'Invalid message object from server';
    } catch (ex) {
        console.log('Invalid message object from server');
    }

    // Ping Pong
    if (msg.action === 'ping') {
        return this.socket.send(JSON.stringify({ action: 'pong' }));
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
};

SocketManager.prototype.onMessage = function(handler) {
    this.messageHandlers.push(handler);
};

SocketManager.prototype.removeOnMessage = function(handler) {
    let index = this.messageHandlers.indexOf(handler);
    if (index > -1) this.messageHandlers.splice(index, 1);
};

SocketManager.prototype.send = function(message) {
    if (this.open) this.socket.send(message);
};

export default SocketManager;
