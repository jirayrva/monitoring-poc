import assert from 'node:assert/strict';
import type { RequestListener } from 'node:http';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { samples } from '@device-monitor/contracts/device-api/testing';
import { lobby } from '../../../../core/domain/testing/devices.ts';
import { testDeviceDiagnosticsReaderContract } from '../../../../core/ports/driven/testing/device-diagnostics-reader.contract.ts';
import type { FakeDevice, Reported } from '../../../../core/ports/driven/testing/device-diagnostics-reader.contract.ts';
import { closedBaseUrl, startServer } from '../../../../infrastructure/http/testing/test-server.ts';
import { createDeviceDiagnosticsReaderRest } from '../index.ts';

const checksum = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const answering =
  (body: string, headers: Record<string, string> = { 'diagnostics-checksum': checksum }): RequestListener =>
  (request, response) => {
    if (!request.url?.endsWith('/v1/diagnostics')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', ...headers }).end(body);
  };

const answeringReported = ({
  hardware,
  softwareVersion,
  firmwareVersion,
  reportedStatus,
  reportedChecksum,
}: Reported) =>
  answering(JSON.stringify({ hardware, softwareVersion, firmwareVersion, status: reportedStatus }), {
    'diagnostics-checksum': reportedChecksum,
  });

const handlerFor = (device: Exclude<FakeDevice, { behavior: 'absent' | 'fails_tls' }>): RequestListener => {
  if (device.behavior === 'answers') {
    return answeringReported(device.reported);
  }
  if (device.behavior === 'answers_with_token') {
    return (request, response) =>
      request.headers.authorization === `Bearer ${device.token}`
        ? answeringReported(device.reported)(request, response)
        : response.writeHead(401).end();
  }
  const handlers: Record<typeof device.behavior, RequestListener> = {
    answers_nonsense: answering('{"hello":"world"}'),
    fails: (_request, response) => response.writeHead(500).end('{}'),
    behind_failing_gateway: (_request, response) => response.writeHead(503).end('<html>Unavailable</html>'),
    never_answers: () => {},
  };
  return handlers[device.behavior];
};

const portOf = (url: string) => Number(new URL(url).port);

/** The base URL has another port, so only the port the device names reaches its diagnostics. */
const arrangeDevice = async (t: TestContext, device: FakeDevice, secrets: Record<string, string> = {}) => {
  const reader = createDeviceDiagnosticsReaderRest({ readSecret: (name) => secrets[name] });
  if (device.behavior === 'absent') {
    return { reader, baseUrl: 'http://127.0.0.1:9', port: portOf(await closedBaseUrl(t)) };
  }
  if (device.behavior === 'fails_tls') {
    return { reader, baseUrl: 'https://127.0.0.1:9', port: portOf(await startServer(t, answering('{}'))) };
  }
  return { reader, baseUrl: 'http://127.0.0.1:9', port: portOf(await startServer(t, handlerFor(device))) };
};

testDeviceDiagnosticsReaderContract('rest', arrangeDevice, {
  fails: 'http_error',
  behindFailingGateway: 'gateway_error',
});

describe('DeviceDiagnosticsReader over REST', () => {
  const options = { signal: AbortSignal.timeout(5000) };

  const readFrom = async (t: TestContext, handler: RequestListener, baseUrl = 'http://127.0.0.1:9') => {
    const port = portOf(await startServer(t, handler));
    const reader = createDeviceDiagnosticsReaderRest({ readSecret: () => undefined });
    return reader.readDiagnostics({ registration: { ...lobby, baseUrl }, port }, options);
  };

  it('returns exactly the bytes the device sent as the payload, and only the fields it knows', async (t) => {
    // Arrange
    const sent = `${JSON.stringify(samples.diagnostics.valid['unknown-fields'], undefined, 4)}\n`;

    // Act
    const result = await readFrom(t, answering(sent));

    // Assert
    assert.deepEqual(result, {
      ok: true,
      value: {
        hardware: { model: 'USW-Pro-24', revision: 'r3', serial: 'F4E2C6A1B9D0' },
        softwareVersion: '7.1.4',
        firmwareVersion: '7.1.4',
        reportedStatus: 'fan 2 slow',
        reportedChecksum: checksum,
        payload: new TextEncoder().encode(sent),
      },
    });
  });

  it("keeps the base URL's path, on the port the device names", async (t) => {
    // Arrange
    let path = '';
    const handler: RequestListener = (request, response) => {
      path = request.url ?? '';
      answering(JSON.stringify(samples.diagnostics.valid.complete))(request, response);
    };

    // Act
    const result = await readFrom(t, handler, 'http://127.0.0.1:9/devices/lobby');

    // Assert
    assert.ok(result.ok);
    assert.equal(path, '/devices/lobby/v1/diagnostics');
  });

  it('reports not_a_device_answer for diagnostics with no checksum header', async (t) => {
    // Act
    const result = await readFrom(t, answering(JSON.stringify(samples.diagnostics.valid.complete), {}));

    // Assert
    assert.deepEqual(result, {
      ok: false,
      failure: { protocol: 'rest', reason: 'not_a_device_answer', httpStatus: 200 },
    });
  });

  for (const [name, sample] of Object.entries<unknown>(samples.diagnostics.invalid)) {
    it(`reports not_a_device_answer for diagnostics/invalid/${name}`, async (t) => {
      // Act
      const result = await readFrom(t, answering(JSON.stringify(sample)));

      // Assert
      assert.deepEqual(result, {
        ok: false,
        failure: { protocol: 'rest', reason: 'not_a_device_answer', httpStatus: 200 },
      });
    });
  }

  const statuses: [number, string][] = [
    [403, 'auth_failed'],
    [404, 'http_error'],
  ];
  for (const [httpStatus, reason] of statuses) {
    it(`reports ${httpStatus} as ${reason}`, async (t) => {
      // Act
      const result = await readFrom(t, (_request, response) => response.writeHead(httpStatus).end());

      // Assert
      assert.deepEqual(result, { ok: false, failure: { protocol: 'rest', reason, httpStatus } });
    });
  }
});
