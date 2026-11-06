import { sep } from 'node:path';
import { runner } from 'node-pg-migrate';

type MigrateDatabaseConfig = {
  connectionString: string;
  /**
   * The migration folders of every adapter that uses this database. They are applied as one
   * sequence, ordered by the timestamp each file name starts with, and recorded in one history.
   */
  dirs: string[];
  schema: string;
};

const migrationsTable = 'migrations';

/** A glob for the SQL files in a folder. Globs take forward slashes, even on Windows. */
const sqlFilesIn = (dir: string) => `${dir.split(sep).join('/')}/*.sql`;

/**
 * Applies every migration that has not run yet. Each adapter owns the migrations for its tables;
 * this knows only how to apply them. Instances starting together take turns, so none applies a
 * migration twice or fails because another is running.
 */
const migrateDatabase = async (config: MigrateDatabaseConfig): Promise<void> => {
  const { connectionString, dirs, schema } = config;
  await runner({
    databaseUrl: connectionString,
    // Several folders need glob mode. It sorts the files of all folders together, by timestamp.
    dir: dirs.map(sqlFilesIn),
    useGlob: true,
    // One lock for the whole database. Waiting for it, rather than failing, lets an instance that
    // starts alongside another find the migrations already applied.
    advisoryLockMode: 'wait',
    direction: 'up',
    migrationsTable,
    schema,
    createSchema: true,
    // Its log lines are plain text, and every other log line is JSON.
    log: () => {},
  });
};

export { migrateDatabase, migrationsTable };
export type { MigrateDatabaseConfig };
