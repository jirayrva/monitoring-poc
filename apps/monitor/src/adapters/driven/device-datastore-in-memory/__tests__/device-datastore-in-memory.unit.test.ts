import { testDeviceDatastoreContract } from '../../../../core/ports/driven/testing/device-datastore.contract.ts';
import { createDeviceDatastoreInMemory } from '../index.ts';

testDeviceDatastoreContract('in-memory', createDeviceDatastoreInMemory);
