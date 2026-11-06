import type { DeviceRegistration } from '../../domain/device.ts';
import type { CallOptions, Result, StoreFailure } from '../types.ts';

type ListDevicesInput = {};
type ListDevicesOutput = Result<DeviceRegistration[], StoreFailure>;

type RegisterDeviceInput = { registration: DeviceRegistration };
type RegisterDeviceOutput = Result<undefined, StoreFailure | { reason: 'already_exists' }>;

type GetDeviceInput = { deviceId: string };
type GetDeviceOutput = Result<DeviceRegistration, StoreFailure | { reason: 'not_found' }>;

type UpdateDeviceInput = { registration: DeviceRegistration };
type UpdateDeviceOutput = Result<undefined, StoreFailure | { reason: 'not_found' }>;

type UnregisterDeviceInput = { deviceId: string };
type UnregisterDeviceOutput = Result<undefined, StoreFailure | { reason: 'not_found' }>;

type DeviceRegistry = {
  listDevices: (input: ListDevicesInput, options: CallOptions) => Promise<ListDevicesOutput>;
  registerDevice: (input: RegisterDeviceInput, options: CallOptions) => Promise<RegisterDeviceOutput>;
  getDevice: (input: GetDeviceInput, options: CallOptions) => Promise<GetDeviceOutput>;
  updateDevice: (input: UpdateDeviceInput, options: CallOptions) => Promise<UpdateDeviceOutput>;
  unregisterDevice: (input: UnregisterDeviceInput, options: CallOptions) => Promise<UnregisterDeviceOutput>;
};

export type {
  DeviceRegistry,
  GetDeviceInput,
  GetDeviceOutput,
  ListDevicesInput,
  ListDevicesOutput,
  RegisterDeviceInput,
  RegisterDeviceOutput,
  UnregisterDeviceInput,
  UnregisterDeviceOutput,
  UpdateDeviceInput,
  UpdateDeviceOutput,
};
