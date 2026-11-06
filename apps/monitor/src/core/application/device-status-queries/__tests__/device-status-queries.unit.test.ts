import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RegisteredDevice } from '../../../domain/device.ts';
import type { DeviceStatus } from '../../../domain/device-status.ts';
import { door, lobby } from '../../../domain/testing/devices.ts';
import { lobbyUp } from '../../../domain/testing/statuses.ts';
import type { DeviceDatastore } from '../../../ports/driven/device-datastore.ts';
import type { DeviceStatusDatastore } from '../../../ports/driven/device-status-datastore.ts';
import { createDeviceStatusQueries } from '../index.ts';

const options = { signal: new AbortController().signal };
const registeredAt = new Date(Date.UTC(2026, 10, 1, 8));
const unused = () => Promise.reject(new Error('not called by the status queries'));
const timeout = () => Promise.resolve({ ok: false as const, failure: { reason: 'timeout' as const } });

const queriesOver = (
  devices: RegisteredDevice[] | DeviceDatastore['listDevices'],
  statuses: DeviceStatus[] | DeviceStatusDatastore['listLatestStatuses'],
) =>
  createDeviceStatusQueries({
    deviceDatastore: {
      listDevices: typeof devices === 'function' ? devices : () => Promise.resolve({ ok: true, value: devices }),
      getDevice: unused,
      insertDevice: unused,
      updateDevice: unused,
      deleteDevice: unused,
    },
    deviceStatusDatastore: {
      appendStatus: unused,
      listLatestStatuses:
        typeof statuses === 'function' ? statuses : () => Promise.resolve({ ok: true, value: statuses }),
    },
  });

describe('listLatestStatuses', () => {
  it('returns each registered device with its latest status, unknown since registered when it has none', async () => {
    // Arrange
    const queries = queriesOver(
      [
        { ...door, registeredAt },
        { ...lobby, registeredAt },
      ],
      [lobbyUp],
    );

    // Act
    const result = await queries.listLatestStatuses({}, options);

    // Assert
    assert.deepEqual(result, {
      ok: true,
      value: [{ deviceId: door.deviceId, name: door.name, since: registeredAt, state: 'unknown' }, lobbyUp],
    });
  });

  it("returns a status under the device's current name", async () => {
    // Arrange
    const queries = queriesOver([{ ...lobby, name: 'Lobby switch, east', registeredAt }], [lobbyUp]);

    // Act
    const result = await queries.listLatestStatuses({}, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: [{ ...lobbyUp, name: 'Lobby switch, east' }] });
  });

  it('leaves out the status of a device that is no longer registered', async () => {
    // Arrange
    const queries = queriesOver([], [lobbyUp]);

    // Act
    const result = await queries.listLatestStatuses({}, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: [] });
  });

  it('returns the failure of either store', async () => {
    // Act
    const results = [
      await queriesOver(timeout, [lobbyUp]).listLatestStatuses({}, options),
      await queriesOver([{ ...lobby, registeredAt }], timeout).listLatestStatuses({}, options),
    ];

    // Assert
    for (const result of results) {
      assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
    }
  });
});
