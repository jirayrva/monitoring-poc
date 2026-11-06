import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { errorHandler, statusNameOf } from '../error-handlers.ts';

describe('errorHandler', () => {
  it('logs an unexpected error, which the client never sees', async () => {
    // Arrange
    const lines: string[] = [];
    const server = Fastify({ logger: { level: 'error', stream: { write: (line: string) => lines.push(line) } } });
    server.setErrorHandler(errorHandler);
    server.get('/boom', () => {
      throw new Error('secret detail');
    });

    // Act
    const response = await server.inject({ method: 'GET', url: '/boom' });

    // Assert
    assert.equal(response.statusCode, 500);
    assert.doesNotMatch(response.body, /secret detail/);
    assert.match(lines.join(''), /secret detail/);
  });

  it('does not log a client error', async () => {
    // Arrange
    const lines: string[] = [];
    const server = Fastify({ logger: { level: 'error', stream: { write: (line: string) => lines.push(line) } } });
    server.setErrorHandler(errorHandler);
    server.post('/echo', () => 'ok');

    // Act
    const response = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    // Assert
    assert.equal(response.statusCode, 400);
    assert.deepEqual(lines, []);
  });
});

describe('statusNameOf', () => {
  for (const [statusCode, name] of [
    [400, 'BAD_REQUEST'],
    [404, 'NOT_FOUND'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [503, 'SERVICE_UNAVAILABLE'],
    [599, 'ERROR'],
  ] as const) {
    it(`names ${statusCode} ${name}, in capitals`, () => {
      // Act
      const result = statusNameOf(statusCode);

      // Assert
      assert.equal(result, name);
    });
  }
});
