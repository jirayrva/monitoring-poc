import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../load-config.ts';

const problemsOf = (env: Record<string, string>) => {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.problems;
  }
};

describe('loadConfig', () => {
  it('uses the defaults when nothing is set, so no setting is required', () => {
    // Act
    const config = loadConfig({});

    // Assert
    assert.deepEqual(config, { host: '127.0.0.1', port: 3000, logLevel: 'info' });
  });

  it('takes the settings that are set', () => {
    // Act
    const config = loadConfig({ HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' });

    // Assert
    assert.deepEqual(config, { host: '0.0.0.0', port: 8080, logLevel: 'debug' });
  });

  it('treats an empty setting as not set', () => {
    // Act
    const config = loadConfig({ PORT: '', LOG_LEVEL: '' });

    // Assert
    assert.partialDeepStrictEqual(config, { port: 3000, logLevel: 'info' });
  });

  it('reports every problem at once, one per line, so one restart is enough to fix them all', () => {
    // Act and assert
    assert.throws(() => loadConfig({ PORT: '70000', LOG_LEVEL: 'loud' }), {
      message: [
        'The configuration has 2 problems:',
        '- PORT must be a whole number from 0 to 65535, not "70000"',
        '- LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent, not "loud"',
      ].join('\n'),
    });
  });

  for (const value of ['http', '80.5', '-1']) {
    it(`reports PORT=${value}`, () => {
      // Act
      const problems = problemsOf({ PORT: value });

      // Assert
      assert.deepEqual(problems, [`PORT must be a whole number from 0 to 65535, not "${value}"`]);
    });
  }
});
