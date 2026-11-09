import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemaDirectory } from '@device-monitor/contracts/monitor-api';
import swagger from '@fastify/swagger';
import apiReference from '@scalar/fastify-api-reference';
import Fastify from 'fastify';
import type { DeviceRegistry } from '../../../core/ports/driving/device-registry.ts';
import type { DeviceStatusQueries } from '../../../core/ports/driving/device-status-queries.ts';
import type { Monitoring } from '../../../core/ports/driving/monitoring.ts';
import { completeApiError, errorHandler, notFoundHandler } from './error-handlers.ts';
import { registerDeviceRegistryRoutes } from './routes/device-registry.ts';
import { registerDeviceStatusQueriesRoutes } from './routes/device-status-queries.ts';
import { registerLivenessRoute } from './routes/liveness.ts';
import { registerMonitoringRoutes } from './routes/monitoring.ts';

type ApiHttpConfig = {
  host: string;
  port: number;
  logLevel: string;
  drainTimeoutMs: number;
};

type ApiHttpDependencies = {
  deviceRegistry: DeviceRegistry;
  deviceStatusQueries: DeviceStatusQueries;
  monitoring: Monitoring;
  config: ApiHttpConfig;
};

/**
 * Disposing it stops it: it takes no new requests, lets those in progress finish for drainTimeoutMs, then cancels their
 * calls, which answer 503, and waits for them to end.
 */
type ApiHttp = AsyncDisposable & {
  start: () => Promise<{ url: string }>;
  openApi: () => Promise<unknown>;
};

type ApiHttpFactory = (dependencies: ApiHttpDependencies) => ApiHttp;

const apiTitle = 'Device Monitor API';

const schemaFileSuffix = '.schema.json';

const apiPrefix = '/v1';

const createApiHttp: ApiHttpFactory = (dependencies) => {
  const { deviceRegistry, deviceStatusQueries, monitoring, config } = dependencies;
  const { host, port, logLevel, drainTimeoutMs } = config;
  const drain = new AbortController();
  let stopping = false;
  const server = Fastify({
    logger: { level: logLevel },
    // A UUID rather than Fastify's counter, so an ID in an error answer finds one request in the log.
    genReqId: () => randomUUID(),
    ajv: { customOptions: { discriminator: true, removeAdditional: false, coerceTypes: false } },
  });

  for (const file of readdirSync(schemaDirectory).filter((name) => name.endsWith(schemaFileSuffix))) {
    server.addSchema(JSON.parse(readFileSync(join(schemaDirectory, file), 'utf8')));
  }

  // While stopping, every answer closes its connection, or a client's kept-alive one would hold the server open.
  server.addHook('onSend', async (_request, reply) => {
    if (stopping) {
      void reply.header('connection', 'close');
    }
  });
  server.addHook('preSerialization', completeApiError);
  server.setErrorHandler(errorHandler);
  server.setNotFoundHandler(notFoundHandler);

  void server.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: apiTitle, version: '0.0.1' },
      // Relative, so the reference's requests go to wherever it was opened from.
      servers: [{ url: '/', description: 'The server this document came from' }],
      // No authentication yet: stated explicitly, so it reads as a decision rather than an omission.
      security: [],
    },
    refResolver: {
      buildLocalReference: (schema, _baseUri, _fragment, index) =>
        typeof schema['$id'] === 'string' ? schema['$id'].replace(schemaFileSuffix, '') : `schema-${index}`,
    },
  });

  void server.register(apiReference, {
    routePrefix: '/docs',
    configuration: { pageTitle: apiTitle, showDeveloperTools: 'never', telemetry: false, agent: { disabled: true } },
  });

  // Registered as a plugin so it loads after @fastify/swagger, which only documents routes added after it.
  void server.register(
    (instance, _options, done) => {
      registerDeviceRegistryRoutes(instance, deviceRegistry, drain.signal);
      registerDeviceStatusQueriesRoutes(instance, deviceStatusQueries, drain.signal);
      registerMonitoringRoutes(instance, monitoring);
      done();
    },
    { prefix: apiPrefix },
  );
  // For the platform, not for clients, so outside the API's version.
  void server.register((instance, _options, done) => {
    registerLivenessRoute(instance);
    done();
  });

  return {
    start: async () => ({ url: await server.listen({ host, port }) }),
    [Symbol.asyncDispose]: async () => {
      stopping = true;
      const drainEnds = setTimeout(() => drain.abort(), drainTimeoutMs);
      try {
        await server.close();
      } finally {
        clearTimeout(drainEnds);
      }
    },
    openApi: async () => {
      await server.ready();
      return server.swagger();
    },
  };
};

export { createApiHttp };
