import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import env from '@app/env';
import logger from '@app/logger';
import { Account } from '@app/core/account/account.entity';
import { TwoFactor } from '@app/core/two-factor/two-factor.entity';
import { LoginChallenges } from '@app/core/two-factor/login-challenge';
import { qr_svg_data_uri } from '@app/core/two-factor/qr';
import {
    decrypt_secret,
    derive_key,
    encrypt_secret,
    generate_recovery_codes,
    generate_secret,
    hash_recovery_code,
    match_totp,
    normalize_recovery_code,
    normalize_totp_code,
    otpauth_url
} from '@app/core/two-factor/totp';
import { RateLimiter, TOO_MANY_REQUESTS_MESSAGE } from '@app/web/http/_rate-limit/rate-limit';

const HOUR = 60 * 60 * 1000;
// Code attempts per account per hour, across sign-in, turning on and turning off (#214, as the
// password routes are limited, #133). Every attempt counts, right or wrong.
export const CODE_ATTEMPTS_PER_HOUR = 10;

// Only for a local stack (IS_LOCAL) with no HORIZON_TOTP_KEY: not a secret
const LOCAL_KEY = 'invokedb-local-development-totp-key';

const bad_request = (message: string) => new HttpException(message, HttpStatus.BAD_REQUEST);
const wrong_code = () =>
    bad_request("That code isn't right. Enter the current code from your app, or a recovery code.");

export type CodeKind = 'totp' | 'recovery';

/**
 * Optional two-factor sign-in for password accounts (#214): an authenticator app (TOTP) set up
 * from the Account page, plus 10 single-use recovery codes. Google and GitHub sign-in rely on the
 * provider's own two-factor, so they don't ask for a code.
 */
@Injectable()
export class TwoFactorService {
    private readonly challenges = new LoginChallenges();
    private readonly attempts = new RateLimiter(CODE_ATTEMPTS_PER_HOUR, HOUR);
    private readonly key: Buffer | null;

    constructor(
        @InjectRepository(TwoFactor)
        private readonly two_factor_repository: Repository<TwoFactor>,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>
    ) {
        const value = env.HORIZON_TOTP_KEY || (env.IS_LOCAL ? LOCAL_KEY : null);
        this.key = value ? derive_key(value) : null;
    }

    /** The Account page's view: `{ available, password_account, enabled, recovery_codes_left }`. */
    async status(account_id: number) {
        const account = await this.live_account(account_id);
        const row = await this.two_factor_repository.findOneBy({ account_id });
        const enabled = !!row?.enabled;
        return {
            available: !!this.key,
            password_account: !!account.password_hash,
            enabled,
            enabled_datetime: enabled ? row.enabled_datetime : null,
            recovery_codes_left: enabled ? row.recovery_code_hashes.length : 0
        };
    }

    /**
     * Starts (or restarts) the setup: a new secret, its QR code and the otpauth URL. Nothing
     * changes at login until `enable` confirms it with a code.
     */
    async setup(account_id: number) {
        const account = await this.live_account(account_id);
        this.assert_can_use(account);
        const existing = await this.two_factor_repository.findOneBy({ account_id });
        if (existing?.enabled) {
            throw new HttpException('Two-factor sign-in is already on.', HttpStatus.CONFLICT);
        }

        const secret = generate_secret();
        await this.two_factor_repository.save({
            account_id,
            secret_encrypted: encrypt_secret(secret, this.key, account_id),
            enabled: false,
            last_used_step: null,
            recovery_code_hashes: [],
            created_datetime: new Date(),
            enabled_datetime: null
        });

        const url = otpauth_url(secret, account.email);
        return { secret, otpauth_url: url, qr_code: qr_svg_data_uri(url) };
    }

    /** Confirms the setup with a code from the app. Answers the recovery codes, shown once. */
    async enable(account_id: number, code: unknown) {
        const account = await this.live_account(account_id);
        this.assert_can_use(account);
        this.count_attempt(account_id);

        const row = await this.two_factor_repository.findOneBy({ account_id });
        if (row?.enabled) {
            throw new HttpException('Two-factor sign-in is already on.', HttpStatus.CONFLICT);
        }
        if (!row) throw bad_request('Start the setup first.');
        if (!normalize_totp_code(code)) throw bad_request('Enter the 6-digit code from your app.');

        const secret = decrypt_secret(row.secret_encrypted, this.key, account_id);
        const step = secret ? match_totp(secret, code, Date.now(), null) : null;
        if (step === null) throw bad_request("That code isn't right. Check your app's clock.");

        const recovery_codes = generate_recovery_codes();
        const result = await this.two_factor_repository
            .createQueryBuilder()
            .update(TwoFactor)
            .set({
                enabled: true,
                last_used_step: step,
                recovery_code_hashes: recovery_codes.map(hash_recovery_code),
                enabled_datetime: new Date()
            })
            .where('account_id = :account_id AND enabled = false', { account_id })
            .andWhere('secret_encrypted = :secret_encrypted', {
                secret_encrypted: row.secret_encrypted
            })
            .execute();
        if (result.affected !== 1) throw bad_request('Start the setup again.');

        logger.info(`Two-factor sign-in turned on for account ${account_id}.`);
        return { enabled: true, recovery_codes };
    }

    /** Turns it off; needs a current code or a recovery code. */
    async disable(account_id: number, code: unknown) {
        await this.live_account(account_id);
        this.count_attempt(account_id);

        const row = await this.two_factor_repository.findOneBy({ account_id, enabled: true });
        if (!row) throw bad_request('Two-factor sign-in is off.');
        if (!(await this.use_code(row, code))) throw wrong_code();

        await this.two_factor_repository.delete({ account_id });
        logger.info(`Two-factor sign-in turned off for account ${account_id}.`);
        return { enabled: false };
    }

    async is_enabled(account_id: number): Promise<boolean> {
        if (!account_id) return false;
        return (await this.two_factor_repository.countBy({ account_id, enabled: true })) > 0;
    }

    /** After the right password, when two-factor is on: the token the code step needs. */
    start_login(account_id: number): string {
        return this.challenges.create(account_id);
    }

    /**
     * The code step of a password sign-in. Answers the account to start a session for, or
     * throws: 400 for a wrong code or a gone challenge, 429 past the account's attempt limit.
     */
    async finish_login(challenge: unknown, code: unknown) {
        const account_id = this.challenges.attempt(challenge);
        if (!account_id) {
            throw bad_request('This sign-in has expired. Enter your email and password again.');
        }
        this.count_attempt(account_id);

        const account = await this.account_repository.findOneBy({ id: account_id, deleted: false });
        const row = await this.two_factor_repository.findOneBy({ account_id, enabled: true });
        if (!account) throw wrong_code();
        if (row) {
            const kind = await this.use_code(row, code);
            if (!kind) throw wrong_code();
            if (kind === 'recovery') {
                logger.info(`Account ${account_id} signed in with a recovery code.`);
            }
        }
        // (No row: two-factor was turned off since the password step; the password was right.)
        this.challenges.consume(challenge as string);
        return account;
    }

    /**
     * Checks a code against the row and uses it up: a TOTP code's time step can't be used again,
     * and a recovery code is removed. Both are single conditional updates, so two requests with
     * the same code can't both pass. Answers which kind matched, or null.
     */
    private async use_code(row: TwoFactor, code: unknown): Promise<CodeKind | null> {
        const account_id = row.account_id;
        if (normalize_totp_code(code)) {
            const secret = this.key
                ? decrypt_secret(row.secret_encrypted, this.key, account_id)
                : null;
            if (!secret) {
                logger.error(
                    `Two-factor secret of account ${account_id} doesn't decrypt (HORIZON_TOTP_KEY changed or unset?).`
                );
                return null;
            }
            const step = match_totp(secret, code, Date.now(), row.last_used_step);
            if (step === null) return null;
            const result = await this.two_factor_repository
                .createQueryBuilder()
                .update(TwoFactor)
                .set({ last_used_step: step })
                .where('account_id = :account_id AND enabled = true', { account_id })
                .andWhere('(last_used_step IS NULL OR last_used_step < :step)', { step })
                .execute();
            return result.affected === 1 ? 'totp' : null;
        }

        if (normalize_recovery_code(code)) {
            const hash = hash_recovery_code(code as string);
            const result = await this.two_factor_repository
                .createQueryBuilder()
                .update(TwoFactor)
                .set({ recovery_code_hashes: () => 'array_remove(recovery_code_hashes, :hash)' })
                .where('account_id = :account_id AND enabled = true', { account_id })
                .andWhere(':hash = ANY(recovery_code_hashes)', { hash })
                .execute();
            return result.affected === 1 ? 'recovery' : null;
        }

        return null;
    }

    private count_attempt(account_id: number) {
        if (!this.attempts.hit(`account:${account_id}`)) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    private assert_can_use(account: Account) {
        if (!account.password_hash) {
            throw bad_request(
                'Two-factor sign-in is for accounts with a password. Google and GitHub sign-in use the two-factor you set up there.'
            );
        }
        if (!this.key) {
            throw new HttpException(
                "Two-factor sign-in isn't available on this server yet.",
                HttpStatus.SERVICE_UNAVAILABLE
            );
        }
    }

    private async live_account(account_id: number): Promise<Account> {
        const account = account_id
            ? await this.account_repository.findOneBy({ id: account_id, deleted: false })
            : null;
        if (!account) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
        return account;
    }
}
