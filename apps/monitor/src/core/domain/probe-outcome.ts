import type { DeviceCapabilities, DeviceHealth, Diagnostics } from './device-report.ts';

type NoResponseReason =
  | 'unreachable'
  | 'timeout'
  /** A gateway in front of the device answered 502, 503 or 504: nothing usable answered behind it. */
  | 'gateway_error'
  /** An answer stopped partway, so it may have been cut off. */
  | 'cut_off';

type UnexpectedResponseReason = 'unparsable' | 'not_a_device_answer' | 'http_error' | 'too_large';

type MisconfiguredReason = 'auth_failed' | 'token_missing' | 'not_found' | 'wrong_device' | 'tls_failed';

type ProbeFailure =
  | { response: 'none'; reason: Exclude<NoResponseReason, 'gateway_error'> }
  | { response: 'none'; reason: 'gateway_error'; httpStatus: number }
  | { response: 'unexpected'; reason: UnexpectedResponseReason; httpStatus: number };

type ProbeTiming = { probedAt: Date; durationMs: number };

type FailedProbe = ProbeFailure & ProbeTiming;

type MisconfiguredProbe = ProbeTiming &
  (
    | {
        response: 'misconfigured';
        reason: Extract<MisconfiguredReason, 'token_missing' | 'tls_failed' | 'wrong_device'>;
      }
    | {
        response: 'misconfigured';
        reason: Extract<MisconfiguredReason, 'auth_failed' | 'not_found'>;
        httpStatus: number;
      }
  );

type ExpectedProbe = ProbeTiming & { response: 'expected' };

type ProbeOutcome =
  | FailedProbe
  | MisconfiguredProbe
  | (ExpectedProbe & { health: DeviceHealth; capabilities: DeviceCapabilities; diagnostics: Diagnostics });

export type {
  ExpectedProbe,
  FailedProbe,
  MisconfiguredProbe,
  MisconfiguredReason,
  NoResponseReason,
  ProbeFailure,
  ProbeOutcome,
  ProbeTiming,
  UnexpectedResponseReason,
};
