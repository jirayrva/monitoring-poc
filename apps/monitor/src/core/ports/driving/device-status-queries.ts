import type { DeviceStatus } from '../../domain/device-status.ts';
import type { CallOptions, Result, StoreFailure } from '../types.ts';

type ListLatestStatusesInput = {};
type ListLatestStatusesOutput = Result<DeviceStatus[], StoreFailure>;

type DeviceStatusQueries = {
  listLatestStatuses: (input: ListLatestStatusesInput, options: CallOptions) => Promise<ListLatestStatusesOutput>;
};

export type { DeviceStatusQueries, ListLatestStatusesInput, ListLatestStatusesOutput };
