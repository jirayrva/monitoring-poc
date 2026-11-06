import type { DeviceRegistration } from '../device.ts';

/** Sorts before `lobby` by device ID, and uses bearer auth where `lobby` uses none. */
const door: DeviceRegistration = {
  deviceId: 'door-ctrl-0021',
  name: 'Door controller',
  baseUrl: 'https://door.example.test/api',
  auth: { strategy: 'bearer', secretRef: 'DEVICE_DOOR_TOKEN' },
};

const lobby: DeviceRegistration = {
  deviceId: 'usw-pro-24-0042',
  name: 'Lobby switch',
  baseUrl: 'http://192.0.2.10:8080',
  auth: { strategy: 'none' },
};

export { door, lobby };
