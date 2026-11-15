import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

// Same scope as the old config (plugin:vue/essential, no other rules), now for Vue 3.
// Formatting is prettier's job (the root prettier, at commit time), not ESLint's.
export default [
    { ignores: ['dist/**', 'public/**'] },
    ...pluginVue.configs['flat/essential'],
    {
        files: ['src/**/*.{js,vue}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node, _: 'readonly' }
        },
        rules: {
            // Component names (Home, Layout, Account) predate this rule
            'vue/multi-word-component-names': 'off'
        }
    }
];
