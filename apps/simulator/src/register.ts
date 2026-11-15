import type { DevicesFileEntry } from './devices-file.ts';

type RegisterOptions = {
  entries: DevicesFileEntry[];
  monitorUrl: string;
  deviceBaseUrl: string;
};

type RegisterOutcome =
  | { deviceId: string; outcome: 'registered' | 'already_registered' }
  | { deviceId: string; outcome: 'failed'; detail: string };

/**
 * Registers each device with the monitor. One already registered is left as it is, so a restart does not undo changes
 * made through the monitor's API.
 */
const registerDevices = async (options: RegisterOptions): Promise<RegisterOutcome[]> => {
  const { entries, monitorUrl, deviceBaseUrl } = options;
  const outcomes: RegisterOutcome[] = [];
  for (const { deviceId, name, secretRef } of entries) {
    const response = await fetch(`${monitorUrl}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name,
        baseUrl: `${deviceBaseUrl}/${encodeURIComponent(deviceId)}`,
        auth: secretRef === undefined ? { strategy: 'none' } : { strategy: 'bearer', secretRef },
      }),
    }).catch((error: unknown) => ({ status: 0, text: () => Promise.resolve(String(error)) }));
    if (response.status === 201 || response.status === 409) {
      outcomes.push({ deviceId, outcome: response.status === 201 ? 'registered' : 'already_registered' });
    } else {
      outcomes.push({ deviceId, outcome: 'failed', detail: `${response.status} ${await response.text()}` });
    }
  }
  return outcomes;
};

export { registerDevices };
export type { RegisterOutcome };
