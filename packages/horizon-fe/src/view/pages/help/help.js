import { store } from '@/store';
import { HELP_TOPICS, find_topic, neighbour_topic } from './help-topics';

// The public help pages (#219): one page per topic at /help/:topic, linked from the site's nav
// and the app's header. The text of every topic is in help.html.
export default {
    name: 'Help',

    data() {
        return { account: null, topics: HELP_TOPICS };
    },

    computed: {
        topic() {
            return find_topic(this.$route.params.topic);
        },

        previous() {
            return neighbour_topic(this.$route.params.topic, -1);
        },

        next() {
            return neighbour_topic(this.$route.params.topic, 1);
        }
    },

    watch: {
        // An unknown topic (an old or mistyped link) goes to the first one
        '$route.params.topic': {
            immediate: true,
            handler(id) {
                if (id && find_topic(id).id !== id) {
                    this.$router.replace('/help');
                }
            }
        },

        topic: {
            immediate: true,
            handler(t) {
                document.title = `${t.title} | InvokeDB Help`;
            }
        }
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
        });
    },

    beforeUnmount() {
        document.title = 'InvokeDB';
    }
};
