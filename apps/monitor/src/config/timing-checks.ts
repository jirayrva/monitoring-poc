import type { ProbePolicy } from '../core/application/device-probes/index.ts';
import { retryDelay } from '../core/application/device-probes/retry-policy.ts';

/** A random that makes every wait its longest: jitter only shortens a wait. */
const longest = () => 1;

/**
 * Settings that work, but not as meant: a step's attempts and the waits between them that do not fit its budget, so
 * the last attempt can be cut short (D-37). One sentence each, to log as a warning at startup.
 */
const checkTimings = (policy: ProbePolicy): string[] => {
  let attempts = 1;
  let waitsMs = 0;
  for (let delay = retryDelay(policy.retry, 0, longest); delay !== undefined;) {
    waitsMs += delay;
    delay = retryDelay(policy.retry, attempts, longest);
    attempts += 1;
  }

  const steps = [
    ['MONITORING_HEALTH_BUDGET_MS', policy.healthAttemptTimeoutMs, policy.healthBudgetMs],
    ['MONITORING_DIAGNOSTICS_BUDGET_MS', policy.diagnosticsAttemptTimeoutMs, policy.diagnosticsBudgetMs],
  ] as const;
  return steps.flatMap(([name, attemptTimeoutMs, budgetMs]) => {
    const neededMs = attempts * attemptTimeoutMs + waitsMs;
    return neededMs > budgetMs
      ? [
          `${name} is ${budgetMs} ms, but ${attempts} attempts of ${attemptTimeoutMs} ms and the waits between them can take ${neededMs} ms, so the last attempt can be cut short`,
        ]
      : [];
  });
};

export { checkTimings };
