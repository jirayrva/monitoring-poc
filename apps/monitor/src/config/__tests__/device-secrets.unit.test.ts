import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDeviceSecretReader } from '../device-secrets.ts';

describe('createDeviceSecretReader', () => {
  const readSecret = createDeviceSecretReader({
    DEVICE_DOOR_TOKEN: 'door-secret',
    DATASTORE_CONNECTION_STRING: 'postgres://monitor:monitor@db/monitor',
  });

  it('reads a DEVICE_ variable', () => {
    // Act
    const token = readSecret('DEVICE_DOOR_TOKEN');

    // Assert
    assert.equal(token, 'door-secret');
  });

  it("reads no other variable, so a registration never reads the service's own settings", () => {
    // Act
    const token = readSecret('DATASTORE_CONNECTION_STRING');

    // Assert
    assert.equal(token, undefined);
  });
});
