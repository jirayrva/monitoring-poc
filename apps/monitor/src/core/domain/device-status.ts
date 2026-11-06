import type { Device } from './device.ts';
import type { DeviceCapabilities, DeviceHealth, Diagnostics } from './device-report.ts';
import type { ExpectedProbe, FailedProbe, MisconfiguredProbe } from './probe-outcome.ts';

type LastKnown = { seenAt: Date; health: DeviceHealth; capabilities: DeviceCapabilities; diagnostics: Diagnostics };

type DeviceStatus = Device & {
  since: Date;
} & (
    | {
        state: 'unknown';
      }
    | {
        state: 'up';
        lastProbe: ExpectedProbe;
        health: DeviceHealth;
        capabilities: DeviceCapabilities;
        diagnostics: Diagnostics;
      }
    | {
        state: 'suspect';
        failedProbes: number;
        lastProbe: FailedProbe;
        lastKnown: LastKnown | undefined;
      }
    | {
        state: 'down';
        lastProbe: FailedProbe;
        lastKnown: LastKnown | undefined;
      }
    | {
        state: 'misconfigured';
        lastProbe: MisconfiguredProbe;
        lastKnown: LastKnown | undefined;
      }
  );

type DeviceState = DeviceStatus['state'];

export type { DeviceState, DeviceStatus, LastKnown };
