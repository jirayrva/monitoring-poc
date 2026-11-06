import type { FastifyReply } from 'fastify';
import type { StoreFailure } from '../../../core/ports/types.ts';

const apiError = { $ref: 'api-error.schema.json#' };

const deviceIdParams = {
  type: 'object',
  required: ['deviceId'],
  properties: { deviceId: { $ref: 'device-registration.schema.json#/properties/deviceId' } },
};

const sendFailure = (reply: FastifyReply, failure: StoreFailure | { reason: 'not_found' | 'already_exists' }) => {
  switch (failure.reason) {
    case 'not_found':
      return reply.code(404).send({ code: 'device_not_found', message: 'No device with this ID exists.', details: {} });
    case 'already_exists':
      return reply
        .code(409)
        .send({ code: 'device_exists', message: 'A device with this ID already exists.', details: {} });
    default:
      return reply.code(503).send({
        code: 'store_unavailable',
        message: 'The device store is temporarily unavailable.',
        details: { reason: failure.reason },
      });
  }
};

export { apiError, deviceIdParams, sendFailure };
