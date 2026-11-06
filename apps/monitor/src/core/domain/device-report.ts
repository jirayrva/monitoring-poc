import type { MisconfiguredReason, NoResponseReason, UnexpectedResponseReason } from './probe-outcome.ts';

type DeviceHealth =
  | { state: 'ok' | 'degraded' | 'starting' | 'updating' }
  | { state: 'unrecognized'; reported: string };

type DeviceProtocol = { name: string; version: string; port: number };

type DeviceCapabilities = {
  deviceType: string;
  /** In the device's order of preference. */
  protocols: DeviceProtocol[];
  checksumAlgorithm: string;
};

type ChecksumGeneratorInfo = { name: string; version: string; standIn: boolean };

type ChecksumResult =
  | {
      comparison: 'unavailable';
      reason: 'unsupported_algorithm' | 'generator_unavailable' | 'timeout' | 'failed' | 'invalid_output';
      generator: ChecksumGeneratorInfo;
    }
  | {
      comparison: 'match' | 'mismatch';
      algorithm: string;
      reported: string;
      computed: string;
      generator: ChecksumGeneratorInfo;
    };

type DiagnosticsProtocol = 'rest' | 'grpc';

type AvailableDiagnostics = {
  state: 'available';
  protocol: DiagnosticsProtocol;
  hardware: { model: string; revision: string; serial: string };
  softwareVersion: string;
  firmwareVersion: string;
  reportedStatus: string;
  checksum: ChecksumResult;
};

type RestDiagnosticsFailure =
  | {
      protocol: 'rest';
      reason: Exclude<NoResponseReason, 'gateway_error'> | Extract<MisconfiguredReason, 'tls_failed'>;
    }
  | {
      protocol: 'rest';
      reason: 'gateway_error' | UnexpectedResponseReason | Extract<MisconfiguredReason, 'auth_failed'>;
      httpStatus: number;
    };

type GrpcDiagnosticsFailure = {
  protocol: 'grpc';
  reason:
    | Exclude<NoResponseReason, 'gateway_error'>
    | Exclude<UnexpectedResponseReason, 'http_error'>
    | 'error_status'
    | Extract<MisconfiguredReason, 'auth_failed' | 'tls_failed'>;
  grpcStatus: number;
};

type Diagnostics =
  | { state: 'unavailable'; reason: 'no_supported_protocol' }
  | ({ state: 'unavailable' } & (RestDiagnosticsFailure | GrpcDiagnosticsFailure))
  | AvailableDiagnostics;

export type {
  AvailableDiagnostics,
  ChecksumGeneratorInfo,
  ChecksumResult,
  DeviceCapabilities,
  DeviceHealth,
  DeviceProtocol,
  Diagnostics,
  DiagnosticsProtocol,
  GrpcDiagnosticsFailure,
  RestDiagnosticsFailure,
};
