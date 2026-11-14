<script>
import { http } from '@/core/http';
import { store } from '@/store';

// Loads the runtime env (public/env.txt) once, then renders the site or the app (see router.js).
export default {
    name: 'Root',

    data: () => {
        return {
            loaded: false
        };
    },

    async created() {
        const env = await http.get(`/env.txt?${new Date().getTime()}`);
        store.set('env', JSON.parse(env));
        this.loaded = true;
    }
};
</script>

<template>
    <router-view v-if="loaded" />
</template>
