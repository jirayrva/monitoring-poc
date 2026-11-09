import { setTimeout as sleep } from 'node:timers/promises';
import type { DeviceProbes } from '../../../core/ports/driving/device-probes.ts';

type Log = (details: object, message: string) => void;

type HeartbeatLogger = { info: Log; warn: Log; error: Log };

type HeartbeatConfig = {
  /** The wait between the end of one round and the start of the next, so rounds never overlap (D-33). */
  intervalMs: number;
  stopTimeoutMs: number;
};

type HeartbeatDependencies = { deviceProbes: DeviceProbes; logger: HeartbeatLogger; config: HeartbeatConfig };

/** Disposing it stops it: it aborts the round in progress, and waits for it to end, up to the stop timeout. */
type Heartbeat = AsyncDisposable & {
  start: () => void;
};

const createHeartbeat = (dependencies: HeartbeatDependencies): Heartbeat => {
  const { deviceProbes, logger, config } = dependencies;
  let running: { controller: AbortController; done: Promise<void> } | undefined;

  const runRound = async (signal: AbortSignal) => {
    const startedAt = performance.now();
    try {
      const result = await deviceProbes.probeDevices({}, { signal });
      const durationMs = Math.round(performance.now() - startedAt);
      if (signal.aborted) {
        return;
      }
      if (!result.ok) {
        logger.error({ reason: result.failure.reason, durationMs }, 'Round failed on the store');
      } else if (result.value.round === 'completed') {
        const { states } = result.value;
        const probed = Object.values(states).reduce((sum, count) => sum + count, 0);
        logger.info({ probed, states, durationMs }, 'Round completed');
      }
    } catch (error) {
      // A bug, not a failure the core expects: the next round may still work.
      logger.error({ err: error }, 'Round threw');
    }
  };

  const loop = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      await runRound(signal);
      await sleep(config.intervalMs, undefined, { signal }).catch(() => {});
    }
  };

  return {
    start: () => {
      if (running === undefined) {
        const controller = new AbortController();
        running = { controller, done: loop(controller.signal) };
      }
    },
    [Symbol.asyncDispose]: async () => {
      if (running === undefined) {
        return;
      }

      const { controller, done } = running;
      running = undefined;
      controller.abort();
      // Unreferenced, so a round that ends in time leaves no timer holding the process open.
      const timedOut = sleep(config.stopTimeoutMs, 'timed_out' as const, { ref: false });
      if ((await Promise.race([done, timedOut])) === 'timed_out') {
        logger.warn({ stopTimeoutMs: config.stopTimeoutMs }, 'Round did not end within the stop timeout');
      }
    },
  };
};

export { createHeartbeat };
export type { Heartbeat, HeartbeatConfig, HeartbeatLogger };
