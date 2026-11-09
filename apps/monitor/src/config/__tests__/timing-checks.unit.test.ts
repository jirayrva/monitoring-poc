import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../load-config.ts';
import { checkTimings } from '../timing-checks.ts';

const defaults = loadConfig({}).monitoring;

describe('checkTimings', () => {
  it('finds nothing wrong with the defaults: two attempts and a wait fit the health budget', () => {
    // Act
    const warnings = checkTimings(defaults);

    // Assert
    assert.deepEqual(warnings, []);
  });

  it('warns when the attempts and the waits between them do not fit the health budget', () => {
    // Act
    const warnings = checkTimings({ ...defaults, healthBudgetMs: 6999 });

    // Assert
    assert.deepEqual(warnings, [
      'MONITORING_HEALTH_BUDGET_MS is 6999 ms, but 2 attempts of 3000 ms and the waits between them can take 7000 ms, so the last attempt can be cut short',
    ]);
  });

  it('warns for the diagnostics budget as for the health budget, with the same retries', () => {
    // Act
    const warnings = checkTimings({ ...defaults, diagnosticsBudgetMs: 6999 });

    // Assert
    assert.deepEqual(warnings, [
      'MONITORING_DIAGNOSTICS_BUDGET_MS is 6999 ms, but 2 attempts of 3000 ms and the waits between them can take 7000 ms, so the last attempt can be cut short',
    ]);
  });

  it('counts every wait at its longest, capped at the largest delay', () => {
    // Act: 4 attempts of 1000 ms, and waits of 1000, 1500 and 1500 ms.
    const warnings = checkTimings({
      ...defaults,
      healthAttemptTimeoutMs: 1000,
      healthBudgetMs: 7999,
      retry: { retries: 3, baseDelayMs: 1000, maxDelayMs: 1500 },
    });

    // Assert
    assert.match(warnings[0] ?? '', /4 attempts of 1000 ms and the waits between them can take 8000 ms/);
  });

  it('counts one attempt when nothing is retried', () => {
    // Act
    const warnings = checkTimings({ ...defaults, healthBudgetMs: 2999, retry: { ...defaults.retry, retries: 0 } });

    // Assert
    assert.match(warnings[0] ?? '', /1 attempts of 3000 ms and the waits between them can take 3000 ms/);
  });
});
