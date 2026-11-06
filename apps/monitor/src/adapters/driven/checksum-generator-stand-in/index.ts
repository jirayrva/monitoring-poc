import { createHash, getHashes } from 'node:crypto';
import type { ChecksumGenerator } from '../../../core/ports/driven/checksum-generator.ts';

const createChecksumGeneratorStandIn = (): ChecksumGenerator => ({
  info: { name: 'node-crypto', version: process.versions.node, standIn: true },
  generateChecksum: ({ algorithm, payload }, options) => {
    if (options.signal.aborted) {
      return Promise.resolve({ ok: false, failure: { reason: 'timeout' } });
    }
    if (!getHashes().includes(algorithm)) {
      return Promise.resolve({ ok: false, failure: { reason: 'unsupported_algorithm' } });
    }
    return Promise.resolve({ ok: true, value: { checksum: createHash(algorithm).update(payload).digest('hex') } });
  },
});

export { createChecksumGeneratorStandIn };
