# M1 T-A / T-B / T-C — OpenCode trajectory 1 integration

Date: 2026-10-19. Checkout: `/Users/caihaoming/Documents/pentest-agent`, `main`. This is deterministic product-integration evidence. External model acceptance remains paused; the old 12-attempt batch and its 0/3 formal result remain unchanged.

## Implemented path

`CLI solve → OpenCode 1.19.3 session → public plugin hooks/tools → authenticated loopback Bridge → Tool Runtime → independent local replay → Platform Service/local oracle`.

The installed SDK/plugin packages remain lockfile-pinned to 1.19.0; the actual OpenCode executable is checked against 1.19.3 before a session starts. These are separate version identities. No fork or replacement model loop was introduced.

- All product `solve` requests now require `opencode.configPath`. Provider/model/temperature come from that OpenCode config. Direct provider profiles and `--allow-stub` cannot fall back to the former JSON-action route.
- The supervisor binds the actual `ses_…` ID to its immutable run/challenge/task/responsibility/lease identity before any prompt. Plugin tools pass OpenCode's ToolContext identity; the host supplies scope, lease, IDs, hashes, fingerprints and evidence references. A copied session binding cannot be mutated to gain capabilities.
- The product manifest has workspace list/read/search/patch, bounded Node-script batch execution and candidate registration. Built-in shell, other agents, MCP, external skills, title/summary and automatic compaction are disabled for this slice. Project config/instructions are not loaded from the material workspace.
- OpenCode's public message/system hooks check model-bound content through the host gateway. Known control-secret values are rejected before managed tool arguments/results enter canonical evidence. A completed failed job returns complete stdout and stderr; truncated capture is marked incomplete.
- Each actual job call produces host-derived hypothesis/experiment/receipt records. Ordinary tool rejections are returned to the same OpenCode session. Shared step/tool/observed-token budgets and wall-clock deadline remain host-controlled; final output is reconstructed from the canonical checkpoint.
- Candidate registration uses the latest successful stdout, publishes exact value/evidence refs, replays the published local solution with a separate verifier task, then uses the existing verified Coordinator/Platform Service to reach the local oracle. A typed candidate by itself cannot produce solved.

## Retirement and retained scope

`m1ContractProbe.ts` was removed from the CLI. `provider-solver-driver.ts` and the old `solver-loop.ts` were removed from production and are not exported. Frozen copies under `tests/legacy/` preserve existing M1b regression tests, including prior uncommitted fixes; they are excluded from the production build and must not be extended. Candidate/deadline control types were extracted into `candidate-control.ts`.

The current product path accepts supplied local Node-script materials. The old direct-provider HTTP CLI route is explicitly blocked. Its resolver, Runtime methods and other frozen domain/verification/interactive assets remain in the repository and their component regressions pass; they have not been ported into this trajectory's OpenCode manifest.

## Behavior grading and golden path

`docs/gates/m1-t1-acceptance.py grade <run-folder> --deterministic` independently checks SQLite events, immutable artifact hashes, failed non-zero execution with stderr → model-context delivery of that exact stderr → proper local patch → same-script successful rerun → current independent replay → confirmed authoritative oracle acceptance.

The grader validates patch semantics and lineage, without prescribing patch count, byte delta or replacement text. Two different valid repairs pass, including a two-patch repair using a decoded intermediate variable. Missing failure, unread stderr, whole-file replacement, a detached oracle effect and a same-hash artifact reference outside the run fail. Oracle acceptance is bound to the same challenge/task/lease. The preset stops at the initial failed execution; the model provider supplies every subsequent read/repair/run/candidate action.

`run-next` and `check` do not launch a new formal run: they return the explicit paused/STOP_RULE condition. Old formal records remain historical evidence and are not regraded as OpenCode results by this new grader. A new T-D batch still needs its own authorized freeze/preflight/dispatch procedure.

## Validation

| Check | Result |
| --- | --- |
| `npm run gate:m0` | 27 files / 169 tests passed, including actual OpenCode integration |
| `npm run gate:m1` | 3/3 passed through actual OpenCode |
| `npm test` | 53 files / 297 tests passed |
| `npm run typecheck` / `npm run build` | passed |
| `git diff --check` | passed |
| Production search for `SolverActionSchema` / `ProviderSolverDriver` in `apps` and `packages` | no matches |

Tests ran in an execution context that permits loopback TCP and PTY. The earlier restricted-context timeouts did not reproduce: all 10 interactive Runtime tests passed.

The first actual OpenCode startup experiment revealed automatic plugin dependency bootstrap and timed out before a model request. The launcher now prepares a link to the already-installed, lockfile-backed dependencies before startup, uses isolated per-run config/data, and sets npm offline/ignore-scripts. Golden-path tests assert that no `.npm` install/cache directory was created and the prepared lockfile is unchanged. Unsupported dynamically installed provider adapters are rejected before startup. Subsequent golden paths take roughly two seconds; no dependency installation is needed in the running solve.

The local provider's reported usage is deterministic fixture data, not billable model usage and not a basis for the final release budget. Missing usage normalized by OpenCode to zero is surfaced as `unavailable` with null counts. Unmanaged shell calls, fabricated candidates and shared-budget exhaustion have actual-OpenCode rejection tests.

## Retained canonical evidence

Summary: [m1-opencode-evidence-20261019.json](m1-opencode-evidence-20261019.json).

Run: `runs/m1-opencode-t1-deterministic-20261019-0a88e90a/run` (ignored run data retained locally). Its canonical database is `state/run_8d7dec4b-e2ed-4e81-aa36-4d39f383929c.sqlite`, SHA-256 `2fd031bd0f2ec2aca348c28099efb88c42192dca15eea8593fa45cf1ea086a11`. The grader passes all 11 checks; 29 canonical events record the real `ses_eac078fccffeZbs6wed1EayZaA` OpenCode session. There were six local fixture provider requests and zero external model requests.

## Remaining acceptance boundary

T-A engineering integration, T-B and T-C are implemented and deterministically verified. T-A's explicit **real-model solve evidence** is still unchecked and must be obtained on the same path during T-D. Neither T-A nor M1 is declared COMPLETE. No new acceptance batch, external model run, final budget, commit or push was performed.

Developer examples are `config/release-profile.m1-opencode.example.json` and `config/opencode.m1.example.json`. The latter carries only an env credential reference and preserves the previously requested Bailian DeepSeek candidate configuration; API availability, quota and real model ability have not been checked here.
