import type { DeviceRegistration } from '../../domain/device.ts';
import type {
  AvailableDiagnostics,
  DiagnosticsProtocol,
  GrpcDiagnosticsFailure,
  RestDiagnosticsFailure,
} from '../../domain/device-report.ts';
import type { CallOptions, Result } from '../types.ts';

type ReadDiagnosticsInput = {
  registration: DeviceRegistration;
  port: number;
};

type DiagnosticsReport = Pick<
  AvailableDiagnostics,
  'hardware' | 'softwareVersion' | 'firmwareVersion' | 'reportedStatus'
> & {
  reportedChecksum: string;
  /** The exact bytes the reported checksum covers. */
  payload: Uint8Array;
};

type ReadDiagnosticsOutput = Result<DiagnosticsReport, RestDiagnosticsFailure | GrpcDiagnosticsFailure>;

type DeviceDiagnosticsReader = {
  protocol: DiagnosticsProtocol;
  versions: string[];
  readDiagnostics: (input: ReadDiagnosticsInput, options: CallOptions) => Promise<ReadDiagnosticsOutput>;
};

export type { DeviceDiagnosticsReader, DiagnosticsReport, ReadDiagnosticsInput, ReadDiagnosticsOutput };
