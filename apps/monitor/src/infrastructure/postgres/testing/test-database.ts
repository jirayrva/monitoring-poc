import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrateDatabase } from '../migrate.ts';

/**
 * A schema of its own for a test: its name, for a datastore, and a connection string scoped to it,
 * for a plain client that inspects or locks its tables.
 */
type TestSchema = { schema: string; connectionString: string };

type TestDatabase = AsyncDisposable & {
  createEmptySchema: () => Promise<TestSchema>;
  createMigratedSchema: (dirs: string[]) => Promise<TestSchema>;
};

/** The Postgres from compose.yaml, unless DATASTORE_CONNECTION_STRING points at another. */
const testConnectionString =
  process.env['DATASTORE_CONNECTION_STRING'] ?? 'postgres://monitor:monitor@127.0.0.1:5432/monitor';

const scopedTo = (connectionString: string, schema: string) => {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
};

/**
 * Connects to a Postgres for tests, usually the one from compose.yaml. Every schema it creates gets
 * a random name, so test files can run in parallel, and disposing it drops them all, then closes
 * its connections. Each is released even when another fails.
 */
const connectTestDatabase = async (connectionString: string): Promise<TestDatabase> => {
  const resources = new AsyncDisposableStack();
  const admin = resources.adopt(new Pool({ connectionString, max: 2 }), (pool) => pool.end());
  admin.on('error', () => {});

  try {
    await admin.query('SELECT 1');
  } catch (error) {
    await resources.disposeAsync();
    throw new Error(`No Postgres at ${connectionString}. Start it with: docker compose up -d --wait`, {
      cause: error,
    });
  }

  const createSchema = async () => {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    resources.defer(async () => {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    });
    return schema;
  };

  return {
    createEmptySchema: async () => {
      const schema = await createSchema();
      return { schema, connectionString: scopedTo(connectionString, schema) };
    },
    createMigratedSchema: async (dirs) => {
      const schema = await createSchema();
      await migrateDatabase({ connectionString, dirs, schema });
      return { schema, connectionString: scopedTo(connectionString, schema) };
    },
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
};

export { connectTestDatabase, testConnectionString };
export type { TestDatabase, TestSchema };
