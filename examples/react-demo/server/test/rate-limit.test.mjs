import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../rate-limit.mjs';

test('allows a burst, then refuses until tokens come back', () => {
  let t = 0;
  const limiter = createRateLimiter({ perSecond: 2, burst: 3, now: () => t });
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, true);
  const refused = limiter.take('a');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 1);
  t += 500; // one token back at 2 a second
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
  t += 10_000; // never more than the burst
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
});

test('keeps a bucket per key', () => {
  let t = 0;
  const limiter = createRateLimiter({ perSecond: 1, burst: 1, now: () => t });
  assert.equal(limiter.take('1.1.1.1').ok, true);
  assert.equal(limiter.take('1.1.1.1').ok, false);
  assert.equal(limiter.take('2.2.2.2').ok, true);
});

test('drops idle buckets and stays within maxKeys', () => {
  let t = 0;
  const limiter = createRateLimiter({ perSecond: 1, burst: 2, maxKeys: 2, now: () => t });
  limiter.take('a');
  limiter.take('b');
  // Both busy: a third key is refused rather than forgetting them
  assert.equal(limiter.take('c').ok, false);
  assert.equal(limiter.size(), 2);
  t += 5000; // both refilled: idle, so pruned to make room
  assert.equal(limiter.take('c').ok, true);
  assert.equal(limiter.size(), 1);
});

test('a slow rate asks to wait longer', () => {
  let t = 0;
  const limiter = createRateLimiter({ perSecond: 0.5, burst: 1, now: () => t });
  limiter.take('a');
  assert.equal(limiter.take('a').retryAfterSec, 2);
});
