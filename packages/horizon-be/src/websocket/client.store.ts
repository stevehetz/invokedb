import { Injectable } from '@nestjs/common';
import WebSocket from 'ws';
import logger from '@app/logger';
import { SocketClientManager } from './socket-client.manager';

export type DirectMessageHandler = (payload: any) => void;

/**
 * This process's websocket clients of the broker, one per backend role, by client id. Provided
 * once, by `CoreModule`.
 */
@Injectable()
export class WebsocketClientStore {
    private clients: Record<string, SocketClientManager> = {};
    private dm_handlers: Record<string, DirectMessageHandler[]> = {};

    create_client(id: string, multi = true): SocketClientManager | undefined {
        try {
            const id_formatted = id + (multi ? '|multi' : '');
            const client = new SocketClientManager(id_formatted);
            client.on_message(m => this.on_socket_message(id, m));
            this.clients[id] = client;
            return client;
        } catch (ex) {
            logger.error(ex);
        }
    }

    get_client(id: string): SocketClientManager | undefined {
        return this.clients[id];
    }

    send_direct_message(from_id: string, to_id: string, payload: unknown) {
        const ws_client = this.get_client(from_id);
        if (!ws_client) {
            throw new Error('Websocket client does not exist');
        }
        ws_client.send_to_client({ recipientId: to_id, payload });
    }

    send_direct_message_account(
        from_id: string,
        to_id: string,
        account_id: unknown,
        payload: unknown
    ) {
        const ws_client = this.get_client(from_id);
        if (!ws_client) {
            throw new Error('Websocket client does not exist');
        }
        ws_client.send_to_client_account({ recipientId: to_id, accountId: account_id, payload });
    }

    on_direct_message(id: string, handler: DirectMessageHandler) {
        this.dm_handlers[id] = this.dm_handlers[id] || [];
        this.dm_handlers[id].push(handler);
    }

    private on_socket_message(id: string, message: WebSocket.MessageEvent) {
        try {
            const { action, payload } = JSON.parse(message.data.toString());

            if (action === 'directMessage') {
                (this.dm_handlers[id] || []).forEach(handler => handler(payload));
            }
        } catch (ex) {
            logger.error('Error parsing websocket message');
            console.error(ex);
        }
    }
}
