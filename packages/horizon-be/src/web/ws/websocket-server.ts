import { Injectable } from '@nestjs/common';
import logger from '@app/logger';
import { AuthService } from '@app/application/auth/auth.service';
import { JobService } from '@app/application/job/job.service';
import env from '@app/env';
import _c from '@app/constants';
const SocketServerManager = require('../../websocket/socket-server.manager');

@Injectable()
export class WebsocketServer {
    socket_manager: any;

    constructor(
        private _auth: AuthService,
        private _job: JobService
    ) {
        try {
            if (env.IS_HORIZON_SB === 'true') {
                this.start();
                setInterval(async () => await this.restart_stale_jobs(), 5000);
            }
        } catch (ex) {
            logger.error(ex);
        }
    }

    start() {
        const id = _c.HORIZON_WS_BROKER_SERVER_ID;
        this.socket_manager = new SocketServerManager(id);
        this.socket_manager.on('error', msg => logger.error(this.get_log('ws-br', msg)));
        this.socket_manager.on('info', msg => logger.info(this.get_log(' ws-br', msg)));
        this.socket_manager.on('close', msg => logger.debug(this.get_log('ws-br', msg)));
        this.socket_manager.on('debug', msg => logger.debug(this.get_log('ws-br', msg)));

        this.socket_manager.onClientMessage(message => this.handle_client_message(message));

        this.socket_manager.startHost(env.HORIZON_SB_PRIV_WS_PORT, {
            require_auth: true,
            auth_middleware: {
                validate_token: async token => await this.validate_token(token)
            }
        });
    }

    async restart_stale_jobs() {
        const client_prc_server_names = Object.keys(this.socket_manager.clientRegistry)
            .filter(c => c.indexOf('horizon-prc') > -1)
            .map(c => this.socket_manager.clientRegistry[c].metadata.server_name);
        const running_jobs = await this._job.get_running_jobs();
        const abandoned_jobs = running_jobs.filter(
            job => client_prc_server_names.indexOf(job.job_processor_id) === -1
        );

        if (abandoned_jobs.length > 0) {
            logger.debug(
                `found ${abandoned_jobs.length} abandoned jobs. Setting statuses to PENDING`
            );

            abandoned_jobs.forEach(async job => {
                let restarts = job.restarts || 0;
                restarts++;
                await this._job.update_job(job.id, {
                    status: 'PENDING',
                    job_processor_id: null,
                    restarts
                });
            });
        }
    }

    get_log(id, msg) {
        if (!msg) return '';
        const m = msg.message || msg;
        return `${id} - ${m}`;
    }

    handle_client_message(message) {}

    async validate_token(token) {
        return await this._auth.authorize(token);
    }
}
