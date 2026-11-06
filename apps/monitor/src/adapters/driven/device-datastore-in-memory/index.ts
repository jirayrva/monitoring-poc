import type { RegisteredDevice } from '../../../core/domain/device.ts';
import type { DeviceDatastore } from '../../../core/ports/driven/device-datastore.ts';

type DeviceDatastoreInMemoryFactory = () => DeviceDatastore;

/** Code-point order, as the DeviceDatastore contract requires, rather than the locale's order. */
const deviceIdComparer = (a: RegisteredDevice, b: RegisteredDevice) =>
  a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;

const cancelled = Promise.resolve({ ok: false, failure: { reason: 'cancelled' } } as const);

const createDeviceDatastoreInMemory: DeviceDatastoreInMemoryFactory = () => {
  const devices = new Map<string, RegisteredDevice>();

  return {
    listDevices: (_input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const value = [...devices.values()].toSorted(deviceIdComparer);
      return Promise.resolve({ ok: true, value: structuredClone(value) });
    },
    getDevice: (input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const registration = devices.get(input.deviceId);
      if (registration === undefined) {
        return Promise.resolve({ ok: false, failure: { reason: 'not_found' } });
      }

      return Promise.resolve({ ok: true, value: structuredClone(registration) });
    },
    insertDevice: (input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const { registration, registeredAt } = input;
      if (devices.has(registration.deviceId)) {
        return Promise.resolve({ ok: false, failure: { reason: 'already_exists' } });
      }

      devices.set(registration.deviceId, structuredClone({ ...registration, registeredAt }));
      return Promise.resolve({ ok: true, value: undefined });
    },
    updateDevice: (input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const { registration } = input;
      const stored = devices.get(registration.deviceId);
      if (stored === undefined) {
        return Promise.resolve({ ok: false, failure: { reason: 'not_found' } });
      }

      devices.set(registration.deviceId, structuredClone({ ...registration, registeredAt: stored.registeredAt }));
      return Promise.resolve({ ok: true, value: undefined });
    },
    deleteDevice: (input, options) => {
      if (options.signal.aborted) {
        return cancelled;
      }
      const { deviceId } = input;
      if (!devices.delete(deviceId)) {
        return Promise.resolve({ ok: false, failure: { reason: 'not_found' } });
      }

      return Promise.resolve({ ok: true, value: undefined });
    },
  };
};

export { createDeviceDatastoreInMemory };
