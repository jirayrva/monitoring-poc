import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { connectFailure, getJson, maxBodyBytes } from '../get-json.ts';
import { closedBaseUrl, startRawServer, startServer } from '../testing/test-server.ts';

const call = (baseUrl: string, signal = AbortSignal.timeout(2000)) =>
  getJson({ baseUrl, path: 'v1/health', headers: { authorization: 'Bearer token' }, signal });

const json = (body: unknown) => JSON.stringify(body);

describe('getJson', () => {
  it('returns the parsed answer and its status, asking for JSON with the given headers', async (t) => {
    // Arrange
    let headers = {};
    const baseUrl = await startServer(t, (request, response) => {
      headers = request.headers;
      response.writeHead(200, { 'content-type': 'application/json' }).end(json({ status: 'ok' }));
    });

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.ok(result.ok);
    assert.equal(result.value.httpStatus, 200);
    assert.deepEqual(result.value.document, { status: 'ok' });
    assert.partialDeepStrictEqual(headers, { accept: 'application/json', authorization: 'Bearer token' });
  });

  it('keeps the exact bytes of the answer, and its headers', async (t) => {
    // Arrange
    const sent = '{ "status" : "ok",\n  "uptime": 1.50 }';
    const baseUrl = await startServer(t, (_request, response) => {
      response.writeHead(200, { 'diagnostics-checksum': 'abc123' }).end(sent);
    });

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.ok(result.ok);
    assert.deepEqual(result.value.body, new TextEncoder().encode(sent));
    assert.equal(result.value.headers.get('diagnostics-checksum'), 'abc123');
  });

  for (const baseUrl of ['/devices/lobby', '/devices/lobby/']) {
    it(`keeps the base URL's path, ${baseUrl}`, async (t) => {
      // Arrange
      let path = '';
      const origin = await startServer(t, (request, response) => {
        path = request.url ?? '';
        response.end('{}');
      });

      // Act
      await call(`${origin}${baseUrl}`);

      // Assert
      assert.equal(path, '/devices/lobby/v1/health');
    });
  }

  for (const httpStatus of [502, 503, 504]) {
    it(`reports gateway_error for ${httpStatus}`, async (t) => {
      // Arrange
      const baseUrl = await startServer(t, (_request, response) => response.writeHead(httpStatus).end('{}'));

      // Act
      const result = await call(baseUrl);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason: 'gateway_error', httpStatus } });
    });
  }

  for (const httpStatus of [401, 404, 500]) {
    it(`reports http_error for ${httpStatus}`, async (t) => {
      // Arrange
      const baseUrl = await startServer(t, (_request, response) => response.writeHead(httpStatus).end('{}'));

      // Act
      const result = await call(baseUrl);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { reason: 'http_error', httpStatus } });
    });
  }

  it('reports http_error for a redirect, without following it', async (t) => {
    // Arrange
    let followed = false;
    const elsewhere = await startServer(t, (_request, response) => {
      followed = true;
      response.end('{}');
    });
    const baseUrl = await startServer(t, (_request, response) =>
      response.writeHead(302, { location: elsewhere }).end(),
    );

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'http_error', httpStatus: 302 } });
    assert.equal(followed, false);
  });

  it('reports unparsable for a whole answer that is not JSON', async (t) => {
    // Arrange
    const baseUrl = await startServer(t, (_request, response) => response.end('<html>Router login</html>'));

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'unparsable', httpStatus: 200 } });
  });

  it('reports cut_off for an answer shorter than its declared length', async (t) => {
    // Arrange
    const baseUrl = await startRawServer(t, 'HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\n{"status": "o');

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'cut_off' } });
  });

  it('reports too_large for an answer larger than the limit, reading no further', async (t) => {
    // Arrange
    const baseUrl = await startRawServer(
      t,
      `HTTP/1.1 200 OK\r\nconnection: close\r\n\r\n${' '.repeat(maxBodyBytes + 1)}`,
    );

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'too_large', httpStatus: 200 } });
  });

  it('reports unreachable when nothing listens', async (t) => {
    // Arrange
    const baseUrl = await closedBaseUrl(t);

    // Act
    const result = await call(baseUrl);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'unreachable' } });
  });

  it('reports tls_failed when the TLS handshake fails, as for an https base URL on a plain HTTP port', async (t) => {
    // Arrange
    const baseUrl = await startServer(t, (_request, response) => response.end('{}'));

    // Act
    const result = await call(baseUrl.replace('http:', 'https:'));

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'tls_failed' } });
  });

  it('reports timeout when the signal ends the call before an answer, whatever its reason', async (t) => {
    // Arrange
    const baseUrl = await startServer(t, () => {});
    const caller = new AbortController();
    setTimeout(() => caller.abort(new Error('monitoring stopped')), 20);

    // Act
    const result = await call(baseUrl, caller.signal);

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
  });

  it('reports timeout when the signal ends the call while reading the answer', async (t) => {
    // Arrange
    const baseUrl = await startServer(t, (_request, response) => {
      response.writeHead(200, { 'content-length': '100' }).write('{"status":');
    });

    // Act
    const result = await call(baseUrl, AbortSignal.timeout(50));

    // Assert
    assert.deepEqual(result, { ok: false, failure: { reason: 'timeout' } });
  });
});

const fetchFailed = (code: string) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

describe('connectFailure', () => {
  for (const code of [
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_SSL_WRONG_VERSION_NUMBER',
  ]) {
    it(`reports tls_failed for ${code}`, () => {
      // Act
      const reason = connectFailure(fetchFailed(code));

      // Assert
      assert.equal(reason, 'tls_failed');
    });
  }

  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH']) {
    it(`reports unreachable for ${code}`, () => {
      // Act
      const reason = connectFailure(fetchFailed(code));

      // Assert
      assert.equal(reason, 'unreachable');
    });
  }

  it('reports unreachable for an error with no code', () => {
    // Act
    const reason = connectFailure(new TypeError('fetch failed'));

    // Assert
    assert.equal(reason, 'unreachable');
  });
});
