// Maps, not plain objects: `sender` comes from any window's postMessage, so a name like
// "constructor" or "__defineSetter__" must not resolve to an Object.prototype method.
const handlers = new Map();
const windows = new Map();

export const iframe_manager = {
    init() {
        // Listen for events sent from child iframe
        window.addEventListener('message', e => {
            const data = e.data;
            if (!data || typeof data !== 'object') return;
            const sender = data.sender;
            if (typeof sender !== 'string') return;
            const handler = handlers.get(sender);
            if (typeof handler === 'function') handler(data);
        });
    },

    add_window(name, window, handler) {
        windows.set(name, window);
        handlers.set(name, handler);
    },

    remove_window(name) {
        windows.delete(name);
        handlers.delete(name);
    },

    send_message(name, data) {
        windows.get(name).postMessage(data, '*');
    }
};
