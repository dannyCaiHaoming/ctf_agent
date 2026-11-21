#!/usr/bin/env python3
"""Write the tool inventory as JSON: capability, entry, version line, architecture and status.

Run at image build time. Status is `installed` when the entry answers its version probe, `missing`
when it does not, and `needs_build` for tools with no Ubuntu arm64 package. `tested` is never set
here: only a job-level check (tests/manual/tool-image-check.mts) can show that a capability works.
"""
import json
import platform
import subprocess

PY = '/opt/ctf-venv/bin/python3'

# (capability, entry, version probe argv)
TOOLS = [
    ('general', 'python3', [PY, '--version']),
    ('general', 'node', ['node', '--version']),
    ('general', 'jq', ['jq', '--version']),
    ('general', 'file', ['file', '--version']),
    ('general', 'xxd', ['xxd', '-v']),
    ('general', '7z', ['7z', 'i']),
    ('general', 'curl', ['curl', '--version']),
    ('general', 'socat', ['socat', '-V']),
    ('compile', 'gcc', ['gcc', '--version']),
    ('compile', 'g++', ['g++', '--version']),
    ('compile', 'go', ['go', 'version']),
    ('compile', 'rustc', ['rustc', '--version']),
    ('compile', 'cargo', ['cargo', '--version']),
    ('web', 'python3: requests, bs4, lxml', [PY, '-c', 'import requests, bs4, lxml; print(requests.__version__)']),
    ('crypto', 'python3: sympy, gmpy2, z3', [PY, '-c', 'import sympy, gmpy2, z3; print(sympy.__version__)']),
    ('crypto', 'python3: Crypto (pycryptodome)', [PY, '-c', 'import Crypto; print(Crypto.__version__)']),
    ('crypto', 'gp', ['gp', '--version-short']),
    ('misc', 'exiftool', ['exiftool', '-ver']),
    ('misc', 'binwalk', ['binwalk', '--help']),
    ('misc', 'foremost', ['foremost', '-V']),
    ('misc', 'steghide', ['steghide', '--version']),
    ('misc', 'pngcheck', ['pngcheck', '-h']),
    ('misc', 'fls (sleuthkit)', ['fls', '-V']),
    ('misc', 'python3: PIL', [PY, '-c', 'import PIL; print(PIL.__version__)']),
    ('pwn-reverse', 'gdb-multiarch', ['gdb-multiarch', '--version']),
    ('pwn-reverse', 'qemu-x86_64', ['qemu-x86_64', '--version']),
    ('pwn-reverse', 'qemu-i386', ['qemu-i386', '--version']),
    ('pwn-reverse', 'x86_64-linux-gnu-gcc', ['x86_64-linux-gnu-gcc', '--version']),
    ('pwn-reverse', 'i686-linux-gnu-gcc', ['i686-linux-gnu-gcc', '--version']),
    ('pwn-reverse', 'objdump', ['objdump', '--version']),
    ('pwn-reverse', 'r2', ['r2', '-v']),
    # pwntools also installs a `checksec` earlier on PATH; the Ubuntu tool stays reachable by its full path.
    ('pwn-reverse', '/usr/bin/checksec', ['/usr/bin/checksec', '--version']),
    ('pwn-reverse', 'checksec (pwntools, first on PATH)', ['checksec', '--help']),
    ('pwn-reverse', 'patchelf', ['patchelf', '--version']),
    ('pwn-reverse', 'strace', ['strace', '-V']),
    ('pwn-reverse', 'ltrace', ['ltrace', '-V']),
    ('pwn-reverse', 'python3: pwntools', [PY, '-c', 'import pwn, importlib.metadata; print(importlib.metadata.version("pwntools"))']),
    ('mobile', 'apktool', ['apktool', '--version']),
    ('mobile', 'java', ['java', '-version']),
]
NEEDS_BUILD = [('pwn-reverse', 'ghidra'), ('mobile', 'jadx'), ('mobile', 'dex2jar'), ('mobile', 'smali'),
               ('crypto', 'sagemath')]
SYSROOTS = {'x86_64': '/usr/x86_64-linux-gnu', 'i386': '/usr/i686-linux-gnu'}


def probe(argv):
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    # A Python import must succeed; other tools may exit non-zero on a help or version flag but must not be missing.
    if (argv[0] == PY and done.returncode != 0) or done.returncode in (126, 127):
        return None
    text = (done.stdout or done.stderr).strip()
    return text.splitlines()[0][:160] if text else ''


def main():
    tools = []
    for capability, entry, argv in TOOLS:
        line = probe(argv)
        tools.append({'capability': capability, 'entry': entry, 'version': line,
                      'status': 'missing' if line is None else 'installed'})
    tools += [{'capability': c, 'entry': e, 'version': None, 'status': 'needs_build'} for c, e in NEEDS_BUILD]
    print(json.dumps({
        'arch': platform.machine(),
        'offline': 'Tools run without network access; no package can be installed while solving.',
        'x86': {'run': 'qemu-x86_64 -L <sysroot> <program> (qemu-i386 for 32-bit)',
                'debug': 'qemu-x86_64 -g <port> ... with gdb-multiarch', 'sysroots': SYSROOTS},
        'tools': tools,
    }, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
