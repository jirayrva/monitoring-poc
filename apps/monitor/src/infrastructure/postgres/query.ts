import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { QueryCancelledError } from './errors.ts';

/** The server process behind a connection, which pg sets on connect but does not type. */
const processIdOf = (client: PoolClient) =>
  'processID' in client && typeof client.processID === 'number' ? client.processID : undefined;

/**
 * Runs one query, as pool.query does, but stops it when the signal aborts. pg takes no signal, so
 * an abort before the query starts runs nothing, and one while it runs asks the server to cancel
 * it with pg_cancel_backend from another connection. Either way the query rejects with
 * QueryCancelledError, which classifyPostgresError calls cancelled: a write may still have
 * committed. A query that ends on its own before the cancel lands keeps its result.
 *
 * A connection that a cancel was sent for is closed rather than returned to the pool, so a cancel
 * that lands late can never stop another caller's query.
 */
const queryWithSignal = async <Row extends QueryResultRow>(
  pool: Pool,
  signal: AbortSignal,
  text: string,
  values?: unknown[],
): Promise<QueryResult<Row>> => {
  if (signal.aborted) {
    throw new QueryCancelledError();
  }

  const client = await pool.connect();
  let cancelling: Promise<unknown> | undefined;
  const cancel = () => {
    const processId = processIdOf(client);
    cancelling =
      processId === undefined
        ? Promise.resolve()
        : pool.query('SELECT pg_cancel_backend($1)', [processId]).catch(() => {});
  };

  try {
    if (signal.aborted) {
      throw new QueryCancelledError();
    }
    signal.addEventListener('abort', cancel, { once: true });
    return await client.query<Row>(text, values);
  } catch (error) {
    throw signal.aborted && !(error instanceof QueryCancelledError) ? new QueryCancelledError({ cause: error }) : error;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (cancelling === undefined) {
      client.release();
    } else {
      await cancelling;
      client.release(true);
    }
  }
};

export { queryWithSignal };
