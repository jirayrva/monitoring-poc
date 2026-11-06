import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { Server } from 'node:net';
import type { TestContext } from 'node:test';

const listen = async (t: TestContext, server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  });
  const address = server.address();
  if (typeof address !== 'object' || !address) {
    throw new Error('The test server listens on no port');
  }
  return `http://127.0.0.1:${address.port}`;
};

const startServer = (t: TestContext, handler: RequestListener) => listen(t, createServer(handler));

/** Writes these bytes to each connection, then closes it: for answers no HTTP server would send. */
const startRawServer = (t: TestContext, bytes: string) =>
  listen(
    t,
    createNetServer((socket) => socket.end(bytes)),
  );

const closedBaseUrl = async (t: TestContext) => {
  const server = createNetServer();
  const url = await listen(t, server);
  server.close();
  return url;
};

export { closedBaseUrl, startRawServer, startServer };
