# Solver tool image (candidate). Design: docs/superpowers/specs/2026-11-21-design-v1-tool-image-and-architecture.md
# One RUN per capability layer so `docker history` shows each layer's size.
# Ubuntu ports (arm64) does not apply apt snapshots, so versions are pinned by the base digest plus the
# installed-package manifest written to /opt/ctf-tools/packages.txt, not by a package snapshot.
FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
ARG APT="apt-get install -y --no-install-recommends"

# General execution: Python, Node, shell, text, archive and encoding tools.
RUN apt-get update && $APT python3 python3-venv python3-pip python3-dev nodejs file xxd binutils unzip \
      p7zip-full zstd xz-utils bzip2 jq ca-certificates curl procps util-linux netcat-openbsd socat \
    && rm -rf /var/lib/apt/lists/*

# Compilers: C/C++, Go and Rust, used offline with their standard libraries only.
RUN apt-get update && $APT build-essential golang-go rustc cargo && rm -rf /var/lib/apt/lists/*

# Web parsing and Crypto mathematics.
RUN apt-get update && $APT python3-requests python3-bs4 python3-lxml python3-numpy python3-sympy \
      python3-gmpy2 python3-z3 python3-pycryptodome pari-gp && rm -rf /var/lib/apt/lists/*

# Misc and forensics: format identification, unpacking, metadata, images.
RUN apt-get update && $APT libimage-exiftool-perl binwalk foremost steghide sleuthkit pngcheck python3-pil \
    && rm -rf /var/lib/apt/lists/*

# Pwn and Reverse: cross-architecture analysis, debugger, QEMU user mode with x86 sysroots and cross compilers.
RUN apt-get update && $APT -o Acquire::Retries=5 gdb-multiarch qemu-user libc6-amd64-cross libc6-i386-cross gcc-x86-64-linux-gnu \
      gcc-i686-linux-gnu radare2 patchelf ltrace strace elfutils checksec && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv --system-site-packages /opt/ctf-venv && /opt/ctf-venv/bin/pip install --no-cache-dir pwntools

# Mobile: static APK analysis.
RUN apt-get update && $APT -o Acquire::Retries=5 default-jdk-headless apktool && rm -rf /var/lib/apt/lists/*

# x86 cross-compilation headers, so self-written x86 samples and helpers can be built inside the image.
RUN apt-get update && $APT -o Acquire::Retries=5 libc6-dev-amd64-cross libc6-dev-i386-cross && rm -rf /var/lib/apt/lists/*

# Ubuntu's python3-pycryptodome only provides the `Cryptodome` namespace; most scripts import `Crypto`.
RUN /opt/ctf-venv/bin/pip install --no-cache-dir pycryptodome

COPY inventory.py /opt/ctf-tools/inventory.py
RUN dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\n' > /opt/ctf-tools/packages.txt \
    && /opt/ctf-venv/bin/pip freeze > /opt/ctf-tools/python-packages.txt \
    && python3 /opt/ctf-tools/inventory.py > /opt/ctf-tools/inventory.json \
    && chmod -R a+rX /opt/ctf-tools

# ubuntu:24.04 already ships the non-root user `ubuntu` (uid 1000); jobs may also run under the caller's uid.
USER ubuntu
ENV PATH=/opt/ctf-venv/bin:/usr/local/bin:/usr/bin:/bin
