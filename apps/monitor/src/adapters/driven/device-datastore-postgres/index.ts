import { join } from 'node:path';
import type { DeviceRegistration, RegisteredDevice } from '../../../core/domain/device.ts';
import type { DeviceDatastore } from '../../../core/ports/driven/device-datastore.ts';
import { classifyPostgresError, outageOf } from '../../../infrastructure/postgres/errors.ts';
import { createPostgresPool } from '../../../infrastructure/postgres/pool.ts';
import { queryWithSignal } from '../../../infrastructure/postgres/query.ts';
import type { PostgresPoolConfig } from '../../../infrastructure/postgres/pool.ts';

const migrationsDir = join(import.meta.dirname, 'migrations');

type DeviceDatastorePostgresFactory = (config: PostgresPoolConfig) => DeviceDatastore & AsyncDisposable;

type DeviceRow = {
  device_id: string;
  name: string;
  base_url: string;
  auth_strategy: 'none' | 'bearer';
  auth_secret_ref: string | null;
  registered_at: Date;
};

const columns = 'device_id, name, base_url, auth_strategy, auth_secret_ref';

const selectColumns = `${columns}, registered_at`;

const toRegisteredDevice = (row: DeviceRow): RegisteredDevice => {
  const {
    device_id: deviceId,
    name,
    base_url: baseUrl,
    auth_strategy: strategy,
    auth_secret_ref: secretRef,
    registered_at: registeredAt,
  } = row;
  if (strategy === 'none') {
    return { deviceId, name, baseUrl, auth: { strategy }, registeredAt };
  }

  if (typeof secretRef !== 'string') {
    // The table's check constraint rules this out.
    throw new Error(`Device ${deviceId} uses bearer auth but has no secret reference`);
  }

  return { deviceId, name, baseUrl, auth: { strategy, secretRef }, registeredAt };
};

const toParameters = ({ deviceId, name, baseUrl, auth }: DeviceRegistration) => [
  deviceId,
  name,
  baseUrl,
  auth.strategy,
  auth.strategy === 'bearer' ? auth.secretRef : undefined,
];

const done = { ok: true, value: undefined } as const;
const notFound = { ok: false, failure: { reason: 'not_found' } } as const;
const alreadyExists = { ok: false, failure: { reason: 'already_exists' } } as const;

const storeFailure = (error: unknown) => ({ ok: false, failure: { reason: outageOf(error) } }) as const;

const createDeviceDatastorePostgres: DeviceDatastorePostgresFactory = (config) => {
  // Releases the pool once, however often the datastore is disposed: pg throws when a pool is ended twice.
  const resources = new AsyncDisposableStack();
  const pool = resources.adopt(createPostgresPool(config), (opened) => opened.end());
  return {
    listDevices: (_input, options) =>
      queryWithSignal<DeviceRow>(pool, options.signal, `SELECT ${selectColumns} FROM devices ORDER BY device_id`)
        .then(({ rows }) => ({ ok: true, value: rows.map(toRegisteredDevice) }) as const)
        .catch(storeFailure),
    getDevice: (input, options) =>
      queryWithSignal<DeviceRow>(pool, options.signal, `SELECT ${selectColumns} FROM devices WHERE device_id = $1`, [
        input.deviceId,
      ])
        .then(({ rows: [row] }) =>
          row === undefined ? notFound : ({ ok: true, value: toRegisteredDevice(row) } as const),
        )
        .catch(storeFailure),
    insertDevice: (input, options) =>
      queryWithSignal(pool, options.signal, `INSERT INTO devices (${selectColumns}) VALUES ($1, $2, $3, $4, $5, $6)`, [
        ...toParameters(input.registration),
        input.registeredAt,
      ])
        .then(() => done)
        .catch((error: unknown) =>
          classifyPostgresError(error) === 'unique_violation' ? alreadyExists : storeFailure(error),
        ),
    updateDevice: (input, options) =>
      queryWithSignal(
        pool,
        options.signal,
        'UPDATE devices SET name = $2, base_url = $3, auth_strategy = $4, auth_secret_ref = $5 WHERE device_id = $1',
        toParameters(input.registration),
      )
        .then(({ rowCount }) => (rowCount === 0 ? notFound : done))
        .catch(storeFailure),
    deleteDevice: (input, options) =>
      queryWithSignal(pool, options.signal, 'DELETE FROM devices WHERE device_id = $1', [input.deviceId])
        .then(({ rowCount }) => (rowCount === 0 ? notFound : done))
        .catch(storeFailure),
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
};

export { createDeviceDatastorePostgres, migrationsDir };
