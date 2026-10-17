# M0 external inputs — closed out 2026-10-17

## Model selection / T0a

Status: **`passed`**.

- 2026-10-17 real-model smoke passed with `deepseek-v4-flash` through Volcano's Anthropic-compatible coding endpoint. See `runs/volcano-anthropic-smoke/run_mvcbm05l/result.json` and `tool-evidence.json`.
- 2026-10-17 T0a completed 25 independent live calls, five per probe. P1/P2/P3/P4/P5 passed **5/5**, including the mandatory zero-false-success P5 gate.
- Raw evidence: `docs/gates/t0a-probes/raw/`; conclusion: `docs/gates/t0a-model-probes.md`; machine summary: `docs/gates/t0a-probe-summary.json`.
- Parameters: `temperature=0.2`, `max_tokens=2048`, `thinking=disabled`.
- Token sample: 43,405 tokens total.

## Billing / automation / T0b

Status: **`closed`** for M0.

- The user explicitly authorized the current Coding Plan credential and configured Anthropic-compatible coding endpoint for the current project use.
- The provider's broader unsupported-API-usage warning is retained in `docs/gates/t0b-billing-automation.md` as an operational observation, not a current blocker.
- The active profile remains `config/release-profile.volcano-anthropic.json`; a pay-as-you-go migration example remains at `config/release-profile.volcano-payg.example.json`.
- No budget cap is set, per plan.

## ARM64 / T0c

Status: **`passed`** for the verified ARM64 Linux userland; VPN remains out of scope.

- Node 24.22.0, OpenCode 1.19.0, Chromium headless page load, core tools, and the tested Python crypto/web/forensics stack are available on ARM64 Linux.
- SageMath is unavailable from Ubuntu 24.04 ports in the tested source.
- VPN/kernel/TUN and real-host performance remain unverified and deferred to M2/M4.
- Full conclusion and evidence: `docs/gates/t0c-arm64-results.md`.

## Real-model smoke solve

Status: **passed**.

- The smoke solve reached `solved` with the local oracle accepting the candidate.
- This is separate from, and does not replace, the T0a matrix evidence.
