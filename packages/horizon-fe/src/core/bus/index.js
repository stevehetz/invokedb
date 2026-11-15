// The app-wide event bus. Vue 3 removed `$on`/`$off`/`$emit` from component instances, so this
// is a tiny emitter with the same method names the code (and `this.$bus`) already uses.
// Prefer props, emits or the store for new code.
class Bus {
    constructor() {
        this.handlers = new Map();
    }

    $on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
    }

    $off(event, handler) {
        if (!handler) this.handlers.delete(event);
        else if (this.handlers.has(event))
            this.handlers.get(event).delete(handler);
    }

    $emit(event, ...args) {
        // Copy first: a handler may remove itself (or others) while we iterate
        [...(this.handlers.get(event) || [])].forEach(handler =>
            handler(...args)
        );
    }
}

export const bus = new Bus();
