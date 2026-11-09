import type { FastifyInstance } from 'fastify';
import type { Monitoring } from '../../../../core/ports/driving/monitoring.ts';

const registerMonitoringRoutes = (instance: FastifyInstance, monitoring: Monitoring) => {
  instance.get(
    '/monitoring',
    {
      schema: {
        operationId: 'getMonitoringState',
        summary: 'Get the monitoring state',
        description:
          'Returns whether devices are probed: running, stopping until the round in progress ends, or stopped.',
        response: { 200: { $ref: 'get-monitoring-state-result.schema.json#' } },
      },
    },
    () => monitoring.getMonitoringState({}),
  );

  instance.post(
    '/monitoring/start',
    {
      schema: {
        operationId: 'startMonitoring',
        summary: 'Start monitoring',
        description: 'Probing resumes with the next round. Does nothing while running.',
        response: { 204: { type: 'null', description: 'Monitoring is running.' } },
      },
    },
    async (_request, reply) => {
      monitoring.startMonitoring({});
      return reply.code(204).send();
    },
  );

  instance.post(
    '/monitoring/stop',
    {
      schema: {
        operationId: 'stopMonitoring',
        summary: 'Stop monitoring',
        description:
          'Lets the round in progress finish, stopping then, and starts no other. Does nothing once stopped.',
        response: { 204: { type: 'null', description: 'Monitoring is stopping, or stopped.' } },
      },
    },
    async (_request, reply) => {
      monitoring.stopMonitoring({});
      return reply.code(204).send();
    },
  );
};

export { registerMonitoringRoutes };
