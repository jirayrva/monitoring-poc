import { setTimeout as sleep } from 'node:timers/promises';
import { diagnosticsProtoPath } from '@device-monitor/contracts/device-api';
import * as grpc from '@grpc/grpc-js';
import type { sendUnaryData, ServerUnaryCall, UntypedServiceImplementation } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { diagnosticsOf } from './device.ts';
import type { SimulatedDevice } from './device.ts';

type Call = ServerUnaryCall<{ deviceId: string }, unknown>;
type Reply = { diagnostics: Buffer; checksum: string };

const serviceName = 'device.v1.Diagnostics';
const definition = loadSync(diagnosticsProtoPath)[serviceName];
if (definition === undefined || 'format' in definition) {
  throw new Error(`${diagnosticsProtoPath} has no service ${serviceName}`);
}

const statuses: Partial<Record<SimulatedDevice['diagnostics'], grpc.status>> = {
  fails: grpc.status.INTERNAL,
  not_found: grpc.status.NOT_FOUND,
  gateway_error: grpc.status.UNAVAILABLE,
  resets: grpc.status.UNAVAILABLE,
  truncates: grpc.status.DATA_LOSS,
};

const replyOf = (device: SimulatedDevice): Reply => {
  const { body, checksum } = diagnosticsOf(device);
  const carried: Partial<Record<SimulatedDevice['diagnostics'], string>> = {
    garbage: '{"unexpected":true}',
    html: '<!doctype html><title>Sign in</title><p>Sign in to use this network.</p>',
  };
  return { diagnostics: Buffer.from(carried[device.diagnostics] ?? body), checksum };
};

/**
 * Serves the simulated devices' diagnostics over gRPC, as device.v1.Diagnostics. One port serves every device, as each
 * request names its device. A device answers only when it offers gRPC, and as its diagnostics behaviour says.
 */
const createGrpcServer = (devices: Map<string, SimulatedDevice>) => {
  const server = new grpc.Server();

  const answer = async (call: Call, callback: sendUnaryData<Reply>) => {
    const device = devices.get(call.request.deviceId);
    if (device === undefined || !device.protocols.includes('grpc')) {
      return callback({ code: grpc.status.NOT_FOUND, details: `No device ${call.request.deviceId} offers gRPC here` });
    }
    if (device.dropNext > 0) {
      devices.set(device.deviceId, { ...device, dropNext: device.dropNext - 1 });
      return callback({ code: grpc.status.UNAVAILABLE, details: 'Dropped' });
    }
    if (device.token !== undefined && call.metadata.get('authorization')[0] !== `Bearer ${device.token}`) {
      return callback({ code: grpc.status.UNAUTHENTICATED, details: 'Unauthorized' });
    }

    await sleep(device.delayMs);
    if (device.diagnostics === 'hangs') {
      return undefined;
    }
    const code = statuses[device.diagnostics];
    // grpc-js takes null, not undefined, for no error.
    // oxlint-disable-next-line unicorn/no-null
    return code === undefined ? callback(null, replyOf(device)) : callback({ code, details: device.diagnostics });
  };

  const implementation: UntypedServiceImplementation = {
    GetDiagnostics: (call: Call, callback: sendUnaryData<Reply>) => void answer(call, callback),
  };
  server.addService(definition, implementation);

  return {
    listen: (host: string, port: number) =>
      new Promise<number>((resolve, reject) => {
        server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (error, bound) =>
          error ? reject(error) : resolve(bound),
        );
      }),
    /** Stops at once, as a device that hangs would hold a graceful stop open. */
    close: () => server.forceShutdown(),
  };
};

export { createGrpcServer };
