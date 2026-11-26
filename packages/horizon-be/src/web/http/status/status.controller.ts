import { Controller, Get } from '@nestjs/common';
import { StatusService } from '@app/application/status/status.service';
import { WebsocketClient } from '@app/web/ws/websocket-client';

// The site's public /status page (#212): the API, the databases, the job processor's heartbeat
// and the production E2E test, with the admin's incident note. States and times only.
@Controller('status')
export class StatusController {
    constructor(
        private readonly status_service: StatusService,
        private readonly ws_client: WebsocketClient
    ) {}

    @Get()
    async status() {
        return await this.status_service.status(this.ws_client.ready());
    }
}
