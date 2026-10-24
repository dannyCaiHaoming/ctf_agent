import { readFile } from 'node:fs/promises';

export interface LocalEnvResult {
  path: string;
  loaded: boolean;
  entries: number;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function loadLocalEnv(path = '.env'): Promise<LocalEnvResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, loaded: false, entries: 0 };
    throw error;
  }

  let entries = 0;
  for (const [index, sourceLine] of raw.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) throw new Error(`invalid .env entry at line ${index + 1}`);
    const key = withoutExport.slice(0, separator).trim();
    const value = unquote(withoutExport.slice(separator + 1));
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) throw new Error(`invalid environment key at line ${index + 1}`);
    if (!(key in process.env)) process.env[key] = value;
    entries++;
  }
  return { path, loaded: true, entries };
}
