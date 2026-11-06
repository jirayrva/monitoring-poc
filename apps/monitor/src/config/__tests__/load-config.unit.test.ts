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
    assert.deepEqual(config, {
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      datastore: {
        connectionString: 'postgres://monitor:monitor@127.0.0.1:5432/monitor',
        schema: 'monitor',
        connectionTimeoutMs: 5000,
        queryTimeoutMs: 5000,
      },
      monitoring: {
        intervalMs: 30_000,
        downProbeThreshold: 3,
        maxConcurrentProbes: 250,
        healthBudgetMs: 7000,
        diagnosticsBudgetMs: 7000,
        checksumTimeoutMs: 2000,
      },
    });
  });

  it('takes the settings that are set', () => {
    // Act
    const config = loadConfig({
      HOST: '0.0.0.0',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATASTORE_SCHEMA: 'fleet',
      DATASTORE_QUERY_TIMEOUT_MS: '1000',
    });

    // Assert
    assert.partialDeepStrictEqual(config, {
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'debug',
      datastore: { schema: 'fleet', queryTimeoutMs: 1000 },
    });
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

  it('reports DATASTORE_CONNECTION_TIMEOUT_MS=soon', () => {
    // Act
    const problems = problemsOf({ DATASTORE_CONNECTION_TIMEOUT_MS: 'soon' });

    // Assert
    assert.deepEqual(problems, ['DATASTORE_CONNECTION_TIMEOUT_MS must be a number of 0 or more, not "soon"']);
  });

  it('reports DATASTORE_SCHEMA=public, so the service never keeps its tables there', () => {
    // Act
    const problems = problemsOf({ DATASTORE_SCHEMA: 'public' });

    // Assert
    assert.deepEqual(problems, ['DATASTORE_SCHEMA must not be public']);
  });

  it('reports a DATASTORE_SCHEMA that would need quoting, since it goes into the search_path', () => {
    // Act
    const problems = problemsOf({ DATASTORE_SCHEMA: 'fleet; drop' });

    // Assert
    assert.deepEqual(problems, [
      'DATASTORE_SCHEMA must be lowercase letters, digits and underscores, not "fleet; drop"',
    ]);
  });

  it('reports a DATASTORE_ variable that is no setting, so a typo does not pass as a default', () => {
    // Act
    const problems = problemsOf({ DATASTORE_URL: 'postgres://db' });

    // Assert
    assert.deepEqual(problems, ['DATASTORE_URL is not a setting']);
  });

  it('reports a MONITORING_ variable that is no setting', () => {
    // Act
    const problems = problemsOf({ MONITORING_INTERVAL: '1000' });

    // Assert
    assert.deepEqual(problems, ['MONITORING_INTERVAL is not a setting']);
  });

  it('reports MONITORING_MAX_CONCURRENT_PROBES=0, as no device would ever be probed', () => {
    // Act
    const problems = problemsOf({ MONITORING_MAX_CONCURRENT_PROBES: '0' });

    // Assert
    assert.deepEqual(problems, ['MONITORING_MAX_CONCURRENT_PROBES must be a whole number of 1 or more, not "0"']);
  });
});
