import { diagnosticsProtoPath } from '@device-monitor/contracts/device-api';
import * as grpc from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { GrpcDiagnosticsFailure } from '../../../core/domain/device-report.ts';
import type {
  DeviceDiagnosticsReader,
  ReadDiagnosticsOutput,
} from '../../../core/ports/driven/device-diagnostics-reader.ts';
import { toDiagnosticsReport } from '../../../infrastructure/device-api/diagnostics.ts';
import { authHeaders } from '../../../infrastructure/http/auth-headers.ts';
import type { ReadSecret } from '../../../infrastructure/http/auth-headers.ts';

type Reply = { diagnostics: Buffer; checksum: string };

const serviceName = 'device.v1.Diagnostics';

// Loaded when the service starts, as Node runs the sources as they are: nothing is generated (D-68).
const definition = loadSync(diagnosticsProtoPath)[serviceName];
if (definition === undefined || 'format' in definition) {
  throw new Error(`${diagnosticsProtoPath} has no service ${serviceName}`);
}
const Diagnostics = grpc.makeGenericClientConstructor(definition, serviceName);

/** As REST answers are capped, so a device that floods the monitor holds up no memory. */
const maxAnswerBytes = 1024 * 1024;

const fail = (reason: GrpcDiagnosticsFailure['reason'], grpcStatus: number) =>
  ({ ok: false, failure: { protocol: 'grpc', reason, grpcStatus } }) as const;

const toDiagnosticsFailure = (error: ServiceError, signal: AbortSignal) => {
  const { code, details } = error;
  if (signal.aborted || code === grpc.status.DEADLINE_EXCEEDED) {
    return fail('timeout', code);
  }
  if (code === grpc.status.UNAUTHENTICATED || code === grpc.status.PERMISSION_DENIED) {
    return fail('auth_failed', code);
  }
  if (code === grpc.status.RESOURCE_EXHAUSTED) {
    return fail('too_large', code);
  }
  if (code === grpc.status.UNAVAILABLE) {
    // grpc-js says only in the details that the TLS handshake, rather than the connection, failed.
    return fail(/SSL|TLS|certificate/i.test(details) ? 'tls_failed' : 'unreachable', code);
  }
  return fail('error_status', code);
};

/**
 * Reads diagnostics with device.v1.Diagnostics/GetDiagnostics, on the base URL's host and the port the device gives
 * for grpc, over TLS when the base URL is https. The answer carries the diagnostics JSON and its checksum, so the
 * payload is exactly the bytes the device sent (Q-06). A channel per call, closed after it, as a device is called
 * once a round. The caller's signal cancels the call.
 */
const createDeviceDiagnosticsReaderGrpc = (dependencies: { readSecret: ReadSecret }): DeviceDiagnosticsReader => ({
  protocol: 'grpc',
  versions: ['1'],
  readDiagnostics: ({ registration, port }, { signal }) =>
    new Promise<ReadDiagnosticsOutput>((resolve) => {
      const baseUrl = new URL(registration.baseUrl);
      const credentials =
        baseUrl.protocol === 'https:' ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      const client = new Diagnostics(`${baseUrl.hostname}:${port}`, credentials, {
        'grpc.max_receive_message_length': maxAnswerBytes,
      });
      const metadata = new grpc.Metadata();
      for (const [name, value] of Object.entries(authHeaders(registration.auth, dependencies.readSecret) ?? {})) {
        metadata.set(name, value);
      }

      const call = client['GetDiagnostics']?.(
        { deviceId: registration.deviceId },
        metadata,
        (error: ServiceError | null, reply: Reply) => {
          client.close();
          if (error) {
            resolve(toDiagnosticsFailure(error, signal));
            return;
          }

          let document: unknown;
          try {
            document = JSON.parse(reply.diagnostics.toString('utf8'));
          } catch {
            resolve(fail('unparsable', grpc.status.OK));
            return;
          }
          const report = toDiagnosticsReport(document, reply.checksum, new Uint8Array(reply.diagnostics));
          resolve(report === undefined ? fail('not_a_device_answer', grpc.status.OK) : { ok: true, value: report });
        },
      );
      if (signal.aborted) {
        call.cancel();
      }
      signal.addEventListener('abort', () => call.cancel(), { once: true });
    }),
});

export { createDeviceDiagnosticsReaderGrpc };
