import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime } from '@ctf/runtime';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const server = createServer((request, response) => {
    if (request.url === '/login' && request.method === 'POST') {
      response.writeHead(302, { 'set-cookie': ['sid=opaque-cookie-value; Path=/; HttpOnly; SameSite=Lax'], location: '/private?next=home&token=redirect-secret' });
      response.end(); return;
    }
    if (request.url === '/private') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(request.headers.cookie === 'sid=opaque-cookie-value' ? 'authenticated' : 'anonymous'); return;
    }
    if (request.url === '/logout') {
      response.writeHead(200, { 'set-cookie': ['sid=; Path=/; Max-Age=0', 'widen=bad; Domain=localhost; Path=/'] });
      response.end('cleared'); return;
    }
    if (request.url === '/external-redirect') {
      response.writeHead(302, { location: 'https://outside.example/private?token=secret' }); response.end(); return;
    }
    if (request.url === '/nested/login') {
      response.writeHead(200, { 'set-cookie': ['nested=path-cookie; Path=/nested', 'secureOnly=not-sent; Path=/; Secure'] });
      response.end('set'); return;
    }
    if (request.url === '/nested/area') {
      response.writeHead(200, { 'content-type': 'text/plain' }); response.end(request.headers.cookie ?? 'no-cookie'); return;
    }
    response.writeHead(404); response.end('missing');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind TCP port');
  const root = await mkdtemp(join(tmpdir(), 'runtime-http-session-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const origin = `http://127.0.0.1:${address.port}`;
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'session-run', 'throwback-fixture', origin);
  cleanups.push(() => runtime.dispose());
  return { runtime, origin };
}

it('keeps host-managed cookies within one HTTP session and returns redacted redirect diagnostics', async () => {
  const { runtime, origin } = await fixture();
  const firstSession = await runtime.openHttpSession();
  const secondSession = await runtime.openHttpSession();

  const login = await runtime.httpRequest(firstSession, `${origin}/login`, { method: 'POST', body: 'username=test', headers: { cookie: 'model-supplied=blocked' } });
  expect(login.status).toBe(302);
  expect(login.setCookieNames).toEqual(['sid']);
  expect(login.cookieNamesSent).toEqual([]);
  expect(login.location).toBe(`${origin}/private?next=home&token=%5Bredacted%5D`);
  expect(JSON.stringify({ ...login, body: undefined })).not.toContain('opaque-cookie-value');

  const authenticated = await runtime.httpRequest(firstSession, `${origin}/private`);
  const isolated = await runtime.httpRequest(secondSession, `${origin}/private`);
  expect(authenticated.body.toString()).toBe('authenticated');
  expect(authenticated.cookieNamesSent).toEqual(['sid']);
  expect(isolated.body.toString()).toBe('anonymous');
  expect(isolated.cookieNamesSent).toEqual([]);

  const pathSet = await runtime.httpRequest(firstSession, `${origin}/nested/login`);
  expect(pathSet.setCookieNames).toEqual(['nested', 'secureOnly']);
  const nested = await runtime.httpRequest(firstSession, `${origin}/nested/area`);
  expect(nested.body.toString()).toBe('nested=path-cookie; sid=opaque-cookie-value');
  expect(nested.cookieNamesSent).toEqual(['nested', 'sid']);

  const external = await runtime.httpRequest(firstSession, `${origin}/external-redirect`);
  expect(external.status).toBe(302);
  expect(external.location).toBeNull();
  await runtime.httpRequest(firstSession, `${origin}/logout`);
  const afterLogout = await runtime.httpRequest(firstSession, `${origin}/private`);
  expect(afterLogout.body.toString()).toBe('anonymous');
  expect(afterLogout.cookieNamesSent).toEqual([]);
});

it('rejects redirects outside the authorized origin and destroys session state on close', async () => {
  const { runtime, origin } = await fixture();
  const session = await runtime.openHttpSession();
  await runtime.httpRequest(session, `${origin}/login`, { method: 'POST' });
  await expect(runtime.httpRequest(session, `${origin.replace('127.0.0.1', 'localhost')}/private`)).rejects.toThrow('outside challenge scope');
  runtime.closeHttpSession(session);
  await expect(runtime.httpRequest(session, `${origin}/private`)).rejects.toThrow('HTTP session closed');
});
