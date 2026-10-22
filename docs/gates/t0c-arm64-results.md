# T0c — ARM64 Linux toolchain results

**Date:** 2026-10-17  
**Host:** macOS Apple Silicon / Docker Desktop  
**Server:** Docker `29.5.3`, Linux `aarch64`  
**Image:** Ubuntu 24.04.5 LTS, `--platform linux/arm64`  
**Conclusion:** **Available for the verified ARM64 Linux userland.** Node 24, OpenCode 1.19.0, Chromium headless, the core tool set, and the tested Python crypto/web/forensics stack all pass. SageMath is unavailable in the Ubuntu 24.04 ports candidate set. This result does **not** verify VPN, kernel/TUN behavior, or real-host performance.

## Evidence files

> 以下日誌與腳本已在 2026-10-22 倉庫精簡中刪除，原文件保存在快照 commit `3a2c32a`（可用 `git show 3a2c32a:<路徑>` 取回）。本文結論為歷史摘要，不能在當前工作樹原樣重驗。

- Setup log: `docs/gates/t0c-arm64-verify.log` (complete apt / Node / OpenCode / core-tool setup and first half of functional checks)
- Final functional log: `docs/gates/t0c-arm64-verify-final.log` (ends with `T0C-VERIFY-OK`)
- Main one-off script: `docs/gates/t0c-arm64-verify.sh`
- Final continuation script: `docs/gates/t0c-arm64-verify-final.sh`

The first run spent **936 seconds (15m36s)** installing the Ubuntu toolchain, Node 24, OpenCode, Python wheels, and Playwright Chromium before stopping on a syntax error in a test fixture. The fixed continuation run then completed all remaining functional checks in **12 seconds** from the prepared ephemeral image. `T0C-VERIFY-OK` is present in the final log.

## Size

| Item | Measured size |
| --- | ---: |
| Ubuntu 24.04 base image | 141 MB |
| Prepared one-off ARM64 verification image | 6.2 GB |
| Prepared verification container (reported by Docker) | 14.3 MB delta / 4.67 GB virtual |

The 6.2 GB figure is the committed one-off evidence image, including global Node/Playwright and the Python virtualenv; it is not a product runtime image and should not be shipped as-is.

## Results

| Component | Result | Evidence / boundary |
| --- | --- | --- |
| Node 24 | **available** | Container reports Node `v24.22.0`; `crypto.randomBytes` + SHA-256 fixture passes. |
| OpenCode | **available** | `opencode --version` reports `1.19.0`. |
| Playwright Chromium | **available** | `playwright install --with-deps chromium`; a real headless page opens and returns the expected title: `chromium-functional-ok`. |
| Core native tools | **available** | Functional checks pass for Git, jq, ripgrep, file, xxd, gcc/objdump, 7z, OpenSSL, netcat, nmap, sqlmap, exiftool, tshark, ffmpeg/ffprobe, qpdf/poppler, pngcheck, and qrencode/zbar. |
| Python crypto / web / misc | **available** | ARM64 wheels install and functional checks pass for httpx, requests, BeautifulSoup/lxml, websockets, dnspython, pycryptodome, cryptography, sympy, gmpy2, Z3, pwntools, construct, Pillow, and scapy. |
| SageMath | **unavailable from this Ubuntu 24.04 ports source** | `apt-cache policy sagemath` reports `Candidate: (none)`. Treat as an optional heavy-Crypto dependency, not an M0 blocker. |

## Boundary and VPN risk

This container test answers only whether ARM64 Linux userland packages exist and run. It does **not** verify:

- Linux kernel modules, TUN/TAP privileges, or Docker Desktop's networking path;
- a VPN client's ARM64 build or its compatibility with the target SSLVPN;
- real-host performance, battery, memory, or long-run stability;
- a packaged production image size.

Recorded risk: ARM64 Linux VPN client support remains unverified and is deferred to M2/M4. Fallbacks are (1) an independent VPN gateway host, (2) a pre-validated VPN service container, or (3) an x86 host for VPN with routing to the ARM64 environment. This must be tested from the actual Tool Runtime network before any M2 platform work depends on it.
