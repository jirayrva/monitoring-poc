/** How a device call that could get another answer is retried (D-35): exponential backoff with full jitter. */
type RetryPolicy = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

type Random = () => number;

/**
 * How long to wait before the given retry, counting from 0, or undefined when the policy allows no more. The wait is
 * a random time up to the backoff, which spreads retries from many devices. Jitter only shortens a wait (D-36).
 */
const retryDelay = (policy: RetryPolicy, retry: number, random: Random) =>
  retry < policy.retries ? random() * Math.min(policy.baseDelayMs * 2 ** retry, policy.maxDelayMs) : undefined;

export { retryDelay };
export type { Random, RetryPolicy };
