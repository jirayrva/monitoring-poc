import { writeFile } from 'node:fs/promises';
import { openApiPath } from '@device-monitor/contracts/monitor-api';
import { config } from '../../../config/index.ts';
import { createApplication } from '../../../core/application/index.ts';
import { createDeviceDatastoreInMemory } from '../../driven/device-datastore-in-memory/index.ts';
import { createApiHttp } from './index.ts';

// The document only depends on the routes: the store is never called and the server never listens.
const { deviceRegistry } = createApplication({
  deviceDatastore: createDeviceDatastoreInMemory(),
  now: () => new Date(),
});
const server = createApiHttp({ deviceRegistry, config });

await writeFile(openApiPath, `${JSON.stringify(await server.openApi(), undefined, 2)}\n`);
await server.stop();
