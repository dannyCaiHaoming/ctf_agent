import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface LocalTarget {
  server: Server;
  url: string;
  flag: string;
  close(): Promise<void>;
}

export async function startLocalTarget(port = 0): Promise<LocalTarget> {
  const token = createHash('sha256').update(randomBytes(32)).digest('hex');
  const flag = `flag{${createHash('sha256').update(randomBytes(24)).digest('hex').slice(0, 32)}}`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    if (url.pathname === '/') {
      response.end('Local web challenge. Only authorized agents may test this service.\n');
      return;
    }
    if (url.pathname === '/health') {
      response.end('ok\n');
      return;
    }
    if (url.pathname === '/robots.txt') {
      response.end(`User-agent: *\nDisallow: /static/${token}.txt\n`);
      return;
    }
    if (url.pathname === `/static/${token}.txt`) {
      response.end(flag);
      return;
    }
    response.statusCode = 404;
    response.end('not found\n');
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('target did not bind');
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    flag,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

if (process.argv[1]?.endsWith('server.ts')) {
  const port = Number(process.argv[2] ?? 8787);
  void startLocalTarget(port).then(target => console.log(target.url));
}
