let handlers = {};
let windows = {};

export const iframe_manager = {
    init() {
        // Listen for events sent from child iframe
        window.addEventListener('message', e => {
            let { sender, payload } = e.data;
            if (handlers[sender]) handlers[sender](e.data);
        });
    },

    add_window(name, window, handler) {
        windows[name] = window;
        handlers[name] = handler;
    },

    remove_window(name) {
        delete windows[name];
        delete handlers[name];
    },

    send_message(name, data) {
        windows[name].postMessage(data, '*');
    }
};
