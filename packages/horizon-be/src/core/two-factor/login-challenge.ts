import { randomBytes } from 'crypto';

// The step between a right password and a session when two-factor sign-in is on (#214): the
// password login answers a challenge token, and /auth/login/two-factor trades it and a code for
// a session. Kept in memory (there is one API process, as for the rate limits, #133): a restart
// only means typing the password again.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Wrong codes allowed per challenge; then the password has to be entered again
export const CHALLENGE_MAX_ATTEMPTS = 5;

interface Challenge {
    account_id: number;
    expires_at: number;
    attempts: number;
}

export class LoginChallenges {
    private readonly challenges = new Map<string, Challenge>();

    constructor(private readonly now: () => number = Date.now) {}

    create(account_id: number): string {
        this.sweep();
        const token = randomBytes(32).toString('hex');
        this.challenges.set(token, {
            account_id,
            expires_at: this.now() + CHALLENGE_TTL_MS,
            attempts: 0
        });
        return token;
    }

    /**
     * Counts an attempt on the challenge and answers its account id, or null when the challenge
     * is unknown, expired or out of attempts (it's then dropped).
     */
    attempt(token: unknown): number | null {
        if (typeof token !== 'string' || !token) return null;
        const challenge = this.challenges.get(token);
        if (!challenge) return null;
        if (challenge.expires_at <= this.now() || challenge.attempts >= CHALLENGE_MAX_ATTEMPTS) {
            this.challenges.delete(token);
            return null;
        }
        challenge.attempts++;
        return challenge.account_id;
    }

    /** Ends a challenge (after the right code): it can't be used again. */
    consume(token: string) {
        this.challenges.delete(token);
    }

    get size() {
        return this.challenges.size;
    }

    private sweep() {
        const now = this.now();
        for (const [token, challenge] of this.challenges) {
            if (challenge.expires_at <= now) this.challenges.delete(token);
        }
    }
}
