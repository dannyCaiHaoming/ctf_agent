#!/usr/bin/env python3
"""Generate a pending, external Alibaba batch; check profiles and judges offline only."""
import argparse
import json
from pathlib import Path
import tempfile
import copy
import importlib.util
import math
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _candidate_common import compose_structure, dump, key_of, read_json, token

REPO = Path(__file__).resolve().parents[2]
TASKS = REPO / 'external_labs/alibaba-ctf'
A1 = Path('/Users/caihaoming/Documents/pentest-agent-run-data/alibaba-easy-20261104-a1')
A8 = REPO / 'runs/alibaba-easy-20261109-a8'
ERROR_CODES = {'batch_must_be_external', 'batch_must_be_new', 'invalid_challenge_keys',
    'invalid_model_or_thinking', 'invalid_budget', 'challenge_not_unique',
    'task_or_compose_incomplete', 'statement_missing', 'judge_image_unavailable',
    'judge_template_missing', 'listening_ports_unavailable', 'ports_unavailable', 'judge_base_not_replaced'}


def self_test():
    # Synthetic input lives under tests/manual; no real statement or oracle is read.
    with tempfile.TemporaryDirectory(prefix='.batch-self-', dir=Path(__file__).parent) as tmp:
        root = Path(tmp)
        task = root / 'tasks/alibabactf-2026-web-synthetic'
        (task / 'environment').mkdir(parents=True)
        (task / 'task.toml').write_text('[metadata]\nflag="flag{synthetic}"\nprimary_service="app"\ncategory="web"\ndifficulty="easy"\n')
        (task / 'instruction.md').write_text('Synthetic offline statement.\n')
        (task / 'environment/docker-compose.yaml').write_text('services:\n  main: {}\n  app:\n    image: synthetic\n    expose: ["8080"]\n')
        task2 = task.with_name('alibabactf-2026-web-synthetic2')
        shutil.copytree(task, task2)
        with tempfile.TemporaryDirectory(prefix='alibaba-batch-self-') as external:
            batch = Path(external) / 'new-batch'
            generate(batch, ['synthetic', 'synthetic2'], 'synthetic/model', 1, 1000, 'disabled', root / 'tasks')
            meta = json.loads((batch / 'batch-meta.json').read_text())
            assert meta['authorization'] == {'status': 'pending'}
            assert len({s['hostPort'] for s in meta['slots'].values()}) == 2
            assert json.loads((batch / 'configs/oracles.json').read_text())['synthetic'] == {
                'path': str(task / 'task.toml'), 'extract': 'toml:metadata.flag'}
            result = check_batch(batch)
            assert result['passed']
            assert result['challenges'][0]['wrong_candidate'] == 'rejected'
            assert result['challenges'][0]['self_compare'] == 'accepted'
            assert (batch / 'statements/synthetic.md').read_bytes() == (task / 'instruction.md').read_bytes()
            override = (batch / 'compose/synthetic.override.yaml').read_text()
            assert '127.0.0.1:' in override and 'ports: !override' in override
            profile_path = batch / 'configs/synthetic.profile.json'
            saved = profile_path.read_text()
            profile = json.loads(saved)
            profile['unexpected'] = True
            profile_path.write_text(json.dumps(profile))
            assert not check_batch(batch)['passed']
            profile_path.write_text(saved)
            try:
                generate(batch, ['synthetic'], 'synthetic/model', 1, 1000, 'disabled', root / 'tasks')
            except ValueError:
                pass
            else:
                raise AssertionError('existing batch was overwritten')
    return {'self_test': True}


def generate(batch, keys, model, deadline, max_tokens, thinking, tasks=TASKS):
    batch = Path(batch).resolve()
    if batch == REPO or REPO in batch.parents:
        raise ValueError('batch_must_be_external')
    if batch.exists():
        raise ValueError('batch_must_be_new')
    if not keys or len(keys) != len(set(keys)) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', k) for k in keys):
        raise ValueError('invalid_challenge_keys')
    if token(model) == 'unknown' or '/' not in model or thinking not in ('enabled', 'disabled'):
        raise ValueError('invalid_model_or_thinking')
    if not math.isfinite(deadline) or deadline <= 0 or round(deadline * 60000) <= 0 or max_tokens <= 0:
        raise ValueError('invalid_budget')
    # Validate every input before creating the new directory. No source statement is opened here.
    resolved = []
    for key in keys:
        matches = [p for p in tasks.iterdir() if p.is_dir() and not p.is_symlink() and key_of(p.name) == key]
        if len(matches) != 1:
            raise ValueError('challenge_not_unique')
        task = matches[0].resolve()
        # inspect_task confines oracle comparisons internally; use only its non-secret result.
        spec = importlib.util.spec_from_file_location('alibaba_eligibility', Path(__file__).with_name('alibaba-eligibility.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        metadata = module.inspect_task(task, set())
        if not metadata['task_toml_ok'] or not metadata['metadata_flag_present'] or not metadata['compose_ok']:
            raise ValueError('task_or_compose_incomplete')
        if not (task / 'instruction.md').is_file() or (task / 'instruction.md').is_symlink():
            raise ValueError('statement_missing')
        compose = next(p for p in (task / 'environment').iterdir() if p.name in
            ('docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml'))
        structure = compose_structure(compose)
        primary = next(s for s in structure['services'] if s['name'] == metadata['primary_service'])
        if not primary['image']:
            raise ValueError('judge_image_unavailable')
        resolved.append((key, task, compose, metadata, structure, primary['image']))
    template = read_json(A8 / 'configs/8a6ac7ff-k2.profile.json')
    opencode_template = read_json(A8 / 'configs/opencode.8a6ac7ff.k2.json')
    for name in ('alibaba.mts', 'exact-subprocess.ts', 'compare-child.mjs'):
        if not (A1 / 'judges' / name).is_file():
            raise ValueError('judge_template_missing')
    # Read the listening-port snapshot only; do not bind sockets or start a listener.
    port_check = subprocess.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True, timeout=15)
    if port_check.returncode not in (0, 1) or port_check.stderr.strip():
        raise ValueError('listening_ports_unavailable')
    occupied = {int(m.group(1)) for line in port_check.stdout.splitlines()
        if line.startswith('n') and (m := re.search(r':(\d+)(?:\s|$)', line))}
    ports = [p for p in range(18000, 60000) if p not in occupied][:len(keys)]
    if len(ports) != len(keys):
        raise ValueError('ports_unavailable')
    batch.mkdir(parents=True)
    for name in ('configs', 'compose', 'statements', 'judges'):
        (batch / name).mkdir()
    oracles, images, slots = {}, {}, {}
    for (key, task, compose, metadata, structure, image), port in zip(resolved, ports):
        statement = batch / 'statements' / f'{key}.md'
        # Explicit copy exception: normal model input, never printed or loaded in this process.
        shutil.copyfile(task / 'instruction.md', statement)
        profile = copy.deepcopy(template)
        profile['profileId'] = f'{batch.name}-{key}'
        profile['opencode'] = {'configPath': f'opencode.{key}.json'}
        profile['challenges'] = f'{key}.challenges.json'
        profile['budget']['wallClockMs'] = round(deadline * 60000)
        profile['budget']['maxObservableTokens'] = max_tokens
        config = {'model': model, 'agent': {'domain-solver': {'options': {'thinking': {'type': thinking}}}}}
        provider = model.split('/', 1)[0]
        if provider in (opencode_template.get('provider') or {}):
            config['provider'] = {provider: opencode_template['provider'][provider]}
            config['enabled_providers'] = [provider]
        dump(config, batch / 'configs' / f'opencode.{key}.json')
        dump(profile, batch / 'configs' / f'{key}.profile.json')
        dump({'reachabilityTimeoutMs': 15000, 'challenges': [{'id': key, 'title': key,
            'statementFile': str(statement), 'materials': [str(p) for p in sorted((task / 'environment').iterdir())
                if p.is_file() and not p.is_symlink() and p.name.lower().startswith('attachment')],
            'target': {'protocol': 'http', 'url': f'http://127.0.0.1:{port}/'}}]},
            batch / 'configs' / f'{key}.challenges.json')
        lines = ['services:']
        for service in structure['services']:
            name = service['name']
            if name == 'main':
                lines.append('  main: !reset null')
            else:
                lines.extend([f'  {name}:', '    ports: !override'])
                if name == metadata['primary_service']:
                    lines.append(f'      - "127.0.0.1:{port}:{metadata["container_port"]}"')
                else:
                    lines[-1] += ' []'
        (batch / 'compose' / f'{key}.override.yaml').write_text('\n'.join(lines) + '\n')
        oracles[key] = {'path': str(task / 'task.toml'), 'extract': 'toml:metadata.flag'}
        images[key] = image
        slots[key] = {'challenge': key, 'source': str(task), 'profile': f'configs/{key}.profile.json',
            'challenges': f'configs/{key}.challenges.json', 'compose': str(compose),
            'override': f'compose/{key}.override.yaml', 'hostPort': port,
            'service': metadata['primary_service'], 'containerPort': metadata['container_port']}
    dump(oracles, batch / 'configs/oracles.json')
    dump(images, batch / 'configs/judge-images.json')
    for name in ('alibaba.mts', 'exact-subprocess.ts', 'compare-child.mjs'):
        shutil.copyfile(A1 / 'judges' / name, batch / 'judges' / name)
    judge = batch / 'judges/alibaba.mts'
    judge.write_text("import { readFileSync } from 'node:fs';\n"
        "import { subprocessExactJudge } from './exact-subprocess.ts';\n"
        "const IMAGES = JSON.parse(readFileSync(new URL('../configs/judge-images.json', import.meta.url), 'utf8'));\n"
        "export const createAlibabaExactJudge = async (challenge: string) => {\n"
        "  if (!Object.hasOwn(IMAGES, challenge)) throw new Error('unknown challenge');\n"
        "  return await subprocessExactJudge({id: `local-alibaba-${challenge}-exact-v1`, "
        "scope: `local-alibaba/${IMAGES[challenge]}/oracle-v1`, challenge});\n};\n")
    exact = batch / 'judges/exact-subprocess.ts'
    source = exact.read_text()
    source, count = re.subn(r"const BASE = '[^']+';", 'const BASE = ' + json.dumps(str(batch)) + ';', source)
    if count != 1:
        raise ValueError('judge_base_not_replaced')
    exact.write_text(source)
    dump({'batchId': batch.name, 'authorization': {'status': 'pending'},
        'model': model, 'solverThinking': thinking, 'deadlineMs': round(deadline * 60000),
        'maxObservableTokensPerRun': max_tokens, 'slots': slots,
        'judge': {'module': 'judges/alibaba.mts', 'export': 'createAlibabaExactJudge'}}, batch / 'batch-meta.json')
    return {'generated': True, 'batch': batch.name, 'challenges_count': len(keys), 'authorization': {'status': 'pending'}}


def check_batch(batch):
    # This child loads only the profile module and the copied exact judge, never launcher.
    # Oracle bytes live in the child and its comparator pipe, not Python, argv, logs or reports.
    script = r'''
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const [batch,repo] = process.argv.slice(1);
const rows=[];
try {
 const {loadReleaseProfile}=await import(pathToFileURL(join(repo,'apps/cli/src/composition/releaseProfile.ts')).href);
 const {createAlibabaExactJudge}=await import(pathToFileURL(join(batch,'judges/alibaba.mts')).href);
 const oracles=JSON.parse(readFileSync(join(batch,'configs/oracles.json'),'utf8'));
 function selfBytes(path) {
   // Same single-line TOML string grammar as the copied comparator. No contents are emitted.
   let section='';
   for(const line of readFileSync(path,'utf8').split(/\r?\n/)) {
     const h=/^\s*\[([^\][]+)\]\s*(#.*)?$/.exec(line); if(h){section=h[1].trim();continue;}
     if(section!=='metadata')continue;
     const kv=/^\s*flag\s*=\s*(.*)$/.exec(line);if(!kv)continue;
     const basic=/^"((?:[^"\\]|\\.)*)"/.exec(kv[1].trim());
     const literal=/^'([^']*)'/.exec(kv[1].trim());
     if(basic)return Buffer.from(JSON.parse('"'+basic[1]+'"'),'utf8');
     if(literal)return Buffer.from(literal[1],'utf8');
     throw Error('unsupported');
   }
   throw Error('missing');
 }
 for(const key of Object.keys(oracles)) {
   const row={challenge:key,profile_loaded:false,wrong_candidate:'unavailable',self_compare:'unavailable'};
   let phase='release_profile_load_failed';
   try {
     await loadReleaseProfile(join(batch,'configs',key+'.profile.json'));row.profile_loaded=true;
     phase='judge_check_failed';
     const judge=await createAlibabaExactJudge(key);
     if(!judge.limits || judge.limits.attempts.kind!=='unlimited')throw Error('limits');
     const submit=bytes=>judge.submit({intent:'submit',challenge:key,bytes,signal:new AbortController().signal});
     row.wrong_candidate=(await submit(Buffer.from('flag{synthetic-wrong}'))).status;
     row.self_compare=(await submit(selfBytes(oracles[key].path))).status;
   } catch {row.gap=phase;}
   rows.push(row);
 }
 console.log(JSON.stringify({passed:rows.length>0&&rows.every(r=>r.profile_loaded&&r.wrong_candidate==='rejected'&&r.self_compare==='accepted'),challenges:rows}));
} catch {console.log(JSON.stringify({passed:false,challenges:rows,gap:'profile_or_judge_module_unavailable'}));}
'''
    try:
        result = subprocess.run(['node', '--import', str(REPO / 'node_modules/tsx/dist/loader.mjs'),
            '--input-type=module', '-e', script, str(Path(batch).resolve()), str(REPO)],
            cwd=REPO, capture_output=True, text=True, timeout=60)
        if result.returncode:
            return {'passed': False, 'gap': 'node_check_unavailable', 'challenges': []}
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {'passed': False, 'gap': 'node_check_unavailable', 'challenges': []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', type=Path)
    parser.add_argument('--challenges')
    parser.add_argument('--model')
    parser.add_argument('--deadline-min', type=float)
    parser.add_argument('--max-observable-tokens', type=int)
    parser.add_argument('--solver-thinking', choices=['enabled', 'disabled'])
    parser.add_argument('--check', action='store_true', help='check existing batch, or check immediately after generation')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        dump(self_test())
        return
    if not args.batch:
        parser.error('--batch is required')
    if args.challenges:
        if any(v is None for v in (args.model, args.deadline_min, args.max_observable_tokens, args.solver_thinking)):
            parser.error('model, deadline, tokens and thinking are required for generation')
        dump(generate(args.batch, args.challenges.split(','), args.model, args.deadline_min,
            args.max_observable_tokens, args.solver_thinking))
    elif not args.check:
        parser.error('--challenges or --check is required')
    if args.check:
        result = check_batch(args.batch)
        dump(result)
        if not result['passed']:
            sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        dump({'error': type(exc).__name__, 'reason': str(exc) if str(exc) in ERROR_CODES else 'unexpected_error'})
        sys.exit(1)
