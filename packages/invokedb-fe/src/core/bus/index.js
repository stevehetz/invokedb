// src/core/bus.js
import mitt from 'mitt';

export const bus = mitt();

export default {
	install(app) {
		// Attach the bus to the global properties so it can be used with `bus`
		app.config.globalProperties.$bus = bus;
	},
};
