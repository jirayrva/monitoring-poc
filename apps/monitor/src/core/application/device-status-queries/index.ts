import type { DeviceDatastore } from '../../ports/driven/device-datastore.ts';
import type { DeviceStatusDatastore } from '../../ports/driven/device-status-datastore.ts';
import type { DeviceStatusQueries } from '../../ports/driving/device-status-queries.ts';
import { registeredStatus } from '../../domain/status-transitions.ts';

type DeviceStatusQueriesDependencies = {
  deviceDatastore: DeviceDatastore;
  deviceStatusDatastore: DeviceStatusDatastore;
};

/**
 * Answers for the devices registered now. An unregistered device's history stays in the store, for offline
 * inspection, but the queries treat it as gone.
 */
const createDeviceStatusQueries = (dependencies: DeviceStatusQueriesDependencies): DeviceStatusQueries => {
  const { deviceDatastore, deviceStatusDatastore } = dependencies;
  return {
    listLatestStatuses: async (_input, options) => {
      const devices = await deviceDatastore.listDevices({}, options);
      if (!devices.ok) {
        return devices;
      }

      const statuses = await deviceStatusDatastore.listLatestStatuses({}, options);
      if (!statuses.ok) {
        return statuses;
      }

      const latest = new Map(statuses.value.map((status) => [status.deviceId, status]));
      return {
        ok: true,
        value: devices.value.map((device) => {
          const status = latest.get(device.deviceId);
          // Under the device's current name, so a rename shows before its next probe.
          return status === undefined ? registeredStatus(device) : { ...status, name: device.name };
        }),
      };
    },
  };
};

export { createDeviceStatusQueries };
export type { DeviceStatusQueriesDependencies };
