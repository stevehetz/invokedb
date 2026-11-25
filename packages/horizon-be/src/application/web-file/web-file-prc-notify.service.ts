import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { WebsocketClientStore } from '@app/websocket/client.store';
import env from '@app/env';
import _c from '@app/constants';
import logger from '@app/logger';

@Injectable()
export class WebFilePrcNotifyService {
    constructor(
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private _ws_client_store: WebsocketClientStore
    ) {}

    /** Tells the job processor a job is waiting, for a job not about a table (#215). */
    wake_processor(client_id) {
        try {
            this._ws_client_store.send_direct_message(client_id, _c.HORIZON_PRC_WS_CLIENT_ID, {
                event: 'RUN_JOB_PROCESSOR'
            });
        } catch (ex) {
            // It also looks for jobs every few seconds
            logger.error(`client_id: ${client_id} failed calling ${_c.HORIZON_PRC_WS_CLIENT_ID}`);
        }
    }

    async job_start(client_id, account_id, file_id) {
        try {
            this._ws_client_store.send_direct_message(client_id, _c.HORIZON_PRC_WS_CLIENT_ID, {
                event: 'RUN_JOB_PROCESSOR'
            });
        } catch (ex) {
            logger.error('job_start received an error');
            logger.error(ex.message);
            logger.error(`client_id: ${client_id} failed calling ${_c.HORIZON_PRC_WS_CLIENT_ID}`);
        }
        this.ws_pr_send_to_fe({
            client_id,
            file_id,
            account_id,
            event: 'WEB_FILE_PROCESS_START'
        });
    }

    async file_delete_request(client_id, account_id, file_id) {
        try {
            this._ws_client_store.send_direct_message(client_id, _c.HORIZON_PRC_WS_CLIENT_ID, {
                event: 'FILE_DELETE_REQUEST',
                account_id,
                file_id
            });
        } catch (ex) {
            logger.error('file_delete_request received an error');
            logger.error('job_start failed');
            logger.error(ex.message);
            logger.error(`client_id: ${client_id} failed calling ${_c.HORIZON_PRC_WS_CLIENT_ID}`);
        }
    }

    async job_error(client_id, account_id, file_id, ex) {
        this.ws_pr_send_to_fe({
            client_id,
            file_id,
            account_id,
            event: 'WEB_FILE_PROCESS_ERROR',
            error: ex.message
        });
    }

    async job_complete(client_id, account_id, file_id) {
        this.ws_pr_send_to_fe({
            client_id,
            file_id,
            account_id,
            event: 'WEB_FILE_PROCESS_COMPLETE'
        });
    }

    /**
     * Tells the frontend about a job. Never throws: callers don't await it, so a rejection
     * (no websocket client yet, a lost connection, a DB error) would crash the process.
     */
    async ws_pr_send_to_fe(opts) {
        const { client_id, file_id, event, error, account_id } = opts;

        try {
            const message: any = {};
            message.file = await this.file_directory_repository.findOneBy({ id: file_id });

            const payload = { message, event, error };

            this._ws_client_store.send_direct_message_account(
                client_id,
                _c.HORIZON_FE_WS_CLIENT_ID,
                account_id,
                payload
            );
        } catch (ex) {
            logger.error(`${event} for file ${file_id} wasn't sent to the frontend: ${ex.message}`);
        }
    }
}
