import type { DeviceState } from '../../domain/device-status.ts';
import type { CallOptions, Result, StoreFailure } from '../types.ts';

type ProbeDevicesInput = {};

type RoundStates = Record<Exclude<DeviceState, 'unknown'>, number>;

type ProbeDevicesOutput = Result<{ round: 'skipped' } | { round: 'completed'; states: RoundStates }, StoreFailure>;

type DeviceProbes = {
  probeDevices: (input: ProbeDevicesInput, options: CallOptions) => Promise<ProbeDevicesOutput>;
};

export type { DeviceProbes, ProbeDevicesInput, ProbeDevicesOutput, RoundStates };
