import { createDeviceRegistry } from './device-registry/index.ts';
import type { DeviceRegistryDependencies } from './device-registry/index.ts';

/**
 * One implementation per driving port, built from the driven adapters and the clock. The composition root hands each
 * driving adapter only the ports meant for it.
 */
const createApplication = (dependencies: DeviceRegistryDependencies) => ({
  deviceRegistry: createDeviceRegistry(dependencies),
});

export { createApplication };
