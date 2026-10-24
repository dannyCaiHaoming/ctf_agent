// Run preparation: before OpenCode starts, check every challenge and pin its materials into
// workspace/<id>/materials/. Everything is validated first and written afterwards, so a rejected run
// leaves nothing under workspace/. Any failure rejects the whole run (Blocked).
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { basename, join } from 'node:path';
import { Blocked } from './blocked.js';
import { loadChallengeList, type Challenge } from './challenges.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Reachability { checkedAt: string; reachable: boolean; timeoutMs: number; error?: string }
interface Pinned { name: string; source: string | null; sha256: string; bytes: number; content: Buffer }

/** One TCP connect, closed immediately, nothing sent. */
function checkReachable(host: string, port: number, timeoutMs: number): Promise<Reachability> {
  return new Promise(done => {
    const checkedAt = new Date().toISOString();
    const socket = connect({ host, port });
    const finish = (reachable: boolean, error?: string) => { socket.destroy(); done({ checkedAt, reachable, timeoutMs, ...(error ? { error } : {}) }); };
    socket.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    socket.once('connect', () => finish(true));
    socket.once('error', e => finish(false, (e as NodeJS.ErrnoException).code ?? e.message));
  });
}

async function collect(challenge: Challenge, secrets: string[]): Promise<Pinned[]> {
  const files: Array<{ name: string; source: string | null; content: Buffer }> = [];
  const seen = new Set<string>();
  if (challenge.statement) {
    const { file, text } = challenge.statement;
    files.push({ name: 'statement.md', source: file ?? null, content: file ? await readFile(file) : Buffer.from(text!) });
    seen.add('statement.md');
  }
  for (const source of challenge.materials) {
    const name = basename(source);
    if (name.startsWith('.')) throw new Blocked(`challenge ${challenge.id}: material name must not start with ".": ${name}`);
    if (seen.has(name.toLowerCase()) || name.toLowerCase() === 'statement.md') throw new Blocked(`challenge ${challenge.id}: duplicate or reserved material name: ${name}`);
    seen.add(name.toLowerCase());
    files.push({ name, source, content: await readFile(source) });
  }
  for (const file of files) {
    if (secrets.some(s => s && file.content.includes(Buffer.from(s)))) throw new Blocked(`challenge ${challenge.id}: control credential found in ${file.name}`);
  }
  return files.map(f => ({ ...f, sha256: sha256(f.content), bytes: f.content.length }));
}

/** What the control service needs to serve the intake tools: the pinned facts of one challenge, no host paths except `materialsDir`. */
export interface PreparedChallenge {
  id: string; title: string | null; target: Challenge['target'] | null; reachability: Reachability | null;
  materials: Array<{ name: string; sha256: string; bytes: number }>;
  /** Host-side only; never returned to a model. */
  materialsDir: string;
}

export async function prepareRun(input: { challengesPath: string | undefined; workspace: string; evidence: string; secrets: string[] }): Promise<PreparedChallenge[]> {
  if (!input.challengesPath) throw new Blocked('release profile has no challenges field');
  const list = await loadChallengeList(input.challengesPath);
  const pinned = new Map<string, Pinned[]>();
  for (const challenge of list.challenges) pinned.set(challenge.id, await collect(challenge, input.secrets));

  const reachability = new Map<string, Reachability>();
  await Promise.all(list.challenges.filter(c => c.target).map(async c => {
    reachability.set(c.id, await checkReachable(c.target!.host, c.target!.port, list.reachabilityTimeoutMs));
  }));
  const record = (c: Challenge) => ({
    id: c.id, ...(c.title ? { title: c.title } : {}),
    target: c.target ?? null, reachability: reachability.get(c.id) ?? null,
    materials: (pinned.get(c.id) ?? []).map(({ name, source, sha256, bytes }) => ({ name, source: source ?? 'inline statement', sha256, bytes }))
  });
  const unreachable = list.challenges.filter(c => reachability.get(c.id)?.reachable === false);
  if (unreachable.length) {
    await writeFile(join(input.evidence, 'challenges.json'), JSON.stringify({ rejected: true, challengeList: list.path, challenges: list.challenges.map(record) }, null, 2), { flag: 'wx' });
    throw new Blocked(`challenge target unreachable: ${unreachable.map(c => `${c.id} (${reachability.get(c.id)!.error})`).join(', ')}`);
  }

  for (const challenge of list.challenges) {
    const directory = join(input.workspace, challenge.id, 'materials');
    await mkdir(directory, { recursive: true });
    for (const file of pinned.get(challenge.id)!) {
      const destination = join(directory, file.name);
      await writeFile(destination, file.content, { flag: 'wx' });
      await chmod(destination, 0o444);
    }
  }
  await writeFile(join(input.evidence, 'challenges.json'), JSON.stringify({ rejected: false, challengeList: list.path, challenges: list.challenges.map(record) }, null, 2), { flag: 'wx' });
  return list.challenges.map(c => ({ id: c.id, title: c.title ?? null, target: c.target ?? null, reachability: reachability.get(c.id) ?? null,
    materials: pinned.get(c.id)!.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })), materialsDir: join(input.workspace, c.id, 'materials') }));
}
