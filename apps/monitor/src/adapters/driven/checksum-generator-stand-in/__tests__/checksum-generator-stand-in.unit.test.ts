import assert from 'node:assert/strict';
import { it } from 'node:test';
import { testChecksumGeneratorContract } from '../../../../core/ports/driven/testing/checksum-generator.contract.ts';
import { createChecksumGeneratorStandIn } from '../index.ts';

testChecksumGeneratorContract('stand-in', createChecksumGeneratorStandIn);

it('names itself a stand-in, so a match is never taken for the vendor binary', () => {
  // Act
  const { info } = createChecksumGeneratorStandIn();

  // Assert
  assert.equal(info.standIn, true);
});
