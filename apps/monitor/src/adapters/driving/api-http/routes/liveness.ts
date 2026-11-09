import type { FastifyInstance } from 'fastify';

/**
 * GET /livez, for a container healthcheck: it answers while the service can serve requests, and never asks a store,
 * so a database outage does not make the service look dead.
 */
const registerLivenessRoute = (instance: FastifyInstance) => {
  instance.get(
    '/livez',
    {
      // Healthchecks call it every few seconds, which would bury the other requests in the log.
      logLevel: 'silent',
      schema: {
        operationId: 'checkLiveness',
        summary: 'Check liveness',
        description: 'Answers 200 while the service can serve requests. It never asks the database.',
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { const: 'ok' } },
          },
        },
      },
    },
    () => ({ status: 'ok' as const }),
  );
};

export { registerLivenessRoute };
