import { account_theme, parse_theme } from './theme';

describe('theme (#290)', () => {
    it('accepts the three choices', () => {
        expect(parse_theme('system')).toBe('system');
        expect(parse_theme('light')).toBe('light');
        expect(parse_theme('dark')).toBe('dark');
    });

    it('refuses anything else', () => {
        for (const value of ['Dark', 'blue', '', null, undefined, 1, {}, ['dark']]) {
            expect(parse_theme(value)).toBeNull();
        }
    });

    it("reads an account's stored value, defaulting to system", () => {
        expect(account_theme('dark')).toBe('dark');
        expect(account_theme(null)).toBe('system');
        expect(account_theme('purple')).toBe('system');
    });
});
