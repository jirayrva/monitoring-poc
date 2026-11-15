import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { json } from 'node:stream/consumers';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaults, diagnosticsOf, healthOf } from './device.ts';
import type { SimulatedDevice } from './device.ts';

type SimulatorConfig = {
  host: string;
  devicePort: number;
  /** Where the control API answers: apart from the devices, so a monitor never reaches it. 0 picks a free port. */
  controlPort: number;
  devices: SimulatedDevice[];
};

/** Disposing it closes its servers, and every connection still open, such as one to a device that hangs. */
type Simulator = AsyncDisposable & {
  start: () => Promise<{ deviceUrl: string; controlUrl: string }>;
};

const devicePath = /^\/devices\/([^/]+)\/v1\/(health|diagnostics)$/;
const controlPath = /^\/devices(?:\/([^/]+))?$/;

const sendJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  response.end(text);
};

const isObject = (value: unknown): value is Record<string, unknown> => value instanceof Object && !Array.isArray(value);

/** Listens, and returns the URL to reach it on. 0.0.0.0 is reached on loopback. */
const listen = (server: Server, host: string, port: number) =>
  new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const actualPort = typeof address === 'string' || !address ? port : address.port;
      resolve(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`);
    });
  });

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

const createSimulator = (config: SimulatorConfig): Simulator => {
  const { host, controlPort } = config;
  const devices = new Map(config.devices.map((device) => [device.deviceId, device]));
  let devicePort = config.devicePort;

  const answerDevice = async (request: IncomingMessage, response: ServerResponse, device: SimulatedDevice) => {
    const call = devicePath.exec(request.url ?? '')?.[2];
    if (device.dropNext > 0) {
      devices.set(device.deviceId, { ...device, dropNext: device.dropNext - 1 });
      request.socket.resetAndDestroy();
      return;
    }
    if (device.token !== undefined && request.headers.authorization !== `Bearer ${device.token}`) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    await sleep(device.delayMs);
    const diagnostics = diagnosticsOf(device);
    const body = call === 'health' ? JSON.stringify(healthOf(device, devicePort)) : diagnostics.body;
    switch (call === 'health' ? device.health : device.diagnostics) {
      case 'garbage':
        return sendJson(response, 200, { unexpected: true });
      case 'html': {
        const page = '<!doctype html><title>Sign in</title><p>Sign in to use this network.</p>';
        response.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) });
        return response.end(page);
      }
      case 'fails':
        return sendJson(response, 500, { error: 'internal' });
      case 'not_found':
        return sendJson(response, 404, { error: 'not_found' });
      case 'gateway_error':
        return sendJson(response, 502, { error: 'bad_gateway' });
      case 'hangs':
        return undefined;
      case 'resets':
        return request.socket.resetAndDestroy();
      case 'truncates':
        // Announces the whole length, then stops halfway, so the client knows the answer was cut off.
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        return response.write(body.slice(0, Math.floor(body.length / 2)), () => request.socket.destroy());
      default:
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(call === 'diagnostics' ? { 'diagnostics-checksum': diagnostics.checksum } : {}),
        });
        return response.end(body);
    }
  };

  const deviceServer = createServer((request, response) => {
    const deviceId = devicePath.exec(request.url ?? '')?.[1];
    const device = deviceId === undefined ? undefined : devices.get(decodeURIComponent(deviceId));
    if (request.method !== 'GET' || device === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    void answerDevice(request, response, device);
  });

  /**
   * GET /devices lists the devices. On /devices/<deviceId>: GET gets one, PUT adds or replaces it from the defaults,
   * PATCH changes some of its settings, DELETE removes it. Settings are not checked (D-63).
   */
  const answerControl = async (request: IncomingMessage, response: ServerResponse) => {
    const match = controlPath.exec(request.url ?? '');
    if (!match) {
      return sendJson(response, 404, { error: 'not_found' });
    }
    const deviceId = match[1] === undefined ? undefined : decodeURIComponent(match[1]);
    if (deviceId === undefined) {
      return request.method === 'GET'
        ? sendJson(response, 200, { data: [...devices.values()] })
        : sendJson(response, 405, { error: 'method_not_allowed' });
    }

    const existing = devices.get(deviceId);
    switch (request.method) {
      case 'GET':
        return existing === undefined
          ? sendJson(response, 404, { error: 'not_found' })
          : sendJson(response, 200, existing);
      case 'DELETE':
        devices.delete(deviceId);
        return response.writeHead(204).end();
      case 'PUT':
      case 'PATCH': {
        const base = request.method === 'PUT' ? defaults(deviceId) : existing;
        if (base === undefined) {
          return sendJson(response, 404, { error: 'not_found' });
        }
        const settings = await json(request).catch(() => undefined);
        if (!isObject(settings)) {
          return sendJson(response, 400, { error: 'the body must be a JSON object' });
        }
        const device = { ...base, ...settings, deviceId };
        devices.set(deviceId, device);
        return sendJson(response, 200, device);
      }
      default:
        return sendJson(response, 405, { error: 'method_not_allowed' });
    }
  };

  const controlServer = createServer((request, response) => {
    void answerControl(request, response);
  });

  const resources = new AsyncDisposableStack();
  return {
    start: async () => {
      const deviceUrl = await listen(deviceServer, host, devicePort);
      resources.defer(() => close(deviceServer));
      // A device names the port it answers on, so a free port picked for tests must be known first.
      devicePort = Number(new URL(deviceUrl).port);
      const controlUrl = await listen(controlServer, host, controlPort);
      resources.defer(() => close(controlServer));
      return { deviceUrl, controlUrl };
    },
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
};

export { createSimulator };
export type { Simulator, SimulatorConfig };
