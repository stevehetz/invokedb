// process.env.IS_LOCAL = true;
import { Injectable } from '@nestjs/common';
import logger from '@app/logger';
import { WebsocketClientStore } from '@app/websocket/client.store';
import { SocketClientManager } from '@app/websocket/socket-client.manager';
import env from '@app/env';
import _c from '@app/constants';

@Injectable()
export class WebsocketClient {
    /** The client ids this process's roles need; see `ready()`. */
    private readonly role_ids = [
        env.IS_HORIZON_BE === 'true' && _c.HORIZON_BE_WS_CLIENT_ID,
        env.IS_HORIZON_PRC === 'true' && _c.HORIZON_PRC_WS_CLIENT_ID,
        env.IS_HORIZON_FS === 'true' && _c.HORIZON_FS_WS_CLIENT_ID
    ].filter(Boolean) as string[];

    constructor(private _store: WebsocketClientStore) {
        setTimeout(() => {
            try {
                if (env.IS_HORIZON_BE === 'true') {
                    this.setup_client(
                        'ws-be',
                        this._store.create_client(_c.HORIZON_BE_WS_CLIENT_ID)
                    );
                }

                if (env.IS_HORIZON_PRC === 'true') {
                    this.setup_client(
                        'ws-pr',
                        this._store.create_client(_c.HORIZON_PRC_WS_CLIENT_ID)
                    );
                }

                if (env.IS_HORIZON_FS === 'true') {
                    this.setup_client(
                        'ws-fs',
                        this._store.create_client(_c.HORIZON_FS_WS_CLIENT_ID)
                    );
                }
            } catch (ex) {
                logger.error(ex);
            }
        }, 1000);
    }

    /** True once every role's client exists and the broker has registered it. */
    ready(): boolean {
        return this.role_ids.every(id => this._store.get_client(id)?.registered);
    }

    setup_client(log_id: string, client: SocketClientManager) {
        // client.on('close', () => logger.debug(`${id} - websocket connection closed`));
        /*client.on('registered', () =>
            logger.info(`${log_id} - websocket connection has been established`)
        );*/
        client.on('verose', msg => logger.verbose(this.get_message_log(log_id, msg)));
        client.on('debug', msg => logger.debug(this.get_message_log(log_id, msg)));
        client.on('info', msg => logger.info(this.get_message_log(log_id, msg)));
        client.on('error', msg => logger.error(this.get_message_log(log_id, msg)));
        client.on('open', () => this.on_socket_open(client));
        client.connect(env.HORIZON_SB_PRIV_WS_URL);
    }

    get_message_log(id, msg) {
        if (!msg) return '';
        const m = msg.message || msg;
        return `${id} - ${m}`;
    }

    on_socket_open(client: SocketClientManager) {
        client.register(env.HORIZON_WS_SERVER_TOKEN, { server_name: env.SERVER_NAME });
    }
}
