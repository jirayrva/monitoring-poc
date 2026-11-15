import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { diagnosticsProtoPath, diagnosticsSchema } from '@device-monitor/contracts/device-api';
import * as grpc from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { Ajv } from 'ajv';
import { defaults } from '../device.ts';
import type { SimulatedDevice } from '../device.ts';
import { createSimulator } from '../simulator.ts';

const isDiagnostics = new Ajv({ strict: true }).compile(diagnosticsSchema);
const definition = loadSync(diagnosticsProtoPath)['device.v1.Diagnostics'];
assert.ok(definition !== undefined && !('format' in definition));
const Diagnostics = grpc.makeGenericClientConstructor(definition, 'device.v1.Diagnostics');

type Reply = { diagnostics: Buffer; checksum: string };
type Outcome = { ok: true; reply: Reply } | { ok: false; code: number };

const device = (settings: Partial<SimulatedDevice> = {}): SimulatedDevice => ({
  ...defaults('sim-1'),
  protocols: ['grpc'],
  ...settings,
});

const start = async (t: TestContext, ...devices: SimulatedDevice[]) => {
  const simulator = createSimulator({ host: '127.0.0.1', devicePort: 0, grpcPort: 0, controlPort: 0, devices });
  const started = await simulator.start();
  t.after(() => simulator[Symbol.asyncDispose]());
  return {
    ...started,
    call: (deviceId: string, token?: string) =>
      new Promise<Outcome>((resolve) => {
        const client = new Diagnostics(`127.0.0.1:${started.grpcPort}`, grpc.credentials.createInsecure());
        const metadata = new grpc.Metadata();
        if (token !== undefined) {
          metadata.set('authorization', `Bearer ${token}`);
        }
        client['GetDiagnostics']?.(
          { deviceId },
          metadata,
          { deadline: Date.now() + 1000 },
          (error: ServiceError | null, reply: Reply) => {
            client.close();
            resolve(error ? { ok: false, code: error.code } : { ok: true, reply });
          },
        );
      }),
  };
};

describe('a simulated device over gRPC', () => {
  it('names the port of each protocol it offers in its health answer, the one it prefers first', async (t) => {
    // Arrange
    const simulator = await start(t, device({ protocols: ['grpc', 'rest'] }));

    // Act
    const response = await fetch(`${simulator.deviceUrl}/devices/sim-1/v1/health`);

    // Assert
    assert.partialDeepStrictEqual(await response.json(), {
      protocols: [
        { name: 'grpc', version: '1', port: simulator.grpcPort },
        { name: 'rest', version: '1', port: Number(new URL(simulator.deviceUrl).port) },
      ],
    });
  });

  it('answers with diagnostics as the device API says, and the checksum of exactly their bytes', async (t) => {
    // Arrange
    const simulator = await start(t, device());

    // Act
    const outcome = await simulator.call('sim-1');

    // Assert
    assert.ok(outcome.ok);
    assert.ok(isDiagnostics(JSON.parse(outcome.reply.diagnostics.toString())));
    assert.equal(outcome.reply.checksum, createHash('sha256').update(outcome.reply.diagnostics).digest('hex'));
  });

  it('sends a checksum that does not match when tampered', async (t) => {
    // Arrange
    const simulator = await start(t, device({ diagnostics: 'tampered' }));

    // Act
    const outcome = await simulator.call('sim-1');

    // Assert
    assert.ok(outcome.ok);
    assert.notEqual(outcome.reply.checksum, createHash('sha256').update(outcome.reply.diagnostics).digest('hex'));
  });

  it('answers NOT_FOUND for a device that does not offer gRPC, or that it does not have', async (t) => {
    // Arrange
    const simulator = await start(t, device({ deviceId: 'rest-only', protocols: ['rest'] }));

    // Act
    const outcomes = [await simulator.call('rest-only'), await simulator.call('sim-1')];

    // Assert
    assert.deepEqual(outcomes, [
      { ok: false, code: grpc.status.NOT_FOUND },
      { ok: false, code: grpc.status.NOT_FOUND },
    ]);
  });

  it('answers UNAUTHENTICATED without its token, and as normal with it', async (t) => {
    // Arrange
    const simulator = await start(t, device({ token: 'secret' }));

    // Act
    const outcomes = [await simulator.call('sim-1'), await simulator.call('sim-1', 'secret')];

    // Assert
    assert.deepEqual(
      outcomes.map((outcome) => (outcome.ok ? 'ok' : outcome.code)),
      [grpc.status.UNAUTHENTICATED, 'ok'],
    );
  });

  for (const [behaviour, code] of [
    ['fails', grpc.status.INTERNAL],
    ['not_found', grpc.status.NOT_FOUND],
    ['gateway_error', grpc.status.UNAVAILABLE],
    ['resets', grpc.status.UNAVAILABLE],
    ['truncates', grpc.status.DATA_LOSS],
    ['hangs', grpc.status.DEADLINE_EXCEEDED],
  ] as const) {
    it(`answers ${grpc.status[code]} when its diagnostics ${behaviour}`, async (t) => {
      // Arrange
      const simulator = await start(t, device({ diagnostics: behaviour }));

      // Act
      const outcome = await simulator.call('sim-1');

      // Assert
      assert.deepEqual(outcome, { ok: false, code });
    });
  }

  it('answers OK with JSON that is no diagnostics when garbage, and with a page when html', async (t) => {
    // Arrange
    const simulator = await start(
      t,
      device({ diagnostics: 'garbage' }),
      device({ deviceId: 'page', diagnostics: 'html' }),
    );

    // Act
    const [garbage, page] = [await simulator.call('sim-1'), await simulator.call('page')];

    // Assert
    assert.ok(garbage.ok && page.ok);
    assert.ok(!isDiagnostics(JSON.parse(garbage.reply.diagnostics.toString())));
    assert.match(page.reply.diagnostics.toString(), /^<!doctype html>/);
  });

  it('drops its next calls, then answers', async (t) => {
    // Arrange
    const simulator = await start(t, device({ dropNext: 1 }));

    // Act
    const outcomes = [await simulator.call('sim-1'), await simulator.call('sim-1')];

    // Assert
    assert.deepEqual(
      outcomes.map((outcome) => (outcome.ok ? 'ok' : outcome.code)),
      [grpc.status.UNAVAILABLE, 'ok'],
    );
  });

  it('waits before answering', async (t) => {
    // Arrange
    const simulator = await start(t, device({ delayMs: 150 }));

    // Act
    const startedAt = performance.now();
    const outcome = await simulator.call('sim-1');

    // Assert
    assert.ok(outcome.ok);
    assert.ok(performance.now() - startedAt >= 140);
  });
});
