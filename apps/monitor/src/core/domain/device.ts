type AuthProfile = { strategy: 'none' } | { strategy: 'bearer'; secretRef: string };

type Device = {
  deviceId: string;
  name: string;
};

type DeviceRegistration = Device & {
  baseUrl: string;
  auth: AuthProfile;
};

type RegisteredDevice = DeviceRegistration & { registeredAt: Date };

export type { AuthProfile, Device, DeviceRegistration, RegisteredDevice };
