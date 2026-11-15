import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { diagnosticsProtoPath } from '@device-monitor/contracts/device-api';
import { samples } from '@device-monitor/contracts/device-api/testing';
import * as grpc from '@grpc/grpc-js';
import type { sendUnaryData, ServerUnaryCall, UntypedServiceImplementation } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { lobby } from '../../../../core/domain/testing/devices.ts';
import { testDeviceDiagnosticsReaderContract } from '../../../../core/ports/driven/testing/device-diagnostics-reader.contract.ts';
import type { FakeDevice, Reported } from '../../../../core/ports/driven/testing/device-diagnostics-reader.contract.ts';
import { closedBaseUrl } from '../../../../infrastructure/http/testing/test-server.ts';
import { createDeviceDiagnosticsReaderGrpc } from '../index.ts';

type Request = { deviceId: string };
type Reply = { diagnostics: Buffer; checksum: string };
type Handler = (call: ServerUnaryCall<Request, Reply>, callback: sendUnaryData<Reply>) => void;

const definition = loadSync(diagnosticsProtoPath)['device.v1.Diagnostics'];
assert.ok(definition !== undefined && !('format' in definition));

const startGrpcServer = async (t: TestContext, handler: Handler) => {
  const server = new grpc.Server();
  const implementation: UntypedServiceImplementation = { GetDiagnostics: handler };
  server.addService(definition, implementation);
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) =>
      error ? reject(error) : resolve(bound),
    );
  });
  t.after(() => server.forceShutdown());
  return { port };
};

const replying =
  (diagnostics: string, checksum = '9f86d081'): Handler =>
  (_call, callback) => {
    // grpc-js takes null, not undefined, for no error.
    // oxlint-disable-next-line unicorn/no-null
    callback(null, { diagnostics: Buffer.from(diagnostics), checksum });
  };

const replyingReported = ({ hardware, softwareVersion, firmwareVersion, reportedStatus, reportedChecksum }: Reported) =>
  replying(JSON.stringify({ hardware, softwareVersion, firmwareVersion, status: reportedStatus }), reportedChecksum);

const handlerFor = (
  device: Exclude<FakeDevice, { behavior: 'absent' | 'fails_tls' | 'behind_failing_gateway' }>,
): Handler => {
  if (device.behavior === 'answers') {
    return replyingReported(device.reported);
  }
  if (device.behavior === 'answers_with_token') {
    return (call, callback) =>
      call.metadata.get('authorization')[0] === `Bearer ${device.token}`
        ? replyingReported(device.reported)(call, callback)
        : callback({ code: grpc.status.UNAUTHENTICATED, details: 'no' });
  }
  const handlers: Record<typeof device.behavior, Handler> = {
    answers_nonsense: replying('{"hello":"world"}'),
    fails: (_call, callback) => callback({ code: grpc.status.INTERNAL, details: 'boom' }),
    never_answers: () => {},
  };
  return handlers[device.behavior];
};

/** An HTTP/2 server that answers 503 as a gateway whose device is gone does. */
const startGateway = async (t: TestContext) => {
  const server = http2.createServer((_request, response) => response.writeHead(503).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  return typeof address === 'string' || !address ? 0 : address.port;
};

const arrangeDevice = async (t: TestContext, device: FakeDevice, secrets: Record<string, string> = {}) => {
  const reader = createDeviceDiagnosticsReaderGrpc({ readSecret: (name) => secrets[name] });
  switch (device.behavior) {
    case 'absent':
      return { reader, baseUrl: 'http://127.0.0.1:9', port: Number(new URL(await closedBaseUrl(t)).port) };
    case 'fails_tls':
      // A name rather than an IP address: grpc-js refuses TLS to an IP address before any handshake.
      return { reader, baseUrl: 'https://localhost:9', port: (await startGrpcServer(t, replying('{}'))).port };
    case 'behind_failing_gateway':
      return { reader, baseUrl: 'http://127.0.0.1:9', port: await startGateway(t) };
    default:
      return { reader, baseUrl: 'http://127.0.0.1:9', port: (await startGrpcServer(t, handlerFor(device))).port };
  }
};

testDeviceDiagnosticsReaderContract('grpc', arrangeDevice, {
  fails: 'error_status',
  behindFailingGateway: 'unreachable',
});

describe('DeviceDiagnosticsReader over gRPC', () => {
  const options = { signal: AbortSignal.timeout(5000) };

  const readFrom = async (t: TestContext, handler: Handler, baseUrl = 'http://127.0.0.1:9/devices/lobby') => {
    const { port } = await startGrpcServer(t, handler);
    const reader = createDeviceDiagnosticsReaderGrpc({ readSecret: () => undefined });
    return reader.readDiagnostics({ registration: { ...lobby, baseUrl }, port }, options);
  };

  it('returns exactly the bytes the device sent as the payload, and only the fields it knows', async (t) => {
    // Arrange
    const sent = `${JSON.stringify(samples.diagnostics.valid['unknown-fields'], undefined, 4)}\n`;

    // Act
    const result = await readFrom(t, replying(sent, 'abc123'));

    // Assert
    assert.deepEqual(result, {
      ok: true,
      value: {
        hardware: { model: 'USW-Pro-24', revision: 'r3', serial: 'F4E2C6A1B9D0' },
        softwareVersion: '7.1.4',
        firmwareVersion: '7.1.4',
        reportedStatus: 'fan 2 slow',
        reportedChecksum: 'abc123',
        payload: new TextEncoder().encode(sent),
      },
    });
  });

  it("asks for the registered device, on the base URL's host, whatever its path", async (t) => {
    // Arrange
    let asked = '';
    const handler: Handler = (call, callback) => {
      asked = call.request.deviceId;
      replying(JSON.stringify(samples.diagnostics.valid.complete))(call, callback);
    };

    // Act
    const result = await readFrom(t, handler);

    // Assert
    assert.ok(result.ok);
    assert.equal(asked, lobby.deviceId);
  });

  for (const [name, handler, failure] of [
    ['unparsable for diagnostics that are not JSON', replying('<html>'), { reason: 'unparsable', grpcStatus: 0 }],
    [
      'not_a_device_answer for diagnostics with no checksum',
      replying(JSON.stringify(samples.diagnostics.valid.complete), ''),
      { reason: 'not_a_device_answer', grpcStatus: 0 },
    ],
    [
      'too_large for an answer over 1 MiB, without reading it',
      replying(' '.repeat(2 * 1024 * 1024)),
      { reason: 'too_large', grpcStatus: grpc.status.RESOURCE_EXHAUSTED },
    ],
    [
      'auth_failed when the device denies the call',
      ((_call, callback) => callback({ code: grpc.status.PERMISSION_DENIED, details: 'no' })) satisfies Handler,
      { reason: 'auth_failed', grpcStatus: grpc.status.PERMISSION_DENIED },
    ],
  ] as const) {
    it(`reports ${name}`, async (t) => {
      // Act
      const result = await readFrom(t, handler);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { protocol: 'grpc', ...failure } });
    });
  }
});
