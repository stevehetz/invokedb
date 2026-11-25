import { http } from '@/core/http';
import { bus } from '@/core/bus';

// The signed-in account's onboarding checklist (#143). Each call answers with the whole
// checklist, which is also sent on the bus ('onboarding:changed') for the checklist to show.
export const onboarding_http = {
    async get() {
        return this.changed(await http.get(http.get_url('/onboarding')));
    },

    // step: 'view_api_key' or 'copy_command'
    async mark(step) {
        const url = http.get_url(`/onboarding/steps/${step}`);
        return this.changed(await http.put(url));
    },

    async dismiss() {
        return this.changed(
            await http.put(http.get_url('/onboarding/dismiss'))
        );
    },

    changed(view) {
        bus.$emit('onboarding:changed', view);
        return view;
    }
};
