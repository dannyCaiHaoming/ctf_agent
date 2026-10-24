import { readFile } from 'node:fs/promises';
import { resumeLocalCheckpoint } from '@ctf/supervisor';

export async function resume(options: { stateRoot: string; runId: string; authorizationPath: string }) {
  const authorization: unknown = JSON.parse(await readFile(options.authorizationPath, 'utf8'));
  const result = await resumeLocalCheckpoint({ stateRoot: options.stateRoot, runId: options.runId, authorization });
  return { code: result.state === 'completed' ? 0 : 1, message: JSON.stringify({ kind: 'local_checkpoint_resumed', ...result }) };
}
