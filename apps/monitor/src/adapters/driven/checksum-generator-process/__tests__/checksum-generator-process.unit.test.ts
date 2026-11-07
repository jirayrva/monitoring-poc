import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { testChecksumGeneratorContract } from '../../../../core/ports/driven/testing/checksum-generator.contract.ts';
import { createChecksumGeneratorProcess } from '../index.ts';
import type { ChecksumGeneratorProcessConfig } from '../index.ts';

const fakeBinary = join(import.meta.dirname, '..', 'testing', 'fake-binary.ts');

/** Node, running the fake binary in this mode, with the algorithm of each call as its last argument. */
const generatorFor = (mode: string, config: Partial<ChecksumGeneratorProcessConfig> = {}) =>
  createChecksumGeneratorProcess({
    path: process.execPath,
    args: [fakeBinary, mode, '{algorithm}'],
    algorithms: ['sha256', 'md5'],
    env: {},
    version: '1.0.0',
    ...config,
  });

const abc = new TextEncoder().encode('abc');
const options = { signal: AbortSignal.timeout(5000) };

testChecksumGeneratorContract('process', () => generatorFor('hash'));

describe('ChecksumGenerator as a process', () => {
  it('names the binary and its version, and is no stand-in', () => {
    // Act
    const { info } = generatorFor('hash');

    // Assert
    assert.deepEqual(info, { name: 'node', version: '1.0.0', standIn: false });
  });

  it('passes the algorithm of each call in place of {algorithm}', async () => {
    // Act
    const result = await generatorFor('hash').generateChecksum({ algorithm: 'md5', payload: abc }, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: { checksum: '900150983cd24fb0d6963f7d28e17f72' } });
  });

  it('reports unsupported_algorithm, without running the binary, for an algorithm not in its list', async () => {
    // Act
    const result = await generatorFor('fail').generateChecksum({ algorithm: 'sha1', payload: abc }, options);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'unsupported_algorithm' } });
  });

  it('returns hex in lowercase, whatever case the binary prints', async () => {
    // Act
    const result = await generatorFor('upper').generateChecksum({ algorithm: 'md5', payload: abc }, options);

    // Assert
    assert.deepEqual(result, { ok: true, value: { checksum: '900150983cd24fb0d6963f7d28e17f72' } });
  });

  it('gives the binary only the environment it is configured with', async () => {
    // Act
    const result = await generatorFor('env', { env: { VENDOR_LICENCE: 'x' } }).generateChecksum(
      { algorithm: 'sha256', payload: abc },
      options,
    );

    // Assert
    assert.ok(result.ok);
    assert.equal(Buffer.from(result.value.checksum, 'hex').toString(), 'VENDOR_LICENCE');
  });

  it('copes with a binary that answers without reading its stdin', async () => {
    // Act
    const result = await generatorFor('ignore-stdin').generateChecksum(
      { algorithm: 'sha256', payload: new Uint8Array(1024 * 1024) },
      options,
    );

    // Assert
    assert.deepEqual(result, { ok: true, value: { checksum: 'abc123' } });
  });

  const failures: [string, string][] = [
    ['fail', 'failed'],
    ['garbage', 'invalid_output'],
    ['two-lines', 'invalid_output'],
    ['flood', 'invalid_output'],
  ];
  for (const [mode, reason] of failures) {
    it(`reports ${reason} for a binary that does "${mode}"`, async () => {
      // Act
      const result = await generatorFor(mode).generateChecksum({ algorithm: 'sha256', payload: abc }, options);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason } });
    });
  }

  it('reports generator_unavailable for a binary that cannot run', async () => {
    // Act
    const result = await generatorFor('hash', { path: '/no/such/binary' }).generateChecksum(
      { algorithm: 'sha256', payload: abc },
      options,
    );

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'generator_unavailable' } });
  });

  it(
    'kills a binary that hangs when the signal ends, and reports timeout once it is gone',
    { timeout: 5000 },
    async (t) => {
      // Arrange
      const directory = await mkdtemp(join(tmpdir(), 'checksum-'));
      t.after(() => rm(directory, { recursive: true }));
      const pidFile = join(directory, 'pid');

      // Act
      const result = await generatorFor('hang', { env: { PID_FILE: pidFile } }).generateChecksum(
        { algorithm: 'sha256', payload: abc },
        { signal: AbortSignal.timeout(500) },
      );

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
      const pid = Number(await readFile(pidFile, 'utf8'));
      // Signal 0 only checks that the process exists.
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    },
  );
});
