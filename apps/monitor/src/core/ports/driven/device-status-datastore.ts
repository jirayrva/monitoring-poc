import type { DeviceStatus } from '../../domain/device-status.ts';
import type { CallOptions, Result, StoreFailure } from '../types.ts';

type AppendStatusInput = { status: DeviceStatus };
type AppendStatusOutput = Result<undefined, StoreFailure>;

type ListLatestStatusesInput = {};
type ListLatestStatusesOutput = Result<DeviceStatus[], StoreFailure>;

type DeviceStatusDatastore = {
  appendStatus: (input: AppendStatusInput, options: CallOptions) => Promise<AppendStatusOutput>;
  listLatestStatuses: (input: ListLatestStatusesInput, options: CallOptions) => Promise<ListLatestStatusesOutput>;
};

export type { DeviceStatusDatastore };
