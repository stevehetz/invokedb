// Checks an InvokeDB webhook's signature. Every delivery carries
//   InvokeDB-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// signed with the webhook's secret (whsec_...). A receiver must check it over the raw body,
// before parsing, and refuse old timestamps so a captured delivery can't be replayed.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'invokedb-signature';
// What InvokeDB itself documents as the window (5 minutes either way)
export const TOLERANCE_SEC = 5 * 60;

/**
 * @param {string} secret the webhook's signing secret
 * @param {string | Buffer} body the raw request body, exactly as received
 * @param {unknown} header the InvokeDB-Signature header
 * @param {number} nowSec the current time in Unix seconds
 * @returns {boolean} true if one of the header's v1 signatures matches and t is recent
 */
export function verifySignature(secret, body, header, nowSec, toleranceSec = TOLERANCE_SEC) {
  if (!secret || typeof header !== 'string' || header.length > 1000) return false;
  /** @type {Record<string, string[]>} */
  const parts = {};
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    (parts[key] ||= []).push(part.slice(i + 1).trim());
  }
  if (!parts.t || parts.t.length !== 1 || !/^\d{1,12}$/.test(parts.t[0])) return false;
  const t = Number(parts.t[0]);
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  return (parts.v1 || []).some(
    v => /^[0-9a-f]{64}$/.test(v) && timingSafeEqual(Buffer.from(v, 'hex'), expected)
  );
}

/** The header InvokeDB would send for this body at `t` (for tests and local trials). */
export function signatureHeader(secret, body, t) {
  const v1 = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
  return `t=${t},v1=${v1}`;
}
