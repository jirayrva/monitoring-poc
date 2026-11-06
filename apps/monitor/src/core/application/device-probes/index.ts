import pMap from 'p-map';
import type { RegisteredDevice } from '../../domain/device.ts';
import type { DeviceCapabilities, Diagnostics } from '../../domain/device-report.ts';
import type { DeviceStatus } from '../../domain/device-status.ts';
import type { ProbeOutcome } from '../../domain/probe-outcome.ts';
import { nextStatus, registeredStatus } from '../../domain/status-transitions.ts';
import type { StatusPolicy } from '../../domain/status-transitions.ts';
import type { ChecksumGenerator } from '../../ports/driven/checksum-generator.ts';
import type { DeviceDatastore } from '../../ports/driven/device-datastore.ts';
import type { DeviceDiagnosticsReader } from '../../ports/driven/device-diagnostics-reader.ts';
import type { DeviceHealthReader } from '../../ports/driven/device-health-reader.ts';
import type { DeviceStatusDatastore } from '../../ports/driven/device-status-datastore.ts';
import type { DeviceProbes, RoundStates } from '../../ports/driving/device-probes.ts';
import type { CallOptions, StoreFailure } from '../../ports/types.ts';

type ProbePolicy = StatusPolicy & {
  healthBudgetMs: number;
  diagnosticsBudgetMs: number;
  checksumTimeoutMs: number;
  maxConcurrentProbes: number;
};

type DeviceProbesDependencies = {
  deviceDatastore: DeviceDatastore;
  deviceStatusDatastore: DeviceStatusDatastore;
  deviceHealthReader: DeviceHealthReader;
  deviceDiagnosticsReaders: DeviceDiagnosticsReader[];
  checksumGenerator: ChecksumGenerator;
  now: () => Date;
  policy: ProbePolicy;
};

const within = (options: CallOptions, timeoutMs: number): CallOptions => ({
  signal: AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]),
});

/** The longest a probe can take: its steps, one after the other. Stopping waits that long for one. */
const probeBudgetMs = (policy: ProbePolicy) =>
  policy.healthBudgetMs + policy.diagnosticsBudgetMs + policy.checksumTimeoutMs;

const createDeviceProbes = (dependencies: DeviceProbesDependencies): DeviceProbes => {
  const { deviceDatastore, deviceStatusDatastore, deviceHealthReader, now, policy } = dependencies;
  const { deviceDiagnosticsReaders, checksumGenerator } = dependencies;

  /** The device's most preferred protocol that the monitor speaks, in that version (Q-04). */
  const pickProtocol = ({ protocols }: DeviceCapabilities) => {
    for (const protocol of protocols) {
      const reader = deviceDiagnosticsReaders.find(
        (each) => each.protocol === protocol.name && each.versions.includes(protocol.version),
      );
      if (reader !== undefined) {
        return { reader, port: protocol.port };
      }
    }
    return undefined;
  };

  /**
   * Reads diagnostics, then checks the checksum the device reported against one generated from what it sent, with the
   * algorithm it names. Hex reads the same in either case. Neither a mismatch nor a failure changes the state (D-27).
   */
  const readDiagnostics = async (
    device: RegisteredDevice,
    capabilities: DeviceCapabilities,
    options: CallOptions,
  ): Promise<Diagnostics> => {
    const picked = pickProtocol(capabilities);
    if (picked === undefined) {
      return { state: 'unavailable', reason: 'no_supported_protocol' };
    }

    const { reader, port } = picked;
    const read = await reader.readDiagnostics(
      { registration: device, port },
      within(options, policy.diagnosticsBudgetMs),
    );
    if (!read.ok) {
      return { state: 'unavailable', ...read.failure };
    }

    const { reportedChecksum, payload, ...report } = read.value;
    const { info: generator } = checksumGenerator;
    const algorithm = capabilities.checksumAlgorithm;
    const generated = await checksumGenerator.generateChecksum(
      { algorithm, payload },
      within(options, policy.checksumTimeoutMs),
    );
    const checksum = generated.ok
      ? ({
          comparison: generated.value.checksum.toLowerCase() === reportedChecksum.toLowerCase() ? 'match' : 'mismatch',
          algorithm,
          reported: reportedChecksum,
          computed: generated.value.checksum,
          generator,
        } as const)
      : ({ comparison: 'unavailable', reason: generated.failure.reason, generator } as const);
    return { state: 'available', protocol: reader.protocol, ...report, checksum };
  };

  const probe = async (device: RegisteredDevice, options: CallOptions): Promise<ProbeOutcome> => {
    const probedAt = now();
    const timing = () => ({ probedAt, durationMs: now().getTime() - probedAt.getTime() });
    const health = await deviceHealthReader.readHealth(
      { registration: device },
      within(options, policy.healthBudgetMs),
    );
    if (!health.ok) {
      return { ...health.failure, ...timing() };
    }

    const { deviceId, health: reportedHealth, capabilities } = health.value;
    if (deviceId !== device.deviceId) {
      return { response: 'misconfigured', reason: 'wrong_device', ...timing() };
    }

    // Read only now: health said which protocols the device speaks (D-34).
    const diagnostics = await readDiagnostics(device, capabilities, options);
    return { response: 'expected', ...timing(), health: reportedHealth, capabilities, diagnostics };
  };

  return {
    probeDevices: async (_input, options) => {
      const devices = await deviceDatastore.listDevices({}, options);
      if (!devices.ok) {
        return devices;
      }

      const statuses = await deviceStatusDatastore.listLatestStatuses({}, options);
      if (!statuses.ok) {
        return statuses;
      }

      const latest = new Map(statuses.value.map((status) => [status.deviceId, status]));
      const failures: StoreFailure[] = [];
      const states: RoundStates = { up: 0, suspect: 0, down: 0, misconfigured: 0 };
      const probeAndRecord = async (device: RegisteredDevice) => {
        const outcome = await probe(device, options);
        if (options.signal.aborted) {
          return;
        }

        const previous: DeviceStatus = latest.get(device.deviceId) ?? registeredStatus(device);
        const status = nextStatus({ device, previous, outcome }, policy);
        const appended = await deviceStatusDatastore.appendStatus({ status }, options);
        if (appended.ok) {
          states[status.state] += 1;
        } else {
          failures.push(appended.failure);
        }
      };

      // An abort stops new probes from starting, and is no failure: the round reports what it recorded.
      await pMap(devices.value, probeAndRecord, {
        concurrency: policy.maxConcurrentProbes,
        signal: options.signal,
      }).catch((error: unknown) => {
        if (!options.signal.aborted) {
          throw error;
        }
      });

      // The other devices' statuses are recorded, but the round reports the store failing.
      const [failure] = failures;
      return failure === undefined ? { ok: true, value: { round: 'completed', states } } : { ok: false, failure };
    },
  };
};

export { createDeviceProbes, probeBudgetMs };
export type { DeviceProbesDependencies, ProbePolicy };
