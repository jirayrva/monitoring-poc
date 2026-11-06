import type { Device } from './device.ts';
import type { DeviceState, DeviceStatus, LastKnown } from './device-status.ts';
import type { ProbeOutcome } from './probe-outcome.ts';

type StatusPolicy = {
  downProbeThreshold: number;
};

type ProbedStatus = Exclude<DeviceStatus, { state: 'unknown' }>;

type NextStatusInput = {
  /** The device as registered now, so a rename shows in its next status. */
  device: Device;
  previous: DeviceStatus;
  outcome: ProbeOutcome;
};

const lastKnownOf = (previous: DeviceStatus): LastKnown | undefined => {
  if (previous.state === 'up') {
    const { lastProbe, health, capabilities, diagnostics } = previous;
    return { seenAt: lastProbe.probedAt, health, capabilities, diagnostics };
  }

  return previous.state === 'unknown' ? undefined : previous.lastKnown;
};

const nextStatus = (input: NextStatusInput, policy: StatusPolicy): ProbedStatus => {
  const { device, previous, outcome } = input;
  const { deviceId, name } = device;
  const sinceFor = (state: DeviceState) => (previous.state === state ? previous.since : outcome.probedAt);

  if (outcome.response === 'expected') {
    const { health, capabilities, diagnostics, ...lastProbe } = outcome;
    return { deviceId, name, since: sinceFor('up'), state: 'up', lastProbe, health, capabilities, diagnostics };
  }

  const lastKnown = lastKnownOf(previous);

  if (outcome.response === 'misconfigured') {
    return { deviceId, name, since: sinceFor('misconfigured'), state: 'misconfigured', lastProbe: outcome, lastKnown };
  }

  const failedProbes = previous.state === 'suspect' ? previous.failedProbes + 1 : 1;
  if (previous.state === 'down' || failedProbes >= policy.downProbeThreshold) {
    return { deviceId, name, since: sinceFor('down'), state: 'down', lastProbe: outcome, lastKnown };
  }

  return { deviceId, name, since: sinceFor('suspect'), state: 'suspect', failedProbes, lastProbe: outcome, lastKnown };
};

export { nextStatus };
export type { NextStatusInput, ProbedStatus, StatusPolicy };
