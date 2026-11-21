import { describe, expect, it } from 'vitest';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';
import { parseLaunchArgs } from '../../apps/launcher/src/launch.js';
import { TOOL_INVENTORY_PATH } from '../../apps/launcher/src/job-tools.js';

// Tool image design §4–§5: the option is off by default; when on, job.run points to the image's tool inventory.
const base = { controlUrl: 'http://127.0.0.1:43210/control', controlToken: 'x'.repeat(40), tools: ['job.run', 'job.read'] };

describe('tool image option', () => {
  it('leaves the job.run description unchanged without a tool inventory', () => {
    const hooks = createCtfAgentHooks(base);
    expect(hooks.tool!['ctf_job_run']!.description).not.toContain('inventory');
  });

  it('points job.run, and only job.run, to the tool inventory when the tool image is on', () => {
    const plain = createCtfAgentHooks(base);
    const hooks = createCtfAgentHooks({ ...base, toolInventory: TOOL_INVENTORY_PATH });
    expect(hooks.tool!['ctf_job_run']!.description).toContain(TOOL_INVENTORY_PATH);
    expect(hooks.tool!['ctf_job_run']!.description.startsWith(plain.tool!['ctf_job_run']!.description)).toBe(true);
    expect(hooks.tool!['ctf_job_read']!.description).toBe(plain.tool!['ctf_job_read']!.description);
  });

  it('parses --tool-image and keeps it absent by default', () => {
    expect(parseLaunchArgs(['--tool-image', 'ctf-tool-image:dev']).toolImage).toBe('ctf-tool-image:dev');
    expect(parseLaunchArgs([]).toolImage).toBeUndefined();
  });
});
