import { join } from 'node:path';
import type { DeviceStatus } from '../../../core/domain/device-status.ts';
import type { DeviceStatusDatastore } from '../../../core/ports/driven/device-status-datastore.ts';
import { outageOf } from '../../../infrastructure/postgres/errors.ts';
import { createPostgresPool } from '../../../infrastructure/postgres/pool.ts';
import type { PostgresPoolConfig } from '../../../infrastructure/postgres/pool.ts';
import { queryWithSignal } from '../../../infrastructure/postgres/query.ts';

const migrationsDir = join(import.meta.dirname, 'migrations');

/** The status as JSON text, parsed here so its dates come back as dates. */
type StatusRow = { status: string };

const dateFields = new Set(['since', 'probedAt', 'seenAt']);

const reviveDates = (key: string, value: unknown) =>
  typeof value === 'string' && dateFields.has(key) ? new Date(value) : value;

/** The status that was appended. Only this adapter writes them, so they are not checked again. */
const toDeviceStatus = ({ status }: StatusRow): DeviceStatus => {
  const parsed: DeviceStatus = JSON.parse(status, reviveDates);
  // JSON drops a property whose value is undefined, and the type says it is there.
  return parsed.state === 'unknown' || parsed.state === 'up' ? parsed : { ...parsed, lastKnown: parsed.lastKnown };
};

const storeFailure = (error: unknown) => ({ ok: false, failure: { reason: outageOf(error) } }) as const;

const createDeviceStatusDatastorePostgres = (config: PostgresPoolConfig): DeviceStatusDatastore & AsyncDisposable => {
  // Releases the pool once, however often the datastore is disposed: pg throws when a pool is ended twice.
  const resources = new AsyncDisposableStack();
  const pool = resources.adopt(createPostgresPool(config), (opened) => opened.end());
  return {
    appendStatus: ({ status }, options) =>
      queryWithSignal(pool, options.signal, 'INSERT INTO device_statuses (device_id, status) VALUES ($1, $2)', [
        status.deviceId,
        JSON.stringify(status),
      ])
        .then(() => ({ ok: true, value: undefined }) as const)
        .catch(storeFailure),
    listLatestStatuses: (_input, options) =>
      queryWithSignal<StatusRow>(
        pool,
        options.signal,
        'SELECT DISTINCT ON (device_id) status::text AS status FROM device_statuses ORDER BY device_id, id DESC',
      )
        .then(({ rows }) => ({ ok: true, value: rows.map(toDeviceStatus) }) as const)
        .catch(storeFailure),
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
};

export { createDeviceStatusDatastorePostgres, migrationsDir };
