import type { DeviceDatastore } from '../../ports/driven/device-datastore.ts';
import type { DeviceRegistry } from '../../ports/driving/device-registry.ts';

type DeviceRegistryDependencies = {
  deviceDatastore: DeviceDatastore;
  now: () => Date;
};

const createDeviceRegistry = ({ deviceDatastore, now }: DeviceRegistryDependencies): DeviceRegistry => ({
  listDevices: deviceDatastore.listDevices,
  registerDevice: ({ registration }, options) =>
    deviceDatastore.insertDevice({ registration, registeredAt: now() }, options),
  getDevice: deviceDatastore.getDevice,
  updateDevice: deviceDatastore.updateDevice,
  unregisterDevice: deviceDatastore.deleteDevice,
});

export { createDeviceRegistry };
export type { DeviceRegistryDependencies };
