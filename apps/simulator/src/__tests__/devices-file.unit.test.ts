import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { defaults } from '../device.ts';
import { readDevicesFile } from '../devices-file.ts';

describe('readDevicesFile', () => {
  it('plays each device from the defaults and its simulated settings, and keeps what a monitor needs', async () => {
    // Arrange
    const path = join(await mkdtemp(join(tmpdir(), 'simulator-')), 'devices.json');
    const entry = { deviceId: 'lobby', name: 'Lobby', secretRef: 'DEVICE_X', simulated: { health: 'hangs' } };
    await writeFile(path, JSON.stringify({ devices: [entry] }));

    // Act
    const devices = readDevicesFile(path);

    // Assert
    assert.deepEqual(devices, [{ entry, device: { ...defaults('lobby'), health: 'hangs' } }]);
  });

  it('reads the demo devices, each with a name and an ID of its own', () => {
    // Act
    const devices = readDevicesFile(join(import.meta.dirname, '..', '..', 'demo-devices.json'));

    // Assert
    const ids = devices.map(({ device }) => device.deviceId);
    assert.ok(devices.length > 0);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(devices.every(({ entry }) => entry.name !== ''));
  });
});
