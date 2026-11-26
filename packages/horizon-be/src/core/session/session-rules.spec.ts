import { session_usable } from './session-rules';

// A login session is refused once its account is deleted (#282)
describe('session_usable', () => {
    const later = new Date(Date.now() + 60_000);
    const earlier = new Date(Date.now() - 60_000);

    it('accepts an unexpired session of a live account', () => {
        expect(session_usable({ expired_datetime: later }, { deleted: false })).toBe(true);
    });

    it('accepts a session with no expiry of a live account', () => {
        expect(session_usable({ expired_datetime: null }, { deleted: false })).toBe(true);
    });

    it('refuses a session of a deleted account', () => {
        expect(session_usable({ expired_datetime: later }, { deleted: true })).toBe(false);
    });

    it('refuses a session whose account is gone', () => {
        expect(session_usable({ expired_datetime: later }, null)).toBe(false);
    });

    it('refuses an expired session', () => {
        expect(session_usable({ expired_datetime: earlier }, { deleted: false })).toBe(false);
    });

    it('refuses a missing session', () => {
        expect(session_usable(null, { deleted: false })).toBe(false);
    });
});
