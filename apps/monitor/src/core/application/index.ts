import { createDeviceRegistry } from './device-registry/index.ts';
import type { DeviceRegistryDependencies } from './device-registry/index.ts';
import { createDeviceStatusQueries } from './device-status-queries/index.ts';
import type { DeviceStatusQueriesDependencies } from './device-status-queries/index.ts';

/**
 * One implementation per driving port, built from the driven adapters and the clock. The composition root hands each
 * driving adapter only the ports meant for it.
 */
const createApplication = (dependencies: DeviceRegistryDependencies & DeviceStatusQueriesDependencies) => ({
  deviceRegistry: createDeviceRegistry(dependencies),
  deviceStatusQueries: createDeviceStatusQueries(dependencies),
});

export { createApplication };
