import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';
import { runService } from '../run-service.ts';
import type { ServiceProcess, StartService } from '../run-service.ts';

const harness = () => {
  const emitter = new EventEmitter();
  const exit = mock.fn<ServiceProcess['exit']>();
  const process: ServiceProcess = {
    on: (event, listener) => emitter.on(event, listener),
    exit,
    exitCode: undefined,
  };
  const logged: string[] = [];
  const log = (_details: object, message: string) => {
    logged.push(message);
  };
  return {
    process,
    exit,
    logged,
    run: (start: StartService, shutdownTimeoutMs = 5000) =>
      runService(start, { logger: { info: log, error: log }, process, shutdownTimeoutMs }),
    signal: (signal: NodeJS.Signals) => emitter.emit(signal, signal),
  };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('runService', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`releases what started in reverse order on ${signal}`, async () => {
      // Arrange
      const { process, logged, run, signal: send } = harness();
      const released: string[] = [];
      const running = run(async (resources) => {
        for (const name of ['datastore', 'api', 'heartbeat']) {
          resources.defer(() => {
            released.push(name);
          });
        }
      });
      await settle();

      // Act
      send(signal);
      await running;

      // Assert
      assert.deepEqual(released, ['heartbeat', 'api', 'datastore']);
      assert.deepEqual(logged, ['Started', 'Stopping', 'Stopped']);
      assert.equal(process.exitCode, undefined);
    });
  }

  it('waits for a signal before releasing anything', async () => {
    // Arrange
    const { run } = harness();
    let released = false;

    // Act
    void run(async (resources) => {
      resources.defer(() => {
        released = true;
      });
    });
    await settle();

    // Assert
    assert.equal(released, false);
  });

  it('releases every resource when some fail, logs each failure, and exits 1', async () => {
    // Arrange
    const { process, logged, run, signal } = harness();
    const released: string[] = [];
    const running = run(async (resources) => {
      resources.defer(() => {
        released.push('datastore');
      });
      resources.defer(() => {
        throw new Error('api');
      });
      resources.defer(() => {
        throw new Error('heartbeat');
      });
    });
    await settle();

    // Act
    signal('SIGTERM');
    await running;

    // Assert
    assert.deepEqual(released, ['datastore']);
    assert.deepEqual(logged, ['Started', 'Stopping', 'Could not stop cleanly', 'Could not stop cleanly']);
    assert.equal(process.exitCode, 1);
  });

  it('releases what had started when startup fails, without waiting for a signal, and exits 1', async () => {
    // Arrange
    const { process, logged, run } = harness();
    const released: string[] = [];

    // Act
    await run(async (resources) => {
      resources.defer(() => {
        released.push('datastore');
      });
      throw new Error('the API could not listen');
    });

    // Assert
    assert.deepEqual(released, ['datastore']);
    assert.deepEqual(logged, ['Could not start']);
    assert.equal(process.exitCode, 1);
  });

  it('exits 1 at once on a second signal while stopping', async () => {
    // Arrange
    const { exit, logged, run, signal } = harness();
    const stuck = Promise.withResolvers<void>();
    void run(async (resources) => {
      resources.defer(() => stuck.promise);
    });
    await settle();
    signal('SIGTERM');
    await settle();

    // Act
    signal('SIGINT');

    // Assert
    assert.deepEqual(
      exit.mock.calls.map((call) => call.arguments),
      [[1]],
    );
    assert.deepEqual(logged, ['Started', 'Stopping', 'Stopping at once: asked again while stopping']);
    stuck.resolve();
  });

  it('changes nothing on a signal after it has stopped, as the process exits', async () => {
    // Arrange
    const { process, exit, logged, run, signal } = harness();
    const running = run(async () => {});
    await settle();
    signal('SIGTERM');
    await running;

    // Act
    signal('SIGINT');

    // Assert
    assert.equal(exit.mock.callCount(), 0);
    assert.equal(process.exitCode, undefined);
    assert.deepEqual(logged, ['Started', 'Stopping', 'Stopped']);
  });

  it('exits 1 at once when releasing takes longer than the shutdown timeout', { timeout: 5000 }, async () => {
    // Arrange
    const { exit, logged, run, signal } = harness();
    const stuck = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    exit.mock.mockImplementation(() => exited.resolve());
    void run(async (resources) => {
      resources.defer(() => stuck.promise);
    }, 50);
    await settle();

    // Act
    signal('SIGTERM');
    await exited.promise;

    // Assert
    assert.deepEqual(
      exit.mock.calls.map((call) => call.arguments),
      [[1]],
    );
    assert.deepEqual(logged, ['Started', 'Stopping', 'Stopping at once: not stopped within the shutdown timeout']);
    stuck.resolve();
  });

  it('leaves no shutdown timeout behind once it has stopped', async () => {
    // Arrange
    const { exit, run, signal } = harness();
    const running = run(async () => {}, 20);
    await settle();

    // Act
    signal('SIGTERM');
    await running;
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    assert.equal(exit.mock.callCount(), 0);
  });
});
