import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DeviceProbes, ProbeDevicesOutput } from '../../../../core/ports/driving/device-probes.ts';
import { createHeartbeat } from '../index.ts';
import type { HeartbeatConfig } from '../index.ts';

type Round = (signal: AbortSignal, count: number) => Promise<ProbeDevicesOutput>;

const none = { up: 0, suspect: 0, down: 0, misconfigured: 0 };

const completed = (states = { ...none, up: 1 }) =>
  Promise.resolve({ ok: true as const, value: { round: 'completed' as const, states } });

/** A round that lasts until it is aborted, as DeviceProbes does when stopped. */
const untilAborted = (signal: AbortSignal) =>
  new Promise<ProbeDevicesOutput>((resolve) => {
    signal.addEventListener('abort', () => resolve({ ok: true, value: { round: 'completed', states: none } }));
  });

const fakeProbes = (round: Round = () => completed()) => {
  let rounds = 0;
  let inProgress = 0;
  let peak = 0;
  const startedAt: number[] = [];
  const deviceProbes: DeviceProbes = {
    probeDevices: async (_input, { signal }) => {
      rounds += 1;
      startedAt.push(performance.now());
      inProgress += 1;
      peak = Math.max(peak, inProgress);
      try {
        return await round(signal, rounds);
      } finally {
        inProgress -= 1;
      }
    },
  };
  return { deviceProbes, rounds: () => rounds, peak: () => peak, startedAt };
};

const fakeLogger = () => {
  const entries: { level: string; details: object; message: string }[] = [];
  const at = (level: string) => (details: object, message: string) => entries.push({ level, details, message });
  return { logger: { info: at('info'), warn: at('warn'), error: at('error') }, entries };
};

const waitFor = async (condition: () => boolean) => {
  const deadline = performance.now() + 2000;
  while (!condition()) {
    assert.ok(performance.now() < deadline, 'condition not met in time');
    await sleep(5);
  }
};

const startHeartbeat = (t: TestContext, deviceProbes: DeviceProbes, config: Partial<HeartbeatConfig> = {}) => {
  const logs = fakeLogger();
  const heartbeat = createHeartbeat({
    deviceProbes,
    logger: logs.logger,
    config: { intervalMs: 5, stopTimeoutMs: 1000, ...config },
  });
  heartbeat.start();
  t.after(() => heartbeat[Symbol.asyncDispose]());
  return { heartbeat, logs };
};

describe('heartbeat', () => {
  it('runs a round again and again', async (t) => {
    // Arrange
    const probes = fakeProbes();

    // Act
    startHeartbeat(t, probes.deviceProbes);
    await waitFor(() => probes.rounds() >= 3);

    // Assert
    assert.ok(probes.rounds() >= 3);
  });

  it('waits the interval after a round ends, so rounds never overlap', async (t) => {
    // Arrange
    const probes = fakeProbes(async () => {
      await sleep(30);
      return completed();
    });

    // Act
    startHeartbeat(t, probes.deviceProbes, { intervalMs: 30 });
    await waitFor(() => probes.rounds() >= 2);

    // Assert
    const [first = 0, second = 0] = probes.startedAt;
    assert.ok(second - first >= 59, `${second - first} ms between starts`);
    assert.equal(probes.peak(), 1);
  });

  it('logs a completed round, with how many devices it probed, the states it left them in, and how long it took', async (t) => {
    // Arrange
    const states = { ...none, up: 2, suspect: 1 };
    const probes = fakeProbes(() => completed(states));

    // Act
    const { logs } = startHeartbeat(t, probes.deviceProbes, { intervalMs: 60_000 });
    await waitFor(() => logs.entries.length >= 1);

    // Assert
    assert.partialDeepStrictEqual(logs.entries, [
      { level: 'info', details: { probed: 3, states }, message: 'Round completed' },
    ]);
    assert.match(JSON.stringify(logs.entries[0]?.details), /"durationMs":\d+/);
  });

  it('logs a round the store failed', async (t) => {
    // Arrange
    const probes = fakeProbes(() => Promise.resolve({ ok: false, failure: { reason: 'unavailable' } }));

    // Act
    const { logs } = startHeartbeat(t, probes.deviceProbes, { intervalMs: 60_000 });
    await waitFor(() => logs.entries.length >= 1);

    // Assert
    assert.partialDeepStrictEqual(logs.entries, [
      { level: 'error', details: { reason: 'unavailable' }, message: 'Round failed on the store' },
    ]);
  });

  it('logs nothing for a skipped round', async (t) => {
    // Arrange
    const probes = fakeProbes(() => Promise.resolve({ ok: true, value: { round: 'skipped' } }));

    // Act
    const { logs } = startHeartbeat(t, probes.deviceProbes);
    await waitFor(() => probes.rounds() >= 2);

    // Assert
    assert.deepEqual(logs.entries, []);
  });

  it('keeps going after a round that throws, and logs the error', async (t) => {
    // Arrange
    const bug = new Error('a bug in an adapter');
    const probes = fakeProbes((_signal, count) => (count === 1 ? Promise.reject(bug) : completed()));

    // Act
    const { logs } = startHeartbeat(t, probes.deviceProbes);
    await waitFor(() => probes.rounds() >= 2);

    // Assert
    assert.deepEqual(logs.entries[0], { level: 'error', details: { err: bug }, message: 'Round threw' });
  });

  it('aborts the round in progress when stopped, waits for it, logs nothing for it, and starts no other', async (t) => {
    // Arrange
    let ended = false;
    const probes = fakeProbes(async (signal) => {
      const result = await untilAborted(signal);
      ended = true;
      return result;
    });
    const { heartbeat, logs } = startHeartbeat(t, probes.deviceProbes);
    await waitFor(() => probes.rounds() >= 1);

    // Act
    await heartbeat[Symbol.asyncDispose]();
    await sleep(30);

    // Assert
    assert.ok(ended);
    assert.equal(probes.rounds(), 1);
    assert.deepEqual(logs.entries, []);
  });

  it('stops waiting for the round at the stop timeout, and warns', { timeout: 2000 }, async (t) => {
    // Arrange
    const probes = fakeProbes(() => new Promise(() => {}));
    const { heartbeat, logs } = startHeartbeat(t, probes.deviceProbes, { stopTimeoutMs: 20 });
    await waitFor(() => probes.rounds() >= 1);

    // Act
    await heartbeat[Symbol.asyncDispose]();

    // Assert
    assert.deepEqual(logs.entries, [
      { level: 'warn', details: { stopTimeoutMs: 20 }, message: 'Round did not end within the stop timeout' },
    ]);
  });

  it('runs one loop however often it is started', async (t) => {
    // Arrange
    const probes = fakeProbes();
    const { heartbeat } = startHeartbeat(t, probes.deviceProbes, { intervalMs: 60_000 });

    // Act
    heartbeat.start();
    await sleep(30);

    // Assert
    assert.equal(probes.rounds(), 1);
  });

  it('can be stopped when it was never started', async () => {
    // Arrange
    const heartbeat = createHeartbeat({
      deviceProbes: fakeProbes().deviceProbes,
      logger: fakeLogger().logger,
      config: { intervalMs: 5, stopTimeoutMs: 20 },
    });

    // Act
    await heartbeat[Symbol.asyncDispose]();
  });
});
