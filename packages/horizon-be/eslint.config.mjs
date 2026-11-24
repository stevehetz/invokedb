import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Replaces tslint (tslint:recommended plus the old tslint.json overrides). ESLint's and
// typescript-eslint's recommended rules, minus those the code doesn't pass yet. Formatting is
// prettier's job (the root prettier, at commit time), not ESLint's.
export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node }
        },
        rules: {
            // Off in the old tslint.json too (no-var-requires, no-empty)
            '@typescript-eslint/no-require-imports': 'off',
            'no-empty': 'off',

            // Not checked by tslint:recommended, and the code doesn't pass them yet. Turn each
            // on once the code is cleaned up (no-explicit-any goes with the strict tsconfig).
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            'no-constant-binary-expression': 'off',
            'no-control-regex': 'off',
            'no-useless-assignment': 'off',
            'no-useless-escape': 'off',
            'preserve-caught-error': 'off',
            'prefer-const': 'off'
        }
    }
);
