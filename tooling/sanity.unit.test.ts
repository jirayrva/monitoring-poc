import assert from 'node:assert/strict';
import { it } from 'node:test';

// Gives the tools a file to work on before there is code, as some fail on a project with none.
it('runs the tests', () => {
  assert.ok(true);
});
