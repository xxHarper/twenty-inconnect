import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import { duplexPair } from 'node:stream';

type HttpResponse = {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
};

export const postInProcess = (
  server: Server,
  url: URL,
  payload: unknown,
  headers: Record<string, string>,
): Promise<HttpResponse> => {
  const [client, serverSide] = duplexPair();
  const body = JSON.stringify(payload);
  // Node's HTTP parser receives actual request bytes over a memory stream.
  const socket = Object.assign(serverSide, { setTimeout: () => serverSide });
  server.emit('connection', socket);

  return new Promise<HttpResponse>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: 'POST',
        createConnection: () => client,
        headers: {
          connection: 'close',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (incoming) => {
        incoming.setEncoding('utf8');
        let response = '';
        incoming.on('data', (chunk: string) => {
          response += chunk;
        });
        incoming.once('error', reject);
        incoming.once('end', () =>
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            body: response,
          }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  }).finally(() => {
    client.destroy();
    serverSide.destroy();
  });
};
