import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { doorDown, lobbySuspect, lobbyUp } from '../../../domain/testing/statuses.ts';
import type { DeviceStatusDatastore } from '../device-status-datastore.ts';

/** Must return a store with no statuses in it, and a separate one on every call. */
type CreateDeviceStatusDatastore = () => DeviceStatusDatastore | Promise<DeviceStatusDatastore>;

const options = { signal: new AbortController().signal };

const aborted = { signal: AbortSignal.abort() };

const testDeviceStatusDatastoreContract = (adapterName: string, createStore: CreateDeviceStatusDatastore) => {
  describe(`DeviceStatusDatastore contract: ${adapterName}`, () => {
    describe('appendStatus', () => {
      it('returns success', async () => {
        // Arrange
        const store = await createStore();

        // Act
        const result = await store.appendStatus({ status: lobbyUp }, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: undefined });
      });

      it('does not let callers change a stored status through the appended object', async () => {
        // Arrange
        const store = await createStore();
        const status = structuredClone(lobbyUp);

        // Act
        await store.appendStatus({ status }, options);
        status.name = 'Changed after append';

        // Assert
        assert.deepEqual(await store.listLatestStatuses({}, options), { ok: true, value: [lobbyUp] });
      });
    });

    describe('listLatestStatuses', () => {
      it('returns no statuses when none was appended', async () => {
        // Arrange
        const store = await createStore();

        // Act
        const result = await store.listLatestStatuses({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [] });
      });

      it('returns a status as it was appended, dates and an undefined lastKnown included', async () => {
        // Arrange
        const store = await createStore();
        await store.appendStatus({ status: doorDown }, options);

        // Act
        const result = await store.listLatestStatuses({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [doorDown] });
      });

      it('returns only the newest status of a device', async () => {
        // Arrange
        const store = await createStore();
        await store.appendStatus({ status: lobbyUp }, options);
        await store.appendStatus({ status: lobbySuspect }, options);

        // Act
        const result = await store.listLatestStatuses({}, options);

        // Assert
        assert.deepEqual(result, { ok: true, value: [lobbySuspect] });
      });

      it('returns one status per device, in no particular order', async () => {
        // Arrange
        const store = await createStore();
        await store.appendStatus({ status: lobbyUp }, options);
        await store.appendStatus({ status: doorDown }, options);

        // Act
        const result = await store.listLatestStatuses({}, options);

        // Assert
        assert.ok(result.ok);
        assert.deepEqual(
          result.value.toSorted((a, b) => a.deviceId.localeCompare(b.deviceId)),
          [doorDown, lobbyUp],
        );
      });

      it('does not let callers change a stored status through a listed object', async () => {
        // Arrange
        const store = await createStore();
        await store.appendStatus({ status: lobbyUp }, options);
        const listed = await store.listLatestStatuses({}, options);
        assert.ok(listed.ok);

        // Act
        for (const status of listed.value) {
          status.name = 'Changed after list';
        }

        // Assert
        assert.deepEqual(await store.listLatestStatuses({}, options), { ok: true, value: [lobbyUp] });
      });
    });

    describe('a call whose signal has already aborted', () => {
      it('changes nothing and reports cancelled, so a caller that gave up leaves no trace', async () => {
        // Arrange
        const store = await createStore();
        await store.appendStatus({ status: lobbyUp }, options);

        // Act
        const results = [
          await store.appendStatus({ status: lobbySuspect }, aborted),
          await store.listLatestStatuses({}, aborted),
        ];

        // Assert
        for (const result of results) {
          assert.deepEqual(result, { ok: false, failure: { reason: 'cancelled' } });
        }
        assert.deepEqual(await store.listLatestStatuses({}, options), { ok: true, value: [lobbyUp] });
      });
    });
  });
};

export { testDeviceStatusDatastoreContract };
