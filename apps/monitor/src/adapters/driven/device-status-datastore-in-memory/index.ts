import type { DeviceStatus } from '../../../core/domain/device-status.ts';
import type { DeviceStatusDatastore } from '../../../core/ports/driven/device-status-datastore.ts';

type DeviceStatusDatastoreInMemoryFactory = () => DeviceStatusDatastore;

const cancelled = Promise.resolve({ ok: false, failure: { reason: 'cancelled' } } as const);

const createDeviceStatusDatastoreInMemory: DeviceStatusDatastoreInMemoryFactory = () => {
  /** The newest status of each device. The history is not kept: nothing in memory reads it. */
  const latest = new Map<string, DeviceStatus>();

  return {
    appendStatus: (input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      latest.set(input.status.deviceId, structuredClone(input.status));
      return Promise.resolve({ ok: true, value: undefined });
    },
    listLatestStatuses: (_input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const value = [...latest.values()];
      return Promise.resolve({ ok: true, value: structuredClone(value) });
    },
  };
};

export { createDeviceStatusDatastoreInMemory };
