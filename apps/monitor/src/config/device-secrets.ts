import type { Environment } from './env.ts';

/**
 * Reads the token a device's secretRef names, from the environment. Only DEVICE_ variables, so a registration can
 * never read the service's own settings (D-38).
 */
const createDeviceSecretReader =
  (env: Environment) =>
  (name: string): string | undefined =>
    name.startsWith('DEVICE_') ? env[name] : undefined;

export { createDeviceSecretReader };
