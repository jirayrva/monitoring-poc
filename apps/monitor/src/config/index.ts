import { createDeviceSecretReader } from './device-secrets.ts';
import { loadConfig } from './load-config.ts';

const config = loadConfig(process.env);

const readDeviceSecret = createDeviceSecretReader(process.env);

export { config, readDeviceSecret };
