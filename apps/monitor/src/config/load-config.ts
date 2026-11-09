import { readChecksumGenerator } from './checksum-generator.ts';
import { createEnvReader } from './env.ts';
import type { Environment, EnvReader } from './env.ts';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Every variable under these is one of the settings below, so any other is a typo. */
const settingPrefixes = ['CHECKSUM_', 'DATASTORE_', 'MONITORING_'];

/** A plain lowercase SQL identifier, so it needs no quoting in SQL or in a search_path option. */
const schemaName = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * The schema that holds the service's tables. Never public: the service keeps its tables, and the history of its
 * migrations, apart from whatever else the database holds.
 */
const readDatastoreSchema = (read: EnvReader) => {
  const fallback = 'monitor';
  const value = read.text('DATASTORE_SCHEMA');
  if (value === undefined) {
    return fallback;
  }
  if (!schemaName.test(value)) {
    read.report(`DATASTORE_SCHEMA must be lowercase letters, digits and underscores, not "${value}"`);
    return fallback;
  }
  if (value === 'public') {
    read.report('DATASTORE_SCHEMA must not be public');
    return fallback;
  }
  return value;
};

class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
    super([`The configuration has ${count}:`, ...problems.map((each) => `- ${each}`)].join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const loadConfig = (env: Environment) => {
  const read = createEnvReader(env);
  const config = {
    host: read.text('HOST') ?? '127.0.0.1',
    port: read.number('PORT', 3000, { whole: true, max: 65_535 }),
    logLevel: read.oneOf('LOG_LEVEL', logLevels, 'info'),
    datastore: {
      connectionString: read.text('DATASTORE_CONNECTION_STRING') ?? 'postgres://monitor:monitor@127.0.0.1:5432/monitor',
      schema: readDatastoreSchema(read),
      connectionTimeoutMs: read.number('DATASTORE_CONNECTION_TIMEOUT_MS', 5000),
      queryTimeoutMs: read.number('DATASTORE_QUERY_TIMEOUT_MS', 5000),
    },
    monitoring: {
      intervalMs: read.number('MONITORING_INTERVAL_MS', 30_000),
      downProbeThreshold: read.number('MONITORING_DOWN_PROBE_THRESHOLD', 3, { min: 1, whole: true }),
      maxConcurrentProbes: read.number('MONITORING_MAX_CONCURRENT_PROBES', 250, { min: 1, whole: true }),
      healthAttemptTimeoutMs: read.number('MONITORING_HEALTH_ATTEMPT_TIMEOUT_MS', 3000, { min: 1 }),
      healthBudgetMs: read.number('MONITORING_HEALTH_BUDGET_MS', 7000, { min: 1 }),
      diagnosticsAttemptTimeoutMs: read.number('MONITORING_DIAGNOSTICS_ATTEMPT_TIMEOUT_MS', 3000, { min: 1 }),
      diagnosticsBudgetMs: read.number('MONITORING_DIAGNOSTICS_BUDGET_MS', 7000, { min: 1 }),
      checksumTimeoutMs: read.number('MONITORING_CHECKSUM_TIMEOUT_MS', 2000, { min: 1 }),
      // One retry, after up to a second, fits the health budget (D-37).
      retry: {
        retries: read.number('MONITORING_RETRY_COUNT', 1, { whole: true }),
        baseDelayMs: read.number('MONITORING_RETRY_BASE_DELAY_MS', 1000),
        maxDelayMs: read.number('MONITORING_RETRY_MAX_DELAY_MS', 4000),
      },
    },
    checksumGenerator: readChecksumGenerator(read, env),
  };

  read.reportUnknown(settingPrefixes);
  const problems = read.problems();
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
};

export { ConfigError, loadConfig };
