/**
 * A stand-in for the vendor's binary in tests, run with Node so it works on every OS: `node fake-binary.ts <mode>
 * <algorithm>`. It hashes stdin, or misbehaves as the mode says.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { text } from 'node:stream/consumers';

const [mode, algorithm = 'sha256'] = process.argv.slice(2);

if (mode === 'ignore-stdin') {
  process.stdout.write('abc123\n');
} else {
  const payload = await text(process.stdin);
  const checksum = createHash(algorithm).update(payload).digest('hex');
  const outputs: Record<string, () => void> = {
    hash: () => process.stdout.write(`${checksum}  -\n`),
    upper: () => process.stdout.write(`${checksum.toUpperCase()}\n`),
    fail: () => process.exit(3),
    garbage: () => process.stdout.write('not a checksum\n'),
    'two-lines': () => process.stdout.write(`${checksum}\n${checksum}\n`),
    flood: () => setInterval(() => process.stdout.write('a'.repeat(65_536)), 1),
    // Records its process ID where PID_FILE says, so a test can check it was killed.
    hang: () => {
      const pidFile = process.env['PID_FILE'];
      if (pidFile !== undefined) {
        writeFileSync(pidFile, String(process.pid));
      }
      setInterval(() => {}, 1000);
    },
    // The names of its environment, hex-encoded so they read as a checksum.
    env: () => process.stdout.write(`${Buffer.from(Object.keys(process.env).toSorted().join(',')).toString('hex')}\n`),
  };
  outputs[mode ?? 'hash']?.();
}
