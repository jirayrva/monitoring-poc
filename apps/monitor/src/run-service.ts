type Log = (details: object, message: string) => void;

type ServiceLogger = { info: Log; error: Log };

type ServiceProcess = {
  on: (event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  exit: (code: number) => void;
  exitCode: number | string | null | undefined;
};

type StartService = (resources: AsyncDisposableStack) => Promise<void>;

const signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const errorsIn = (error: unknown): unknown[] =>
  error instanceof SuppressedError ? [...errorsIn(error.suppressed), ...errorsIn(error.error)] : [error];

type RunServiceOptions = {
  logger: ServiceLogger;
  process: ServiceProcess;
  shutdownTimeoutMs: number;
};

/**
 * Runs the service until SIGINT or SIGTERM, then releases what it started, in reverse order (I-08). Each resource is
 * released even when another fails. A startup that fails releases what had started. Any failure is logged and makes
 * the exit code 1. Releasing past shutdownTimeoutMs, or a second signal while stopping, such as Ctrl-C twice, exits 1
 * at once, with a log line, rather than be killed without one.
 */
const runService = async (start: StartService, options: RunServiceOptions) => {
  const { logger, process, shutdownTimeoutMs } = options;
  const stopRequested = Promise.withResolvers<NodeJS.Signals>();
  let phase: 'running' | 'stopping' | 'stopped' = 'running';
  for (const each of signals) {
    process.on(each, (signal) => {
      if (phase === 'stopping') {
        logger.error({ signal }, 'Stopping at once: asked again while stopping');
        process.exit(1);
      }
      phase = 'stopping';
      stopRequested.resolve(signal);
    });
  }

  let failed = false;
  const resources = new AsyncDisposableStack();
  try {
    await start(resources);
    logger.info({}, 'Started');
    logger.info({ signal: await stopRequested.promise }, 'Stopping');
  } catch (error) {
    failed = true;
    logger.error({ err: error }, 'Could not start');
  }

  const deadline = setTimeout(() => {
    logger.error({ shutdownTimeoutMs }, 'Stopping at once: not stopped within the shutdown timeout');
    process.exit(1);
  }, shutdownTimeoutMs);
  try {
    await resources.disposeAsync();
  } catch (error) {
    failed = true;
    for (const each of errorsIn(error)) {
      logger.error({ err: each }, 'Could not stop cleanly');
    }
  } finally {
    clearTimeout(deadline);
  }
  // A signal that arrives while the process exits changes nothing.
  phase = 'stopped';

  if (failed) {
    process.exitCode = 1;
  } else {
    logger.info({}, 'Stopped');
  }
};

export { runService };
export type { RunServiceOptions, ServiceProcess, StartService };
