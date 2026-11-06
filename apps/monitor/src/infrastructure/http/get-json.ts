type GetJsonFailure =
  | { reason: 'unreachable' | 'timeout' | 'cut_off' | 'tls_failed' }
  | { reason: 'gateway_error' | 'http_error' | 'unparsable' | 'too_large'; httpStatus: number };

type GetJsonOutput =
  | { ok: true; value: { httpStatus: number; document: unknown } }
  | { ok: false; failure: GetJsonFailure };

type GetJsonInput = {
  /** Paths join under it, so a server behind a path prefix keeps it. */
  baseUrl: string;
  path: string;
  headers: Record<string, string>;
  signal: AbortSignal;
};

/** Far more than any answer the monitor reads, so a server that floods it is cut off. */
const maxBodyBytes = 1024 * 1024;

const gatewayStatuses = new Set([502, 503, 504]);

/**
 * OpenSSL's certificate checks, such as DEPTH_ZERO_SELF_SIGNED_CERT or CERT_HAS_EXPIRED, and Node's TLS and SSL errors,
 * such as ERR_SSL_WRONG_VERSION_NUMBER for an https URL on a plain HTTP port.
 */
const tlsErrorCode = /^ERR_(SSL|TLS)_|CERT|SIGNATURE|ISSUER/;

const connectFailure = (error: TypeError): 'tls_failed' | 'unreachable' => {
  const code: unknown = error.cause instanceof Error && 'code' in error.cause ? error.cause.code : undefined;
  return typeof code === 'string' && tlsErrorCode.test(code) ? 'tls_failed' : 'unreachable';
};

const fail = (failure: GetJsonFailure) => ({ ok: false, failure }) as const;

const utf8 = new TextDecoder('utf-8', { fatal: true });

const readBody = async (body: ReadableStream<Uint8Array> | null) => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      // Leaving the loop cancels the stream, which closes the connection.
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const readAnswer = async (response: Response): Promise<GetJsonOutput> => {
  const { status: httpStatus } = response;
  if (!response.ok) {
    // Nothing reads the body, so the connection is released now.
    await response.body?.cancel();
    return fail({ reason: gatewayStatuses.has(httpStatus) ? 'gateway_error' : 'http_error', httpStatus });
  }

  const body = await readBody(response.body);
  if (body === undefined) {
    return fail({ reason: 'too_large', httpStatus });
  }

  try {
    return { ok: true, value: { httpStatus, document: JSON.parse(utf8.decode(body)) } };
  } catch {
    return fail({ reason: 'unparsable', httpStatus });
  }
};

/**
 * Says which failure an error from fetch is. A call whose signal ended timed out, whatever reason the signal carries.
 * fetch reports every network failure as a TypeError: before an answer, the server was unreachable, or the TLS
 * handshake failed. While reading one, it was cut off. Anything else is a bug, so it is thrown again.
 */
const toFailure = (signal: AbortSignal, whileReading: boolean) => (error: unknown) => {
  if (signal.aborted) {
    return fail({ reason: 'timeout' });
  }
  if (!(error instanceof TypeError)) {
    throw error;
  }
  return fail({ reason: whileReading ? 'cut_off' : connectFailure(error) });
};

/**
 * GETs a JSON answer. A redirect is not followed, and counts as an http_error: a token sent with the call never goes
 * to another host.
 */
const getJson = (input: GetJsonInput): Promise<GetJsonOutput> => {
  const { baseUrl, path, headers, signal } = input;
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  return fetch(url, { headers: { accept: 'application/json', ...headers }, redirect: 'manual', signal }).then(
    (response) => readAnswer(response).catch(toFailure(signal, true)),
    toFailure(signal, false),
  );
};

export { connectFailure, getJson, maxBodyBytes };
export type { GetJsonFailure, GetJsonOutput };
