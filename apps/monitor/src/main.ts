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
import { checkTimings } from './config/timing-checks.ts';
import { probeBudgetMs } from './core/application/device-probes/index.ts';
import { createApplication } from './core/application/index.ts';
import { migrateDatabase } from './infrastructure/postgres/migrate.ts';
import { runService } from './run-service.ts';
import type { StartService } from './run-service.ts';

const logger = pino({ level: config.logLevel });
for (const warning of checkTimings(config.monitoring)) {
  logger.warn({}, warning);
}

const checksumGenerator =
  config.checksumGenerator.kind === 'binary'
    ? createChecksumGeneratorProcess(config.checksumGenerator)
    : createChecksumGeneratorStandIn();

/**
 * Each part is added to resources as soon as it starts, so it is released in reverse order: the heartbeat first, so no
 * probe writes after a store has closed, then the API, and the datastores last.
 */
const startService: StartService = async (resources) => {
  await migrateDatabase({ ...config.datastore, dirs: [deviceDatastoreMigrations, deviceStatusDatastoreMigrations] });

  const deviceDatastore = resources.use(createDeviceDatastorePostgres(config.datastore));
  const deviceStatusDatastore = resources.use(createDeviceStatusDatastorePostgres(config.datastore));
  const { deviceRegistry, deviceStatusQueries, monitoring, deviceProbes } = createApplication({
    deviceDatastore,
    deviceStatusDatastore,
    deviceHealthReader: createDeviceHealthReaderHttp({ readSecret: readDeviceSecret }),
    deviceDiagnosticsReaders: [createDeviceDiagnosticsReaderRest({ readSecret: readDeviceSecret })],
    checksumGenerator,
    now: () => new Date(),
    random: Math.random,
    policy: config.monitoring,
  });

  const apiHttp = resources.use(createApiHttp({ deviceRegistry, deviceStatusQueries, monitoring, config }));
  await apiHttp.start();

  const heartbeat = resources.use(
    createHeartbeat({
      deviceProbes,
      logger,
      config: { intervalMs: config.monitoring.intervalMs, stopTimeoutMs: probeBudgetMs(config.monitoring) },
    }),
  );
  heartbeat.start();
};

await runService(startService, { logger, process, shutdownTimeoutMs: config.shutdownTimeoutMs });
