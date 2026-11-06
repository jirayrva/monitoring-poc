import pMap from 'p-map';
import type { RegisteredDevice } from '../../domain/device.ts';
import type { DeviceStatus } from '../../domain/device-status.ts';
import type { ProbeOutcome } from '../../domain/probe-outcome.ts';
import { nextStatus, registeredStatus } from '../../domain/status-transitions.ts';
import type { StatusPolicy } from '../../domain/status-transitions.ts';
import type { DeviceDatastore } from '../../ports/driven/device-datastore.ts';
import type { DeviceHealthReader } from '../../ports/driven/device-health-reader.ts';
import type { DeviceStatusDatastore } from '../../ports/driven/device-status-datastore.ts';
import type { DeviceProbes, RoundStates } from '../../ports/driving/device-probes.ts';
import type { CallOptions, StoreFailure } from '../../ports/types.ts';

type ProbePolicy = StatusPolicy & {
  healthBudgetMs: number;
  maxConcurrentProbes: number;
};

type DeviceProbesDependencies = {
  deviceDatastore: DeviceDatastore;
  deviceStatusDatastore: DeviceStatusDatastore;
  deviceHealthReader: DeviceHealthReader;
  now: () => Date;
  policy: ProbePolicy;
};

const within = (options: CallOptions, timeoutMs: number): CallOptions => ({
  signal: AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]),
});

const createDeviceProbes = (dependencies: DeviceProbesDependencies): DeviceProbes => {
  const { deviceDatastore, deviceStatusDatastore, deviceHealthReader, now, policy } = dependencies;

  const probe = async (device: RegisteredDevice, options: CallOptions): Promise<ProbeOutcome> => {
    const probedAt = now();
    const health = await deviceHealthReader.readHealth(
      { registration: device },
      within(options, policy.healthBudgetMs),
    );
    const timing = { probedAt, durationMs: now().getTime() - probedAt.getTime() };
    if (!health.ok) {
      return { ...health.failure, ...timing };
    }

    const { deviceId, health: reportedHealth, capabilities } = health.value;
    if (deviceId !== device.deviceId) {
      return { response: 'misconfigured', reason: 'wrong_device', ...timing };
    }

    // No diagnostics reader yet, so the monitor speaks none of the device's protocols.
    const diagnostics = { state: 'unavailable', reason: 'no_supported_protocol' } as const;
    return { response: 'expected', ...timing, health: reportedHealth, capabilities, diagnostics };
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

export { createDeviceProbes };
export type { DeviceProbesDependencies, ProbePolicy };
