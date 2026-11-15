import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { json } from 'node:stream/consumers';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { registerDevices } from '../register.ts';

const startMonitor = async (t: TestContext, statusOf: Record<string, number>) => {
  const received: unknown[] = [];
  const server = createServer((request, response) => {
    void json(request).then((body) => {
      received.push({ method: request.method, url: request.url, body });
      const deviceId = body instanceof Object && 'deviceId' in body ? String(body.deviceId) : '';
      response.writeHead(statusOf[deviceId] ?? 201, { 'content-type': 'application/json' }).end('{"code":"x"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  return { monitorUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, received };
};

const entry = (deviceId: string, secretRef?: string) => ({
  deviceId,
  name: `Name of ${deviceId}`,
  secretRef,
  simulated: {},
});

describe('registerDevices', () => {
  it('registers each device at its simulated URL, with bearer auth when it names a secret', async (t) => {
    // Arrange
    const { monitorUrl, received } = await startMonitor(t, {});

    // Act
    const outcomes = await registerDevices({
      monitorUrl,
      deviceBaseUrl: 'http://simulator:4100/devices',
      entries: [entry('lobby'), entry('door', 'DEVICE_DOOR_TOKEN')],
    });

    // Assert
    assert.deepEqual(outcomes, [
      { deviceId: 'lobby', outcome: 'registered' },
      { deviceId: 'door', outcome: 'registered' },
    ]);
    assert.deepEqual(received, [
      {
        method: 'POST',
        url: '/v1/devices',
        body: {
          deviceId: 'lobby',
          name: 'Name of lobby',
          baseUrl: 'http://simulator:4100/devices/lobby',
          auth: { strategy: 'none' },
        },
      },
      {
        method: 'POST',
        url: '/v1/devices',
        body: {
          deviceId: 'door',
          name: 'Name of door',
          baseUrl: 'http://simulator:4100/devices/door',
          auth: { strategy: 'bearer', secretRef: 'DEVICE_DOOR_TOKEN' },
        },
      },
    ]);
  });

  it('leaves a device already registered as it is, and goes on after one that fails', async (t) => {
    // Arrange
    const { monitorUrl } = await startMonitor(t, { lobby: 409, door: 503 });

    // Act
    const outcomes = await registerDevices({
      monitorUrl,
      deviceBaseUrl: 'http://simulator:4100/devices',
      entries: [entry('lobby'), entry('door'), entry('gate')],
    });

    // Assert
    assert.deepEqual(outcomes, [
      { deviceId: 'lobby', outcome: 'already_registered' },
      { deviceId: 'door', outcome: 'failed', detail: '503 {"code":"x"}' },
      { deviceId: 'gate', outcome: 'registered' },
    ]);
  });

  it('reports every device as failed when the monitor does not answer', async () => {
    // Act
    const outcomes = await registerDevices({
      monitorUrl: 'http://127.0.0.1:1',
      deviceBaseUrl: 'http://simulator:4100/devices',
      entries: [entry('lobby')],
    });

    // Assert
    assert.partialDeepStrictEqual(outcomes, [{ deviceId: 'lobby', outcome: 'failed' }]);
  });
});
