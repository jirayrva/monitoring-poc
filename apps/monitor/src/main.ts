import { createDeviceDatastoreInMemory } from './adapters/driven/device-datastore-in-memory/index.ts';
import { createApiHttp } from './adapters/driving/api-http/index.ts';
import { config } from './config/index.ts';
import { createApplication } from './core/application/index.ts';

// Devices are kept in memory until a real datastore arrives.
const { deviceRegistry } = createApplication({
  deviceDatastore: createDeviceDatastoreInMemory(),
  now: () => new Date(),
});
const apiHttp = createApiHttp({ deviceRegistry, config });

await apiHttp.start();

process.once('SIGINT', () => void apiHttp.stop());
process.once('SIGTERM', () => void apiHttp.stop());
