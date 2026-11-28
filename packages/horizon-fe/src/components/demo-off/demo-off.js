// A feature that's off in the no-signup demo (#333): what it is, and a way to sign up. The
// backend refuses it too (403 `demo_account`); this says so before anyone tries.
import { defineComponent } from 'vue';
import { sign_up_from_demo } from '@/core/demo';

export default defineComponent({
    name: 'DemoOff',

    // What's off, as a sentence: "API keys are off in the demo."
    props: { text: { type: String, default: 'This is off in the demo.' } },

    methods: {
        sign_up() {
            sign_up_from_demo();
        }
    }
});
