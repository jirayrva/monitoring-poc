import { createHash } from 'node:crypto';

/**
 * How a device answers a call. Each way but normal is one thing that goes wrong with a real device, or with the
 * network between it and the monitor:
 *
 * - garbage: 200 with JSON the device API never sends.
 * - html: 200 with an HTML page, as a captive portal sends.
 * - fails: 500.
 * - not_found: 404, as a wrong path gets.
 * - gateway_error: 502, as a proxy whose device is gone sends.
 * - hangs: never answers.
 * - resets: drops the connection.
 * - truncates: stops partway through a framed answer, as a broken link does.
 */
type Behaviour =
  | 'normal'
  | 'garbage'
  | 'html'
  | 'fails'
  | 'not_found'
  | 'gateway_error'
  | 'hangs'
  | 'resets'
  | 'truncates';

type Protocol = 'rest' | 'grpc';

type SimulatedDevice = {
  deviceId: string;
  deviceType: string;
  /** What it says about its health. Any word: the monitor keeps one it does not know as unrecognized. */
  status: string;
  /** When set, every call must carry it as a bearer token, or gets 401. A PUT without one removes it. */
  token: string | undefined;
  health: Behaviour | 'impostor';
  diagnostics: Behaviour | 'tampered';
  delayMs: number;
  dropNext: number;
  protocols: Protocol[];
  hardware: { model: string; revision: string; serial: string };
  softwareVersion: string;
  firmwareVersion: string;
};

const defaults = (deviceId: string): SimulatedDevice => ({
  deviceId,
  deviceType: 'switch',
  status: 'ok',
  token: undefined,
  health: 'normal',
  diagnostics: 'normal',
  delayMs: 0,
  dropNext: 0,
  protocols: ['rest'],
  hardware: { model: 'SIM-24', revision: 'r1', serial: `SIM-${deviceId.toUpperCase()}` },
  softwareVersion: '1.0.0',
  firmwareVersion: '1.0.0',
});

const checksumAlgorithm = 'sha256';

const healthOf = (device: SimulatedDevice, ports: Record<Protocol, number>) => ({
  status: device.status,
  deviceId: device.health === 'impostor' ? `${device.deviceId}-impostor` : device.deviceId,
  deviceType: device.deviceType,
  protocols: device.protocols.map((name) => ({ name, version: '1', port: ports[name] })),
  checksumAlgorithm,
});

/**
 * The diagnostics, as the JSON a REST answer's body and a gRPC answer both carry, and the checksum of exactly those
 * bytes. A tampered device changes the checksum's first digit.
 */
const diagnosticsOf = (device: SimulatedDevice) => {
  const { hardware, softwareVersion, firmwareVersion, status } = device;
  const body = JSON.stringify({ hardware, softwareVersion, firmwareVersion, status });
  const checksum = createHash(checksumAlgorithm).update(body).digest('hex');
  return {
    body,
    checksum: device.diagnostics === 'tampered' ? `${checksum[0] === '0' ? '1' : '0'}${checksum.slice(1)}` : checksum,
  };
};

export { defaults, diagnosticsOf, healthOf };
export type { Behaviour, Protocol, SimulatedDevice };
