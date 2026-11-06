import type { DeviceStatus } from '../device-status.ts';
import { door, lobby } from './devices.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 9, minute));

const lobbyUp: DeviceStatus = {
  deviceId: lobby.deviceId,
  name: lobby.name,
  since: at(0),
  state: 'up',
  lastProbe: { response: 'expected', probedAt: at(0), durationMs: 20 },
  health: { state: 'ok' },
  capabilities: {
    deviceType: 'switch',
    protocols: [{ name: 'rest', version: '1', port: 443 }],
    checksumAlgorithm: 'sha256',
  },
  diagnostics: { state: 'unavailable', reason: 'no_supported_protocol' },
};

const lobbySuspect: DeviceStatus = {
  deviceId: lobby.deviceId,
  name: lobby.name,
  since: at(1),
  state: 'suspect',
  failedProbes: 1,
  lastProbe: { response: 'none', reason: 'timeout', probedAt: at(1), durationMs: 3000 },
  lastKnown: {
    seenAt: at(0),
    health: lobbyUp.health,
    capabilities: lobbyUp.capabilities,
    diagnostics: lobbyUp.diagnostics,
  },
};

/** Never answered, so it has no lastKnown. */
const doorDown: DeviceStatus = {
  deviceId: door.deviceId,
  name: door.name,
  since: at(2),
  state: 'down',
  lastProbe: { response: 'none', reason: 'unreachable', probedAt: at(2), durationMs: 15 },
  lastKnown: undefined,
};

export { doorDown, lobbySuspect, lobbyUp };
