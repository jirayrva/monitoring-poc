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
      checksumGenerator: { kind: 'stand-in' },
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
  describe('checksum generator', () => {
    // Any executable file will do: loadConfig only checks that it can be run.
    const binary = process.execPath;

    it('runs the binary with its arguments, algorithms, version, and CHECKSUM_ENV_<NAME> as <NAME>', () => {
      // Act
      const config = loadConfig({
        CHECKSUM_BINARY_PATH: binary,
        CHECKSUM_BINARY_ARGS: '["--algo", "{algorithm}", "--config", "/opt/vendor/my checksum.conf"]',
        CHECKSUM_BINARY_ALGORITHMS: 'sha256, md5',
        CHECKSUM_BINARY_VERSION: '1.2.0',
        CHECKSUM_ENV_LICENSE_KEY: 'abc',
        PATH: '/usr/bin',
      });

      // Assert
      assert.deepEqual(config.checksumGenerator, {
        kind: 'binary',
        path: binary,
        args: ['--algo', '{algorithm}', '--config', '/opt/vendor/my checksum.conf'],
        algorithms: ['sha256', 'md5'],
        version: '1.2.0',
        env: { LICENSE_KEY: 'abc' },
      });
    });

    it('names the version unknown when it is not set', () => {
      // Act
      const config = loadConfig({ CHECKSUM_BINARY_PATH: binary, CHECKSUM_BINARY_ALGORITHMS: 'sha256' });

      // Assert
      assert.partialDeepStrictEqual(config.checksumGenerator, { version: 'unknown', args: [], env: {} });
    });

    const badPaths: [why: string, path: string, problem: string][] = [
      ['relative', 'bin/checksum', 'CHECKSUM_BINARY_PATH must be an absolute path, not "bin/checksum"'],
      ['missing', '/no/such/binary', 'CHECKSUM_BINARY_PATH must be an executable file, and "/no/such/binary" is not'],
      [
        'not executable',
        import.meta.filename,
        `CHECKSUM_BINARY_PATH must be an executable file, and "${import.meta.filename}" is not`,
      ],
      [
        'a directory',
        import.meta.dirname,
        `CHECKSUM_BINARY_PATH must be an executable file, and "${import.meta.dirname}" is not`,
      ],
    ];
    for (const [why, path, problem] of badPaths) {
      it(`reports a CHECKSUM_BINARY_PATH that is ${why}, so the service never starts with a binary it cannot run`, () => {
        // Act
        const problems = problemsOf({ CHECKSUM_BINARY_PATH: path, CHECKSUM_BINARY_ALGORITHMS: 'sha256' });

        // Assert
        assert.deepEqual(problems, [problem]);
      });
    }

    it('reports a binary with no algorithms, as it would never be run', () => {
      // Act
      const problems = problemsOf({ CHECKSUM_BINARY_PATH: binary, CHECKSUM_BINARY_ALGORITHMS: ' , ' });

      // Assert
      assert.deepEqual(problems, [
        'CHECKSUM_BINARY_ALGORITHMS must list the algorithms the binary supports, such as sha256,md5',
      ]);
    });

    for (const value of ['--algo sha256', '"--algo"', '[1, 2]', '{"algo": "sha256"}']) {
      it(`reports CHECKSUM_BINARY_ARGS that is not a JSON array of strings: ${value}`, () => {
        // Act
        const problems = problemsOf({
          CHECKSUM_BINARY_PATH: binary,
          CHECKSUM_BINARY_ALGORITHMS: 'sha256',
          CHECKSUM_BINARY_ARGS: value,
        });

        // Assert
        assert.deepEqual(problems, [
          `CHECKSUM_BINARY_ARGS must be a JSON array of strings, such as ["--algo", "{algorithm}"], not ${value}`,
        ]);
      });
    }

    it('reports CHECKSUM_ENV_ with no name after it', () => {
      // Act
      const problems = problemsOf({
        CHECKSUM_BINARY_PATH: binary,
        CHECKSUM_BINARY_ALGORITHMS: 'sha256',
        CHECKSUM_ENV_: 'x',
      });

      // Assert
      assert.deepEqual(problems, ['CHECKSUM_ENV_ must be followed by the name of a variable for the binary']);
    });

    it('reports a setting for the binary without one, so a mistake does not pass unnoticed', () => {
      // Act
      const problems = problemsOf({
        CHECKSUM_BINARY_ARGS: '["-v"]',
        CHECKSUM_BINARY_ALGORITHMS: 'sha256',
        CHECKSUM_BINARY_VERSION: '1.2.0',
        CHECKSUM_ENV_LICENSE_KEY: 'abc',
      });

      // Assert
      assert.deepEqual(problems, [
        'CHECKSUM_BINARY_ARGS applies only with CHECKSUM_BINARY_PATH',
        'CHECKSUM_BINARY_ALGORITHMS applies only with CHECKSUM_BINARY_PATH',
        'CHECKSUM_BINARY_VERSION applies only with CHECKSUM_BINARY_PATH',
        'CHECKSUM_ENV_LICENSE_KEY applies only with CHECKSUM_BINARY_PATH',
      ]);
    });

    it('reports a CHECKSUM_ variable that is no setting', () => {
      // Act
      const problems = problemsOf({ CHECKSUM_BINARY: '/opt/vendor/checksum' });

      // Assert
      assert.deepEqual(problems, ['CHECKSUM_BINARY is not a setting']);
    });
  });
});
