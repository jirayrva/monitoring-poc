import { createDeviceProbes } from './device-probes/index.ts';
import type { DeviceProbesDependencies } from './device-probes/index.ts';
import { createDeviceRegistry } from './device-registry/index.ts';
import type { DeviceRegistryDependencies } from './device-registry/index.ts';
import { createDeviceStatusQueries } from './device-status-queries/index.ts';
import type { DeviceStatusQueriesDependencies } from './device-status-queries/index.ts';
import { createMonitoring } from './monitoring/index.ts';

type ApplicationDependencies = DeviceRegistryDependencies &
  DeviceStatusQueriesDependencies &
  Omit<DeviceProbesDependencies, 'rounds'>;

/**
 * One implementation per driving port, built from the driven adapters, the clock and the policy. Monitoring and
 * DeviceProbes share the rounds, so stopping monitoring waits for the round in progress. The composition root hands
 * each driving adapter only the ports meant for it.
 */
const createApplication = (dependencies: ApplicationDependencies) => {
  const { monitoring, rounds } = createMonitoring();
  return {
    deviceRegistry: createDeviceRegistry(dependencies),
    deviceStatusQueries: createDeviceStatusQueries(dependencies),
    monitoring,
    deviceProbes: createDeviceProbes({ ...dependencies, rounds }),
  };
};

export { createApplication };
export type { ApplicationDependencies };
