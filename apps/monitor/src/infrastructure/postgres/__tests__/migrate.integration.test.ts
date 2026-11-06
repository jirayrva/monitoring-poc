import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Client } from 'pg';
import { migrationsTable } from '../migrate.ts';
import { connectTestDatabase, testConnectionString } from '../testing/test-database.ts';

const database = await connectTestDatabase(testConnectionString);
const folders: string[] = [];

after(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true })));
  await database[Symbol.asyncDispose]();
});

const migrationsFolder = async (files: Record<string, string>) => {
  const folder = await mkdtemp(join(tmpdir(), 'migrations-'));
  folders.push(folder);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(folder, name), `-- Up Migration\n${sql}\n-- Down Migration\n`);
  }
  return folder;
};

const appliedMigrations = async (target: { connectionString: string }) => {
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM ${migrationsTable} ORDER BY run_on, id`);
    return rows.map(({ name }) => name);
  } finally {
    // Even when the query fails, so an open connection cannot keep the test process alive.
    await client.end();
  }
};

describe('migrateDatabase', () => {
  it("applies several adapters' migrations as one sequence, ordered by timestamp across folders", async () => {
    // Arrange
    const devices = await migrationsFolder({
      '1000_create-devices.sql': 'CREATE TABLE devices (device_id text PRIMARY KEY);',
      '3000_add-device-name.sql': 'ALTER TABLE devices ADD COLUMN name text;',
    });
    const statuses = await migrationsFolder({
      // Depends on a table from the other folder, so it only works in timestamp order.
      '2000_create-statuses.sql': 'CREATE TABLE statuses (device_id text REFERENCES devices);',
    });

    // Act
    const target = await database.createMigratedSchema([statuses, devices]);

    // Assert
    assert.deepEqual(await appliedMigrations(target), [
      '1000_create-devices',
      '2000_create-statuses',
      '3000_add-device-name',
    ]);
  });
});
