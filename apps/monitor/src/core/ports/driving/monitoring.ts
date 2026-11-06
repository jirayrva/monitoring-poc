import type { MonitoringState } from '../../domain/monitoring.ts';

type StartMonitoringInput = {};
type StartMonitoringOutput = undefined;

type StopMonitoringInput = {};
type StopMonitoringOutput = undefined;

type GetMonitoringStateInput = {};
type GetMonitoringStateOutput = { state: MonitoringState };

type Monitoring = {
  startMonitoring: (input: StartMonitoringInput) => StartMonitoringOutput;
  stopMonitoring: (input: StopMonitoringInput) => StopMonitoringOutput;
  getMonitoringState: (input: GetMonitoringStateInput) => GetMonitoringStateOutput;
};

export type {
  GetMonitoringStateInput,
  GetMonitoringStateOutput,
  Monitoring,
  StartMonitoringInput,
  StartMonitoringOutput,
  StopMonitoringInput,
  StopMonitoringOutput,
};
