#!/usr/bin/env python3
"""Materialize the off-arm product directory for the workbook paired control (team-decision design §7.2). 0 model calls.

Usage: python3 -I tests/manual/paired-control-product.py <out-dir>

The off arm is the product as it was before the workbook role rules, plus every later product change that is not about
the workbook: `product/` at BASE, with the commits in INCLUDE applied in order. Every commit touching `product/` after
BASE must be classified in INCLUDE or EXCLUDE; an unclassified one stops the script, so a later non-workbook change
cannot silently go missing from the off arm (nor a workbook change leak into it).

<out-dir> must not exist and must be outside the repository, so no second copy of the role files is tracked. Writes
<out-dir>/product/ and <out-dir>/manifest.json (commits, per-file sha256, files that differ from HEAD's product/).
Pass <out-dir>/product to launch as `product`.
"""
import hashlib, io, json, os, subprocess, sys, tarfile

BASE = '6adf73fa~1'
# Product commits after BASE that are not about the workbook: applied to the off arm, oldest first.
INCLUDE = ['05af1de2', '63b3633f', 'f6bd40ab', '13a93056']
# Workbook role rules: left out of the off arm.
EXCLUDE = ['6adf73fa', '2d22283d', '0cf1e606', 'ccdd0c0a', 'e625024d']


def git(*args, binary=False):
    out = subprocess.run(['git', *args], cwd=REPO, check=True, capture_output=True)
    return out.stdout if binary else out.stdout.decode()


def tree_hashes(root):
    result = {}
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            result[os.path.relpath(p, root)] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    return dict(sorted(result.items()))


if len(sys.argv) != 2:
    sys.exit(__doc__)
REPO = subprocess.run(['git', 'rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True).stdout.strip()
out = os.path.realpath(sys.argv[1])
if os.path.exists(out):
    sys.exit(f'refusing: {out} already exists')
if out == REPO or out.startswith(REPO + os.sep):
    sys.exit('refusing: output must be outside the repository')
if git('status', '--porcelain', '--', 'product'):
    sys.exit('refusing: product/ has uncommitted changes')

short = lambda ref: git('rev-parse', '--short=8', ref).strip()
touched = [short(c) for c in git('log', '--format=%H', f'{BASE}..HEAD', '--', 'product').split()]
known = {short(c): c for c in INCLUDE + EXCLUDE}
unclassified = [c for c in touched if c not in known]
if unclassified:
    sys.exit(f'refusing: product commits not classified in INCLUDE/EXCLUDE: {unclassified}')
missing = [c for c in known if c not in touched]
if missing:
    sys.exit(f'refusing: classified commits not found after {BASE} on HEAD: {missing}')

os.makedirs(out)
with tarfile.open(fileobj=io.BytesIO(git('archive', BASE, 'product', binary=True))) as tar:
    tar.extractall(out, filter='data')
for c in sorted(INCLUDE, key=lambda c: touched.index(short(c)), reverse=True):  # git log is newest first
    # One context line: included commits land on the older role files, whose neighbouring lines may differ.
    patch = git('diff', '-U1', f'{c}~1', c, '--', 'product', binary=True)
    subprocess.run(['git', 'apply', '--whitespace=nowarn', '-'], cwd=out, input=patch, check=True)

files = tree_hashes(os.path.join(out, 'product'))
head = {}
with tarfile.open(fileobj=io.BytesIO(git('archive', 'HEAD', 'product', binary=True))) as tar:
    for m in tar.getmembers():
        if m.isfile():
            head[os.path.relpath(m.name, 'product')] = hashlib.sha256(tar.extractfile(m).read()).hexdigest()
manifest = {
    'note': 'Off-arm product for the workbook paired control (team-decision design §7.2).',
    'head': short('HEAD'), 'base': short(BASE), 'included': [short(c) for c in INCLUDE], 'excluded': [short(c) for c in EXCLUDE],
    'files': files,
    'differs_from_head': sorted(k for k in set(files) | set(head) if files.get(k) != head.get(k)),
}
open(os.path.join(out, 'manifest.json'), 'x').write(json.dumps(manifest, indent=1) + '\n')
print(json.dumps({k: manifest[k] for k in ('head', 'base', 'included', 'excluded', 'differs_from_head')}))
