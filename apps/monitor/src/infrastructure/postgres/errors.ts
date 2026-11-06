type PostgresErrorKind = 'cancelled' | 'timeout' | 'unavailable' | 'unique_violation';

const uniqueViolation = '23505';
const queryCanceled = '57014';

/** Server codes that mean the database cannot serve us right now, rather than a bad query. */
const unavailableServerCodes = new Set(['53300', '57P01', '57P02', '57P03']);

const unavailableSocketCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

/** pg reports a lost connection, or a pool that could not connect in time, with no code at all. */
const unavailableMessage = /^Connection terminated|^timeout exceeded when trying to connect/;

/** pg's own query_timeout, which also has no code. */
const timeoutMessage = /^Query read timeout/;

class QueryCancelledError extends Error {
  constructor(options?: ErrorOptions) {
    super('The caller aborted the query', options);
    this.name = 'QueryCancelledError';
  }
}

const errorCode = (error: unknown) =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const classifyPostgresError = (error: unknown): PostgresErrorKind | undefined => {
  if (error instanceof QueryCancelledError) {
    return 'cancelled';
  }

  const code = errorCode(error);
  if (code === uniqueViolation) {
    return 'unique_violation';
  }

  if (code === queryCanceled || (error instanceof Error && timeoutMessage.test(error.message))) {
    return 'timeout';
  }

  // Class 08 is connection exceptions.
  if (
    code !== undefined &&
    (code.startsWith('08') || unavailableServerCodes.has(code) || unavailableSocketCodes.has(code))
  ) {
    return 'unavailable';
  }

  return error instanceof Error && unavailableMessage.test(error.message) ? 'unavailable' : undefined;
};

/**
 * The outage a pg error is: the database could not serve the query, it took too long, or its caller aborted it. A
 * timeout or a cancel leaves a write's outcome unknown. Anything else is a bug, such as bad SQL or a missing table, so
 * it is thrown again to surface as one.
 */
const outageOf = (error: unknown): 'unavailable' | 'timeout' | 'cancelled' => {
  const kind = classifyPostgresError(error);
  if (kind === undefined || kind === 'unique_violation') {
    throw error;
  }
  return kind;
};

export { classifyPostgresError, outageOf, QueryCancelledError };
export type { PostgresErrorKind };
