import { diagnosticsChecksumHeader } from '@device-monitor/contracts/device-api';
import type { RestDiagnosticsFailure } from '../../../core/domain/device-report.ts';
import type {
  DeviceDiagnosticsReader,
  ReadDiagnosticsOutput,
} from '../../../core/ports/driven/device-diagnostics-reader.ts';
import { toDiagnosticsReport } from '../../../infrastructure/device-api/diagnostics.ts';
import { authHeaders } from '../../../infrastructure/http/auth-headers.ts';
import type { ReadSecret } from '../../../infrastructure/http/auth-headers.ts';
import { getJson } from '../../../infrastructure/http/get-json.ts';
import type { GetJsonFailure } from '../../../infrastructure/http/get-json.ts';

const toDiagnosticsFailure = (failure: GetJsonFailure): RestDiagnosticsFailure => {
  if (!('httpStatus' in failure)) {
    return { protocol: 'rest', reason: failure.reason };
  }

  const { reason, httpStatus } = failure;
  const refused = reason === 'http_error' && (httpStatus === 401 || httpStatus === 403);
  return { protocol: 'rest', reason: refused ? 'auth_failed' : reason, httpStatus };
};

/**
 * Reads diagnostics with GET /v1/diagnostics on the base URL, with the port the device gives for rest. The checksum
 * comes in a header, so the payload is exactly the body the device sent (Q-06). Keeps only what the port knows. The
 * caller's signal limits the call.
 */
const createDeviceDiagnosticsReaderRest = (dependencies: { readSecret: ReadSecret }): DeviceDiagnosticsReader => ({
  protocol: 'rest',
  versions: ['1'],
  readDiagnostics: async ({ registration, port }, { signal }): Promise<ReadDiagnosticsOutput> => {
    const baseUrl = new URL(registration.baseUrl);
    baseUrl.port = String(port);
    // Health is read first and reports a token that is not set, so a call without one only happens if it went away.
    const headers = authHeaders(registration.auth, dependencies.readSecret) ?? {};
    const answer = await getJson({ baseUrl: baseUrl.toString(), path: 'v1/diagnostics', headers, signal });
    if (!answer.ok) {
      return { ok: false, failure: toDiagnosticsFailure(answer.failure) };
    }

    const { httpStatus, headers: answerHeaders, body, document } = answer.value;
    const report = toDiagnosticsReport(document, answerHeaders.get(diagnosticsChecksumHeader) ?? '', body);
    return report === undefined
      ? { ok: false, failure: { protocol: 'rest', reason: 'not_a_device_answer', httpStatus } }
      : { ok: true, value: report };
  },
});

export { createDeviceDiagnosticsReaderRest };
