import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startStack } from './stack.ts';
import type { Stack } from './stack.ts';

type StatusJson = {
  deviceId: string;
  state: 'unknown' | 'up' | 'suspect' | 'down' | 'misconfigured';
  lastProbe: { response: string; reason?: string; httpStatus?: number };
  health?: { state: string; reported?: string };
  diagnostics?: {
    state: string;
    checksum?: { comparison: string; generator: { name: string; version: string; standIn: boolean } };
  };
};

const jsonOf = async <Body>(response: Response): Promise<Body> => JSON.parse(await response.text());

/** Reads until the value is accepted, so a test waits as long as the probes need, and no longer. */
const eventually = async <Value>(what: string, read: () => Promise<Value>, accept: (value: Value) => boolean) => {
  const deadline = performance.now() + 20_000;
  let last: Value | undefined;
  while (performance.now() < deadline) {
    last = await read();
    if (accept(last)) {
      return last;
    }
    await sleep(100);
  }
  return assert.fail(`Timed out waiting for ${what}. Last seen: ${JSON.stringify(last)}`);
};

let stack: Stack;
/** Read again after a restart, which may publish a service on another port. */
let monitorUrl: string;
let controlUrl: string;

before(async () => {
  stack = await startStack();
  ({ monitorUrl, controlUrl } = stack);
});

const restart = async (service: 'monitor' | 'simulator') => {
  await stack.restart(service);
  monitorUrl = await stack.urlOf('monitor', 3000);
  controlUrl = await stack.urlOf('simulator', 4101);
};

after(async () => {
  await stack?.[Symbol.asyncDispose]();
});

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const addDevice = async (deviceId: string, simulated: object, auth: object = { strategy: 'none' }) => {
  const played = await fetch(`${controlUrl}/devices/${deviceId}`, json('PUT', simulated));
  assert.equal(played.status, 200, await played.text());
  const registered = await fetch(
    `${monitorUrl}/v1/devices`,
    json('POST', { deviceId, name: `E2E ${deviceId}`, baseUrl: stack.deviceUrl(deviceId), auth }),
  );
  assert.equal(registered.status, 201, await registered.text());
};

const changeDevice = async (deviceId: string, settings: object) => {
  const response = await fetch(`${controlUrl}/devices/${deviceId}`, json('PATCH', settings));
  assert.equal(response.status, 200, await response.text());
};

const statusOf = async (deviceId: string) =>
  (await jsonOf<{ data: StatusJson[] }>(await fetch(`${monitorUrl}/v1/device-statuses`))).data.find(
    (status) => status.deviceId === deviceId,
  );

const waitForStatus = async (deviceId: string, what: string, accept: (status: StatusJson) => boolean) => {
  const status = await eventually(
    `${deviceId} to be ${what}`,
    () => statusOf(deviceId),
    (each) => each !== undefined && accept(each),
  );
  assert.ok(status);
  return status;
};

const waitForState = (deviceId: string, state: StatusJson['state']) =>
  waitForStatus(deviceId, state, (each) => each.state === state);

/** The statuses the database holds for a device, oldest first: only it keeps the history (R-13). */
const historyCount = async (deviceId: string) =>
  Number(await stack.sql(`SELECT count(*) FROM monitor.device_statuses WHERE device_id = '${deviceId}'`));

const statesOf = async (deviceId: string) =>
  (await stack.sql(`SELECT status->>'state' FROM monitor.device_statuses WHERE device_id = '${deviceId}' ORDER BY id`))
    .split('\n')
    .filter((state, index, all) => state !== all[index - 1]);

describe('the monitor, run as docker compose up runs it', () => {
  describe('probes the devices it is given', () => {
    it('reports a working device up, with diagnostics whose checksum, from a binary, matches', async () => {
      // Arrange
      await addDevice('honest', {});

      // Act
      const status = await waitForState('honest', 'up');

      // Assert
      assert.equal(status.diagnostics?.state, 'available');
      assert.deepEqual(status.diagnostics?.checksum?.comparison, 'match');
      assert.deepEqual(status.diagnostics?.checksum?.generator, { name: 'checksum', version: 'e2e', standIn: false });
    });

    it('reports a checksum that does not match, and keeps the device up', async () => {
      // Arrange
      await addDevice('tampered', { diagnostics: 'tampered' });

      // Act
      const status = await waitForStatus('tampered', 'compared', (each) => each.diagnostics?.checksum !== undefined);

      // Assert
      assert.equal(status.state, 'up');
      assert.equal(status.diagnostics?.checksum?.comparison, 'mismatch');
    });

    it('calls a device with bearer auth with the token its secret reference names', async () => {
      // Arrange
      await addDevice('bearer', { token: 'e2e-secret' }, { strategy: 'bearer', secretRef: 'DEVICE_E2E_TOKEN' });

      // Act
      const status = await waitForState('bearer', 'up');

      // Assert
      assert.equal(status.diagnostics?.state, 'available');
    });

    it('calls a device misconfigured when its token is not set, never down, and does not call it', async () => {
      // Arrange
      await addDevice('no-token', { token: 'e2e-secret' }, { strategy: 'bearer', secretRef: 'DEVICE_E2E_MISSING' });

      // Act
      const status = await waitForState('no-token', 'misconfigured');

      // Assert
      assert.partialDeepStrictEqual(status.lastProbe, { response: 'misconfigured', reason: 'token_missing' });
      assert.deepEqual(await statesOf('no-token'), ['misconfigured']);
    });

    it('keeps a device that says something unknown about itself up, with what it said', async () => {
      // Arrange
      await addDevice('maintenance', { status: 'maintenance' });

      // Act
      const status = await waitForState('maintenance', 'up');

      // Assert
      assert.deepEqual(status.health, { state: 'unrecognized', reported: 'maintenance' });
    });

    for (const [behaviour, reason] of [
      ['impostor', 'wrong_device'],
      ['not_found', 'not_found'],
    ] as const) {
      it(`calls a device misconfigured when its health is ${behaviour}: ${reason}`, async () => {
        // Arrange
        const deviceId = `answers-${behaviour.replace('_', '-')}`;
        await addDevice(deviceId, { health: behaviour });

        // Act
        const status = await waitForState(deviceId, 'misconfigured');

        // Assert
        assert.partialDeepStrictEqual(status.lastProbe, { response: 'misconfigured', reason });
      });
    }
  });

  describe('tells a device that stopped answering from a network that dropped a call', () => {
    it('goes suspect, then down, when a device stops answering, and up when it answers again', async () => {
      // Arrange
      await addDevice('flaky', {});
      await waitForState('flaky', 'up');

      // Act
      await changeDevice('flaky', { health: 'hangs' });
      await waitForState('flaky', 'down');
      await changeDevice('flaky', { health: 'normal' });
      await waitForState('flaky', 'up');

      // Assert
      assert.deepEqual(await statesOf('flaky'), ['up', 'suspect', 'down', 'up']);
    });

    it('stays up when one call is dropped, because the retry answers', async () => {
      // Arrange
      await addDevice('dropped', {});
      await waitForState('dropped', 'up');

      // Act
      await changeDevice('dropped', { dropNext: 1 });
      await eventually(
        'the call to be dropped',
        async () => jsonOf<{ dropNext: number }>(await fetch(`${controlUrl}/devices/dropped`)),
        (device) => device.dropNext === 0,
      );
      const probesSoFar = await historyCount('dropped');
      await eventually(
        'two more probes',
        () => historyCount('dropped'),
        (count) => count > probesSoFar + 1,
      );

      // Assert
      assert.deepEqual(await statesOf('dropped'), ['up']);
    });

    for (const [behaviour, failure] of [
      ['truncates', { response: 'none', reason: 'cut_off' }],
      ['garbage', { response: 'unexpected', reason: 'not_a_device_answer', httpStatus: 200 }],
      ['html', { response: 'unexpected', reason: 'unparsable', httpStatus: 200 }],
      ['fails', { response: 'unexpected', reason: 'http_error', httpStatus: 500 }],
      ['gateway_error', { response: 'none', reason: 'gateway_error', httpStatus: 502 }],
    ] as const) {
      it(`goes suspect, then down, when an up device's health ${behaviour}, saying whether anything responded`, async () => {
        // Arrange
        const deviceId = `then-${behaviour.replace('_', '-')}`;
        await addDevice(deviceId, {});
        await waitForState(deviceId, 'up');

        // Act
        await changeDevice(deviceId, { health: behaviour });
        const status = await waitForState(deviceId, 'down');

        // Assert
        assert.partialDeepStrictEqual(status.lastProbe, failure);
        assert.deepEqual(await statesOf(deviceId), ['up', 'suspect', 'down']);
      });
    }
  });

  describe('comes with demo devices', () => {
    it('has the demo devices registered, and probes them', async () => {
      // Act
      const lobby = await waitForState('demo-lobby-switch', 'up');
      const camera = await waitForState('demo-door-camera', 'up');

      // Assert
      assert.equal(lobby.diagnostics?.checksum?.comparison, 'match');
      assert.equal(camera.diagnostics?.state, 'available');
    });

    it('leaves a demo device changed through the API as it is when the simulator restarts', async () => {
      // Arrange
      const renamed = await fetch(
        `${monitorUrl}/v1/devices/demo-lobby-switch`,
        json('PUT', { name: 'Renamed', baseUrl: stack.deviceUrl('demo-lobby-switch'), auth: { strategy: 'none' } }),
      );
      assert.equal(renamed.status, 200, await renamed.text());

      // Act
      await restart('simulator');

      // Assert
      const device = await jsonOf<{ name: string }>(await fetch(`${monitorUrl}/v1/devices/demo-lobby-switch`));
      assert.equal(device.name, 'Renamed');
      assert.match(await stack.logs('simulator'), /"deviceId":"demo-lobby-switch","outcome":"already_registered"/);
    });
  });

  describe('keeps what it found', () => {
    it('keeps the latest statuses and their history across a restart', async () => {
      // Arrange
      const countBefore = await historyCount('demo-lobby-switch');

      // Act
      await restart('monitor');

      // Assert
      assert.ok((await historyCount('demo-lobby-switch')) >= countBefore);
      assert.equal((await statusOf('demo-lobby-switch'))?.state, 'up');
    });

    it('stops reporting a removed device, and keeps its history', async () => {
      // Arrange
      await addDevice('removed', {});
      await waitForState('removed', 'up');

      // Act
      const response = await fetch(`${monitorUrl}/v1/devices/removed`, { method: 'DELETE' });

      // Assert
      assert.equal(response.status, 204);
      await eventually(
        'removed to leave the statuses',
        () => statusOf('removed'),
        (status) => status === undefined,
      );
      assert.ok((await historyCount('removed')) > 0, 'its history was deleted');
    });
  });

  describe('starts and stops cleanly', () => {
    it('refuses to start with wrong settings, listing every problem', async () => {
      // Act
      const { code, output } = await stack.runMonitor({
        MONITORING_INTERVAL_MS: 'soon',
        CHECKSUM_BINARY_PATH: 'bin/checksum',
      });

      // Assert
      assert.notEqual(code, 0);
      assert.match(output, /MONITORING_INTERVAL_MS must be a number of 0 or more, not "soon"/);
      assert.match(output, /CHECKSUM_BINARY_PATH must be an absolute path, not "bin\/checksum"/);
    });

    it('exits 0 on SIGTERM, within the shutdown timeout', async () => {
      // Act
      const { exitCode, elapsedMs } = await stack.stopMonitor();

      // Assert
      assert.equal(exitCode, 0, await stack.logs('monitor'));
      assert.ok(elapsedMs < 9000, `took ${Math.round(elapsedMs)} ms`);
    });
  });
});
