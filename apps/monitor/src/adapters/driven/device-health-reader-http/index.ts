import { healthSchema } from '@device-monitor/contracts/device-api';
import { Ajv } from 'ajv';
import type { DeviceHealth, DeviceProtocol } from '../../../core/domain/device-report.ts';
import type {
  DeviceHealthReader,
  HealthCallFailure,
  ReadHealthOutput,
} from '../../../core/ports/driven/device-health-reader.ts';
import { authHeaders } from '../../../infrastructure/http/auth-headers.ts';
import type { ReadSecret } from '../../../infrastructure/http/auth-headers.ts';
import { getJson } from '../../../infrastructure/http/get-json.ts';
import type { GetJsonFailure } from '../../../infrastructure/http/get-json.ts';

type DeviceHealthReaderHttpDependencies = { readSecret: ReadSecret };

type HealthAnswer = {
  status: string;
  deviceId: string;
  deviceType: string;
  protocols: DeviceProtocol[];
  checksumAlgorithm: string;
};

const isHealthAnswer = new Ajv({ strict: true }).compile<HealthAnswer>(healthSchema);

type KnownHealth = Exclude<DeviceHealth['state'], 'unrecognized'>;

const knownHealth: readonly string[] = ['ok', 'degraded', 'starting', 'updating'] satisfies KnownHealth[];

const isKnownHealth = (status: string): status is KnownHealth => knownHealth.includes(status);

/** A word the monitor does not know is kept as the device said it (D-29). */
const toHealth = (status: string): DeviceHealth =>
  isKnownHealth(status) ? { state: status } : { state: 'unrecognized', reported: status };

/** Which failure of a health call an HTTP failure is: 401, 403 and 404 show the registration is wrong (Q-17). */
const toHealthCallFailure = (failure: GetJsonFailure): HealthCallFailure => {
  if (failure.reason === 'tls_failed') {
    return { response: 'misconfigured', reason: 'tls_failed' };
  }
  if (!('httpStatus' in failure)) {
    return { response: 'none', reason: failure.reason };
  }

  const { reason, httpStatus } = failure;
  if (reason === 'gateway_error') {
    return { response: 'none', reason, httpStatus };
  }
  if (reason !== 'http_error') {
    return { response: 'unexpected', reason, httpStatus };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { response: 'misconfigured', reason: 'auth_failed', httpStatus };
  }
  if (httpStatus === 404) {
    return { response: 'misconfigured', reason: 'not_found', httpStatus };
  }
  return { response: 'unexpected', reason, httpStatus };
};

/**
 * Reads health with GET <baseUrl>/v1/health, which every device answers over HTTP (Q-03). Keeps only what the port
 * knows, so fields from newer firmware go no further. A device whose token is not set is not called. The caller's
 * signal limits the call.
 */
const createDeviceHealthReaderHttp = (dependencies: DeviceHealthReaderHttpDependencies): DeviceHealthReader => ({
  readHealth: async ({ registration }, { signal }): Promise<ReadHealthOutput> => {
    const headers = authHeaders(registration.auth, dependencies.readSecret);
    if (headers === undefined) {
      return { ok: false, failure: { response: 'misconfigured', reason: 'token_missing' } };
    }

    const answer = await getJson({ baseUrl: registration.baseUrl, path: 'v1/health', headers, signal });
    if (!answer.ok) {
      return { ok: false, failure: toHealthCallFailure(answer.failure) };
    }

    const { httpStatus, document } = answer.value;
    if (!isHealthAnswer(document)) {
      return { ok: false, failure: { response: 'unexpected', reason: 'not_a_device_answer', httpStatus } };
    }

    const { status, deviceId, deviceType, protocols, checksumAlgorithm } = document;
    return {
      ok: true,
      value: {
        deviceId,
        health: toHealth(status),
        capabilities: {
          deviceType,
          protocols: protocols.map(({ name, version, port }) => ({ name, version, port })),
          checksumAlgorithm,
        },
      },
    };
  },
});

export { createDeviceHealthReaderHttp };
export type { DeviceHealthReaderHttpDependencies };
