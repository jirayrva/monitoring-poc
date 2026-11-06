import { testDeviceStatusDatastoreContract } from '../../../../core/ports/driven/testing/device-status-datastore.contract.ts';
import { createDeviceStatusDatastoreInMemory } from '../index.ts';

testDeviceStatusDatastoreContract('in-memory', createDeviceStatusDatastoreInMemory);
