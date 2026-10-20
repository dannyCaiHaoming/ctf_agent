import { loadLocalEnv } from './composition/localEnv.js';
import { loadReleaseProfile } from './composition/releaseProfile.js';
import { doctor } from './commands/doctor.js';
import { resume } from './commands/resume.js';
import { solve } from './commands/solve.js';

function usage(): string {
  return `ctf-agent
Commands:
  resume --state-root <dir> --run <id> --authorization <host-local-policy.json>
  doctor --profile <path>
  solve --target <authorized-url> [--trajectory t1|t2] [--description <text>] [--input <path>] [--material <path> ...] --profile <opencode-release-profile> [--out <dir>] [--preset-trajectory1]
`;
}

function args(input: string[]): Record<string, string | boolean | string[]> {
  const parsed: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < input.length; i++) {
    const item = input[i]!;
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    if (i + 1 >= input.length || input[i + 1]!.startsWith('--')) parsed[key] = true;
    else if (key === 'material') {
      const value = input[++i]!;
      parsed.material = [...(Array.isArray(parsed.material) ? parsed.material : []), value];
    } else parsed[key] = input[++i]!;
  }
  return parsed;
}

async function main(): Promise<number> {
  await loadLocalEnv();
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log(usage());
    return command ? 0 : 2;
  }
  const parsed = args(rest);
  if (command === 'resume') {
    if (typeof parsed['state-root'] !== 'string' || typeof parsed.run !== 'string' || typeof parsed.authorization !== 'string') {
      console.error('resume requires --state-root, --run and host-generated --authorization');
      return 2;
    }
    const result = await resume({ stateRoot: parsed['state-root'], runId: parsed.run, authorizationPath: parsed.authorization });
    console.log(result.message);
    return result.code;
  }
  const profilePath = typeof parsed.profile === 'string' ? parsed.profile : 'config/release-profile.m1-opencode.example.json';
  const profile = await loadReleaseProfile(profilePath);
  if (command === 'doctor') {
    console.log(JSON.stringify(await doctor(profile), null, 2));
    return 0;
  }
  if (command === 'solve') {
    if (parsed.trajectory !== undefined && !['t1', 't2'].includes(String(parsed.trajectory))) throw new Error('--trajectory must be t1 or t2');
    if (typeof parsed.target !== 'string') {
      console.error('--target is required');
      return 2;
    }
    const result = await solve({
      target: parsed.target,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      input: typeof parsed.input === 'string' ? parsed.input : undefined,
      materials: Array.isArray(parsed.material) ? parsed.material : [],
      profile,
      out: typeof parsed.out === 'string' ? parsed.out : undefined,
      allowStub: parsed['allow-stub'] === true,
      startLocalTarget: parsed['start-local-target'] === true,
      presetTrajectory1: parsed['preset-trajectory1'] === true,
      trajectory: parsed.trajectory as 't1' | 't2' | undefined
    });
    console.log(result.message);
    return result.code;
  }
  console.error(usage());
  return 2;
}

main().then(code => process.exitCode = code).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
