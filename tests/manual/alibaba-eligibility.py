#!/usr/bin/env python3
"""Offline Alibaba metadata census. Never expose oracle literals or environment contents."""
import argparse
import json
from pathlib import Path
import tempfile
import re
import sys
import subprocess
import tomllib
from collections import Counter

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _candidate_common import GATE, compose_structure, dump, key_of, read_json, token

REPO = Path(__file__).resolve().parents[2]


def self_test():
    with tempfile.TemporaryDirectory(prefix='.eligibility-self-', dir=Path(__file__).parent) as tmp:
        task = Path(tmp) / 'alibabactf-2026-web-synthetic'
        env = task / 'environment'
        env.mkdir(parents=True)
        (task / 'task.toml').write_text('[metadata]\nflag="flag{synthetic}"\nprimary_service="app"\ncategory="web"\ndifficulty="medium"\n')
        compose = env / 'docker-compose.yaml'
        base = 'services:\n  main: {}\n  app:\n    image: synthetic\n    expose: ["8080"]\n'
        compose.write_text(base)
        row = inspect_task(task, set())
        assert row['task_toml_ok'] and row['compose_ok']
        assert row['judge_consistency'] == 'unknown'
        assert row['container_port'] == 8080 and not row['already_run']
        baseline = Path(tmp) / 'baseline.json'
        baseline.write_text(json.dumps({'runs': [
            {'challenge': 'synthetic', 'solved': True, 'posthoc_accepted': None},
            {'challenge': 'synthetic2', 'solved': False, 'posthoc_accepted': True},
            {'challenge': 'synthetic3', 'solved': 'unknown', 'posthoc_accepted': None}]}))
        assert accepted_challenges(baseline) == {'synthetic', 'synthetic2'}
        assert accepted_challenges(Path(tmp) / 'missing.json') == set()
        assert inspect_task(task, {'synthetic'}, {'synthetic'})['judge_consistency'] == 'confirmed_by_accepted_run'
        cases = [
            ('    environment:\n      FLAG: "flag{synthetic}"\n', 'compose_env_equals_toml'),
            ('    environment:\n      - FLAG=flag{synthetic}\n', 'compose_env_equals_toml'),
            ('    environment:\n      FLAG: "different-synthetic"\n', 'compose_env_differs'),
            ('    environment:\n      FLAG: "${SYNTHETIC_FLAG}"\n', 'compose_env_interpolated'),
            ('    environment:\n      - FLAG\n', 'unknown'),
            ('    env_file: values.env\n', 'compose_env_equals_toml'),
            ('    env_file: [values.env]\n    environment:\n      FLAG: different-synthetic\n', 'compose_env_differs'),
            ('    env_file: missing.env\n', 'unknown'),
        ]
        (env / 'values.env').write_text('FLAG="flag{synthetic}"\n')
        for config, expected in cases:
            compose.write_text(base + config)
            row = inspect_task(task, {'synthetic'}, {'synthetic'})
            assert row['judge_consistency'] == expected, expected
            assert row['already_run']
            assert 'flag{synthetic}' not in json.dumps(row)
        compose.write_text(base + '    env_file: values.env\n')
        assert inspect_task(task, set())['flag_env_names'] == ['FLAG']
        (env / 'values.env').write_text('FLAG=${SYNTHETIC_FLAG}\n')
        assert inspect_task(task, set())['judge_consistency'] == 'compose_env_interpolated'
        (env / 'values.env').write_text('FLAG=different-synthetic\n')
        assert inspect_task(task, set())['judge_consistency'] == 'compose_env_differs'
        # Protected or symlinked references stay unknown, even with accepted history.
        (env / 'linked.env').symlink_to(env / 'values.env')
        compose.write_text(base + '    env_file: linked.env\n')
        assert inspect_task(task, set(), {'synthetic'})['judge_consistency'] == 'unknown'
        (task / 'task.toml').write_text('invalid = [')
        row = inspect_task(task, set())
        assert not row['task_toml_ok'] and row['category'] == 'unknown'
        assert row['judge_consistency'] == 'unknown'
    return {'self_test': True}


def inspect_task(task, already, accepted=frozenset()):
    task = Path(task)
    env = task / 'environment'
    compose_paths = [env / n for n in ('docker-compose.yaml', 'docker-compose.yml', 'compose.yaml', 'compose.yml')
        if (env / n).is_file() and not (env / n).is_symlink()]
    structure = compose_structure(compose_paths[0]) if len(compose_paths) == 1 else {'ok': False, 'services': []}
    # `main` is the upstream agent slot, reset out of batch overrides, not a target service.
    targets = [s for s in structure['services'] if s['name'] != 'main']
    key = key_of(task.name)
    metadata, names = metadata_and_consistency(task, compose_paths, key in accepted)
    names = sorted(set(names) | {n for s in targets for n in s['environment_names'] if 'FLAG' in n.upper()})
    primary = metadata.pop('primary_service')
    service = next((s for s in targets if s['name'] == primary), None)
    ports = service['ports'] if service else []
    complete = bool(structure['ok'] and targets and service and ports and
        all(s.get('image') or s.get('build_present') for s in targets))
    reason = 'ok' if complete else 'primary_service_missing' if not service else 'container_port_missing' if not ports else 'compose_incomplete'
    return {'challenge': token(key), 'task': token(task.name), **metadata,
        'compose_ok': complete, 'compose_reason': reason,
        'primary_service': primary, 'container_port': ports[0] if ports else 'unknown',
        'services_count': len(targets), 'compose_services_count': len(structure['services']),
        'flag_env_names': names, 'has_attachments': has_attachments(task),
        'already_run': key in already,
        'instruction_bytes': (task / 'instruction.md').stat().st_size if (task / 'instruction.md').is_file() else 'unavailable'}


def metadata_and_consistency(task, compose_paths, accepted):
    """Compare in memory; only categories/names leave the YAML child, never values.

    Read deployment settings and referenced env files only, not build contexts/images.
    Existing acceptance is a fallback solely when no FLAG setting is present.
    """
    try:
        document = tomllib.loads((task / 'task.toml').read_text())
        meta = document.get('metadata') or {}
        literal = meta.get('flag')
        present = isinstance(literal, str) and bool(literal.strip())
        base = {'task_toml_ok': True, 'metadata_flag_present': present,
            'category': token(meta.get('category')), 'difficulty': token(meta.get('difficulty')),
            'primary_service': token(meta.get('primary_service'))}
        if len(compose_paths) != 1:
            return dict(base, judge_consistency='unknown'), []
        script = r'''
const fs=require('node:fs'),path=require('node:path'),Y=require('yaml');
const names=new Set();
try {
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 const root=path.dirname(input.compose), doc=Y.parse(fs.readFileSync(input.compose,'utf8'));
 let incomplete=false;
 const values=[];
 const flagged=k=>/FLAG/i.test(k);
 const remember=k=>{if(flagged(k)&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))names.add(k);};
 const interpolation=v=>/\$(?:\{|[A-Za-z_])/.test(v.replace(/\$\$/g,''));
 function readEnv(ref) {
   const spec=typeof ref==='string'?{path:ref}:ref;
   if(!spec||typeof spec.path!=='string'||interpolation(spec.path))throw Error();
   const dest=path.resolve(root,spec.path), relative=path.relative(root,dest);
   if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error();
   let part=root;
   for(const segment of relative.split(path.sep)) {
     if(['solution','tests','private','.git','node_modules'].includes(segment))throw Error();
     part=path.join(part,segment);if(fs.lstatSync(part).isSymbolicLink())throw Error();
   }
   const result={};
   for(const line of fs.readFileSync(dest,'utf8').split(/\r?\n/)) {
     if(!line.trim()||/^\s*#/.test(line))continue;
     const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.*))?$/.exec(line);
     if(!m)throw Error();
     const key=m[1];remember(key);if(!flagged(key))continue;
     let value=m[2];
     if(value===undefined){result[key]=null;continue;}
     if(spec.format!=='raw') {
       if(value.startsWith('"')) {
         const q=/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(value);if(!q)throw Error();
         value=JSON.parse(q[1]);
       } else if(value.startsWith("'")) {
         const q=/^'([^']*)'\s*(?:#.*)?$/.exec(value);if(!q)throw Error();
         result[key]={value:q[1],interpolated:false};continue;
       } else value=value.replace(/\s+#.*$/,'').trimEnd();
     }
     result[key]={value,interpolated:spec.format!=='raw'&&interpolation(value)};
   }
   return result;
 }
 for(const [name,s] of Object.entries(doc.services||{})) {
   if(name==='main')continue;
   const effective={};
   const refs=s.env_file===undefined?[]:Array.isArray(s.env_file)?s.env_file:[s.env_file];
   for(const ref of refs) {try {Object.assign(effective,readEnv(ref));}catch{incomplete=true;}}
   const entries=Array.isArray(s.environment)?s.environment.map(item=>{
     const text=String(item),i=text.indexOf('=');return i<0?[text,null]:[text.slice(0,i),text.slice(i+1)];
   }):Object.entries(s.environment||{});
   for(const [key,value] of entries) {
     remember(key);if(!flagged(key))continue;
     effective[key]=value===null?null:{value:String(value),interpolated:interpolation(String(value))};
   }
   values.push(...Object.values(effective));
 }
 let category='unknown';
 if(values.some(v=>v?.interpolated))category='compose_env_interpolated';
 else if(input.present&&values.some(v=>v!==null&&v.value!==input.literal))category='compose_env_differs';
 else if(!incomplete&&input.present&&values.length&&values.every(v=>v!==null))category='compose_env_equals_toml';
 else if(!incomplete&&!values.length&&input.present&&input.accepted)category='confirmed_by_accepted_run';
 process.stdout.write(JSON.stringify({category,names:[...names].sort()}));
} catch {process.stdout.write(JSON.stringify({category:'unknown',names:[...names].sort()}));}
'''
        result = subprocess.run(['node', '-e', script], input=json.dumps({
            'compose': str(compose_paths[0].resolve()), 'literal': literal,
            'present': present, 'accepted': accepted}), cwd=REPO,
            capture_output=True, text=True, timeout=15)
        safe = json.loads(result.stdout) if result.returncode == 0 else {'category': 'unknown', 'names': []}
        return dict(base, judge_consistency=safe['category']), safe['names']
    except (OSError, ValueError, TypeError):
        return {'task_toml_ok': False, 'metadata_flag_present': False,
            'category': 'unknown', 'difficulty': 'unknown', 'primary_service': 'unknown',
            'judge_consistency': 'unknown'}, []


def accepted_challenges(baseline):
    return {r['challenge'] for r in read_json(baseline).get('runs', [])
            if r.get('solved') is True or r.get('posthoc_accepted') is True} if baseline.is_file() else set()


def has_attachments(task):
    # Existence only: do not open public/attachments or read archive members.
    if any((task / name).exists() for name in ('public', 'attachments', 'attachment')):
        return True
    return any(p.is_file() and ('attachment' in p.name.lower() or p.suffix.lower() in ('.zip', '.tar', '.gz'))
        for p in (task / 'environment').iterdir()) if (task / 'environment').is_dir() else False


def already_run(baseline, table):
    keys = set()
    if baseline.is_file():
        keys.update(r['challenge'] for r in read_json(baseline).get('runs', []) if r.get('challenge') != 'unknown')
    if table.is_file():
        for line in table.read_text().splitlines():
            cells = [c.strip() for c in line.strip().split('|')]
            if len(cells) >= 9 and re.match(r'^\d{4}-web-', cells[1]) and re.search(r'a[1-8]\s', cells[7]):
                keys.add(key_of(cells[1]))
    return keys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=REPO / 'external_labs/alibaba-ctf')
    parser.add_argument('--baseline', type=Path, default=GATE / 'summary.json')
    parser.add_argument('--output', type=Path, default=GATE / 'eligibility.json')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        dump(self_test())
        return
    already = already_run(args.baseline, REPO / 'docs/local-challenges.md')
    accepted = accepted_challenges(args.baseline)
    rows = [inspect_task(p, already, accepted) for p in sorted(args.root.iterdir())
            if p.is_dir() and not p.is_symlink() and p.name.startswith('alibabactf-')]
    consistent = {'compose_env_equals_toml', 'confirmed_by_accepted_run'}
    result = {'challenges': rows, 'totals': {'tasks': len(rows),
        'compose_ok': sum(r['compose_ok'] for r in rows),
        'judge_consistency': {k: Counter(r['judge_consistency'] for r in rows)[k] for k in
            ('compose_env_equals_toml', 'compose_env_differs', 'compose_env_interpolated', 'confirmed_by_accepted_run', 'unknown')},
        'eligible': sum(r['compose_ok'] and r['judge_consistency'] in consistent and
            r['services_count'] == 1 and r['category'] == 'web' and r['difficulty'] in ('easy', 'medium') for r in rows),
        'eligible_never_run': sum(r['compose_ok'] and r['judge_consistency'] in consistent and
            r['services_count'] == 1 and r['category'] == 'web' and r['difficulty'] in ('easy', 'medium') and
            not r['already_run'] for r in rows)}}
    dump(result, args.output)
    dump(result)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        dump({'error': type(exc).__name__})
        sys.exit(1)
