import { store } from '@/store';
// Written by `npm run changelog` (scripts/changelog.mjs) from the merged pull requests
// labelled enhancement (#219), so the page needs no GitHub call
import entries from './changelog.json';

const REPO_URL = 'https://github.com/stevehetz/invokedb';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
});

/**
 * The entries grouped by day, newest day first, each day's changes newest first.
 * @param {{ date: string, number: number, title: string }[]} list
 */
export function group_by_date(list) {
    /** @type {Map<string, { number: number, title: string, url: string }[]>} */
    const days = new Map();
    [...list]
        .sort((a, b) =>
            a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1
        )
        .forEach(e => {
            const changes = days.get(e.date) || [];
            changes.push({
                number: e.number,
                title: e.title,
                url: `${REPO_URL}/pull/${e.number}`
            });
            days.set(e.date, changes);
        });
    return [...days].map(([date, changes]) => ({
        date,
        label: DATE_FORMAT.format(new Date(`${date}T00:00:00Z`)),
        changes
    }));
}

export default {
    name: 'Changelog',

    data() {
        return { account: null, days: group_by_date(entries) };
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
        });
    }
};
