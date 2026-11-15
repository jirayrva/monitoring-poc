import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const repoRoot = join(import.meta.dirname, '..', '..', '..');

const composeArgs = [
  'compose',
  // Its own project, so a stack you are running is left alone.
  '--project-name',
  'monitor-e2e',
  '--file',
  join(repoRoot, 'compose.yaml'),
  '--file',
  join(import.meta.dirname, 'compose.e2e.yaml'),
];

const compose = async (...args: string[]) => {
  const { stdout } = await run('docker', [...composeArgs, ...args], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
};

const composeOutcome = (...args: string[]) =>
  new Promise<{ code: number; output: string }>((resolve) => {
    execFile('docker', [...composeArgs, ...args], { cwd: repoRoot }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, output: `${stdout}${stderr}` });
    });
  });

const urlOf = async (service: string, port: number) => `http://${await compose('port', service, String(port))}`;

const down = async () => {
  await compose('down', '--volumes', '--remove-orphans', '--rmi', 'local');
};

/**
 * The whole stack in Compose, as `docker compose up` runs it, with the short times of compose.e2e.yaml. Tests reach it
 * only from outside: the monitor's API, the simulator's control API, and psql for what only the database shows.
 * Disposing it removes it with its data and images, and so does a start that fails.
 */
const startStack = async () => {
  // Whatever an earlier run left goes first, so every run starts from an empty database.
  await down();
  const resources = new AsyncDisposableStack();
  resources.defer(down);
  try {
    await compose('up', '--detach', '--wait', '--build');
    return {
      monitorUrl: await urlOf('monitor', 3000),
      controlUrl: await urlOf('simulator', 4101),
      /** Where the monitor's container reaches a simulated device. */
      deviceUrl: (deviceId: string) => `http://simulator:4100/devices/${deviceId}`,
      /** Restarts a service and waits until it is healthy again. It may be published on another port then. */
      restart: async (service: string) => {
        await compose('restart', service);
        await compose('up', '--detach', '--wait', service);
      },
      urlOf,
      stopMonitor: async () => {
        const startedAt = performance.now();
        await compose('stop', '--timeout', '30', 'monitor');
        const elapsedMs = performance.now() - startedAt;
        const container = await compose('ps', '--all', '--quiet', 'monitor');
        const { stdout } = await run('docker', ['inspect', '--format', '{{.State.ExitCode}}', container]);
        return { exitCode: Number(stdout.trim()), elapsedMs };
      },
      runMonitor: (env: Record<string, string>) =>
        composeOutcome(
          'run',
          '--rm',
          '--no-deps',
          ...Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
          'monitor',
        ),
      sql: (query: string) =>
        compose('exec', '-T', 'postgres', 'psql', '--username=monitor', '--tuples-only', '--no-align', '-c', query),
      logs: (service: string) => compose('logs', '--no-color', service),
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
};

type Stack = Awaited<ReturnType<typeof startStack>>;

export { startStack };
export type { Stack };
