import { STATUS_CODES } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';

type HandledError = Error & { code?: string; statusCode?: number };

type Problem = { code: string; message: string; details: Record<string, unknown> };

/** Only Fastify's own errors are known to carry a meaningful status and a message that's safe to send. */
const isClientError = (error: HandledError) =>
  error.code?.startsWith('FST_') === true && error.statusCode !== undefined && error.statusCode < 500;

const errorHandler = (error: HandledError, request: FastifyRequest, reply: FastifyReply) => {
  if (isClientError(error)) {
    return reply.code(error.statusCode ?? 400).send({
      code: 'invalid_request',
      message: 'The request is invalid.',
      details: { reason: error.message },
    });
  }

  request.log.error(error);
  return reply.code(500).send({ code: 'internal_error', message: 'Something went wrong.', details: {} });
};

const notFoundHandler = (_request: FastifyRequest, reply: FastifyReply) =>
  reply.code(404).send({ code: 'route_not_found', message: 'This route does not exist.', details: {} });

const statusNameOf = (statusCode: number) =>
  (STATUS_CODES[statusCode] ?? 'Error')
    .toUpperCase()
    .replaceAll(/[^A-Z]+/g, '_')
    .replaceAll(/^_|_$/g, '');

const isProblem = (payload: unknown): payload is Problem =>
  payload instanceof Object && 'code' in payload && 'message' in payload && 'details' in payload;

const completeApiError = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  if (reply.statusCode < 400 || !isProblem(payload)) {
    return payload;
  }

  return {
    ...payload,
    statusCode: reply.statusCode,
    statusName: statusNameOf(reply.statusCode),
    requestPath: request.url.split('?', 1)[0],
    requestId: request.id,
    timestamp: new Date().toISOString(),
  };
};

export { completeApiError, errorHandler, notFoundHandler, statusNameOf };
