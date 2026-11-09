import { pino } from 'pino';
import { createChecksumGeneratorProcess } from './adapters/driven/checksum-generator-process/index.ts';
import { createChecksumGeneratorStandIn } from './adapters/driven/checksum-generator-stand-in/index.ts';
import { createDeviceDiagnosticsReaderRest } from './adapters/driven/device-diagnostics-reader-rest/index.ts';
import { createDeviceHealthReaderHttp } from './adapters/driven/device-health-reader-http/index.ts';
import {
  createDeviceDatastorePostgres,
  migrationsDir as deviceDatastoreMigrations,
} from './adapters/driven/device-datastore-postgres/index.ts';
import {
  createDeviceStatusDatastorePostgres,
  migrationsDir as deviceStatusDatastoreMigrations,
} from './adapters/driven/device-status-datastore-postgres/index.ts';
import { createApiHttp } from './adapters/driving/api-http/index.ts';
import { createHeartbeat } from './adapters/driving/heartbeat/index.ts';
import { config, readDeviceSecret } from './config/index.ts';
import { probeBudgetMs } from './core/application/device-probes/index.ts';
import { createApplication } from './core/application/index.ts';
import { migrateDatabase } from './infrastructure/postgres/migrate.ts';

const logger = pino({ level: config.logLevel });

const checksumGenerator =
  config.checksumGenerator.kind === 'binary'
    ? createChecksumGeneratorProcess(config.checksumGenerator)
    : createChecksumGeneratorStandIn();

await migrateDatabase({ ...config.datastore, dirs: [deviceDatastoreMigrations, deviceStatusDatastoreMigrations] });

const deviceDatastore = createDeviceDatastorePostgres(config.datastore);
const deviceStatusDatastore = createDeviceStatusDatastorePostgres(config.datastore);
const { deviceRegistry, deviceStatusQueries, deviceProbes } = createApplication({
  deviceDatastore,
  deviceStatusDatastore,
  deviceHealthReader: createDeviceHealthReaderHttp({ readSecret: readDeviceSecret }),
  deviceDiagnosticsReaders: [createDeviceDiagnosticsReaderRest({ readSecret: readDeviceSecret })],
  checksumGenerator,
  now: () => new Date(),
  policy: config.monitoring,
});
const apiHttp = createApiHttp({ deviceRegistry, deviceStatusQueries, config });
const heartbeat = createHeartbeat({
  deviceProbes,
  logger,
  config: { intervalMs: config.monitoring.intervalMs, stopTimeoutMs: probeBudgetMs(config.monitoring) },
});

await apiHttp.start();
heartbeat.start();

// Probes first, so none writes after the store has closed.
const stop = async () => {
  await heartbeat.stop();
  await apiHttp.stop();
  await deviceDatastore[Symbol.asyncDispose]();
  await deviceStatusDatastore[Symbol.asyncDispose]();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
