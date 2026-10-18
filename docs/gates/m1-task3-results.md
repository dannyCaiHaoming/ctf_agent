# M1 Task 3 implementation report

Implemented in `/Users/caihaoming/.codex/worktrees/m1-task1-responsibilities/pentest-agent`, branch `codex/m1-task1-responsibilities`. Existing Task 1/2 files and uncommitted work are preserved except for the documented additive Task 3 integration. No commits, pushes, subagents, external operations, or real model calls.

## Scope and API

- New `packages/supervisor/src/solver-loop.ts`: reusable, single-use `SolverLoop`, typed `SolverDriver.decide(request, { signal, maxTokens })`, strict `SolverActionSchema`, `SolverFailure` and public interfaces. Exports appended to Supervisor index; M0 smoke APIs remain unchanged.
- The host binds a ResponsibilityRegistry session once and rechecks its task/session/attempt/lease authority through ordinary read/search/patch/command/repair steps. Strategy is a decision phase within the authorized responsibility set; it does not redispatch the complete role pipeline.
- The driver sees ready challenge/material refs/snapshot, immutable experiment state, complete raw terminal observations, current phase and remaining budgets. Commands use real ToolRuntime jobs with host authorization; file tools use real Workspace operations with path and symlink scope checks. A patch must replace exactly one bounded proper substring, with immutable before/after artifacts. Repairs preserve the original experiment and fingerprint.
- HypothesisManager remains the only hypothesis/experiment state machine. Actual runtime terminal receipts are stored in StateStore and resolved from its canonical event ledger, with exact task/session/attempt, experiment, fingerprint, ordered step and verified immutable artifact bindings. No parallel fake experiment state or unconditional semantic validator exists. Callers must supply a trusted artifact-based semantic discriminator.
- `hypothesis_falsified` is accepted only through successful, semantically substantiated `conclude(rejected)` evidence; it saves contradicting refs before Strategy. `tool_invocation_error` and `output_parse_error` retain full raw errors for bounded local repair. `model_transient` and `model_rate_limited` count original usage/attempts, respect Retry-After and bounded retries. `scope_denied`/`blocked_data` block without mechanism rejection. Resource/step/tool/token/deadline exhaustion checkpoints and returns for reprioritization; missing provider usage fails closed.
- Driver adapters must return authoritative usage with provenance; deterministic adapters report zero live calls. Provider adapters can return classified errors with full raw error plus usage. Unavailable usage is persisted explicitly and stops further calls. The AbortSignal/deadline bounds a hanging adapter; adapters must honor cancellation to stop any remote work.
- Additive `solver.activity` EventDelta contract records starts, authoritative usage/action, command input, stream cursors, terminal receipts, patch artifacts, repairs, retries, experiment snapshots, semantic conclusions/progress, windows, strategy requests/switches, candidates and checkpoints through SQLite. No JSONL second truth was added. The existing StateStore implementation required no changes.
- Candidate artifacts/evidence remain `candidate_only`; this module has no submission capability. `solverDisposition` provides a total mapping from internal disposition to the exact spec §7.1 `solve_state` and `outcome` vocabulary. No result is labeled solved or oracle accepted.
- Small essential Runtime addition: spawned-command `error` events are retained as raw output and terminate the job as failure instead of becoming unhandled host errors.

## TDD and review-driven fixes

Initial red, before implementation:

```text
npx vitest run tests/integration/solver-loop-trajectories.test.ts
1 failed file, 2 failed tests: SolverLoop is not a constructor
```

Initial green: both fixtures passed using real local commands. Subsequent regression coverage exercises failure classification, bounded repairs, semantic rejection, file scope, output gaps and error tails, missing usage, retry limits/Retry-After, steps/tools/tokens and actual process/driver deadlines.

Controller pre-review identified window closure before semantic assessment. Three focused tests reproduced red:

```text
npx vitest run tests/integration/solver-loop-windows.test.ts
1 failed file, 3 failed tests
second successful candidate: resource_exhausted instead of candidate_only
second explicit inconclusive assessment: premature Strategy phase
old-window progress: masked later no-progress work
```

Fix: successful completion now gives the same Solver an opportunity to conclude or register a candidate. Windows close after semantic assessment or when departing a completed experiment. Evidence is credited to its completed window, and Strategy acknowledgment occurs when an actual replacement route is admitted. These three regressions pass.

The related representation-exhaustion edge required an additive host-only `HypothesisManager.abandonExperiment(id, reason)`. After the sequential loop proves no local dispatch remains in flight, it retains an `abandoned` experiment and inconclusive reason without inventing a runtime receipt. Abandoned work cannot accept later completion/receipts and is excluded from genuine experiment windows. Two integration regressions cover abandonment before any tool and between steps of a multi-step experiment, then successful admission of the replacement route. This is a local cancellation boundary, not durable restart/watch functionality.

## Final deterministic validation

```text
npx vitest run tests/integration/solver-loop-trajectories.test.ts tests/integration/solver-loop-failures.test.ts tests/integration/solver-loop-windows.test.ts tests/integration/solver-loop-abandonment.test.ts tests/contract/hypothesis-lifecycle.test.ts tests/contract/hypothesis-progress.test.ts tests/contract/hypothesis-routes.test.ts tests/integration/smoke-solve.test.ts
8 files passed, 64 tests passed
  Task 3 loop integration: 4 files, 28 tests
  Existing Task 2 contracts: 3 files, 33 tests
  Existing M0 smoke: 1 file, 3 tests

npm run typecheck
exit 0

git diff --check
exit 0

npm run gate:m0
18 files passed, 125 tests passed
nested deterministic suite: 17 files passed, 123 tests passed
```

The gate was first run before controller refinements, then rerun after the justified HypothesisManager integration and final fixes. No additional code edits followed the final targeted/typecheck/gate checks.

## Boundaries and remaining acceptance

These are deterministic trajectory proofs driven by scripted adapters and actual local tools. They are not the deferred live trajectory Gate and prove no model quality or real provider billing behavior. Retry/provider usage tests use simulated adapter receipts; no provider was contacted. Neither fixture exposes an expected flag in its model-visible description/config; challenge payloads are ordinary supplied materials.

The loop is exported for the integration harness. CLI wiring, a production provider adapter, durable long-job watches/restart entry point (Task 8), Engineering/independent verification (Task 9), remote/protected tools, broader effect authority and later persistence/recomputation integrations remain deferred. Only explicitly authorized local commands with zero declared remote units are admitted. The required host command authorizer is the scope boundary; this module does not supply an OS sandbox. HypothesisManager remains in memory with canonical event snapshots; this task does not claim restart reconstruction.

Parent owns plan checkboxes, public status documents and independent review.

## Independent review fix round 1

Read `task-3-review.md` and addressed S1, S2, Q1 and Q2. Before edits, saved ten relevant existing sources/tests/report files as a flat path-to-content object in `task-3-fix1-before.json`. Fix ownership: `packages/supervisor/src/solver-loop.ts`, `packages/supervisor/src/hypotheses.ts`, the essential optional `repair_kind` field in `packages/contracts/src/index.ts`, new `tests/integration/solver-loop-fix1.test.ts`, and this report append. No plan/status, index, Runtime or other agents' Task 4/5 files were edited in this round.

TDD red before implementation:

```text
npx vitest run tests/integration/solver-loop-fix1.test.ts
1 file failed, 6 tests failed
missing argv correction: experiment stayed running
shared allowance: candidate_only incorrectly accepted
repair audit: null failure_code and missing failed receipt/raw refs
candidate evidence verification: revoked lease and crossed deadline both still accepted
semantic callback revocation: hypothesis still changed to rejected
```

Fixes:

- A failed local script invocation may correct one bounded positional argv element (insert/remove/replace) while retaining its executable, script, tool, ordered step, task/session, original experiment/fingerprint and runtime options. Interpreter/method flags, script/executable replacement and multi-argument changes are rejected. Corrected invocations rerun the trusted host command authorizer. Canonical repair events retain original/corrected inputs, the actual failed receipt ID, failure classification and immutable raw-error refs.
- All experiment corrections now consume one HypothesisManager `activities` ledger. The optional activity `repair_kind` distinguishes tool, representation and auxiliary repairs; all consume the same original allowance. Only a tool repair authorizes retrying a failed ordered step. A failed-step correction is reserved once, at its first patch or corrected invocation, and its eventual retry does not spend it twice. Only pre-experiment errors use the separate fixed allowance. Mixed representation/auxiliary/tool regressions prevent doubled allowances and free retries.
- Candidate acceptance rechecks current authority/deadline after each awaited evidence verification, before value publication, and again after publication before canonical candidate registration. Dispatch rechecks after input verification; local patch dispatch rechecks after awaited material publication. The manager has an optional synchronous `assertCurrent` host guard after semantic evidence verification/substantiation and immediately before semantic state commits. Revocation remains `scope_denied`, never a parse-repair retry. Real runtime terminal receipts/diagnostics remain retained even if semantic acceptance is denied.

Fourteen new fix-round tests cover the original failures, parameter-repair limits and repeated command policy, shared auxiliary accounting, candidate revocation during publication, and semantic deadline crossing. Final validation:

```text
npx vitest run tests/integration/solver-loop-fix1.test.ts tests/integration/solver-loop-trajectories.test.ts tests/integration/solver-loop-failures.test.ts tests/integration/solver-loop-windows.test.ts tests/integration/solver-loop-abandonment.test.ts tests/contract/hypothesis-lifecycle.test.ts tests/contract/hypothesis-progress.test.ts tests/contract/hypothesis-routes.test.ts tests/integration/smoke-solve.test.ts
9 files passed, 78 tests passed

npm run typecheck
exit 0

git diff --check
exit 0

npm run gate:m0
20 files passed, 133 tests passed
nested deterministic suite: 19 files passed, 131 tests passed
```

The gate includes eight concurrently added Task 4 reference tests; their files were neither changed nor owned by this fix. These results remain deterministic local-tool/adapter evidence, with no real model/provider calls. Code edits stopped after final validation; only this report append followed. No commits, pushes or subagents.

## 独立复审

Spec PASS、quality APPROVED；三项 Important 和相关 Minor 全部已修复，未发现新增问题。本次仅证明确定性实现。
