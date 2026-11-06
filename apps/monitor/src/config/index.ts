import { loadConfig } from './load-config.ts';

const config = loadConfig(process.env);

export { config };
