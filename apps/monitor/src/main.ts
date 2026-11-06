import {
  createDeviceDatastorePostgres,
  migrationsDir as deviceDatastoreMigrations,
} from './adapters/driven/device-datastore-postgres/index.ts';
import { createDeviceStatusDatastoreInMemory } from './adapters/driven/device-status-datastore-in-memory/index.ts';
import { createApiHttp } from './adapters/driving/api-http/index.ts';
import { config } from './config/index.ts';
import { createApplication } from './core/application/index.ts';
import { migrateDatabase } from './infrastructure/postgres/migrate.ts';

await migrateDatabase({ ...config.datastore, dirs: [deviceDatastoreMigrations] });

const deviceDatastore = createDeviceDatastorePostgres(config.datastore);
const { deviceRegistry } = createApplication({
  deviceDatastore,
  // Statuses are kept in memory until their Postgres adapter arrives.
  deviceStatusDatastore: createDeviceStatusDatastoreInMemory(),
  now: () => new Date(),
});
const apiHttp = createApiHttp({ deviceRegistry, config });

await apiHttp.start();

const stop = async () => {
  await apiHttp.stop();
  await deviceDatastore[Symbol.asyncDispose]();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
