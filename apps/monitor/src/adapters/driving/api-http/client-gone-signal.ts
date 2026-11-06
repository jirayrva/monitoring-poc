import type { FastifyReply } from 'fastify';

/**
 * Aborts when the client goes away before the response is sent. Fastify's request.signal follows
 * the request stream's close event, which Node emits as soon as the body has been read, so it
 * would abort every POST and PUT halfway through.
 */
const clientGoneSignal = (reply: FastifyReply) => {
  const controller = new AbortController();
  const response = reply.raw;
  response.once('close', () => {
    if (!response.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
};

export { clientGoneSignal };
