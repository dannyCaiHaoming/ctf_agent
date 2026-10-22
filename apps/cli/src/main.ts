import { loadLocalEnv } from './composition/localEnv.js';
import { resume } from './commands/resume.js';

function usage(): string {
  return `ctf-agent
Commands:
  resume --state-root <dir> --run <id> --authorization <host-local-policy.json>
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
  console.error(usage());
  return 2;
}

main().then(code => process.exitCode = code).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
