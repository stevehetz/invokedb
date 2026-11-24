<!-- "Continue with Google / GitHub", for the login and signup pages. Shows only the providers
     the backend has configured, and nothing when it has none. -->
<template>
    <div class="sso-buttons" v-if="enabled.length">
        <a
            v-for="p in enabled"
            :key="p.id"
            href=""
            class="sso-button"
            @click.prevent="start(p.id)"
        >
            <i :class="p.icon"></i>
            <span>Continue with {{ p.name }}</span>
        </a>
        <div class="sso-divider"><span>or</span></div>
    </div>
</template>

<script>
import { auth_http } from '@/core/context/account/auth-http';
import { sso_start } from './sso';

const PROVIDERS = [
    { id: 'google', name: 'Google', icon: 'fab fa-google' },
    { id: 'github', name: 'GitHub', icon: 'fab fa-github' }
];

export default {
    name: 'SsoButtons',

    data() {
        return { available: {} };
    },

    computed: {
        enabled() {
            return PROVIDERS.filter(p => this.available[p.id]);
        }
    },

    async created() {
        try {
            this.available = (await auth_http.sso_providers()) || {};
        } catch {
            this.available = {};
        }
    },

    methods: {
        start(provider) {
            sso_start(provider);
        }
    }
};
</script>

<style scoped>
.sso-buttons {
    padding: 0 1em;
}
.sso-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6em;
    margin-bottom: 0.75em;
    padding: 0.6em 1em;
    border: solid 1px #dadada;
    border-radius: 3px;
    color: #2b2b2b;
    font-weight: bold;
    text-decoration: none;
}
.sso-button:hover {
    background-color: #f5f5f5;
}
.sso-button i {
    font-size: 1.2em;
}
.sso-divider {
    display: flex;
    align-items: center;
    gap: 0.75em;
    margin: 0.5em 0 1em;
    color: #8b8b8b;
}
.sso-divider::before,
.sso-divider::after {
    content: '';
    flex: 1;
    border-top: solid 1px #dadada;
}
</style>
