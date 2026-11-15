// In a file of its own, so that no other test's sockets are open while it counts them.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { diagnosticsProtoPath } from '@device-monitor/contracts/device-api';
import { samples } from '@device-monitor/contracts/device-api/testing';
import * as grpc from '@grpc/grpc-js';
import type { sendUnaryData, ServerUnaryCall, UntypedServiceImplementation } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { lobby } from '../../../../core/domain/testing/devices.ts';
import { createDeviceDiagnosticsReaderGrpc } from '../index.ts';

const sockets = () => process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length;

it('closes its connection after the call, so none is left open per probe', async (t) => {
  // Arrange
  const definition = loadSync(diagnosticsProtoPath)['device.v1.Diagnostics'];
  assert.ok(definition !== undefined && !('format' in definition));
  const implementation: UntypedServiceImplementation = {
    GetDiagnostics: (_call: ServerUnaryCall<unknown, unknown>, callback: sendUnaryData<unknown>) => {
      // grpc-js takes null, not undefined, for no error.
      // oxlint-disable-next-line unicorn/no-null
      callback(null, { diagnostics: Buffer.from(JSON.stringify(samples.diagnostics.valid.complete)), checksum: 'abc' });
    },
  };
  const server = new grpc.Server();
  server.addService(definition, implementation);
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, bound) =>
      error ? reject(error) : resolve(bound),
    );
  });
  t.after(() => server.forceShutdown());
  const reader = createDeviceDiagnosticsReaderGrpc({ readSecret: () => undefined });
  const before = sockets();

  // Act
  const result = await reader.readDiagnostics(
    { registration: { ...lobby, baseUrl: 'http://127.0.0.1:9' }, port },
    { signal: AbortSignal.timeout(5000) },
  );
  await sleep(100);

  // Assert
  assert.ok(result.ok);
  assert.equal(sockets(), before);
});
