import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual
} from 'crypto';

// Two-factor sign-in (#214): authenticator-app codes (TOTP, RFC 6238: HMAC-SHA1, 30-second
// steps, 6 digits) and single-use recovery codes. Pure: no database, no env.

export const STEP_SECONDS = 30;
export const DIGITS = 6;
// A code from the step before or after the current one is still accepted (clock drift)
export const DRIFT_STEPS = 1;
export const RECOVERY_CODE_COUNT = 10;
export const ISSUER = 'InvokeDB';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32_encode(bytes: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

/** Decodes base32 (any case, spaces and `=` padding ignored). Null for anything else. */
export function base32_decode(text: string): Buffer | null {
    const clean = text.replace(/[\s=]/g, '').toUpperCase();
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;
    for (const char of clean) {
        const index = BASE32.indexOf(char);
        if (index < 0) return null;
        value = ((value << 5) | index) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), base32. */
export function generate_secret(): string {
    return base32_encode(randomBytes(20));
}

/** The HOTP value (RFC 4226) of a counter, `digits` long with leading zeros. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const hash = createHmac('sha1', secret).update(message).digest();
    const offset = hash[hash.length - 1] & 0x0f;
    const binary = hash.readUInt32BE(offset) & 0x7fffffff;
    return String(binary % 10 ** digits).padStart(digits, '0');
}

export function time_step(now_ms: number): number {
    return Math.floor(now_ms / 1000 / STEP_SECONDS);
}

export function totp(secret: Buffer, now_ms: number, digits = DIGITS): string {
    return hotp(secret, time_step(now_ms), digits);
}

/** Six digits, with any spaces or dashes taken out; null if it isn't one. */
export function normalize_totp_code(code: unknown): string | null {
    if (typeof code !== 'string') return null;
    const digits = code.replace(/[\s-]/g, '');
    return new RegExp(`^\\d{${DIGITS}}$`).test(digits) ? digits : null;
}

/**
 * The time step a code matches, or null. Only steps after `last_used_step` count, so a code
 * that has been used (or an older one) can't be used again.
 */
export function match_totp(
    secret_base32: string,
    code: unknown,
    now_ms: number,
    last_used_step: number | null
): number | null {
    const digits = normalize_totp_code(code);
    const secret = base32_decode(secret_base32);
    if (!digits || !secret || !secret.length) return null;
    const current = time_step(now_ms);
    for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
        if (last_used_step !== null && step <= last_used_step) continue;
        if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(digits))) return step;
    }
    return null;
}

/** What the QR code holds: the key URI format that authenticator apps read. */
export function otpauth_url(secret_base32: string, email: string): string {
    const label = encodeURIComponent(`${ISSUER}:${email}`);
    const params = new URLSearchParams({
        secret: secret_base32,
        issuer: ISSUER,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(STEP_SECONDS)
    });
    return `otpauth://totp/${label}?${params}`;
}

// Recovery codes: 16 characters of lowercase base32 (80 random bits), shown as xxxx-xxxx-xxxx-xxxx.
// Only their SHA-256 is stored: they're random enough that a slow hash isn't needed.
const RECOVERY_LENGTH = 16;

export function generate_recovery_codes(count = RECOVERY_CODE_COUNT): string[] {
    const codes: string[] = [];
    while (codes.length < count) {
        const raw = base32_encode(randomBytes(10)).toLowerCase().slice(0, RECOVERY_LENGTH);
        const code = raw.match(/.{4}/g).join('-');
        if (!codes.includes(code)) codes.push(code);
    }
    return codes;
}

/** A recovery code without case, spaces or dashes; null if it can't be one. */
export function normalize_recovery_code(code: unknown): string | null {
    if (typeof code !== 'string') return null;
    const clean = code.replace(/[\s-]/g, '').toLowerCase();
    return new RegExp(`^[a-z2-7]{${RECOVERY_LENGTH}}$`).test(clean) ? clean : null;
}

export function hash_recovery_code(code: string): string | null {
    const clean = normalize_recovery_code(code);
    return clean ? createHash('sha256').update(clean, 'utf8').digest('hex') : null;
}

// The TOTP secret has to be read back to check codes, so it's encrypted rather than hashed:
// AES-256-GCM under the server's key (HORIZON_TOTP_KEY), bound to the account id, so a secret
// copied onto another account's row doesn't decrypt.
const ENCRYPTION_VERSION = 'v1';

/** The 32-byte key from the configured value (any string; hex from `openssl rand -hex 32`). */
export function derive_key(value: string): Buffer {
    return createHash('sha256').update(`invokedb-totp:${value}`, 'utf8').digest();
}

export function encrypt_secret(secret: string, key: Buffer, account_id: number): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`account:${account_id}`));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENCRYPTION_VERSION, iv, tag, encrypted]
        .map(part => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
}

/** The secret, or null when it doesn't decrypt (another key, another account, or tampered). */
export function decrypt_secret(stored: string, key: Buffer, account_id: number): string | null {
    const [version, iv, tag, encrypted] = (stored || '').split('.');
    if (version !== ENCRYPTION_VERSION || !iv || !tag || encrypted === undefined) return null;
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(`account:${account_id}`));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'base64url')),
            decipher.final()
        ]).toString('utf8');
    } catch {
        return null;
    }
}
