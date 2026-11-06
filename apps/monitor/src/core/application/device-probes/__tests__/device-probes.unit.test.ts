import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RegisteredDevice } from '../../../domain/device.ts';
import type { DeviceStatus } from '../../../domain/device-status.ts';
import { door, lobby } from '../../../domain/testing/devices.ts';
import type { ChecksumGenerator } from '../../../ports/driven/checksum-generator.ts';
import type { DeviceDatastore } from '../../../ports/driven/device-datastore.ts';
import type { DeviceDiagnosticsReader, DiagnosticsReport } from '../../../ports/driven/device-diagnostics-reader.ts';
import type { DeviceHealthReader, HealthReport } from '../../../ports/driven/device-health-reader.ts';
import type { DeviceStatusDatastore } from '../../../ports/driven/device-status-datastore.ts';
import { createDeviceProbes, probeBudgetMs } from '../index.ts';

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

const generator = { name: 'test-generator', version: '1', standIn: true };

/** Diagnostics as a device reports them, with the checksum it gives in uppercase hex. */
const report: DiagnosticsReport = {
  hardware: { model: 'USW-Pro-24', revision: 'r3', serial: 'F4E2C6A1B9D0' },
  softwareVersion: '7.1.4',
  firmwareVersion: '7.1.4',
  reportedStatus: 'ok',
  reportedChecksum: 'ABC123',
  payload: new TextEncoder().encode('{"status":"ok"}'),
};

const generatingAbc: ChecksumGenerator['generateChecksum'] = () => ok({ checksum: 'abc123' });

const restReader = (
  readDiagnostics: DeviceDiagnosticsReader['readDiagnostics'] = () => ok(report),
): DeviceDiagnosticsReader => ({ protocol: 'rest', versions: ['1'], readDiagnostics });

const speaking =
  (protocols: HealthReport['capabilities']['protocols']): DeviceHealthReader['readHealth'] =>
  ({ registration }) => {
    const answer = reportOf(registration.deviceId);
    return ok({ ...answer, capabilities: { ...answer.capabilities, protocols } });
  };

type SetUp = {
  devices?: RegisteredDevice[] | DeviceDatastore['listDevices'];
  statuses?: DeviceStatus[] | DeviceStatusDatastore['listLatestStatuses'];
  readHealth?: DeviceHealthReader['readHealth'];
  appendStatus?: DeviceStatusDatastore['appendStatus'];
  downProbeThreshold?: number;
  maxConcurrentProbes?: number;
  healthBudgetMs?: number;
  readers?: DeviceDiagnosticsReader[];
  generateChecksum?: ChecksumGenerator['generateChecksum'];
  diagnosticsBudgetMs?: number;
  checksumTimeoutMs?: number;
  now?: () => Date;
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
    deviceDiagnosticsReaders: overrides.readers ?? [],
    checksumGenerator: { info: generator, generateChecksum: overrides.generateChecksum ?? generatingAbc },
    now: overrides.now ?? (() => at(seconds++)),
    policy: {
      downProbeThreshold: overrides.downProbeThreshold ?? 3,
      maxConcurrentProbes: overrides.maxConcurrentProbes ?? 10,
      healthBudgetMs: overrides.healthBudgetMs ?? 1000,
      diagnosticsBudgetMs: overrides.diagnosticsBudgetMs ?? 1000,
      checksumTimeoutMs: overrides.checksumTimeoutMs ?? 1000,
    },
  });
  return { deviceProbes, appended };
};

const none = { up: 0, suspect: 0, down: 0, misconfigured: 0 };

/** The diagnostics a round records for the one device, which must be up. */
const diagnosticsOf = async (overrides: SetUp) => {
  const { deviceProbes, appended } = setUp(overrides);
  await deviceProbes.probeDevices({}, options);
  const [status] = appended;
  assert.ok(status?.state === 'up', `the device is ${status?.state}`);
  return status.diagnostics;
};

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

  describe('diagnostics', () => {
    it("reads them in the device's most preferred protocol that the monitor speaks, on the port it names", async () => {
      // Arrange
      const calls: { port: number; deviceId: string }[] = [];
      const reader = restReader(({ registration, port }) => {
        calls.push({ port, deviceId: registration.deviceId });
        return ok(report);
      });
      const readHealth = speaking([
        { name: 'grpc', version: '1', port: 50051 },
        { name: 'rest', version: '1', port: 8443 },
      ]);

      // Act
      const diagnostics = await diagnosticsOf({ readHealth, readers: [reader] });

      // Assert
      assert.deepEqual(calls, [{ port: 8443, deviceId: lobby.deviceId }]);
      const { reportedChecksum: _reported, payload: _payload, ...reported } = report;
      assert.deepEqual(diagnostics, {
        state: 'available',
        protocol: 'rest',
        ...reported,
        checksum: { comparison: 'match', algorithm: 'sha256', reported: 'ABC123', computed: 'abc123', generator },
      });
    });

    it("keeps to the device's order of preference when the monitor speaks several of its protocols", async () => {
      // Arrange
      const grpcReader: DeviceDiagnosticsReader = {
        protocol: 'grpc',
        versions: ['1'],
        readDiagnostics: () => ok(report),
      };
      const readHealth = speaking([
        { name: 'grpc', version: '1', port: 50051 },
        { name: 'rest', version: '1', port: 8443 },
      ]);

      // Act
      const diagnostics = await diagnosticsOf({ readHealth, readers: [restReader(unused), grpcReader] });

      // Assert
      assert.partialDeepStrictEqual(diagnostics, { state: 'available', protocol: 'grpc' });
    });

    it('reads none in a protocol version the monitor does not speak', async () => {
      // Arrange
      const reader = restReader(unused);

      // Act
      const diagnostics = await diagnosticsOf({
        readHealth: speaking([{ name: 'rest', version: '2', port: 443 }]),
        readers: [reader],
      });

      // Assert
      assert.deepEqual(diagnostics, { state: 'unavailable', reason: 'no_supported_protocol' });
    });

    const noDiagnostics: [string, DeviceHealthReader['readHealth']][] = [
      ['health fails', () => Promise.resolve({ ok: false, failure: { response: 'none', reason: 'unreachable' } })],
      ['another device answers', () => ok(reportOf('some-other-device'))],
    ];
    for (const [name, readHealth] of noDiagnostics) {
      it(`reads none when ${name} (D-34)`, async () => {
        // Arrange
        let reads = 0;
        const reader = restReader(() => {
          reads += 1;
          return ok(report);
        });
        const { deviceProbes } = setUp({ readHealth, readers: [reader] });

        // Act
        await deviceProbes.probeDevices({}, options);

        // Assert
        assert.equal(reads, 0);
      });
    }

    it('records why they are unavailable, and the device stays up', async () => {
      // Arrange
      const failure = { protocol: 'rest', reason: 'http_error', httpStatus: 500 } as const;
      const reader = restReader(() => Promise.resolve({ ok: false, failure }));

      // Act
      const diagnostics = await diagnosticsOf({ readers: [reader] });

      // Assert
      assert.deepEqual(diagnostics, { state: 'unavailable', ...failure });
    });

    it('ends them at the diagnostics budget', async () => {
      // Arrange
      const reader = restReader((_input, { signal }) => untilAborted(signal, { protocol: 'rest', reason: 'timeout' }));
      const started = performance.now();

      // Act
      const diagnostics = await diagnosticsOf({ readers: [reader], diagnosticsBudgetMs: 20 });

      // Assert
      assert.deepEqual(diagnostics, { state: 'unavailable', protocol: 'rest', reason: 'timeout' });
      assert.ok(performance.now() - started < 500, 'waited past the diagnostics budget');
    });

    it('generates the checksum of the payload, with the algorithm the device names', async () => {
      // Arrange
      const inputs: unknown[] = [];

      // Act
      await diagnosticsOf({
        readers: [restReader()],
        generateChecksum: (input) => {
          inputs.push(input);
          return ok({ checksum: 'abc123' });
        },
      });

      // Assert
      assert.deepEqual(inputs, [{ algorithm: 'sha256', payload: report.payload }]);
    });

    it('reports a checksum mismatch, and the device stays up (D-27)', async () => {
      // Act
      const diagnostics = await diagnosticsOf({
        readers: [restReader()],
        generateChecksum: () => ok({ checksum: 'ffff' }),
      });

      // Assert
      assert.partialDeepStrictEqual(diagnostics, {
        checksum: { comparison: 'mismatch', reported: 'ABC123', computed: 'ffff' },
      });
    });

    it('records why the checksum is unavailable, and which generator said so', async () => {
      // Act
      const diagnostics = await diagnosticsOf({
        readers: [restReader()],
        generateChecksum: () => Promise.resolve({ ok: false, failure: { reason: 'unsupported_algorithm' } }),
      });

      // Assert
      assert.partialDeepStrictEqual(diagnostics, {
        checksum: { comparison: 'unavailable', reason: 'unsupported_algorithm', generator },
      });
    });

    it('gives the checksum its own timeout', { timeout: 2000 }, async () => {
      // Arrange
      const started = performance.now();

      // Act
      const diagnostics = await diagnosticsOf({
        readers: [restReader()],
        generateChecksum: (_input, { signal }) => untilAborted(signal, { reason: 'timeout' as const }),
        checksumTimeoutMs: 20,
      });

      // Assert
      assert.partialDeepStrictEqual(diagnostics, { checksum: { comparison: 'unavailable', reason: 'timeout' } });
      assert.ok(performance.now() - started < 500, 'waited past the checksum timeout');
    });

    it('times the probe over every step, diagnostics included', async () => {
      // Arrange
      let second = 0;
      const reader = restReader(() => {
        second = 5;
        return ok(report);
      });
      const { deviceProbes, appended } = setUp({ readers: [reader], now: () => at(second) });

      // Act
      await deviceProbes.probeDevices({}, options);

      // Assert
      assert.partialDeepStrictEqual(appended, [{ lastProbe: { probedAt: at(0), durationMs: 5000 } }]);
    });
  });
});

it('makes the probe budget the sum of its steps: health, diagnostics and the checksum', () => {
  // Act
  const budgetMs = probeBudgetMs({
    downProbeThreshold: 3,
    maxConcurrentProbes: 1,
    healthBudgetMs: 7000,
    diagnosticsBudgetMs: 6000,
    checksumTimeoutMs: 2000,
  });

  // Assert
  assert.equal(budgetMs, 15_000);
});
