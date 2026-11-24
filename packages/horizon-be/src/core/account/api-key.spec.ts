import { generate_api_key } from './account.manager';

describe('generate_api_key', () => {
    it('makes 32 alphanumeric characters', () => {
        for (let i = 0; i < 100; i++) {
            expect(generate_api_key()).toMatch(/^[0-9a-zA-Z]{32}$/);
        }
    });

    it('makes a different key every time', () => {
        const keys = new Set(Array.from({ length: 1000 }, () => generate_api_key()));
        expect(keys.size).toBe(1000);
    });

    it('uses the whole alphabet', () => {
        const seen = new Set(Array.from({ length: 200 }, () => generate_api_key()).join(''));
        expect(seen.size).toBe(62);
    });
});
