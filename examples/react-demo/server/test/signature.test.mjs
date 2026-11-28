import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signatureHeader, verifySignature, TOLERANCE_SEC } from '../signature.mjs';

const secret = 'whsec_0123456789abcdef';
const body = JSON.stringify({ id: 'dlv_1', event: 'row.created', rows: [] });
const now = 1_800_000_000;

test('accepts a signature made the way InvokeDB makes it', () => {
  // HMAC-SHA256 of "<t>.<body>", hex (core/webhook/webhook.ts in the backend)
  const v1 = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
  assert.equal(verifySignature(secret, body, `t=${now},v1=${v1}`, now), true);
  assert.equal(verifySignature(secret, Buffer.from(body), `t=${now},v1=${v1}`, now), true);
});

test('accepts any matching v1 among several (secret rotation)', () => {
  const good = signatureHeader(secret, body, now).split(',')[1];
  const other = signatureHeader('whsec_other', body, now).split(',')[1];
  assert.equal(verifySignature(secret, body, `t=${now},${other},${good}`, now), true);
});

test('refuses a changed body, another secret or a missing header', () => {
  const header = signatureHeader(secret, body, now);
  assert.equal(verifySignature(secret, body + ' ', header, now), false);
  assert.equal(verifySignature('whsec_other', body, header, now), false);
  assert.equal(verifySignature(secret, body, undefined, now), false);
  assert.equal(verifySignature(secret, body, '', now), false);
  assert.equal(verifySignature('', body, header, now), false);
});

test('refuses old and future timestamps outside the window', () => {
  const old = signatureHeader(secret, body, now - TOLERANCE_SEC - 1);
  const future = signatureHeader(secret, body, now + TOLERANCE_SEC + 1);
  const edge = signatureHeader(secret, body, now - TOLERANCE_SEC);
  assert.equal(verifySignature(secret, body, old, now), false);
  assert.equal(verifySignature(secret, body, future, now), false);
  assert.equal(verifySignature(secret, body, edge, now), true);
});

test('refuses malformed headers', () => {
  const v1 = signatureHeader(secret, body, now).split(',')[1];
  for (const header of [
    v1,
    `t=abc,${v1}`,
    `t=${now},t=${now},${v1}`,
    `t=${now},v1=zz`,
    `t=${now},v1=${'0'.repeat(64)}`,
    `t=${now},v0=${v1.slice(3)}`,
    `t=${now}.5,${v1}`,
    'x'.repeat(2000)
  ]) {
    assert.equal(verifySignature(secret, body, header, now), false, header);
  }
});
