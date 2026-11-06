import assert from 'node:assert/strict';
import type { RequestListener } from 'node:http';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { samples } from '@device-monitor/contracts/device-api/testing';
import { door, lobby } from '../../../../core/domain/testing/devices.ts';
import type { HealthReport } from '../../../../core/ports/driven/device-health-reader.ts';
import { testDeviceHealthReaderContract } from '../../../../core/ports/driven/testing/device-health-reader.contract.ts';
import type { FakeDevice } from '../../../../core/ports/driven/testing/device-health-reader.contract.ts';
import { closedBaseUrl, startServer } from '../../../../infrastructure/http/testing/test-server.ts';
import { createDeviceHealthReaderHttp } from '../index.ts';

const answerOf = ({ deviceId, health, capabilities }: HealthReport) => ({
  status: health.state === 'unrecognized' ? health.reported : health.state,
  deviceId,
  ...capabilities,
});

const answering =
  (body: unknown, httpStatus = 200): RequestListener =>
  (request, response) => {
    if (request.url !== '/v1/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(httpStatus, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };

const handlerFor = (device: Exclude<FakeDevice, { behavior: 'absent' | 'fails_tls' }>): RequestListener => {
  if (device.behavior === 'answers') {
    return answering(answerOf(device.report));
  }
  if (device.behavior === 'answers_with_token') {
    return (request, response) =>
      request.headers.authorization === `Bearer ${device.token}`
        ? answering(answerOf(device.report))(request, response)
        : response.writeHead(401).end();
  }
  const handlers: Record<typeof device.behavior, RequestListener> = {
    answers_nonsense: answering({ hello: 'world' }),
    has_no_health: (_request, response) => response.writeHead(404).end(),
    fails: answering({ error: 'internal' }, 500),
    behind_failing_gateway: (_request, response) => response.writeHead(502).end('<html>Bad gateway</html>'),
    never_answers: () => {},
  };
  return handlers[device.behavior];
};

const arrangeDevice = async (t: TestContext, device: FakeDevice, secrets: Record<string, string> = {}) => {
  const reader = createDeviceHealthReaderHttp({ readSecret: (name) => secrets[name] });
  if (device.behavior === 'absent') {
    return { reader, baseUrl: await closedBaseUrl(t) };
  }
  if (device.behavior === 'fails_tls') {
    const baseUrl = await startServer(t, answering({}));
    return { reader, baseUrl: baseUrl.replace('http:', 'https:') };
  }
  return { reader, baseUrl: await startServer(t, handlerFor(device)) };
};

testDeviceHealthReaderContract('http', arrangeDevice);

describe('DeviceHealthReader over HTTP', () => {
  const options = { signal: AbortSignal.timeout(5000) };

  const readFrom = async (t: TestContext, handler: RequestListener) => {
    const baseUrl = await startServer(t, handler);
    const reader = createDeviceHealthReaderHttp({ readSecret: () => undefined });
    return reader.readHealth({ registration: { ...lobby, baseUrl } }, options);
  };

  it('keeps only the fields it knows, so those of newer firmware go no further', async (t) => {
    // Act
    const result = await readFrom(t, answering(samples.health.valid['unknown-fields']));

    // Assert
    assert.deepEqual(result, {
      ok: true,
      value: {
        deviceId: 'usw-pro-24-0042',
        health: { state: 'ok' },
        capabilities: {
          deviceType: 'switch',
          protocols: [{ name: 'rest', version: '1', port: 443 }],
          checksumAlgorithm: 'sha256',
        },
      },
    });
  });

  for (const [name, sample] of Object.entries<unknown>(samples.health.invalid)) {
    it(`reports not_a_device_answer for health/invalid/${name}`, async (t) => {
      // Act
      const result = await readFrom(t, answering(sample));

      // Assert
      assert.deepEqual(result, {
        ok: false,
        failure: { response: 'unexpected', reason: 'not_a_device_answer', httpStatus: 200 },
      });
    });
  }

  it('reports token_missing, calling nothing, for a token set to nothing, as Compose sets one it does not have', async (t) => {
    // Arrange
    let called = false;
    const baseUrl = await startServer(t, (_request, response) => {
      called = true;
      response.end('{}');
    });
    const reader = createDeviceHealthReaderHttp({ readSecret: () => '' });

    // Act
    const result = await reader.readHealth({ registration: { ...door, baseUrl } }, options);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { response: 'misconfigured', reason: 'token_missing' } });
    assert.equal(called, false);
  });

  it('reports auth_failed for 403', async (t) => {
    // Act
    const result = await readFrom(t, (_request, response) => response.writeHead(403).end());

    // Assert
    assert.deepEqual(result, {
      ok: false,
      failure: { response: 'misconfigured', reason: 'auth_failed', httpStatus: 403 },
    });
  });

  it('reports an answer that is not JSON as unexpected, with its status', async (t) => {
    // Act
    const result = await readFrom(t, (_request, response) => response.end('<html>Router login</html>'));

    // Assert
    assert.deepEqual(result, { ok: false, failure: { response: 'unexpected', reason: 'unparsable', httpStatus: 200 } });
  });
});
