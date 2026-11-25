// A calendar view (#211): a month of the view's rows placed by its date column (in UTC, as the
// grid shows dates), with the view's filters. Each day lists its rows' titles; a busy day shows
// the first few and opens to show the rest.
import { defineComponent } from 'vue';
import { view_http } from '@/core/context/view/view-http';
import {
    WEEKDAYS,
    add_months,
    day_string,
    month_grid,
    month_title
} from './calendar-geometry';

// Rows listed in a day before "+ n more"
const DAY_EVENTS = 3;

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['view'],

    data() {
        const now = new Date();
        return {
            loading: true,
            /** @type {string | null} */
            error: null,
            year: now.getUTCFullYear(),
            month: now.getUTCMonth(),
            today: day_string(now),
            /** @type {{ _id: string, date: string, time: string | null, title: string }[]} */
            events: [],
            truncated: false,
            /** @type {string | null} the day opened to show all its rows */
            open_day: null,
            load_seq: 0,
            weekdays: WEEKDAYS,
            day_events: DAY_EVENTS
        };
    },

    computed: {
        /** @returns {ReturnType<typeof month_grid>} */
        grid() {
            return month_grid(this.year, this.month);
        },

        /** @returns {string} */
        title() {
            return month_title(this.year, this.month);
        },

        /** @returns {Record<string, any[]>} the events of each day */
        by_day() {
            /** @type {Record<string, any[]>} */
            const out = {};
            this.events.forEach(e => {
                (out[e.date] = out[e.date] || []).push(e);
            });
            return out;
        },

        /** @returns {number} the month's rows */
        month_count() {
            return this.grid.days
                .filter(d => d.in_month)
                .reduce((n, d) => n + (this.by_day[d.date] || []).length, 0);
        },

        /** @returns {any[][]} */
        weeks() {
            const weeks = [];
            for (let i = 0; i < this.grid.days.length; i += 7) {
                weeks.push(this.grid.days.slice(i, i + 7));
            }
            return weeks;
        }
    },

    watch: {
        view() {
            this.load();
        }
    },

    mounted() {
        this.load();
    },

    methods: {
        async load() {
            this.loading = true;
            this.open_day = null;
            const { from, to } = this.grid;
            const seq = ++this.load_seq;
            try {
                const res = await view_http.calendar(this.view.id, from, to);
                // A later month was asked for while this one loaded
                if (seq !== this.load_seq) return;
                this.events = (res && res.events) || [];
                this.truncated = !!(res && res.truncated);
                this.error = null;
            } catch (ex) {
                if (seq !== this.load_seq) return;
                this.error = message_of(ex, 'Could not load the calendar');
                this.events = [];
            }
            this.loading = false;
        },

        /** @param {number} step */
        go(step) {
            const next = add_months(this.year, this.month, step);
            this.year = next.year;
            this.month = next.month;
            this.load();
        },

        go_today() {
            const now = new Date();
            this.year = now.getUTCFullYear();
            this.month = now.getUTCMonth();
            this.load();
        },

        /** @param {string} date */
        shown(date) {
            const all = this.by_day[date] || [];
            return this.open_day === date ? all : all.slice(0, DAY_EVENTS);
        },

        /** @param {string} date */
        toggle_day(date) {
            this.open_day = this.open_day === date ? null : date;
        }
    }
});
