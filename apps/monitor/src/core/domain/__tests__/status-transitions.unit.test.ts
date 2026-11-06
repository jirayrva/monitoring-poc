import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeviceCapabilities, DeviceHealth, Diagnostics } from '../device-report.ts';
import type { DeviceStatus } from '../device-status.ts';
import type { ProbeOutcome } from '../probe-outcome.ts';
import { nextStatus } from '../status-transitions.ts';

const device = { deviceId: 'usw-pro-24-0042', name: 'Lobby switch' };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 9, minute));

const reported: { health: DeviceHealth; capabilities: DeviceCapabilities; diagnostics: Diagnostics } = {
  health: { state: 'ok' },
  capabilities: {
    deviceType: 'switch',
    protocols: [{ name: 'rest', version: '1', port: 443 }],
    checksumAlgorithm: 'sha256',
  },
  diagnostics: { state: 'unavailable', reason: 'no_supported_protocol' },
};

const outcomes = {
  expected: { response: 'expected', probedAt: at(10), durationMs: 20, ...reported },
  failed: { response: 'none', reason: 'timeout', probedAt: at(10), durationMs: 3000 },
  misconfigured: {
    response: 'misconfigured',
    reason: 'auth_failed',
    httpStatus: 401,
    probedAt: at(10),
    durationMs: 20,
  },
} as const satisfies Record<string, ProbeOutcome>;

const lastKnown = { seenAt: at(1), ...reported };

const statuses = {
  unknown: { ...device, since: at(0), state: 'unknown' },
  up: {
    ...device,
    since: at(0),
    state: 'up',
    lastProbe: { response: 'expected', probedAt: at(1), durationMs: 20 },
    ...reported,
  },
  suspect: {
    ...device,
    since: at(0),
    state: 'suspect',
    failedProbes: 1,
    lastProbe: { ...outcomes.failed, probedAt: at(1) },
    lastKnown,
  },
  down: { ...device, since: at(0), state: 'down', lastProbe: { ...outcomes.failed, probedAt: at(1) }, lastKnown },
  misconfigured: {
    ...device,
    since: at(0),
    state: 'misconfigured',
    lastProbe: { ...outcomes.misconfigured, probedAt: at(1) },
    lastKnown,
  },
} as const satisfies Record<DeviceStatus['state'], DeviceStatus>;

type From = keyof typeof statuses;
type Outcome = keyof typeof outcomes;

/** Every edge of the state diagram in ARCHITECTURE.md: from, outcome, N, to. */
const edges: [From, Outcome, number, DeviceStatus['state']][] = [
  ['unknown', 'expected', 3, 'up'],
  ['unknown', 'failed', 3, 'suspect'],
  ['unknown', 'failed', 1, 'down'],
  ['up', 'expected', 3, 'up'],
  ['up', 'failed', 3, 'suspect'],
  ['up', 'failed', 1, 'down'],
  ['suspect', 'expected', 3, 'up'],
  ['suspect', 'failed', 3, 'suspect'],
  ['suspect', 'failed', 2, 'down'],
  ['down', 'expected', 3, 'up'],
  ['down', 'failed', 3, 'down'],
  ['unknown', 'misconfigured', 3, 'misconfigured'],
  ['up', 'misconfigured', 3, 'misconfigured'],
  ['suspect', 'misconfigured', 3, 'misconfigured'],
  ['down', 'misconfigured', 3, 'misconfigured'],
  ['misconfigured', 'misconfigured', 3, 'misconfigured'],
  ['misconfigured', 'expected', 3, 'up'],
  ['misconfigured', 'failed', 3, 'suspect'],
  ['misconfigured', 'failed', 1, 'down'],
];

const next = (from: From, outcome: Outcome, downProbeThreshold = 3) =>
  nextStatus({ device, previous: statuses[from], outcome: outcomes[outcome] }, { downProbeThreshold });

describe('nextStatus', () => {
  for (const [from, outcome, threshold, to] of edges) {
    it(`goes from ${from} to ${to} on ${outcome}, with N = ${threshold}`, () => {
      // Act
      const status = next(from, outcome, threshold);

      // Assert
      assert.equal(status.state, to);
      assert.deepEqual(status.since, from === to ? at(0) : at(10), 'since changes only with the state');
    });
  }

  it('counts failed probes in a row while suspect, from one after any other state', () => {
    // Act
    const fromSuspect = next('suspect', 'failed');
    const fromMisconfigured = next('misconfigured', 'failed');

    // Assert
    assert.partialDeepStrictEqual(fromSuspect, { state: 'suspect', failedProbes: 2 });
    assert.partialDeepStrictEqual(fromMisconfigured, { state: 'suspect', failedProbes: 1 });
  });

  it('keeps what an expected probe reported, and the probe without it', () => {
    // Act
    const status = next('down', 'expected');

    // Assert
    assert.deepEqual(status, {
      ...device,
      since: at(10),
      state: 'up',
      lastProbe: { response: 'expected', probedAt: at(10), durationMs: 20 },
      ...reported,
    });
  });

  it('keeps the failed probe as the last probe', () => {
    // Act
    const status = next('up', 'failed');

    // Assert
    assert.partialDeepStrictEqual(status, { lastProbe: outcomes.failed });
  });

  it('remembers what an up device last reported, and when, once it stops being up', () => {
    // Act
    const statusesAfter = [next('up', 'failed'), next('up', 'failed', 1), next('up', 'misconfigured')];

    // Assert
    for (const status of statusesAfter) {
      assert.partialDeepStrictEqual(status, { lastKnown: { seenAt: at(1), ...reported } });
    }
  });

  it('carries lastKnown while not up, and has none before the device was ever up', () => {
    // Act
    const carried = [next('suspect', 'failed'), next('down', 'failed'), next('misconfigured', 'failed')];
    const never = next('unknown', 'failed');

    // Assert
    for (const status of carried) {
      assert.partialDeepStrictEqual(status, { lastKnown });
    }
    assert.partialDeepStrictEqual(never, { lastKnown: undefined });
  });

  it("takes the device's current name, so a rename shows in its next status", () => {
    // Act
    const status = nextStatus(
      { device: { ...device, name: 'Lobby switch, east' }, previous: statuses.up, outcome: outcomes.expected },
      { downProbeThreshold: 3 },
    );

    // Assert
    assert.equal(status.name, 'Lobby switch, east');
  });
});
