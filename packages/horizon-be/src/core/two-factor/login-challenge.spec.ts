import { CHALLENGE_MAX_ATTEMPTS, CHALLENGE_TTL_MS, LoginChallenges } from './login-challenge';

describe('LoginChallenges', () => {
    let now = 1_000_000;
    const clock = () => now;

    beforeEach(() => {
        now = 1_000_000;
    });

    it('answers the account of a live challenge', () => {
        const challenges = new LoginChallenges(clock);
        const token = challenges.create(42);
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(challenges.attempt(token)).toBe(42);
        expect(challenges.attempt(token)).toBe(42);
    });

    it('refuses unknown or malformed challenges', () => {
        const challenges = new LoginChallenges(clock);
        challenges.create(1);
        expect(challenges.attempt('nope')).toBeNull();
        expect(challenges.attempt(undefined)).toBeNull();
        expect(challenges.attempt({ token: 'x' })).toBeNull();
    });

    it('can be used up once', () => {
        const challenges = new LoginChallenges(clock);
        const token = challenges.create(1);
        challenges.consume(token);
        expect(challenges.attempt(token)).toBeNull();
    });

    it('expires', () => {
        const challenges = new LoginChallenges(clock);
        const token = challenges.create(1);
        now += CHALLENGE_TTL_MS;
        expect(challenges.attempt(token)).toBeNull();
        expect(challenges.size).toBe(0);
    });

    it(`allows ${CHALLENGE_MAX_ATTEMPTS} attempts, then drops the challenge`, () => {
        const challenges = new LoginChallenges(clock);
        const token = challenges.create(1);
        for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i++) expect(challenges.attempt(token)).toBe(1);
        expect(challenges.attempt(token)).toBeNull();
        expect(challenges.size).toBe(0);
    });

    it('sweeps expired challenges when a new one is made', () => {
        const challenges = new LoginChallenges(clock);
        challenges.create(1);
        challenges.create(2);
        now += CHALLENGE_TTL_MS + 1;
        challenges.create(3);
        expect(challenges.size).toBe(1);
    });
});
