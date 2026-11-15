import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { diagnosticsChecksumHeader, diagnosticsSchema, healthSchema } from '@device-monitor/contracts/device-api';
import { Ajv } from 'ajv';
import { defaults } from '../device.ts';
import type { SimulatedDevice } from '../device.ts';
import { createSimulator } from '../simulator.ts';

const ajv = new Ajv({ strict: true });
const isHealth = ajv.compile(healthSchema);
const isDiagnostics = ajv.compile(diagnosticsSchema);

const start = async (t: TestContext, ...devices: SimulatedDevice[]) => {
  const simulator = createSimulator({ host: '127.0.0.1', devicePort: 0, grpcPort: 0, controlPort: 0, devices });
  const { deviceUrl, controlUrl } = await simulator.start();
  t.after(() => simulator[Symbol.asyncDispose]());
  return {
    deviceUrl,
    call: (deviceId: string, call: 'health' | 'diagnostics', init: RequestInit = {}) =>
      fetch(`${deviceUrl}/devices/${deviceId}/v1/${call}`, init),
    control: (method: string, path: string, body?: unknown) =>
      fetch(`${controlUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: typeof body === 'string' ? body : JSON.stringify(body),
            }),
      }),
  };
};

const device = (settings: Partial<SimulatedDevice> = {}): SimulatedDevice => ({ ...defaults('sim-1'), ...settings });

describe('a simulated device', () => {
  it('answers health as the device API says, naming the port it answers on for rest', async (t) => {
    // Arrange
    const simulator = await start(t, device());

    // Act
    const response = await simulator.call('sim-1', 'health');

    // Assert
    const health: unknown = await response.json();
    assert.equal(response.status, 200);
    assert.ok(isHealth(health), JSON.stringify(isHealth.errors));
    assert.deepEqual(health, {
      status: 'ok',
      deviceId: 'sim-1',
      deviceType: 'switch',
      protocols: [{ name: 'rest', version: '1', port: Number(new URL(simulator.deviceUrl).port) }],
      checksumAlgorithm: 'sha256',
    });
  });

  it('answers diagnostics as the device API says, with the checksum of exactly their bytes', async (t) => {
    // Arrange
    const simulator = await start(t, device());

    // Act
    const response = await simulator.call('sim-1', 'diagnostics');

    // Assert
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.ok(isDiagnostics(JSON.parse(body.toString())), JSON.stringify(isDiagnostics.errors));
    assert.equal(response.headers.get(diagnosticsChecksumHeader), createHash('sha256').update(body).digest('hex'));
  });

  it('sends a checksum that does not match its diagnostics when tampered', async (t) => {
    // Arrange
    const simulator = await start(t, device({ diagnostics: 'tampered' }));

    // Act
    const response = await simulator.call('sim-1', 'diagnostics');

    // Assert
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.get(diagnosticsChecksumHeader), createHash('sha256').update(body).digest('hex'));
  });

  it('answers health as another device when an impostor', async (t) => {
    // Arrange
    const simulator = await start(t, device({ health: 'impostor' }));

    // Act
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.partialDeepStrictEqual(await response.json(), { deviceId: 'sim-1-impostor' });
  });

  it('says any status it is given, such as one the monitor does not know', async (t) => {
    // Arrange
    const simulator = await start(t, device({ status: 'maintenance' }));

    // Act
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.partialDeepStrictEqual(await response.json(), { status: 'maintenance' });
  });

  it('answers 401 without its token, and as normal with it', async (t) => {
    // Arrange
    const simulator = await start(t, device({ token: 'secret' }));

    // Act
    const without = await simulator.call('sim-1', 'health');
    const wrong = await simulator.call('sim-1', 'health', { headers: { authorization: 'Bearer other' } });
    const right = await simulator.call('sim-1', 'diagnostics', { headers: { authorization: 'Bearer secret' } });

    // Assert
    assert.deepEqual([without.status, wrong.status, right.status], [401, 401, 200]);
  });

  for (const [behaviour, status, contentType] of [
    ['garbage', 200, 'application/json'],
    ['html', 200, 'text/html'],
    ['fails', 500, 'application/json'],
    ['not_found', 404, 'application/json'],
    ['gateway_error', 502, 'application/json'],
  ] as const) {
    it(`answers ${status} ${contentType} that is no device answer when ${behaviour}, on either call`, async (t) => {
      // Arrange
      const simulator = await start(t, device({ health: behaviour, diagnostics: behaviour }));

      for (const call of ['health', 'diagnostics'] as const) {
        // Act
        const response = await simulator.call('sim-1', call);

        // Assert
        const text = await response.text();
        assert.equal(response.status, status);
        assert.equal(response.headers.get('content-type'), contentType);
        assert.ok(!(call === 'health' ? isHealth : isDiagnostics)(text.startsWith('{') ? JSON.parse(text) : text));
      }
    });
  }

  it('never answers when it hangs', { timeout: 5000 }, async (t) => {
    // Arrange
    const simulator = await start(t, device({ health: 'hangs' }));

    // Act
    const response = simulator.call('sim-1', 'health', { signal: AbortSignal.timeout(200) });

    // Assert
    await assert.rejects(response, { name: 'TimeoutError' });
  });

  it('drops the connection when it resets', async (t) => {
    // Arrange
    const simulator = await start(t, device({ diagnostics: 'resets' }));

    // Act
    const response = simulator.call('sim-1', 'diagnostics');

    // Assert
    await assert.rejects(response, { name: 'TypeError', message: 'fetch failed' });
  });

  it('stops partway through a framed answer when it truncates', async (t) => {
    // Arrange
    const simulator = await start(t, device({ health: 'truncates' }));

    // Act
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.equal(response.status, 200);
    await assert.rejects(response.text(), { name: 'TypeError', message: 'terminated' });
  });

  it('waits before every answer', async (t) => {
    // Arrange
    const simulator = await start(t, device({ delayMs: 150 }));

    // Act
    const startedAt = performance.now();
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.equal(response.status, 200);
    assert.ok(performance.now() - startedAt >= 140);
  });

  it('drops its next calls, then answers', async (t) => {
    // Arrange
    const simulator = await start(t, device({ dropNext: 2 }));

    // Act
    const first = simulator.call('sim-1', 'health');
    await assert.rejects(first);
    const second = simulator.call('sim-1', 'health');
    await assert.rejects(second);
    const third = await simulator.call('sim-1', 'health');

    // Assert
    assert.equal(third.status, 200);
  });

  it('is not found when the simulator has no such device', async (t) => {
    // Arrange
    const simulator = await start(t);

    // Act
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.equal(response.status, 404);
  });
});

describe('the control API', () => {
  it('adds a device from the defaults, changes some of its settings, lists it and removes it', async (t) => {
    // Arrange
    const simulator = await start(t);

    // Act
    const added = await simulator.control('PUT', '/devices/sim-1', { deviceType: 'camera', token: 'secret' });
    const changed = await simulator.control('PATCH', '/devices/sim-1', { health: 'hangs' });
    const listed = await simulator.control('GET', '/devices');
    const removed = await simulator.control('DELETE', '/devices/sim-1');
    const gone = await simulator.control('GET', '/devices/sim-1');

    // Assert
    assert.equal(added.status, 200);
    assert.deepEqual(await changed.json(), {
      ...defaults('sim-1'),
      deviceType: 'camera',
      token: 'secret',
      health: 'hangs',
    });
    assert.deepEqual(await listed.json(), {
      data: [{ ...defaults('sim-1'), deviceType: 'camera', token: 'secret', health: 'hangs' }],
    });
    assert.equal(removed.status, 204);
    assert.equal(gone.status, 404);
  });

  it('replaces a device from the defaults on PUT, so a setting left out goes back to its default', async (t) => {
    // Arrange
    const simulator = await start(t, device({ token: 'secret', health: 'hangs' }));

    // Act
    const response = await simulator.control('PUT', '/devices/sim-1', { status: 'degraded' });

    // Assert
    const { token: _, ...withoutToken } = defaults('sim-1');
    assert.deepEqual(await response.json(), { ...withoutToken, status: 'degraded' });
  });

  it('changes how a device answers at once', async (t) => {
    // Arrange
    const simulator = await start(t, device());

    // Act
    await simulator.control('PATCH', '/devices/sim-1', { health: 'fails' });
    const response = await simulator.call('sim-1', 'health');

    // Assert
    assert.equal(response.status, 500);
  });

  it('keeps the device ID of the path, whatever the body says', async (t) => {
    // Arrange
    const simulator = await start(t);

    // Act
    const response = await simulator.control('PUT', '/devices/sim-1', { deviceId: 'other' });

    // Assert
    assert.partialDeepStrictEqual(await response.json(), { deviceId: 'sim-1' });
  });

  it('answers 404 to PATCH for a device it does not have', async (t) => {
    // Arrange
    const simulator = await start(t);

    // Act
    const response = await simulator.control('PATCH', '/devices/sim-1', { health: 'fails' });

    // Assert
    assert.equal(response.status, 404);
  });

  for (const body of ['[]', '"text"', 'not json']) {
    it(`answers 400 to settings that are not a JSON object: ${body}`, async (t) => {
      // Arrange
      const simulator = await start(t, device());

      // Act
      const response = await simulator.control('PATCH', '/devices/sim-1', body);

      // Assert
      assert.equal(response.status, 400);
    });
  }
});
