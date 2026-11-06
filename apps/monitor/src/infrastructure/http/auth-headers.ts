type HttpAuth = { strategy: 'none' } | { strategy: 'bearer'; secretRef: string };

type ReadSecret = (name: string) => string | undefined;

/**
 * The headers that authenticate a call. Undefined when the token secretRef names is not set, or set to nothing, so the
 * call is not made.
 */
const authHeaders = (auth: HttpAuth, readSecret: ReadSecret): Record<string, string> | undefined => {
  if (auth.strategy === 'none') {
    return {};
  }

  const token = readSecret(auth.secretRef);
  return token === undefined || token === '' ? undefined : { authorization: `Bearer ${token}` };
};

export { authHeaders };
export type { HttpAuth, ReadSecret };
