import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { WebsocketClient } from '@app/web/ws/websocket-client';

/**
 * Readiness: 200 once this process's websocket clients are registered with the broker, 503
 * before (they connect about a second after the HTTP server starts). The smoke test waits on it.
 */
@Controller('health')
export class HealthController {
    constructor(private readonly ws_client: WebsocketClient) {}

    @Get()
    health() {
        if (!this.ws_client.ready()) {
            throw new ServiceUnavailableException({ websocket: 'starting' });
        }
        return { websocket: 'ready' };
    }
}
