import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { json } from 'node:stream/consumers';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { defaults } from '../device.ts';
import { addFleet, fleetOf, maxFleetSize, removeFleet } from '../fleet.ts';
import { createSimulator } from '../simulator.ts';

const startMonitor = async (t: TestContext, deviceIds: string[] = []) => {
  const devices = new Map(deviceIds.map((deviceId) => [deviceId, { deviceId }]));
  const server = createServer((request, response) => {
    const send = (status: number, body?: unknown) =>
      response
        .writeHead(status, { 'content-type': 'application/json' })
        .end(body === undefined ? '' : JSON.stringify(body));
    const deviceId = /^\/v1\/devices\/(.+)$/.exec(request.url ?? '')?.[1];
    if (request.method === 'GET') {
      return send(200, { data: [...devices.values()] });
    }
    if (request.method === 'DELETE') {
      return send(deviceId !== undefined && devices.delete(deviceId) ? 204 : 404);
    }
    return void json(request).then((body) => {
      const id = body instanceof Object && 'deviceId' in body ? String(body.deviceId) : '';
      if (devices.has(id)) {
        return send(409, { code: 'device_exists' });
      }
      devices.set(id, { deviceId: id });
      return send(201);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  return { url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, devices };
};

const startSimulator = async (t: TestContext, deviceIds: string[] = []) => {
  const simulator = createSimulator({
    host: '127.0.0.1',
    devicePort: 0,
    controlPort: 0,
    devices: deviceIds.map((deviceId) => defaults(deviceId)),
  });
  const { controlUrl } = await simulator.start();
  t.after(() => simulator[Symbol.asyncDispose]());
  const listed = async () => {
    const { data }: { data: { deviceId: string }[] } = JSON.parse(await (await fetch(`${controlUrl}/devices`)).text());
    return data.map(({ deviceId }) => deviceId).toSorted();
  };
  return { url: controlUrl, listed };
};

const deviceBaseUrl = 'http://simulator:4100/devices';

describe('fleetOf', () => {
  it('numbers the devices from 1, under the fleet prefix, the same in a fleet of any size', () => {
    // Act
    const fleet = fleetOf(12);

    // Assert
    assert.deepEqual(
      fleet.slice(0, 2).map(({ deviceId }) => deviceId),
      ['fleet-00001', 'fleet-00002'],
    );
    assert.equal(new Set(fleet.map(({ deviceId }) => deviceId)).size, 12);
    assert.deepEqual(fleetOf(1001).slice(0, 12), fleet);
  });

  it('is the same every time, mostly working, with a few devices that misbehave', () => {
    // Act
    const fleet = fleetOf(1001);

    // Assert
    assert.deepEqual(fleet, fleetOf(1001));
    const misbehaving = fleet.filter(({ simulated }) => Object.keys(simulated).length > 1);
    assert.ok(misbehaving.length > 0 && misbehaving.length < fleet.length / 10, String(misbehaving.length));
    assert.partialDeepStrictEqual(fleet[96]?.simulated, { health: 'hangs' });
  });

  for (const size of [0, maxFleetSize + 1, 1.5, Number.NaN]) {
    it(`refuses a fleet of ${size}`, () => {
      assert.throws(() => fleetOf(size), RangeError);
    });
  }
});

describe('addFleet', () => {
  it('adds each device to the simulator and registers it with the monitor', async (t) => {
    // Arrange
    const simulator = await startSimulator(t, ['demo-lobby']);
    const monitor = await startMonitor(t);

    // Act
    const outcome = await addFleet(3, { simulatorUrl: simulator.url, monitorUrl: monitor.url, deviceBaseUrl });

    // Assert
    assert.deepEqual(outcome, { registered: 3, alreadyRegistered: 0, failed: [] });
    assert.deepEqual(await simulator.listed(), ['demo-lobby', 'fleet-00001', 'fleet-00002', 'fleet-00003']);
    assert.deepEqual([...monitor.devices.keys()].toSorted(), ['fleet-00001', 'fleet-00002', 'fleet-00003']);
  });

  it('brings the fleet back to a simulator that forgot it, leaving the monitor as it is', async (t) => {
    // Arrange
    const simulator = await startSimulator(t);
    const monitor = await startMonitor(t, ['fleet-00001', 'fleet-00002']);

    // Act
    const outcome = await addFleet(2, { simulatorUrl: simulator.url, monitorUrl: monitor.url, deviceBaseUrl });

    // Assert
    assert.deepEqual(outcome, { registered: 0, alreadyRegistered: 2, failed: [] });
    assert.deepEqual(await simulator.listed(), ['fleet-00001', 'fleet-00002']);
  });

  it('adds nothing when the monitor does not answer, rather than add the fleet to the simulator only', async (t) => {
    // Arrange
    const simulator = await startSimulator(t);

    // Act
    const adding = addFleet(2, { simulatorUrl: simulator.url, monitorUrl: 'http://127.0.0.1:1', deviceBaseUrl });

    // Assert
    await assert.rejects(adding);
    assert.deepEqual(await simulator.listed(), []);
  });
});

describe('removeFleet', () => {
  it('removes every fleet device from both, even one in only one of them, and leaves the others', async (t) => {
    // Arrange
    const simulator = await startSimulator(t, ['demo-lobby', 'fleet-1', 'fleet-2']);
    const monitor = await startMonitor(t, ['demo-lobby', 'fleet-1', 'fleet-3']);

    // Act
    const outcome = await removeFleet({ simulatorUrl: simulator.url, monitorUrl: monitor.url, deviceBaseUrl });

    // Assert
    assert.deepEqual(outcome, { removed: 3, failed: [] });
    assert.deepEqual(await simulator.listed(), ['demo-lobby']);
    assert.deepEqual([...monitor.devices.keys()], ['demo-lobby']);
  });
});
