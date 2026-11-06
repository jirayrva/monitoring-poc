import type { ChecksumGeneratorInfo, ChecksumResult } from '../../domain/device-report.ts';
import type { CallOptions, Result } from '../types.ts';

type GenerateChecksumInput = { algorithm: string; payload: Uint8Array };

type ChecksumFailure = { reason: Extract<ChecksumResult, { comparison: 'unavailable' }>['reason'] };

type GenerateChecksumOutput = Result<{ checksum: string }, ChecksumFailure>;

type ChecksumGenerator = {
  info: ChecksumGeneratorInfo;
  generateChecksum: (input: GenerateChecksumInput, options: CallOptions) => Promise<GenerateChecksumOutput>;
};

export type { ChecksumFailure, ChecksumGenerator, GenerateChecksumInput, GenerateChecksumOutput };
