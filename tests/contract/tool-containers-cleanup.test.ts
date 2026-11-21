import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolContainers, type JobBinding } from '../../apps/launcher/src/job-tools.js';

// Tool image design §4: every per-session container is removed at the end of the run, and a removal that cannot be
// confirmed must surface (launch.ts records it as tool_container_cleanup_error) instead of being dropped silently.
// A fake docker client keeps one marker file per live container; flags in its directory inject failures.
const FAKE_DOCKER = `#!/bin/sh
d="$(dirname "$0")"
echo "$*" >> "$d/calls"
case "$1" in
  run)
    while [ $# -gt 0 ]; do if [ "$1" = "--name" ]; then touch "$d/live-$2"; fi; shift; done; exit 0 ;;
  rm)
    shift 2
    if [ -f "$d/rm-fails" ]; then echo "Error response from daemon: removal failed" >&2; exit 1; fi
    for n in "$@"; do rm -f "$d/live-$n"; done; exit 0 ;;
  container)
    if [ -f "$d/daemon-down" ]; then echo "Cannot connect to the Docker daemon" >&2; exit 1; fi
    if [ -f "$d/live-$5" ]; then echo id; exit 0; fi
    echo "Error: No such container: $5" >&2; exit 1 ;;
esac
exit 0
`;

let root: string;
let dir: string;
let docker: string;
const calls = () => existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n') : [];
const binding = (sessionId: string): JobBinding =>
  ({ sessionId, challengeId: 'c', workDir: join(root, sessionId, 'work'), materialsDir: join(root, 'm'), publishedDir: join(root, 'p') });
const tool = () => new ToolContainers({ image: 'img', prefix: 'ctf-test', docker });

beforeEach(() => {
  root ??= mkdtempSync(join(tmpdir(), 'tool-cleanup-'));
  dir = mkdtempSync(join(root, 'docker-'));
  docker = join(dir, 'docker');
  writeFileSync(docker, FAKE_DOCKER);
  chmodSync(docker, 0o755);
  mkdirSync(join(root, 'm'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ToolContainers.removeAll', () => {
  it('does nothing without containers', async () => {
    await tool().removeAll();
    expect(calls()).toEqual([]);
  });

  it('resolves when docker rm succeeds', async () => {
    const t = tool();
    await t.container(binding('s1'));
    await t.container(binding('s2'));
    await t.removeAll();
    expect(calls().filter(c => c.startsWith('rm '))).toEqual(['rm -f ctf-test-s1 ctf-test-s2']);
    expect(calls().some(c => c.startsWith('container '))).toBe(false);
  });

  it('rejects with the containers still present and retries only those', async () => {
    const t = tool();
    await t.container(binding('s1'));
    await t.container(binding('s2'));
    rmSync(join(dir, 'live-ctf-test-s1')); // already gone: Docker reports it missing
    writeFileSync(join(dir, 'rm-fails'), '');
    await expect(t.removeAll()).rejects.toThrow('1 still present, 0 unknown');
    rmSync(join(dir, 'rm-fails'));
    await t.removeAll();
    expect(calls().filter(c => c.startsWith('rm ')).at(-1)).toBe('rm -f ctf-test-s2');
    expect(existsSync(join(dir, 'live-ctf-test-s2'))).toBe(false);
  });

  it('counts containers as unknown when Docker cannot be asked', async () => {
    const t = tool();
    await t.container(binding('s1'));
    await t.container(binding('s2'));
    writeFileSync(join(dir, 'rm-fails'), '');
    writeFileSync(join(dir, 'daemon-down'), '');
    await expect(t.removeAll()).rejects.toThrow('0 still present, 2 unknown');
  });
});
