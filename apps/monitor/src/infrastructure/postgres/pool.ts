import { Pool } from 'pg';

type PostgresPoolConfig = {
  connectionString: string;
  /**
   * The schema the adapter's tables are in, and the only one its queries look in, besides the
   * system catalog. It sets search_path for each connection, so a table never resolves to public.
   */
  schema: string;
  connectionTimeoutMs: number;
  queryTimeoutMs: number;
};

const createPostgresPool = (config: PostgresPoolConfig) => {
  const { connectionString, schema, connectionTimeoutMs, queryTimeoutMs } = config;
  const pool = new Pool({
    connectionString,
    // An options parameter in the connection string would replace this one, as pg lets the
    // connection string win. The schema setting is the place to choose the schema.
    options: `-c search_path=${schema}`,
    connectionTimeoutMillis: connectionTimeoutMs,
    // The database ends a slow query, so it does not hold a connection or locks.
    statement_timeout: queryTimeoutMs,
    // The client stops waiting too, for when the database cannot even send the cancellation.
    query_timeout: queryTimeoutMs,
  });

  // An idle connection was lost, for example because the database restarted. The pool discards
  // it and the next query opens a new one, or fails as unavailable.
  pool.on('error', () => {});

  return pool;
};

export { createPostgresPool };
export type { PostgresPoolConfig };
