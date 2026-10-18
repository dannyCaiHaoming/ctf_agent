import { createServer } from 'node:http';

/** Fresh localhost-only ordinary greeting service. All data is synthetic and public. */
export async function startGreetingFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const login = '<html><form><input type="password" name="password"></form></html>';
  const error = '<html>ordinary unified error response</html>';
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const name = url.searchParams.get('name') ?? 'world';
    if (url.pathname === '/login' || name === 'login') { response.end(login); return; }
    if (url.pathname === '/error' || name === 'error') { response.statusCode = 404; response.end(error); return; }
    if (url.pathname === '/redirect') { response.statusCode = 302; response.setHeader('location', '/login'); response.end('ordinary redirect'); return; }
    if (name === 'broken') { response.statusCode = 500; response.end('synthetic ordinary failure'); return; }
    if (url.pathname !== '/greet' || !/^[a-z]{1,16}$/.test(name)) { response.statusCode = 400; response.end(error); return; }
    response.setHeader('content-type', 'text/plain');
    response.end(`puzzle{hello_${name}}`);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
