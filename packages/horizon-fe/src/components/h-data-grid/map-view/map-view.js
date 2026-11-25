// A map view (#211): the view's rows as points, placed by a latitude and a longitude column (in
// degrees), with the view's filters. Drawn as SVG on a latitude/longitude grid
// (map-geometry.js); each point can be opened on OpenStreetMap.
import { defineComponent } from 'vue';
import { view_http } from '@/core/context/view/view-http';
import { MAP_H, MAP_W, map_geometry, osm_link } from './map-geometry';

// Rows listed in the table under the map
const LISTED = 200;

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['view'],

    data() {
        return {
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {{ _id: string, lat: number, lng: number, label: string }[]} */
            points: [],
            truncated: false,
            missing: 0,
            /** @type {number | null} */
            hover: null,
            /** @type {number | null} the point clicked, which stays shown */
            picked: null,
            width: MAP_W,
            height: MAP_H,
            listed: LISTED
        };
    },

    computed: {
        /** @returns {ReturnType<typeof map_geometry>} */
        geo() {
            return map_geometry(this.points);
        },

        /** @returns {any} the point the readout shows */
        current() {
            const i = this.hover !== null ? this.hover : this.picked;
            return i !== null ? this.points[i] || null : null;
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
            this.hover = null;
            this.picked = null;
            try {
                const res = await view_http.map(this.view.id);
                this.points = (res && res.points) || [];
                this.truncated = !!(res && res.truncated);
                this.missing = (res && res.missing) || 0;
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the map');
                this.points = [];
            }
            this.loading = false;
        },

        /** @param {number} i */
        pick(i) {
            this.picked = this.picked === i ? null : i;
        },

        /** @param {number} v */
        coord(v) {
            return Number(v.toFixed(5)).toString();
        },

        osm_link
    }
});
