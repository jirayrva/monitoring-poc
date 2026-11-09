import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createApplication } from '../index.ts';

const unused = () => Promise.reject(new Error('not called by a skipped round'));

it('skips probing once monitoring is stopped, as both share the rounds', async () => {
  // Arrange
  const { monitoring, deviceProbes } = createApplication({
    deviceDatastore: {
      listDevices: unused,
      getDevice: unused,
      insertDevice: unused,
      updateDevice: unused,
      deleteDevice: unused,
    },
    deviceStatusDatastore: { appendStatus: unused, listLatestStatuses: unused },
    deviceHealthReader: { readHealth: unused },
    deviceDiagnosticsReaders: [],
    checksumGenerator: { info: { name: 'none', version: '0', standIn: true }, generateChecksum: unused },
    now: () => new Date(),
    random: Math.random,
    policy: {
      downProbeThreshold: 3,
      maxConcurrentProbes: 1,
      healthAttemptTimeoutMs: 1000,
      healthBudgetMs: 1000,
      diagnosticsAttemptTimeoutMs: 1000,
      diagnosticsBudgetMs: 1000,
      checksumTimeoutMs: 1000,
      retry: { retries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    },
  });

  // Act
  monitoring.stopMonitoring({});
  const result = await deviceProbes.probeDevices({}, { signal: new AbortController().signal });

  // Assert
  assert.deepEqual(result, { ok: true, value: { round: 'skipped' } });
});
