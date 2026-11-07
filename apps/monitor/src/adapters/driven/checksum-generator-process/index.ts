import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type {
  ChecksumFailure,
  ChecksumGenerator,
  GenerateChecksumOutput,
} from '../../../core/ports/driven/checksum-generator.ts';

type ChecksumGeneratorProcessConfig = {
  path: string;
  args: string[];
  algorithms: string[];
  /** Its whole environment, so it never sees the service's own, with its secrets. */
  env: Record<string, string>;
  version: string;
};

/** Far more than any checksum, so a binary that floods stdout is cut off rather than buffered. */
const maxOutputBytes = 4096;

/** A checksum line: hex first, then anything, as sha256sum prints `<hex>  -` for stdin. */
const checksumLine = /^([0-9a-f]+)(?:\s.*)?$/i;

const fail = (reason: ChecksumFailure['reason']) => ({ ok: false, failure: { reason } }) as const;

const parseChecksum = (output: string) => {
  const lines = output.trim().split(/\r?\n/);
  return lines.length === 1 ? checksumLine.exec(lines[0] ?? '')?.[1]?.toLowerCase() : undefined;
};

/**
 * Generates checksums by running a binary, as the vendor's is assumed to work (Q-07): the payload goes to its stdin,
 * and it prints the checksum in hex on stdout and exits 0. A new process for every checksum, so one that crashes or
 * hangs affects only that probe. The caller's signal kills it. stderr is ignored.
 */
const createChecksumGeneratorProcess = (config: ChecksumGeneratorProcessConfig): ChecksumGenerator => {
  const { path, args, algorithms, env, version } = config;
  return {
    info: { name: basename(path), version, standIn: false },
    generateChecksum: ({ algorithm, payload }, { signal }) =>
      new Promise<GenerateChecksumOutput>((resolve) => {
        if (signal.aborted) {
          resolve(fail('timeout'));
          return;
        }
        if (!algorithms.includes(algorithm)) {
          resolve(fail('unsupported_algorithm'));
          return;
        }

        // SIGKILL, so a binary that ignores SIGTERM cannot linger.
        const child = spawn(
          path,
          args.map((arg) => arg.replaceAll('{algorithm}', algorithm)),
          { env, signal, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'ignore'] },
        );
        const chunks: Buffer[] = [];
        let size = 0;
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxOutputBytes) {
            child.kill('SIGKILL');
            return;
          }
          chunks.push(chunk);
        });
        // A binary may exit before reading all of its stdin: its exit code judges.
        child.stdin.on('error', () => {});

        // A binary that cannot be run at all, such as one that is missing. On the signal's kill, close settles the
        // promise once the process has exited, so none outlives the call.
        child.once('error', () => {
          if (!signal.aborted) {
            resolve(fail('generator_unavailable'));
          }
        });
        child.once('close', (code) => {
          if (signal.aborted) {
            resolve(fail('timeout'));
          } else if (size > maxOutputBytes) {
            resolve(fail('invalid_output'));
          } else if (code !== 0) {
            resolve(fail('failed'));
          } else {
            const checksum = parseChecksum(Buffer.concat(chunks).toString('utf8'));
            resolve(checksum === undefined ? fail('invalid_output') : { ok: true, value: { checksum } });
          }
        });

        child.stdin.end(payload);
      }),
  };
};

export { createChecksumGeneratorProcess };
export type { ChecksumGeneratorProcessConfig };
