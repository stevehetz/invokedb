import logger from '@app/logger';
import _c from '@app/constants';

const SocketClientManager = require('./socket-client.manager');

const clients = {};
const dm_handlers = {};

export class WebsocketClientStore {
    constructor() {}

    create_client(id, multi = true) {
        try {
            const id_formatted = id + (multi ? '|multi' : '');
            clients[id] = new SocketClientManager(id_formatted);
            clients[id].onMessage(m => this.on_socket_message(id, m));
            return clients[id];
        } catch (ex) {
            logger.error(ex);
        }
    }

    get_client(id) {
        return clients[id];
    }

    send_direct_message(from_id, to_id, payload) {
        const ws_client = this.get_client(from_id);
        if (!ws_client) {
            throw new Error('Websocket client does not exist');
        }
        ws_client.sendToClient({
            recipientId: to_id,
            payload
        });
    }

    send_direct_message_account(from_id, to_id, account_id, payload) {
        const ws_client = this.get_client(from_id);
        if (!ws_client) {
            throw new Error('Websocket client does not exist');
        }
        ws_client.sendToClientAccount({
            recipientId: to_id,
            accountId: account_id,
            payload
        });
    }

    on_socket_message(id, message) {
        try {
            const { senderId, action, payload } = JSON.parse(message.data);

            if (action === 'directMessage') {
                if (Array.isArray(dm_handlers[id])) {
                    dm_handlers[id].forEach(handler => handler(payload));
                }
            }
        } catch (ex) {
            logger.error('Error parsing websocket message');
            console.error(ex);
        }
    }

    on_direct_message(id, handler) {
        dm_handlers[id] = dm_handlers[id] || [];
        dm_handlers[id].push(handler);
    }
}
