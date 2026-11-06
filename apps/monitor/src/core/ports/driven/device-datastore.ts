import type { DeviceRegistration, RegisteredDevice } from '../../domain/device.ts';
import type { CallOptions, Result, StoreFailure } from '../types.ts';

type ListDevicesInput = {};
type ListDevicesOutput = Result<RegisteredDevice[], StoreFailure>;

type GetDeviceInput = { deviceId: string };
type GetDeviceOutput = Result<RegisteredDevice, StoreFailure | { reason: 'not_found' }>;

type InsertDeviceInput = { registration: DeviceRegistration; registeredAt: Date };
type InsertDeviceOutput = Result<undefined, StoreFailure | { reason: 'already_exists' }>;

/** Replaces the registration. When it was registered stays. */
type UpdateDeviceInput = { registration: DeviceRegistration };
type UpdateDeviceOutput = Result<undefined, StoreFailure | { reason: 'not_found' }>;

type DeleteDeviceInput = { deviceId: string };
type DeleteDeviceOutput = Result<undefined, StoreFailure | { reason: 'not_found' }>;

type DeviceDatastore = {
  listDevices: (input: ListDevicesInput, options: CallOptions) => Promise<ListDevicesOutput>;
  getDevice: (input: GetDeviceInput, options: CallOptions) => Promise<GetDeviceOutput>;
  insertDevice: (input: InsertDeviceInput, options: CallOptions) => Promise<InsertDeviceOutput>;
  updateDevice: (input: UpdateDeviceInput, options: CallOptions) => Promise<UpdateDeviceOutput>;
  deleteDevice: (input: DeleteDeviceInput, options: CallOptions) => Promise<DeleteDeviceOutput>;
};

export type { DeviceDatastore };
