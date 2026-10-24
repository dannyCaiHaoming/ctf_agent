import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fault = vi.hoisted(() => ({ stderr: false }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, openSync: (...args: Parameters<typeof fs.openSync>) => {
    if (fault.stderr && String(args[0]).endsWith('stderr.bin')) throw new Error('injected output open failure');
    return fs.openSync(...args);
  } };
});
import { JobManager } from '../../apps/launcher/src/job-tools.js';
let root: string;
afterEach(async () => { fault.stderr = false; if (root) await rm(root, { recursive: true, force: true }); });
// If spawn happens before both output files are ready, its child escapes the failed registration path.
it('failed output setup cannot start an unregistered process', async () => {
  root = await mkdtemp(join(tmpdir(), 'job-start-')); await mkdir(join(root, 'work'));
  const manager = new JobManager({ jobsRoot: join(root, 'jobs') });
  fault.stderr = true;
  await expect(manager.run({ sessionId: 'a', challengeId: 'X', workDir: join(root, 'work'), materialsDir: root, publishedDir: root },
    { argv: [process.execPath, '-e', "setTimeout(()=>require('fs').writeFileSync('orphan-marker','bad'),100)"], wait_ms: 0 })).rejects.toThrow('output open failure');
  await new Promise(r => setTimeout(r, 250));
  await expect(readFile(join(root, 'work/orphan-marker'))).rejects.toThrow();
});
