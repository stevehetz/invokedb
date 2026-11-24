// From its own module, not 'element-plus', which would pull in the whole library (see main.js)
import { ElNotification } from 'element-plus/es/components/notification/index.mjs';

const INFO_DURATION = 2500;
const WARN_DURATION = 2500;
const SUCCESS_DURATION = 2500;
const ERROR_DURATION = 3500;

// Handlers for the bus's notify:* events. (In Vue 2 these reached `$notify` because the bus
// called them with a Vue instance as `this`; they now call Element Plus directly.)
export default class Notify {
    /***
     * Supports the following inputs
     * error('some message');
     * error({ m: 'Some message' })
     * error({ t: 'Some title' m: 'Some message' })
     */
    info(data) {
        const { d } = data;
        let title = '';
        let message = '';
        if (typeof data === 'string') {
            message = data;
        } else {
            let { t, m } = data;
            title = t;
            if (m && typeof m === 'string') {
                message = m;
            }
        }
        ElNotification.info({
            title,
            message,
            duration: d || INFO_DURATION
        });
    }

    /***
     * Supports the following inputs
     * error('some message');
     * error({ m: 'Some message' })
     * error({ t: 'Some title' m: 'Some message' })
     */
    warn(data) {
        const { d } = data;
        let title = '';
        let message = '';
        if (typeof data === 'string') {
            message = data;
        } else {
            let { t, m } = data;
            title = t;
            if (m && typeof m === 'string') {
                message = m;
            }
        }
        ElNotification.warning({
            title,
            message,
            duration: d || WARN_DURATION
        });
    }

    /***
     * Supports the following inputs
     * error('some message');
     * error({ m: 'Some message' })
     * error({ t: 'Some title' m: 'Some message' })
     */
    success(data) {
        const { d } = data;
        let title = '';
        let message = '';
        if (typeof data === 'string') {
            message = data;
        } else {
            let { t, m } = data;
            title = t;
            if (m && typeof m === 'string') {
                message = m;
            }
        }
        ElNotification.success({
            title,
            message,
            duration: d || SUCCESS_DURATION
        });
    }

    /***
     * Supports the following inputs
     * error('some message');
     * error({ t: 'Some title', e: 'Some message' })
     * error({ t: 'Some title', e: { m: 'Some message' } })
     */
    error(data) {
        const { d } = data;
        let title = '';
        let message = '';
        if (typeof data === 'string') {
            message = data;
        } else {
            let { t, e } = data;
            title = t;
            if (e) {
                if (typeof e === 'string') {
                    message = e;
                } else if (e.message) {
                    message = e.message.error || e.message;
                } else {
                    message = 'Server error';
                }
            }
        }
        ElNotification.error({
            title,
            message,
            duration: d || ERROR_DURATION
        });
    }
}
