const INFO_DURATION = 2500;
const WARN_DURATION = 2500;
const SUCCESS_DURATION = 2500;
const ERROR_DURATION = 3500;

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
        this.$notify.info({
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
        this.$notify.warning({
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
        this.$notify.success({
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
        this.$notify.error({
            title,
            message,
            duration: d || ERROR_DURATION
        });
    }
}
