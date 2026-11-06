import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChecksumGenerator } from '../checksum-generator.ts';

const options = { signal: new AbortController().signal };

/** The SHA-256 test vector from FIPS 180-2: the checksum of "abc". */
const abc = {
  payload: new TextEncoder().encode('abc'),
  checksum: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

const testChecksumGeneratorContract = (adapterName: string, createGenerator: () => ChecksumGenerator) => {
  describe(`ChecksumGenerator contract: ${adapterName}`, () => {
    it("returns the payload's checksum in lowercase hex", async () => {
      // Arrange
      const generator = createGenerator();

      // Act
      const result = await generator.generateChecksum({ algorithm: 'sha256', payload: abc.payload }, options);

      // Assert
      assert.deepEqual(result, { ok: true, value: { checksum: abc.checksum } });
    });

    it('reports unsupported_algorithm for an algorithm it does not know', async () => {
      // Arrange
      const generator = createGenerator();

      // Act
      const result = await generator.generateChecksum({ algorithm: 'no-such-hash', payload: abc.payload }, options);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason: 'unsupported_algorithm' } });
    });

    it('reports timeout for a call whose signal has already ended', async () => {
      // Arrange
      const generator = createGenerator();

      // Act
      const result = await generator.generateChecksum(
        { algorithm: 'sha256', payload: abc.payload },
        { signal: AbortSignal.abort() },
      );

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
    });
  });
};

export { testChecksumGeneratorContract };
