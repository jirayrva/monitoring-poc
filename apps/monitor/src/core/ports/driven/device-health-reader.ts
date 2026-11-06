import type { DeviceRegistration } from '../../domain/device.ts';
import type { DeviceCapabilities, DeviceHealth } from '../../domain/device-report.ts';
import type { ProbeFailure } from '../../domain/probe-outcome.ts';
import type { CallOptions, Result } from '../types.ts';

type ReadHealthInput = { registration: DeviceRegistration };

type HealthReport = { deviceId: string; health: DeviceHealth; capabilities: DeviceCapabilities };

type HealthCallFailure =
  | ProbeFailure
  | { response: 'misconfigured'; reason: 'token_missing' | 'tls_failed' }
  | { response: 'misconfigured'; reason: 'auth_failed' | 'not_found'; httpStatus: number };

type ReadHealthOutput = Result<HealthReport, HealthCallFailure>;

type DeviceHealthReader = {
  readHealth: (input: ReadHealthInput, options: CallOptions) => Promise<ReadHealthOutput>;
};

export type { DeviceHealthReader, HealthCallFailure, HealthReport, ReadHealthInput, ReadHealthOutput };
