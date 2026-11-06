import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { lobby } from '../../../domain/testing/devices.ts';
import type { DeviceDatastore } from '../../../ports/driven/device-datastore.ts';
import { createDeviceRegistry } from '../index.ts';

const unused = () => Promise.reject(new Error('not called by registerDevice'));

it('records when a device was registered', async () => {
  // Arrange
  const registeredAt = new Date(Date.UTC(2026, 10, 3, 9));
  const insertDevice = mock.fn<DeviceDatastore['insertDevice']>(() => Promise.resolve({ ok: true, value: undefined }));
  const deviceDatastore: DeviceDatastore = {
    listDevices: unused,
    getDevice: unused,
    insertDevice,
    updateDevice: unused,
    deleteDevice: unused,
  };
  const deviceRegistry = createDeviceRegistry({ deviceDatastore, now: () => registeredAt });
  const options = { signal: new AbortController().signal };

  // Act
  const result = await deviceRegistry.registerDevice({ registration: lobby }, options);

  // Assert
  assert.deepEqual(result, { ok: true, value: undefined });
  assert.deepEqual(insertDevice.mock.calls[0]?.arguments, [{ registration: lobby, registeredAt }, options]);
});
