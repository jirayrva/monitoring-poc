import { createDeviceProbes } from './device-probes/index.ts';
import type { DeviceProbesDependencies } from './device-probes/index.ts';
import { createDeviceRegistry } from './device-registry/index.ts';
import type { DeviceRegistryDependencies } from './device-registry/index.ts';
import { createDeviceStatusQueries } from './device-status-queries/index.ts';
import type { DeviceStatusQueriesDependencies } from './device-status-queries/index.ts';

type ApplicationDependencies = DeviceRegistryDependencies & DeviceStatusQueriesDependencies & DeviceProbesDependencies;

/**
 * One implementation per driving port, built from the driven adapters, the clock and the policy. The composition
 * root hands each driving adapter only the ports meant for it.
 */
const createApplication = (dependencies: ApplicationDependencies) => ({
  deviceRegistry: createDeviceRegistry(dependencies),
  deviceStatusQueries: createDeviceStatusQueries(dependencies),
  deviceProbes: createDeviceProbes(dependencies),
});

export { createApplication };
export type { ApplicationDependencies };
