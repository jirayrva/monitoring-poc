import type { FastifyInstance } from 'fastify';
import type { DeviceStatusQueries } from '../../../../core/ports/driving/device-status-queries.ts';
import { callSignal } from '../call-signal.ts';
import { apiError, sendFailure } from '../responses.ts';

const registerDeviceStatusQueriesRoutes = (
  instance: FastifyInstance,
  deviceStatusQueries: DeviceStatusQueries,
  drainEnded: AbortSignal,
) => {
  instance.get(
    '/device-statuses',
    {
      schema: {
        operationId: 'listLatestStatuses',
        summary: 'List device statuses',
        description:
          'Returns the latest status of every registered device, ordered by device ID. A device not probed yet is unknown.',
        response: { 200: { $ref: 'list-latest-statuses-result.schema.json#' }, 503: apiError },
      },
    },
    async (_request, reply) => {
      const result = await deviceStatusQueries.listLatestStatuses({}, { signal: callSignal(reply, drainEnded) });
      return result.ok ? reply.send({ data: result.value }) : sendFailure(reply, result.failure);
    },
  );
};

export { registerDeviceStatusQueriesRoutes };
