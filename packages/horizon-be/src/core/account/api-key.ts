import { randomInt } from 'node:crypto';

const API_KEY_LENGTH = 32;
const API_KEY_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// An API key opens its account's tables, so it must be unguessable: crypto.randomInt, never
// Math.random (predictable; CodeQL js/insecure-randomness). Same 32-character format as before.
export function generate_api_key(): string {
    let key = '';
    for (let i = 0; i < API_KEY_LENGTH; i++) {
        key += API_KEY_CHARS[randomInt(API_KEY_CHARS.length)];
    }
    return key;
}
