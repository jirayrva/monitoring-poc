import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Client } from 'pg';
import { testDeviceDatastoreContract } from '../../../../core/ports/driven/testing/device-datastore.contract.ts';
import { lobby } from '../../../../core/domain/testing/devices.ts';
import { config } from '../../../../config/index.ts';
import { connectTestDatabase } from '../../../../infrastructure/postgres/testing/test-database.ts';
import type { TestSchema } from '../../../../infrastructure/postgres/testing/test-database.ts';
import { createDeviceDatastorePostgres, migrationsDir } from '../index.ts';

const database = await connectTestDatabase(config.datastore.connectionString);
const stores = new AsyncDisposableStack();

after(async () => {
  await stores.disposeAsync();
  await database[Symbol.asyncDispose]();
});

/**
 * A store on its own pool, as the composition root would build it, on the unscoped database: only
 * its schema setting points it at the test's schema. Closed once the file's tests end.
 */
const openStore = (
  target: Pick<TestSchema, 'schema'>,
  queryTimeoutMs = 5000,
  connectionString = config.datastore.connectionString,
) =>
  stores.use(
    createDeviceDatastorePostgres({
      connectionString,
      schema: target.schema,
      connectionTimeoutMs: 5000,
      queryTimeoutMs,
    }),
  );

/** Holds a lock that blocks every query on the devices table until the returned function runs. */
const lockDevicesTable = async (target: TestSchema) => {
  const client = new Client({ connectionString: target.connectionString });
  await client.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE devices IN ACCESS EXCLUSIVE MODE');
  let released: Promise<void> | undefined;
  return () => (released ??= client.query('ROLLBACK').then(() => client.end()));
};

const options = { signal: new AbortController().signal };

testDeviceDatastoreContract('postgres', async () => openStore(await database.createMigratedSchema([migrationsDir])));

describe('Postgres device datastore', () => {
  it('reports unavailable when the database cannot be reached', async () => {
    // Arrange
    const store = openStore({ schema: 'monitor' }, 5000, 'postgres://monitor:monitor@127.0.0.1:1/monitor');

    // Act
    const results = [
      await store.listDevices({}, options),
      await store.getDevice({ deviceId: lobby.deviceId }, options),
      await store.insertDevice({ registration: lobby, registeredAt: new Date() }, options),
      await store.updateDevice({ registration: lobby }, options),
      await store.deleteDevice({ deviceId: lobby.deviceId }, options),
    ];

    // Assert
    for (const result of results) {
      assert.deepEqual(result, { ok: false, failure: { reason: 'unavailable' } });
    }
  });

  it('reports timeout when a query takes longer than the timeout, and recovers once it is free', async (t) => {
    // Arrange
    const target = await database.createMigratedSchema([migrationsDir]);
    const store = openStore(target, 200);
    const unlock = await lockDevicesTable(target);
    t.after(unlock);
    const started = performance.now();

    // Act
    const result = await store.listDevices({}, options);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
    assert.ok(performance.now() - started < 2000, 'took far longer than the timeout');
    await unlock();
    assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [] });
  });

  it('closes its pool when disposed, so it takes no more calls, and can be disposed again', async () => {
    // Arrange
    const store = openStore(await database.createMigratedSchema([migrationsDir]));
    await store.listDevices({}, options);

    // Act
    await store[Symbol.asyncDispose]();
    await store[Symbol.asyncDispose]();

    // Assert
    await assert.rejects(store.listDevices({}, options), /after calling end/);
  });

  it('throws, rather than reporting an outage, when a query fails for another reason', async () => {
    // Arrange
    const store = openStore(await database.createEmptySchema());

    // Act
    const result = store.listDevices({}, options);

    // Assert
    await assert.rejects(result, { code: '42P01' });
  });
});
