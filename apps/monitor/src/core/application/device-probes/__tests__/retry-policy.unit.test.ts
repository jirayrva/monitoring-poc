import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retryDelay } from '../retry-policy.ts';
import type { RetryPolicy } from '../retry-policy.ts';

const delays = (policy: RetryPolicy, random: () => number) => {
  const result: number[] = [];
  for (let retry = 0; retry < 20; retry++) {
    const delay = retryDelay(policy, retry, random);
    if (delay === undefined) {
      return result;
    }
    result.push(delay);
  }
  return result;
};

describe('retryDelay', () => {
  it('never retries when no retries are allowed', () => {
    // Act
    const result = delays({ retries: 0, baseDelayMs: 100, maxDelayMs: 500 }, () => 0.5);

    // Assert
    assert.deepEqual(result, []);
  });

  it('doubles the backoff up to the maximum', () => {
    // Act
    const result = delays({ retries: 5, baseDelayMs: 100, maxDelayMs: 500 }, () => 1);

    // Assert
    assert.deepEqual(result, [100, 200, 400, 500, 500]);
  });

  it('waits a random time up to the backoff', () => {
    // Act
    const result = delays({ retries: 3, baseDelayMs: 100, maxDelayMs: 1000 }, () => 0.25);

    // Assert
    assert.deepEqual(result, [25, 50, 100]);
  });
});
