import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Client } from 'pg';
import { config } from '../../../../config/index.ts';
import { lobbySuspect, lobbyUp } from '../../../../core/domain/testing/statuses.ts';
import { testDeviceStatusDatastoreContract } from '../../../../core/ports/driven/testing/device-status-datastore.contract.ts';
import { connectTestDatabase } from '../../../../infrastructure/postgres/testing/test-database.ts';
import { createDeviceStatusDatastorePostgres, migrationsDir } from '../index.ts';

const database = await connectTestDatabase(config.datastore.connectionString);
const stores = new AsyncDisposableStack();

after(async () => {
  await stores.disposeAsync();
  await database[Symbol.asyncDispose]();
});

const openStore = (schema: string, connectionString = config.datastore.connectionString) =>
  stores.use(
    createDeviceStatusDatastorePostgres({ connectionString, schema, connectionTimeoutMs: 5000, queryTimeoutMs: 5000 }),
  );

const options = { signal: new AbortController().signal };

testDeviceStatusDatastoreContract('postgres', async () =>
  openStore((await database.createMigratedSchema([migrationsDir])).schema),
);

describe('Postgres device status datastore', () => {
  it('keeps every status appended, for offline inspection, where it lists only the newest', async () => {
    // Arrange
    const target = await database.createMigratedSchema([migrationsDir]);
    const store = openStore(target.schema);
    await store.appendStatus({ status: lobbyUp }, options);
    await store.appendStatus({ status: lobbySuspect }, options);
    const client = new Client({ connectionString: target.connectionString });
    await client.connect();

    // Act
    const { rows } = await client.query<{ state: string }>(
      "SELECT status->>'state' AS state FROM device_statuses ORDER BY id",
    );
    await client.end();

    // Assert
    assert.deepEqual(
      rows.map(({ state }) => state),
      ['up', 'suspect'],
    );
  });

  it('reports unavailable when the database cannot be reached', async () => {
    // Arrange
    const store = openStore('monitor', 'postgres://monitor:monitor@127.0.0.1:1/monitor');

    // Act
    const results = [
      await store.appendStatus({ status: lobbyUp }, options),
      await store.listLatestStatuses({}, options),
    ];

    // Assert
    for (const result of results) {
      assert.deepEqual(result, { ok: false, failure: { reason: 'unavailable' } });
    }
  });

  it('closes its pool when disposed, and can be disposed again', async () => {
    // Arrange
    const store = openStore((await database.createMigratedSchema([migrationsDir])).schema);

    // Act
    await store[Symbol.asyncDispose]();
    await store[Symbol.asyncDispose]();

    // Assert
    await assert.rejects(store.listLatestStatuses({}, options), /after calling end/);
  });
});
