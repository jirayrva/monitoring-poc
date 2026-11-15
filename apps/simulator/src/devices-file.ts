import { readFileSync } from 'node:fs';
import { defaults } from './device.ts';
import type { SimulatedDevice } from './device.ts';

/**
 * One device in a devices file: how the simulator plays it, under simulated, and what a monitor needs to register it.
 * The simulator takes the settings as they come (D-63).
 */
type DevicesFileEntry = {
  deviceId: string;
  name: string;
  secretRef: string | undefined;
  simulated: Partial<SimulatedDevice>;
};

const readDevicesFile = (path: string) => {
  const { devices }: { devices: DevicesFileEntry[] } = JSON.parse(readFileSync(path, 'utf8'));
  return devices.map((entry) => ({
    entry,
    device: { ...defaults(entry.deviceId), ...entry.simulated, deviceId: entry.deviceId },
  }));
};

export { readDevicesFile };
export type { DevicesFileEntry };
