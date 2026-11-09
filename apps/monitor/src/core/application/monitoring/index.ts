import type { MonitoringState } from '../../domain/monitoring.ts';
import type { Monitoring } from '../../ports/driving/monitoring.ts';

/** How DeviceProbes tells Monitoring that a round starts and ends, so stopping waits for the round (D-32). */
type MonitoringRounds = {
  /** Starts a round and returns true while running. Returns false, starting none, otherwise. */
  startRound: () => boolean;
  endRound: () => void;
};

const createMonitoring = (): { monitoring: Monitoring; rounds: MonitoringRounds } => {
  let state: MonitoringState = 'running';
  let roundInProgress = false;

  return {
    monitoring: {
      startMonitoring: () => {
        state = 'running';
      },
      stopMonitoring: () => {
        state = roundInProgress ? 'stopping' : 'stopped';
      },
      getMonitoringState: () => ({ state }),
    },
    rounds: {
      startRound: () => {
        roundInProgress = state === 'running';
        return roundInProgress;
      },
      endRound: () => {
        roundInProgress = false;
        if (state === 'stopping') {
          state = 'stopped';
        }
      },
    },
  };
};

export { createMonitoring };
export type { MonitoringRounds };
