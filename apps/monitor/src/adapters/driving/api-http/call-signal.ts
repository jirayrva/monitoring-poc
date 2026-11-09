import type { FastifyReply } from 'fastify';

/**
 * The signal for the calls a request makes. It aborts when the client goes away before the response is sent, or when
 * the drain of a stopping API ends. Fastify's request.signal follows the request stream's close event, which Node emits as soon as the
 * body has been read, so it would abort every POST and PUT halfway through.
 */
const callSignal = (reply: FastifyReply, drainEnded: AbortSignal) => {
  const clientGone = new AbortController();
  const response = reply.raw;
  response.once('close', () => {
    if (!response.writableFinished) {
      clientGone.abort();
    }
  });
  return AbortSignal.any([clientGone.signal, drainEnded]);
};

export { callSignal };
