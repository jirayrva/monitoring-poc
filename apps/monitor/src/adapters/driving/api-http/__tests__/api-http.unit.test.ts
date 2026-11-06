import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { openApiPath } from '@device-monitor/contracts/monitor-api';
import { samples } from '@device-monitor/contracts/monitor-api/testing';
import { createApplication } from '../../../../core/application/index.ts';
import { door, lobby } from '../../../../core/domain/testing/devices.ts';
import type { DeviceDatastore } from '../../../../core/ports/driven/device-datastore.ts';
import type { CallOptions } from '../../../../core/ports/types.ts';
import { createDeviceDatastoreInMemory } from '../../../driven/device-datastore-in-memory/index.ts';
import { createDeviceStatusDatastoreInMemory } from '../../../driven/device-status-datastore-in-memory/index.ts';
import { statusNameOf } from '../error-handlers.ts';
import { createApiHttp } from '../index.ts';

type ApiErrorBody = Record<string, unknown>;

/** What the API adds to every error. It varies from one request to the next. */
const envelope = new Set(['statusCode', 'statusName', 'requestPath', 'requestId', 'timestamp']);

const isApiErrorBody = (value: unknown): value is ApiErrorBody => value instanceof Object && 'code' in value;

const withoutEnvelope = (error: ApiErrorBody) =>
  Object.fromEntries(Object.entries(error).filter(([key]) => !envelope.has(key)));

const errorSamples: Record<string, any> = Object.fromEntries(
  Object.entries<ApiErrorBody>(samples.apiError.valid).map(([name, sample]) => [name, withoutEnvelope(sample)]),
);

const problemOf = async (response: Response) => {
  const error: unknown = await response.json();
  assert.ok(isApiErrorBody(error));
  assert.equal(error['statusCode'], response.status);
  assert.equal(error['statusName'], statusNameOf(response.status));
  assert.equal(error['requestPath'], new URL(response.url).pathname);
  assert.match(String(error['requestId']), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(!Number.isNaN(Date.parse(String(error['timestamp']))));
  return withoutEnvelope(error);
};

const assertInvalidRequest = async (response: Response) => {
  const { code, message } = errorSamples['invalid-request'];
  assert.equal(response.status, 400);
  const body = await problemOf(response);
  assert.partialDeepStrictEqual(body, { code, message });
  assert.match(JSON.stringify(body), /"details":\{"reason":".+"\}/);
};

const startServer = async (t: TestContext, ...registrations: (typeof lobby)[]) =>
  startServerOn(t, createDeviceDatastoreInMemory(), ...registrations);

const startServerOn = async (t: TestContext, deviceDatastore: DeviceDatastore, ...registrations: (typeof lobby)[]) => {
  for (const registration of registrations) {
    await deviceDatastore.insertDevice(
      { registration, registeredAt: new Date() },
      { signal: new AbortController().signal },
    );
  }
  const { deviceRegistry } = createApplication({
    deviceDatastore,
    deviceStatusDatastore: createDeviceStatusDatastoreInMemory(),
    now: () => new Date(),
  });
  const server = createApiHttp({ deviceRegistry, config: { host: '127.0.0.1', port: 0, logLevel: 'silent' } });
  const { url } = await server.start();
  t.after(() => server.stop());
  return {
    request: (method: string, path: string, body?: unknown, signal?: AbortSignal) =>
      fetch(`${url}/v1${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: typeof body === 'string' ? body : JSON.stringify(body),
            }),
        ...(signal ? { signal } : {}),
      }),
    listed: async () => (await fetch(`${url}/v1/devices`)).json(),
    fetchPath: (path: string) => fetch(`${url}${path}`),
  };
};

describe('GET /v1/devices', () => {
  it('returns an empty list when no device is registered', async (t) => {
    // Arrange
    const api = await startServer(t);

    // Act
    const response = await api.request('GET', '/devices');

    // Assert
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), samples.listDevicesResult.valid.empty);
  });

  it('returns the devices in the documented format', async (t) => {
    // Arrange
    const api = await startServer(t, lobby, door);

    // Act
    const response = await api.request('GET', '/devices');

    // Assert
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), samples.listDevicesResult.valid['two-devices']);
  });
});

describe('GET /v1/devices/:deviceId', () => {
  it('returns the device in the documented format', async (t) => {
    // Arrange
    const api = await startServer(t, door);

    // Act
    const response = await api.request('GET', `/devices/${door.deviceId}`);

    // Assert
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), samples.getDeviceResult.valid.bearer);
  });

  it('returns 404 device_not_found for an unregistered ID', async (t) => {
    // Arrange
    const api = await startServer(t);

    // Act
    const response = await api.request('GET', '/devices/missing');

    // Assert
    assert.equal(response.status, 404);
    assert.deepEqual(await problemOf(response), errorSamples['device-not-found']);
  });
});

describe('POST /v1/devices', () => {
  for (const [name, command] of Object.entries<{ deviceId: string }>(samples.registerDeviceCommand.valid)) {
    it(`returns 201 with the device and where to find it, for register-device-command/valid/${name}`, async (t) => {
      // Arrange
      const api = await startServer(t);

      // Act
      const response = await api.request('POST', '/devices', command);

      // Assert
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('location'), `/v1/devices/${command.deviceId}`);
      assert.deepEqual(await response.json(), samples.registerDeviceResult.valid[name]);
      assert.deepEqual(await api.listed(), { data: [command] });
    });
  }

  const invalidBodies: [string, unknown][] = [
    ...Object.entries(samples.registerDeviceCommand.invalid).map(([name, sample]): [string, unknown] => [
      `register-device-command/invalid/${name}`,
      sample,
    ]),
    ['an unknown field, rather than dropping it', { ...lobby, unknown: true }],
    ['a wrong type, rather than converting it', { ...lobby, name: 123 }],
    ['a body that is not JSON', '{not json'],
  ];
  for (const [name, body] of invalidBodies) {
    it(`returns 400 invalid_request for ${name}, and registers nothing`, async (t) => {
      // Arrange
      const api = await startServer(t);

      // Act
      const response = await api.request('POST', '/devices', body);

      // Assert
      await assertInvalidRequest(response);
      assert.deepEqual(await api.listed(), { data: [] });
    });
  }

  it('returns 409 device_exists for a registered ID, and keeps the original', async (t) => {
    // Arrange
    const api = await startServer(t, lobby);

    // Act
    const response = await api.request('POST', '/devices', { ...lobby, name: 'Renamed' });

    // Assert
    assert.equal(response.status, 409);
    assert.deepEqual(await problemOf(response), errorSamples['device-exists']);
    assert.deepEqual(await api.listed(), { data: [lobby] });
  });
});

describe('PUT /v1/devices/:deviceId', () => {
  for (const [name, command] of Object.entries<object>(samples.updateDeviceCommand.valid)) {
    it(`returns 200 with the device named in the URL, for update-device-command/valid/${name}`, async (t) => {
      // Arrange
      const api = await startServer(t, door, lobby);
      const updated = { ...command, deviceId: lobby.deviceId };

      // Act
      const response = await api.request('PUT', `/devices/${lobby.deviceId}`, command);

      // Assert
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), updated);
      assert.deepEqual(await api.listed(), { data: [door, updated] });
    });
  }

  for (const [name, command] of Object.entries(samples.updateDeviceCommand.invalid)) {
    it(`returns 400 invalid_request for update-device-command/invalid/${name}, and changes nothing`, async (t) => {
      // Arrange
      const api = await startServer(t, lobby);

      // Act
      const response = await api.request('PUT', `/devices/${lobby.deviceId}`, command);

      // Assert
      await assertInvalidRequest(response);
      assert.deepEqual(await api.listed(), { data: [lobby] });
    });
  }

  it('returns 404 device_not_found for an unregistered ID, and does not register it', async (t) => {
    // Arrange
    const api = await startServer(t);

    // Act
    const response = await api.request('PUT', `/devices/${lobby.deviceId}`, samples.updateDeviceCommand.valid.bearer);

    // Assert
    assert.equal(response.status, 404);
    assert.deepEqual(await problemOf(response), errorSamples['device-not-found']);
    assert.deepEqual(await api.listed(), { data: [] });
  });
});

describe('DELETE /v1/devices/:deviceId', () => {
  it('returns 204 with no body, and unregisters only the device named in the URL', async (t) => {
    // Arrange
    const api = await startServer(t, door, lobby);

    // Act
    const response = await api.request('DELETE', `/devices/${door.deviceId}`);

    // Assert
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.deepEqual(await api.listed(), { data: [lobby] });
  });

  it('returns 404 device_not_found for an unregistered ID', async (t) => {
    // Arrange
    const api = await startServer(t);

    // Act
    const response = await api.request('DELETE', `/devices/${lobby.deviceId}`);

    // Assert
    assert.equal(response.status, 404);
    assert.deepEqual(await problemOf(response), errorSamples['device-not-found']);
  });
});

const routes: { method: string; path: string; body?: unknown; storeCall: keyof DeviceDatastore }[] = [
  { method: 'GET', path: '/devices', storeCall: 'listDevices' },
  { method: 'GET', path: `/devices/${lobby.deviceId}`, storeCall: 'getDevice' },
  { method: 'POST', path: '/devices', body: lobby, storeCall: 'insertDevice' },
  {
    method: 'PUT',
    path: `/devices/${lobby.deviceId}`,
    body: samples.updateDeviceCommand.valid.bearer,
    storeCall: 'updateDevice',
  },
  { method: 'DELETE', path: `/devices/${lobby.deviceId}`, storeCall: 'deleteDevice' },
];

/** Lets a store call run a little while, and fails the request if its signal ended meanwhile. */
const delayed =
  <Input, Output>(call: (input: Input, options: CallOptions) => Promise<Output>) =>
  async (input: Input, options: CallOptions) => {
    await sleep(50);
    if (options.signal.aborted) {
      throw new Error('the store call was aborted while the client waited');
    }
    return call(input, options);
  };

const slowed = (store: DeviceDatastore): DeviceDatastore => ({
  listDevices: delayed(store.listDevices),
  getDevice: delayed(store.getDevice),
  insertDevice: delayed(store.insertDevice),
  updateDevice: delayed(store.updateDevice),
  deleteDevice: delayed(store.deleteDevice),
});

describe('every route', () => {
  for (const { method, path, body, storeCall } of routes) {
    describe(`${method} ${path}`, () => {
      it('returns 503 store_unavailable when the store fails', async (t) => {
        // Arrange
        const api = await startServerOn(t, {
          ...createDeviceDatastoreInMemory(),
          [storeCall]: () => Promise.resolve({ ok: false, failure: { reason: 'timeout' } }),
        });

        // Act
        const response = await api.request(method, path, body);

        // Assert
        assert.equal(response.status, 503);
        assert.deepEqual(await problemOf(response), {
          ...errorSamples['store-unavailable'],
          details: { reason: 'timeout' },
        });
      });

      it('aborts the store call when the client disconnects', { timeout: 5000 }, async (t) => {
        // Arrange
        const called = Promise.withResolvers<void>();
        const aborted = Promise.withResolvers<void>();
        const api = await startServerOn(t, {
          ...createDeviceDatastoreInMemory(),
          [storeCall]: (_input: unknown, { signal }: { signal: AbortSignal }) => {
            signal.addEventListener('abort', () => aborted.resolve());
            called.resolve();
            return aborted.promise.then(() => ({ ok: false, failure: { reason: 'cancelled' } }));
          },
        });
        const client = new AbortController();
        const request = api.request(method, path, body, client.signal);

        // Act
        await called.promise;
        client.abort();

        // Assert
        await assert.rejects(request, { name: 'AbortError' });
        await aborted.promise;
      });

      it('keeps the store call going while the client waits', async (t) => {
        // Arrange
        const api = await startServerOn(
          t,
          slowed(createDeviceDatastoreInMemory()),
          ...(method === 'POST' ? [] : [lobby]),
        );

        // Act
        const response = await api.request(method, path, body);

        // Assert
        assert.ok(response.ok, String(response.status));
      });

      if (path !== '/devices') {
        it('returns 400 invalid_request for a device ID the API would never accept', async (t) => {
          // Arrange
          const api = await startServer(t);

          // Act
          const response = await api.request(method, path.replace(lobby.deviceId, 'lobby%2Fswitch'), body);

          // Assert
          await assertInvalidRequest(response);
        });
      }
    });
  }
});

it('returns 404 route_not_found for a route that does not exist', async (t) => {
  // Arrange
  const api = await startServer(t);

  // Act
  const response = await api.request('GET', '/nowhere');

  // Assert
  assert.equal(response.status, 404);
  assert.deepEqual(await problemOf(response), { ...errorSamples['route-not-found'] });
});

describe('API documentation', () => {
  it('serves the OpenAPI document that is checked in', async (t) => {
    // Arrange
    const api = await startServer(t);
    const checkedIn: unknown = JSON.parse(await readFile(openApiPath, 'utf8'));

    // Act
    const response = await api.fetchPath('/docs/openapi.json');

    // Assert
    assert.equal(response.status, 200);
    assert.deepEqual(
      await response.json(),
      checkedIn,
      'openapi.json is out of date: run pnpm --filter @device-monitor/monitor openapi:generate',
    );
  });

  it('serves the API reference page', async (t) => {
    // Arrange
    const api = await startServer(t);

    // Act
    const response = await api.fetchPath('/docs/');

    // Assert
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /<title>Device Monitor API<\/title>/);
  });
});
