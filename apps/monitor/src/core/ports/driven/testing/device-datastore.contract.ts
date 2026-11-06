import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeviceRegistration, RegisteredDevice } from '../../../domain/device.ts';
import { door, lobby } from '../../../domain/testing/devices.ts';
import type { DeviceDatastore } from '../device-datastore.ts';

/** Must return a store with no devices in it, and a separate one on every call. */
type CreateDeviceDatastore = () => DeviceDatastore | Promise<DeviceDatastore>;

const options = { signal: new AbortController().signal };

const aborted = { signal: AbortSignal.abort() };

const registeredAt = new Date(Date.UTC(2026, 10, 1, 8));

const registered = (registration: DeviceRegistration): RegisteredDevice => ({ ...registration, registeredAt });

const testDeviceDatastoreContract = (adapterName: string, createDeviceDatastore: CreateDeviceDatastore) => {
  describe(`DeviceDatastore contract: ${adapterName}`, () => {
    describe('listDevices', () => {
      it('returns an empty list when no device was added', async () => {
        // Arrange
        const store = await createDeviceDatastore();

        // Act
        const result = await store.listDevices({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [] });
      });

      it('returns devices ordered by ID, regardless of the order they were added in', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);
        await store.insertDevice({ registration: door, registeredAt }, options);

        // Act
        const result = await store.listDevices({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [registered(door), registered(lobby)] });
      });

      it('orders IDs by code point, so uppercase sorts before lowercase in every adapter', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        const lowercase = { ...lobby, deviceId: 'a-switch' };
        const uppercase = { ...lobby, deviceId: 'B-switch' };
        await store.insertDevice({ registration: lowercase, registeredAt }, options);
        await store.insertDevice({ registration: uppercase, registeredAt }, options);

        // Act
        const result = await store.listDevices({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [registered(uppercase), registered(lowercase)] });
      });

      it('does not let callers change stored devices through a listed object', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);
        const listed = await store.listDevices({}, options);
        assert.ok(listed.ok);

        // Act
        for (const device of listed.value) {
          device.baseUrl = 'http://changed.example.test';
        }

        // Assert
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(lobby)] });
      });
    });

    describe('getDevice', () => {
      it('returns the device with the ID', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: door, registeredAt }, options);
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        const result = await store.getDevice({ deviceId: lobby.deviceId }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: registered(lobby) });
      });

      it('rejects an unknown ID', async () => {
        // Arrange
        const store = await createDeviceDatastore();

        // Act
        const result = await store.getDevice({ deviceId: lobby.deviceId }, options);

        // Assert
        assert.deepEqual(result, { ok: false, failure: { reason: 'not_found' } });
      });

      it('does not let callers change a stored device through the returned object', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);
        const got = await store.getDevice({ deviceId: lobby.deviceId }, options);
        assert.ok(got.ok);

        // Act
        got.value.baseUrl = 'http://changed.example.test';

        // Assert
        assert.deepEqual(await store.getDevice({ deviceId: lobby.deviceId }, options), {
          ok: true,
          value: registered(lobby),
        });
      });
    });

    describe('insertDevice', () => {
      it('returns success for a new device', async () => {
        // Arrange
        const store = await createDeviceDatastore();

        // Act
        const result = await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: undefined });
      });

      it('rejects a duplicate ID and keeps the original device', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        const result = await store.insertDevice({ registration: { ...lobby, name: 'Renamed' }, registeredAt }, options);

        // Assert
        assert.deepEqual(result, { ok: false, failure: { reason: 'already_exists' } });
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(lobby)] });
      });

      it('accepts exactly one of two simultaneous inserts with the same ID', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        const renamed = { ...lobby, name: 'Renamed' };

        // Act
        const results = await Promise.all([
          store.insertDevice({ registration: lobby, registeredAt }, options),
          store.insertDevice({ registration: renamed, registeredAt }, options),
        ]);

        // Assert
        const [first, second] = results;
        const failed = first.ok ? second : first;
        assert.equal(results.filter((result) => result.ok).length, 1);
        assert.deepEqual(failed, { ok: false, failure: { reason: 'already_exists' } });
        assert.deepEqual(await store.listDevices({}, options), {
          ok: true,
          value: [registered(first.ok ? lobby : renamed)],
        });
      });

      it('does not let callers change a stored device through the inserted object', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        const inserted = structuredClone(lobby);

        // Act
        await store.insertDevice({ registration: inserted, registeredAt }, options);
        inserted.name = 'Changed after insert';

        // Assert
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(lobby)] });
      });
    });

    it('keeps when each device was registered, through an update', async () => {
      // Arrange
      const store = await createDeviceDatastore();
      const later = new Date(Date.UTC(2026, 10, 2, 8));
      await store.insertDevice({ registration: lobby, registeredAt }, options);
      await store.insertDevice({ registration: door, registeredAt: later }, options);

      // Act
      await store.updateDevice({ registration: { ...lobby, name: 'Renamed' } }, options);

      // Assert
      assert.deepEqual(await store.listDevices({}, options), {
        ok: true,
        value: [
          { ...door, registeredAt: later },
          { ...lobby, name: 'Renamed', registeredAt },
        ],
      });
      assert.deepEqual(await store.getDevice({ deviceId: door.deviceId }, options), {
        ok: true,
        value: { ...door, registeredAt: later },
      });
    });

    describe('updateDevice', () => {
      const updated: DeviceRegistration = {
        ...lobby,
        name: 'Renamed switch',
        baseUrl: 'https://switch.example.test',
        auth: { strategy: 'bearer', secretRef: 'DEVICE_SWITCH_TOKEN' },
      };

      it('replaces the settings of an existing device', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        const result = await store.updateDevice({ registration: updated }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: undefined });
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(updated)] });
      });

      it('rejects an unknown ID and does not add the device', async () => {
        // Arrange
        const store = await createDeviceDatastore();

        // Act
        const result = await store.updateDevice({ registration: updated }, options);

        // Assert
        assert.deepEqual(result, { ok: false, failure: { reason: 'not_found' } });
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [] });
      });

      it('leaves other devices unchanged', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: door, registeredAt }, options);
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        await store.updateDevice({ registration: updated }, options);

        // Assert
        assert.deepEqual(await store.listDevices({}, options), {
          ok: true,
          value: [registered(door), registered(updated)],
        });
      });

      it('does not let callers change a stored device through the updated object', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);
        const registration = structuredClone(updated);

        // Act
        await store.updateDevice({ registration }, options);
        registration.name = 'Changed after update';

        // Assert
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(updated)] });
      });
    });

    describe('deleteDevice', () => {
      it('removes an existing device', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        const result = await store.deleteDevice({ deviceId: lobby.deviceId }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: undefined });
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [] });
      });

      it('rejects an unknown ID', async () => {
        // Arrange
        const store = await createDeviceDatastore();

        // Act
        const result = await store.deleteDevice({ deviceId: lobby.deviceId }, options);

        // Assert
        assert.deepEqual(result, { ok: false, failure: { reason: 'not_found' } });
      });

      it('leaves other devices unchanged', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: door, registeredAt }, options);
        await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Act
        await store.deleteDevice({ deviceId: lobby.deviceId }, options);

        // Assert
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(door)] });
      });

      it('allows the ID to be added again', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: lobby, registeredAt }, options);
        await store.deleteDevice({ deviceId: lobby.deviceId }, options);

        // Act
        const result = await store.insertDevice({ registration: lobby, registeredAt }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: undefined });
      });
    });

    describe('a call whose signal has already aborted', () => {
      it('changes nothing and reports cancelled, so a caller that gave up leaves no trace', async () => {
        // Arrange
        const store = await createDeviceDatastore();
        await store.insertDevice({ registration: door, registeredAt }, options);

        // Act
        const results = [
          await store.listDevices({}, aborted),
          await store.getDevice({ deviceId: door.deviceId }, aborted),
          await store.insertDevice({ registration: lobby, registeredAt }, aborted),
          await store.updateDevice({ registration: { ...door, name: 'Changed' } }, aborted),
          await store.deleteDevice({ deviceId: door.deviceId }, aborted),
        ];

        // Assert
        for (const result of results) {
          assert.deepEqual(result, { ok: false, failure: { reason: 'cancelled' } });
        }
        assert.deepEqual(await store.listDevices({}, options), { ok: true, value: [registered(door)] });
      });
    });
  });
};

export { testDeviceDatastoreContract };
