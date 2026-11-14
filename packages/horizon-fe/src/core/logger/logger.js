import { store } from '@/store';

export const logger = {
    debug: msg => {
        const level = store.get('env').LOG_LEVEL;
        if (level === 'DEBUG') {
            console.log(`%cdebug: ${msg}`, 'color: #737373');
        }
    },

    info: msg => {
        const level = store.get('env').LOG_LEVEL;
        if (level === 'DEBUG' || level === 'INFO') {
            console.log(`%cinfo:  ${msg}`, 'color: #6bcbe8');
        }
    },

    warn: msg => {
        const level = store.get('env').LOG_LEVEL;
        if (level === 'DEBUG' || level === 'INFO' || level === 'WARN') {
            console.log(`%cwarn:  ${msg}`, 'color: #e49148');
        }
    },

    error: msg => {
        const level = store.get('env').LOG_LEVEL;
        if (
            level === 'DEBUG' ||
            level === 'INFO' ||
            level === 'WARN' ||
            level === 'ERROR'
        ) {
            console.log(`%cerror: ${msg}`, 'color: #d85757');
        }
    }
};
