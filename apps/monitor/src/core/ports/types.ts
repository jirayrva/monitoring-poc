type Result<Value, Failure> = { ok: true; value: Value } | { ok: false; failure: Failure };

type CallOptions = { signal: AbortSignal };

/** Why a datastore call failed. A timeout or a cancel leaves a write's outcome unknown. */
type StoreFailure = { reason: 'unavailable' | 'timeout' | 'cancelled' };

export type { Result, CallOptions, StoreFailure };
