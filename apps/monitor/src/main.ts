import { pino } from 'pino';
import { createDeviceHealthReaderHttp } from './adapters/driven/device-health-reader-http/index.ts';
import {
  createDeviceDatastorePostgres,
  migrationsDir as deviceDatastoreMigrations,
} from './adapters/driven/device-datastore-postgres/index.ts';
import { createDeviceStatusDatastoreInMemory } from './adapters/driven/device-status-datastore-in-memory/index.ts';
import { createApiHttp } from './adapters/driving/api-http/index.ts';
import { createHeartbeat } from './adapters/driving/heartbeat/index.ts';
import { config, readDeviceSecret } from './config/index.ts';
import { createApplication } from './core/application/index.ts';
import { migrateDatabase } from './infrastructure/postgres/migrate.ts';

const logger = pino({ level: config.logLevel });

await migrateDatabase({ ...config.datastore, dirs: [deviceDatastoreMigrations] });

const deviceDatastore = createDeviceDatastorePostgres(config.datastore);
const { deviceRegistry, deviceStatusQueries, deviceProbes } = createApplication({
  deviceDatastore,
  // Statuses are kept in memory until their Postgres adapter arrives.
  deviceStatusDatastore: createDeviceStatusDatastoreInMemory(),
  deviceHealthReader: createDeviceHealthReaderHttp({ readSecret: readDeviceSecret }),
  now: () => new Date(),
  policy: config.monitoring,
});
const apiHttp = createApiHttp({ deviceRegistry, deviceStatusQueries, config });
const heartbeat = createHeartbeat({
  deviceProbes,
  logger,
  config: { intervalMs: config.monitoring.intervalMs, stopTimeoutMs: config.monitoring.healthBudgetMs },
});

await apiHttp.start();
heartbeat.start();

// Probes first, so none writes after the store has closed.
const stop = async () => {
  await heartbeat.stop();
  await apiHttp.stop();
  await deviceDatastore[Symbol.asyncDispose]();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
