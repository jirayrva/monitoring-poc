import { createEnvReader } from './env.ts';
import type { Environment } from './env.ts';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

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
  };

  const problems = read.problems();
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return config;
};

export { ConfigError, loadConfig };
