import { BehaviorSubject } from "rxjs";

class Store {
    constructor(opts) {
        this.data = opts || {};
        for (let d in this.data) {
            if (this.data.hasOwnProperty(d)) {
                this.data[d] = new BehaviorSubject(null);
            }
        }
    }

    set(key, value) {
        if (!this.data[key]) throw Error('Store key does not exist');

        this.data[key].next(value);
    }

    get(key) {
        return this.data[key].value;
    }

    subscribe(key, cb) {
        if (!this.data[key]) throw Error('Store key does not exist');

        return this.data[key].subscribe(cb);
    }
}

export default Store;
