// Loopback RPC between the product plugin (inside OpenCode) and the control service (inside the launcher).
// Same safety properties as OpenCodeBridgeRpcServer: 127.0.0.1 only, per-run random bearer credential, constant-time
// comparison, request size cap. It is written fresh because that class resolves one lease/scope binding per session
// through the policy engine before any operation, which cannot express "unknown session, bind on first hook".
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { ControlDenied } from './control-service.js';

const MAX_BODY_BYTES = 1024 * 1024;

export type ControlHandler = (sessionID: string, operation: string, input: unknown, signal: AbortSignal) => Promise<unknown>;

export async function startControlRpc(handler: ControlHandler): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(24).toString('hex');
  const expected = Buffer.from(token);
  const active = new Set<AbortController>();
  const server = createServer((request, response) => {
    const controller = new AbortController(); active.add(controller);
    response.once('close', () => { if (!response.writableFinished) controller.abort('rpc abandoned'); active.delete(controller); });
    request.once('aborted', () => controller.abort('rpc abandoned'));
    void (async () => {
      const header = request.headers.authorization ?? '';
      const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { response.writeHead(401).end('unauthorized'); return; }
      if (request.method !== 'POST' || request.url !== '/control') { response.writeHead(404).end('not found'); return; }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += (chunk as Buffer).length;
          if (size > MAX_BODY_BYTES) { response.writeHead(413).end('request too large'); return; }
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        if (typeof body.sessionID !== 'string' || !/^[\w.-]{1,128}$/.test(body.sessionID) || typeof body.operation !== 'string') throw new ControlDenied('malformed request');
        const result = await handler(body.sessionID, body.operation, body.input, controller.signal);
        if (response.destroyed) return;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
      } catch (error) {
        const message = error instanceof ControlDenied ? error.message : 'denied: control error';
        if (response.destroyed) return;
        response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('control RPC did not bind a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}/control`, token,
    close: () => new Promise<void>(done => { for (const controller of active) controller.abort('rpc closed'); server.close(() => done()); server.closeAllConnections(); })
  };
}
