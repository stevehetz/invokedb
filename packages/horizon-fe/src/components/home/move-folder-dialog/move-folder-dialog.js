// "Move to folder…" (#357), for people who don't drag: picks one of the account's folders, or
// the top level, for a table. Opened by the Tables page through `container-dialog:open` with
// `props: { item, folders, on_move(parent_id) }`; `on_move` answers once the table is moved.
import { defineComponent } from 'vue';
import { bus } from '@/core/bus';

// The select's value for "no folder" (el-select treats null as nothing chosen)
export const TOP_LEVEL = 0;

export default defineComponent({
    props: ['props'],

    data() {
        const item = this.props.item || {};
        return {
            /** @type {number} */
            target: item.parent_id || TOP_LEVEL,
            moving: false,
            top_level: TOP_LEVEL
        };
    },

    computed: {
        /** @returns {{ id: number, name: string }[]} */
        folders() {
            return this.props.folders || [];
        },

        /** @returns {boolean} */
        unchanged() {
            return this.target === (this.props.item.parent_id || TOP_LEVEL);
        }
    },

    methods: {
        async move() {
            if (this.unchanged || this.moving) return;
            this.moving = true;
            try {
                await this.props.on_move(
                    this.target === TOP_LEVEL ? null : this.target
                );
                bus.$emit('container-dialog:close');
            } finally {
                this.moving = false;
            }
        },

        cancel() {
            bus.$emit('container-dialog:close');
        }
    }
});
