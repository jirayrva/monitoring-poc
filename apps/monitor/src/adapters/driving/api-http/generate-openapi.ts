import { writeFile } from 'node:fs/promises';
import { openApiPath } from '@device-monitor/contracts/monitor-api';
import { config } from '../../../config/index.ts';
import { createApplication } from '../../../core/application/index.ts';
import { createChecksumGeneratorStandIn } from '../../driven/checksum-generator-stand-in/index.ts';
import { createDeviceDatastoreInMemory } from '../../driven/device-datastore-in-memory/index.ts';
import { createDeviceStatusDatastoreInMemory } from '../../driven/device-status-datastore-in-memory/index.ts';
import { createApiHttp } from './index.ts';

// The document only depends on the routes: the store is never called and the server never listens.
const application = createApplication({
  deviceDatastore: createDeviceDatastoreInMemory(),
  deviceStatusDatastore: createDeviceStatusDatastoreInMemory(),
  deviceHealthReader: { readHealth: () => Promise.reject(new Error('The API never probes')) },
  deviceDiagnosticsReaders: [],
  checksumGenerator: createChecksumGeneratorStandIn(),
  now: () => new Date(),
  random: Math.random,
  policy: config.monitoring,
});
await using server = createApiHttp({ ...application, config });

await writeFile(openApiPath, `${JSON.stringify(await server.openApi(), undefined, 2)}\n`);
