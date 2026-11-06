import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RegisteredDevice } from '../../../domain/device.ts';
import type { DeviceStatus } from '../../../domain/device-status.ts';
import { door, lobby } from '../../../domain/testing/devices.ts';
import type { DeviceDatastore } from '../../../ports/driven/device-datastore.ts';
import type { DeviceHealthReader, HealthReport } from '../../../ports/driven/device-health-reader.ts';
import type { DeviceStatusDatastore } from '../../../ports/driven/device-status-datastore.ts';
import { createDeviceProbes } from '../index.ts';

const at = (second: number) => new Date(Date.UTC(2026, 10, 3, 9, 0, second));
const registeredAt = new Date(Date.UTC(2026, 10, 1, 8));
const lobbyDevice: RegisteredDevice = { ...lobby, registeredAt };
const doorDevice: RegisteredDevice = { ...door, registeredAt };
const options = { signal: new AbortController().signal };
const unused = () => Promise.reject(new Error('not called by a round'));
const ok = <Value>(value: Value) => Promise.resolve({ ok: true as const, value });
const timeout = () => Promise.resolve({ ok: false as const, failure: { reason: 'timeout' as const } });

const reportOf = (deviceId: string): HealthReport => ({
  deviceId,
  health: { state: 'ok' },
  capabilities: {
    deviceType: 'switch',
    protocols: [{ name: 'rest', version: '1', port: 443 }],
    checksumAlgorithm: 'sha256',
  },
});

const answering: DeviceHealthReader['readHealth'] = ({ registration }) => ok(reportOf(registration.deviceId));

const untilAborted = <Failure>(signal: AbortSignal, failure: Failure) =>
  new Promise<{ ok: false; failure: Failure }>((resolve) => {
    const fail = () => resolve({ ok: false, failure });
    if (signal.aborted) {
      fail();
    } else {
      signal.addEventListener('abort', fail);
    }
  });

const hanging: DeviceHealthReader['readHealth'] = (_input, { signal }) =>
  untilAborted(signal, { response: 'none', reason: 'timeout' } as const);

type SetUp = {
  devices?: RegisteredDevice[] | DeviceDatastore['listDevices'];
  statuses?: DeviceStatus[] | DeviceStatusDatastore['listLatestStatuses'];
  readHealth?: DeviceHealthReader['readHealth'];
  appendStatus?: DeviceStatusDatastore['appendStatus'];
  downProbeThreshold?: number;
  maxConcurrentProbes?: number;
  healthBudgetMs?: number;
};

/** A round over stores that hold these devices and statuses. Each reading of the clock is one second later. */
const setUp = (overrides: SetUp = {}) => {
  const { devices = [lobbyDevice], statuses = [], readHealth = answering } = overrides;
  const appended: DeviceStatus[] = [];
  let seconds = 0;
  const deviceProbes = createDeviceProbes({
    deviceDatastore: {
      listDevices: typeof devices === 'function' ? devices : () => ok(devices),
      getDevice: unused,
      insertDevice: unused,
      updateDevice: unused,
      deleteDevice: unused,
    },
    deviceStatusDatastore: {
      appendStatus:
        overrides.appendStatus ??
        (({ status }) => {
          appended.push(status);
          return ok(undefined);
        }),
      listLatestStatuses: typeof statuses === 'function' ? statuses : () => ok(statuses),
    },
    deviceHealthReader: { readHealth },
    now: () => at(seconds++),
    policy: {
      downProbeThreshold: overrides.downProbeThreshold ?? 3,
      maxConcurrentProbes: overrides.maxConcurrentProbes ?? 10,
      healthBudgetMs: overrides.healthBudgetMs ?? 1000,
    },
  });
  return { deviceProbes, appended };
};

const none = { up: 0, suspect: 0, down: 0, misconfigured: 0 };

describe('probeDevices', () => {
  it('records an answering device as up, with when the probe ran and how long it took', async () => {
    // Arrange
    const { deviceProbes, appended } = setUp();

    // Act
    const result = await deviceProbes.probeDevices({}, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: { round: 'completed', states: { ...none, up: 1 } } });
    const { health, capabilities } = reportOf(lobby.deviceId);
    assert.deepEqual(appended, [
      {
        deviceId: lobby.deviceId,
        name: lobby.name,
        since: at(0),
        state: 'up',
        lastProbe: { response: 'expected', probedAt: at(0), durationMs: 1000 },
        health,
        capabilities,
        diagnostics: { state: 'unavailable', reason: 'no_supported_protocol' },
      },
    ]);
  });

  it('records a failed health call as the probe failing, from unknown since the device was registered', async () => {
    // Arrange
    const { deviceProbes, appended } = setUp({
      readHealth: () => Promise.resolve({ ok: false, failure: { response: 'none', reason: 'unreachable' } }),
    });

    // Act
    await deviceProbes.probeDevices({}, options);

    // Assert
    assert.partialDeepStrictEqual(appended, [
      { state: 'suspect', failedProbes: 1, lastProbe: { response: 'none', reason: 'unreachable', probedAt: at(0) } },
    ]);
  });

  it('records an answer that shows the registration is wrong as misconfigured', async () => {
    // Arrange
    const { deviceProbes, appended } = setUp({
      readHealth: () =>
        Promise.resolve({ ok: false, failure: { response: 'misconfigured', reason: 'auth_failed', httpStatus: 401 } }),
    });

    // Act
    await deviceProbes.probeDevices({}, options);

    // Assert
    assert.partialDeepStrictEqual(appended, [
      { state: 'misconfigured', lastProbe: { response: 'misconfigured', reason: 'auth_failed', httpStatus: 401 } },
    ]);
  });

  it('records another device answering as misconfigured, never as up', async () => {
    // Arrange
    const { deviceProbes, appended } = setUp({ readHealth: () => ok(reportOf('some-other-device')) });

    // Act
    await deviceProbes.probeDevices({}, options);

    // Assert
    assert.partialDeepStrictEqual(appended, [
      { state: 'misconfigured', lastProbe: { response: 'misconfigured', reason: 'wrong_device' } },
    ]);
  });

  it("follows on from the device's latest status", async () => {
    // Arrange
    const suspect: DeviceStatus = {
      ...lobby,
      since: at(0),
      state: 'suspect',
      failedProbes: 2,
      lastProbe: { response: 'none', reason: 'timeout', probedAt: at(0), durationMs: 3000 },
      lastKnown: undefined,
    };
    const { deviceProbes, appended } = setUp({
      statuses: [suspect],
      readHealth: () => Promise.resolve({ ok: false, failure: { response: 'none', reason: 'timeout' } }),
    });

    // Act
    await deviceProbes.probeDevices({}, options);

    // Assert
    assert.partialDeepStrictEqual(appended, [{ state: 'down' }]);
  });

  it('counts the devices the round left in each state', async () => {
    // Arrange
    const devices = ['answers', 'silent', 'also-silent'].map((deviceId) => ({ ...lobbyDevice, deviceId }));
    const { deviceProbes } = setUp({
      devices,
      readHealth: ({ registration }) =>
        Promise.resolve(
          registration.deviceId === 'answers'
            ? { ok: true, value: reportOf(registration.deviceId) }
            : { ok: false, failure: { response: 'none', reason: 'timeout' } },
        ),
    });

    // Act
    const result = await deviceProbes.probeDevices({}, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: { round: 'completed', states: { ...none, up: 1, suspect: 2 } } });
  });

  it('probes every registered device, at most maxConcurrentProbes at once', async () => {
    // Arrange
    const devices = Array.from({ length: 5 }, (_, index) => ({ ...lobbyDevice, deviceId: `device-${index}` }));
    let inFlight = 0;
    let mostInFlight = 0;
    const { deviceProbes, appended } = setUp({
      devices,
      maxConcurrentProbes: 2,
      readHealth: async ({ registration }) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return { ok: true, value: reportOf(registration.deviceId) };
      },
    });

    // Act
    const result = await deviceProbes.probeDevices({}, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: { round: 'completed', states: { ...none, up: 5 } } });
    assert.deepEqual(
      appended.map(({ deviceId }) => deviceId).toSorted(),
      devices.map(({ deviceId }) => deviceId),
    );
    assert.equal(mostInFlight, 2);
  });

  it('returns a store failure from listing, and probes nothing', async () => {
    // Arrange
    let probes = 0;
    const readHealth: DeviceHealthReader['readHealth'] = (input, callOptions) => {
      probes += 1;
      return answering(input, callOptions);
    };

    // Act
    const results = [
      await setUp({ devices: timeout, readHealth }).deviceProbes.probeDevices({}, options),
      await setUp({ statuses: timeout, readHealth }).deviceProbes.probeDevices({}, options),
    ];

    // Assert
    for (const result of results) {
      assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
    }
    assert.equal(probes, 0);
  });

  it("records the other devices' statuses when appending one fails, and reports the failure", async () => {
    // Arrange
    const appended: string[] = [];
    const { deviceProbes } = setUp({
      devices: [doorDevice, lobbyDevice],
      appendStatus: ({ status }) => {
        if (status.deviceId === door.deviceId) {
          return Promise.resolve({ ok: false, failure: { reason: 'unavailable' } });
        }
        appended.push(status.deviceId);
        return ok(undefined);
      },
    });

    // Act
    const result = await deviceProbes.probeDevices({}, options);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'unavailable' } });
    assert.deepEqual(appended, [lobby.deviceId]);
  });

  it('records nothing for a probe the round was aborted during', async () => {
    // Arrange
    const round = new AbortController();
    const { deviceProbes, appended } = setUp({
      readHealth: () => {
        round.abort();
        return Promise.resolve({ ok: false, failure: { response: 'none', reason: 'timeout' } });
      },
    });

    // Act
    const result = await deviceProbes.probeDevices({}, { signal: round.signal });

    // Assert
    assert.deepEqual(result, { ok: true, value: { round: 'completed', states: none } });
    assert.deepEqual(appended, []);
  });

  it('starts no more probes once the round is aborted', async () => {
    // Arrange
    const round = new AbortController();
    const devices = Array.from({ length: 3 }, (_, index) => ({ ...lobbyDevice, deviceId: `device-${index}` }));
    let probes = 0;
    const { deviceProbes } = setUp({
      devices,
      maxConcurrentProbes: 1,
      readHealth: () => {
        probes += 1;
        round.abort();
        return Promise.resolve({ ok: false, failure: { response: 'none', reason: 'timeout' } });
      },
    });

    // Act
    await deviceProbes.probeDevices({}, { signal: round.signal });

    // Assert
    assert.equal(probes, 1);
  });

  it('ends the health call at its budget, so a device that hangs holds up no round, and records the timeout', async () => {
    // Arrange
    const { deviceProbes, appended } = setUp({ readHealth: hanging, healthBudgetMs: 20 });

    // Act
    await deviceProbes.probeDevices({}, options);

    // Assert
    assert.partialDeepStrictEqual(appended, [{ state: 'suspect', lastProbe: { response: 'none', reason: 'timeout' } }]);
  });
});
