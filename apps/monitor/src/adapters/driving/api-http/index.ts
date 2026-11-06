import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemaDirectory } from '@device-monitor/contracts/monitor-api';
import Fastify from 'fastify';
import type { DeviceRegistry } from '../../../core/ports/driving/device-registry.ts';
import { completeApiError, errorHandler, notFoundHandler } from './error-handlers.ts';
import { registerDeviceRegistryRoutes } from './routes/device-registry.ts';

type ApiHttpConfig = { host: string; port: number; logLevel: string };

type ApiHttpDependencies = {
  deviceRegistry: DeviceRegistry;
  config: ApiHttpConfig;
};

type ApiHttp = {
  start: () => Promise<{ url: string }>;
  stop: () => Promise<void>;
};

type ApiHttpFactory = (dependencies: ApiHttpDependencies) => ApiHttp;

const apiPrefix = '/v1';

const createApiHttp: ApiHttpFactory = (dependencies) => {
  const { deviceRegistry, config } = dependencies;
  const { host, port, logLevel } = config;
  const server = Fastify({
    logger: { level: logLevel },
    // A UUID rather than Fastify's counter, so an ID in an error answer finds one request in the log.
    genReqId: () => randomUUID(),
    ajv: { customOptions: { discriminator: true, removeAdditional: false, coerceTypes: false } },
  });

  for (const file of readdirSync(schemaDirectory).filter((name) => name.endsWith('.schema.json'))) {
    server.addSchema(JSON.parse(readFileSync(join(schemaDirectory, file), 'utf8')));
  }

  server.addHook('preSerialization', completeApiError);
  server.setErrorHandler(errorHandler);
  server.setNotFoundHandler(notFoundHandler);
  void server.register(
    (instance, _options, done) => {
      registerDeviceRegistryRoutes(instance, deviceRegistry);
      done();
    },
    { prefix: apiPrefix },
  );

  return {
    start: async () => ({ url: await server.listen({ host, port }) }),
    stop: () => server.close(),
  };
};

export { createApiHttp };
