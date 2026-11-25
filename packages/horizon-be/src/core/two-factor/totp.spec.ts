import {
    base32_decode,
    base32_encode,
    decrypt_secret,
    derive_key,
    encrypt_secret,
    generate_recovery_codes,
    generate_secret,
    hash_recovery_code,
    hotp,
    match_totp,
    normalize_recovery_code,
    normalize_totp_code,
    otpauth_url,
    totp,
    time_step
} from './totp';
import { qr_svg_data_uri } from './qr';

// RFC 6238 appendix B (SHA-1): the seed is the ASCII "12345678901234567890"
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_SEED_BASE32 = base32_encode(RFC_SEED);

describe('base32', () => {
    it('matches RFC 4648 test vectors', () => {
        expect(base32_encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
        expect(base32_encode(Buffer.from('f'))).toBe('MY');
        expect(base32_decode('MZXW6YTBOI').toString()).toBe('foobar');
        expect(base32_decode('mzxw 6ytb oi======').toString()).toBe('foobar');
    });

    it('refuses characters outside the alphabet', () => {
        expect(base32_decode('MZXW1')).toBeNull();
    });

    it('round-trips a generated secret of 20 bytes', () => {
        const secret = generate_secret();
        expect(secret).toMatch(/^[A-Z2-7]{32}$/);
        expect(base32_decode(secret)).toHaveLength(20);
    });
});

describe('hotp / totp', () => {
    it('matches RFC 4226 appendix D', () => {
        const expected = ['755224', '287082', '359152', '969429', '338314'];
        expected.forEach((code, counter) => expect(hotp(RFC_SEED, counter)).toBe(code));
    });

    it('matches RFC 6238 appendix B (8 digits)', () => {
        expect(totp(RFC_SEED, 59 * 1000, 8)).toBe('94287082');
        expect(totp(RFC_SEED, 1111111109 * 1000, 8)).toBe('07081804');
        expect(totp(RFC_SEED, 1234567890 * 1000, 8)).toBe('89005924');
        expect(totp(RFC_SEED, 20000000000 * 1000, 8)).toBe('65353130');
    });
});

describe('match_totp', () => {
    const now = 1234567890 * 1000;
    const current = time_step(now);
    const code_at = (step: number) => hotp(RFC_SEED, step);

    it('accepts the current code and one step either side, answering its step', () => {
        expect(match_totp(RFC_SEED_BASE32, code_at(current), now, null)).toBe(current);
        expect(match_totp(RFC_SEED_BASE32, code_at(current - 1), now, null)).toBe(current - 1);
        expect(match_totp(RFC_SEED_BASE32, code_at(current + 1), now, null)).toBe(current + 1);
    });

    it('refuses codes from further away', () => {
        expect(match_totp(RFC_SEED_BASE32, code_at(current - 2), now, null)).toBeNull();
        expect(match_totp(RFC_SEED_BASE32, code_at(current + 2), now, null)).toBeNull();
    });

    it('refuses a code whose step was used, or an earlier one (no replay)', () => {
        expect(match_totp(RFC_SEED_BASE32, code_at(current), now, current)).toBeNull();
        expect(match_totp(RFC_SEED_BASE32, code_at(current - 1), now, current - 1)).toBeNull();
        expect(match_totp(RFC_SEED_BASE32, code_at(current + 1), now, current)).toBe(current + 1);
    });

    it('takes spaces in the code and refuses anything not six digits', () => {
        const code = code_at(current);
        expect(match_totp(RFC_SEED_BASE32, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(
            current
        );
        expect(match_totp(RFC_SEED_BASE32, code.slice(1), now, null)).toBeNull();
        expect(match_totp(RFC_SEED_BASE32, 123456 as any, now, null)).toBeNull();
        expect(match_totp(RFC_SEED_BASE32, undefined, now, null)).toBeNull();
        expect(match_totp('not base32!', code, now, null)).toBeNull();
    });

    it('normalizes codes', () => {
        expect(normalize_totp_code(' 123-456 ')).toBe('123456');
        expect(normalize_totp_code('12345a')).toBeNull();
    });
});

describe('otpauth_url', () => {
    it('names the issuer and account and carries the settings', () => {
        const url = new URL(otpauth_url('JBSWY3DPEHPK3PXP', 'a+b@x.com'));
        expect(url.protocol).toBe('otpauth:');
        expect(url.host).toBe('totp');
        expect(decodeURIComponent(url.pathname)).toBe('/InvokeDB:a+b@x.com');
        expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
        expect(url.searchParams.get('issuer')).toBe('InvokeDB');
        expect(url.searchParams.get('digits')).toBe('6');
        expect(url.searchParams.get('period')).toBe('30');
    });

    it('draws as an SVG data URI', () => {
        const uri = qr_svg_data_uri(otpauth_url('JBSWY3DPEHPK3PXP', 'a@x.com'));
        expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
        const svg = Buffer.from(uri.split(',')[1], 'base64').toString();
        expect(svg).toContain('<svg');
        expect(svg).toContain('<path d="M');
    });
});

describe('recovery codes', () => {
    it('makes 10 different codes of 80 bits, formatted in groups', () => {
        const codes = generate_recovery_codes();
        expect(codes).toHaveLength(10);
        expect(new Set(codes).size).toBe(10);
        codes.forEach(code => expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/));
    });

    it('hashes the same code the same however it is typed', () => {
        const [code] = generate_recovery_codes(1);
        const hash = hash_recovery_code(code);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash_recovery_code(code.toUpperCase().replace(/-/g, ' '))).toBe(hash);
        expect(hash_recovery_code(code.replace(/-/g, ''))).toBe(hash);
    });

    it('refuses what cannot be a recovery code', () => {
        expect(normalize_recovery_code('123456')).toBeNull();
        expect(normalize_recovery_code('abcd-efgh-ijkl-mno1')).toBeNull();
        expect(hash_recovery_code('')).toBeNull();
        expect(normalize_recovery_code(null)).toBeNull();
    });
});

describe('secret encryption', () => {
    const key = derive_key('test-key');

    it('round-trips, with a new IV each time', () => {
        const secret = generate_secret();
        const a = encrypt_secret(secret, key, 7);
        const b = encrypt_secret(secret, key, 7);
        expect(a).not.toBe(b);
        expect(a).not.toContain(secret);
        expect(decrypt_secret(a, key, 7)).toBe(secret);
    });

    it("doesn't decrypt under another key or another account, or when changed", () => {
        const stored = encrypt_secret(generate_secret(), key, 7);
        expect(decrypt_secret(stored, derive_key('other'), 7)).toBeNull();
        expect(decrypt_secret(stored, key, 8)).toBeNull();
        const parts = stored.split('.');
        parts[3] = Buffer.from('tampered').toString('base64url');
        expect(decrypt_secret(parts.join('.'), key, 7)).toBeNull();
        expect(decrypt_secret('garbage', key, 7)).toBeNull();
        expect(decrypt_secret('', key, 7)).toBeNull();
    });
});
