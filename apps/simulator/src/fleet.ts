/**
 * A fleet of simulated devices, added to a running stack and removed from it again, to show how rounds of probes keep
 * up at scale (Q-09). Each device is added to the simulator, then registered with the monitor. The fleet is the same
 * every time: most devices work, and a few in every hundred are slow, degraded, failing or never answer.
 */
import pMap from 'p-map';
import type { DevicesFileEntry } from './devices-file.ts';
import { registerDevices } from './register.ts';

const maxFleetSize = 10_000;

/** What every fleet device's ID starts with, so removing the fleet leaves every other device alone. */
const fleetPrefix = 'fleet-';

const deviceTypes = ['switch', 'access-point', 'camera', 'display'];

/**
 * How device number n misbehaves, if it does. A slow one waits 1.2 s before each answer, within every attempt's
 * timeout. One that hangs never answers, so each of its probes waits out its whole health budget.
 */
const behaviourOf = (n: number) => {
  if (n % 97 === 0) {
    return { health: 'hangs' } as const;
  }
  if (n % 89 === 0) {
    return { health: 'fails' } as const;
  }
  if (n % 50 === 0) {
    return { delayMs: 1200 };
  }
  return n % 31 === 0 ? { status: 'degraded' } : {};
};

const fleetOf = (size: number): DevicesFileEntry[] => {
  if (!Number.isInteger(size) || size < 1 || size > maxFleetSize) {
    throw new RangeError(`A fleet has from 1 to ${maxFleetSize} devices, not ${size}`);
  }
  return Array.from({ length: size }, (_, index) => {
    const n = index + 1;
    // The same width whatever the size, so a device is the same in every fleet, and the IDs sort.
    const number = String(n).padStart(String(maxFleetSize).length, '0');
    const deviceType = deviceTypes[index % deviceTypes.length] ?? 'switch';
    return {
      deviceId: `${fleetPrefix}${number}`,
      name: `Fleet ${deviceType} ${number}`,
      secretRef: undefined,
      simulated: { deviceType, ...behaviourOf(n) },
    };
  });
};

type FleetOptions = {
  simulatorUrl: string;
  monitorUrl: string;
  /** Where the monitor reaches the simulated devices, such as http://simulator:4100/devices: from its container. */
  deviceBaseUrl: string;
};

type Failure = { deviceId: string; detail: string };

const concurrency = 25;

const failureOf = async (deviceId: string, what: string, response: Response): Promise<Failure> => ({
  deviceId,
  detail: `${what}: ${response.status} ${await response.text()}`,
});

const fleetIdsOf = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status} ${await response.text()}`);
  }
  const { data }: { data: { deviceId: string }[] } = JSON.parse(await response.text());
  return data.map(({ deviceId }) => deviceId).filter((deviceId) => deviceId.startsWith(fleetPrefix));
};

/**
 * Adds a fleet of the given size: each device to the simulator, then to the monitor. A device the monitor has already
 * is left as it is, so adding again, after the simulator restarted and forgot the fleet, brings it back. Stops before
 * the first device when either does not answer, rather than add the fleet to only one.
 */
const addFleet = async (size: number, options: FleetOptions) => {
  const { simulatorUrl, monitorUrl, deviceBaseUrl } = options;
  const entries = fleetOf(size);
  await fleetIdsOf(`${simulatorUrl}/devices`);
  await fleetIdsOf(`${monitorUrl}/v1/devices`);

  const failed: Failure[] = [];
  const outcomes = await pMap(
    entries,
    async (entry) => {
      const simulated = await fetch(`${simulatorUrl}/devices/${entry.deviceId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.simulated),
      });
      if (!simulated.ok) {
        failed.push(await failureOf(entry.deviceId, 'simulator', simulated));
        return undefined;
      }
      const [outcome] = await registerDevices({ entries: [entry], monitorUrl, deviceBaseUrl });
      if (outcome?.outcome === 'failed') {
        failed.push({ deviceId: entry.deviceId, detail: `monitor: ${outcome.detail}` });
      }
      return outcome?.outcome;
    },
    { concurrency },
  );
  return {
    registered: outcomes.filter((outcome) => outcome === 'registered').length,
    alreadyRegistered: outcomes.filter((outcome) => outcome === 'already_registered').length,
    failed,
  };
};

/**
 * Removes every fleet device, whatever size it was added with, from the monitor, then from the simulator, so the
 * monitor never probes one the simulator no longer has. One in only one of them, as after a restart, goes too.
 */
const removeFleet = async (options: FleetOptions) => {
  const { simulatorUrl, monitorUrl } = options;
  const deviceIds = new Set([
    ...(await fleetIdsOf(`${monitorUrl}/v1/devices`)),
    ...(await fleetIdsOf(`${simulatorUrl}/devices`)),
  ]);
  const failed: Failure[] = [];
  await pMap(
    deviceIds,
    async (deviceId) => {
      const unregistered = await fetch(`${monitorUrl}/v1/devices/${deviceId}`, { method: 'DELETE' });
      if (!unregistered.ok && unregistered.status !== 404) {
        failed.push(await failureOf(deviceId, 'monitor', unregistered));
        return;
      }
      await fetch(`${simulatorUrl}/devices/${deviceId}`, { method: 'DELETE' });
    },
    { concurrency },
  );
  return { removed: deviceIds.size - failed.length, failed };
};

/** Run as a script: `fleet.ts add [size]` or `fleet.ts remove`. Exits 1 when any device failed. */
const main = async (command: string | undefined, size: string | undefined) => {
  const options: FleetOptions = {
    simulatorUrl: process.env['FLEET_SIMULATOR_URL'] || 'http://127.0.0.1:4101',
    monitorUrl: process.env['FLEET_MONITOR_URL'] || 'http://127.0.0.1:8080',
    deviceBaseUrl: process.env['FLEET_DEVICE_BASE_URL'] || 'http://simulator:4100/devices',
  };
  if (command !== 'add' && command !== 'remove') {
    throw new Error('Usage: fleet.ts add [size, 1001 unless given] | fleet.ts remove');
  }
  const outcome = command === 'add' ? await addFleet(Number(size ?? 1001), options) : await removeFleet(options);
  for (const failure of outcome.failed) {
    console.error(JSON.stringify(failure));
  }
  console.log(JSON.stringify({ ...outcome, failed: outcome.failed.length }));
  process.exitCode = outcome.failed.length > 0 ? 1 : 0;
};

if (import.meta.main) {
  await main(process.argv[2], process.argv[3]);
}

export { addFleet, fleetOf, maxFleetSize, removeFleet };
export type { FleetOptions };
