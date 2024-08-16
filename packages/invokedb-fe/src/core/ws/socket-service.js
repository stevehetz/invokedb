import { bus } from '@/core/bus';
import { logger } from '@/core/logger/logger';
import SocketManager from '@/core/ws/socket-manager';
import { store } from '@/store';
const socket_manager = new SocketManager('horizon-fe|multi');

export const socket_service = {
	start_websocket(token) {
		socket_manager.on('close', () => logger.info('websocket connection closed'));
		socket_manager.on('debug', (msg) => logger.debug(msg));
		socket_manager.on('info', (msg) => logger.info(msg));
		socket_manager.on('error', (msg) => logger.error(msg));
		socket_manager.on('registered', () =>
			logger.info('websocket connection has been established'),
		);
		socket_manager.on('open', () => this.on_socket_open(token));
		socket_manager.onMessage((m) => this.on_socket_message(m));
		const env = store.get('env');
		socket_manager.connect(env.HORIZON_SB_PUB_WS_URL);
	},

	on_socket_open(token) {
		socket_manager.register(token);
	},

	on_socket_message(data) {
		try {
			const { senderId, action, payload } = JSON.parse(data);

			if (action === 'directMessage') {
				this.socket_bus_send_message(payload);
			}
		} catch (ex) {
			logger.error('Error parsing websocket message');
			console.error(ex);
		}
	},

	socket_bus_send_message(data) {
		bus.emit('websocket:message', data);
	},
};
