// process.env.IS_LOCAL = true;
import { Injectable } from '@nestjs/common';
import logger from '@app/logger';
import { WebsocketClientStore } from '@app/websocket/client.store';
import env from '@app/env';
import _c from '@app/constants';

@Injectable()
export class WebsocketClient {
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

    setup_client(log_id, client) {
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

    on_socket_open(client) {
        client.register(env.HORIZON_WS_SERVER_TOKEN, { server_name: env.SERVER_NAME });
    }
}
