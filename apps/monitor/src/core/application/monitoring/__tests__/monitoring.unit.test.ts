import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMonitoring } from '../index.ts';

describe('Monitoring', () => {
  it('starts as running, and lets a round start', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();

    // Act
    const started = rounds.startRound();

    // Assert
    assert.deepEqual(monitoring.getMonitoringState({}), { state: 'running' });
    assert.equal(started, true);
  });

  it('stops at once between rounds, and starts no round while stopped', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();

    // Act
    monitoring.stopMonitoring({});

    // Assert
    assert.deepEqual(monitoring.getMonitoringState({}), { state: 'stopped' });
    assert.equal(rounds.startRound(), false);
  });

  it('is stopping until the round in progress ends, then stopped', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();
    rounds.startRound();

    // Act
    monitoring.stopMonitoring({});
    const during = monitoring.getMonitoringState({});
    rounds.endRound();

    // Assert
    assert.deepEqual(during, { state: 'stopping' });
    assert.deepEqual(monitoring.getMonitoringState({}), { state: 'stopped' });
  });

  it('starts no round while stopping', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();
    rounds.startRound();
    monitoring.stopMonitoring({});

    // Act
    const started = rounds.startRound();

    // Assert
    assert.equal(started, false);
  });

  it('runs again when started while stopping, and stays running once the round ends', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();
    rounds.startRound();
    monitoring.stopMonitoring({});

    // Act
    monitoring.startMonitoring({});
    rounds.endRound();

    // Assert
    assert.deepEqual(monitoring.getMonitoringState({}), { state: 'running' });
    assert.equal(rounds.startRound(), true);
  });

  it('runs again when started after stopping', () => {
    // Arrange
    const { monitoring, rounds } = createMonitoring();
    monitoring.stopMonitoring({});

    // Act
    monitoring.startMonitoring({});

    // Assert
    assert.deepEqual(monitoring.getMonitoringState({}), { state: 'running' });
    assert.equal(rounds.startRound(), true);
  });
});
