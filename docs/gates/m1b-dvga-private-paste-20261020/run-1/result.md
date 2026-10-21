# DVGA private paste ID finding run 1 — result

Date: 2026-10-20 (Asia/Tokyo)  
Source HEAD before this run: `9a9138b`; the focused Web finding integration was in the working tree and was not committed. Existing unrelated documentation edits were left untouched.

## Outcome

- One real solve run completed; no retry was started.
- Target: `http://localhost:5013/graphql`.
- Model path: OpenCode 1.19.3, `bailian/deepseek-v4-flash-0731`.
- The Solver sent exactly `{ pastes(public: false) { id } }` as an unauthenticated JSON POST.
- DVGA returned HTTP 200, no GraphQL errors, and two rows containing only `id` fields. No paste content was requested or included in this run's response.
- `candidate.register` bound the exact 43-byte response body to its canonical HTTP response evidence.
- The host created a separate verification session and replayed the same POST. The independent verification result was `verified`; the replay output was 43 bytes and matched the candidate. The canonical outbox recorded one delivered `job.terminal` event.
- Final product result: `candidate_only`, `authoritative=false`, `solve_state=paused`. This is a locally verified vulnerability finding, not `solved`: DVGA has no authoritative completion oracle. No oracle submission was attempted.

## Usage and limits

- 3 provider calls: 6,339 input tokens + 939 output/reasoning tokens = 7,278 observable tokens.
- Elapsed: 11.554 seconds; 6 admitted steps; 0 Solver `job.run` jobs. The independent replay used one host-managed verification job.
- Configured limits: 300,000 observable tokens, 900 seconds, 60 steps, 40 tool jobs. The run stopped naturally before any limit; no threshold overshoot occurred.
- Provider connectivity preflight was unauthenticated and returned HTTP 401. The local auth credential was read into the process environment only; it was not written to run artifacts or logs.

## Validation before the real run

- `npm test`: 49 files / 273 tests passed.
- After the last small code adjustment: `npm run typecheck` passed; focused tests `tests/integration/opencode-solve.test.ts` and `tests/integration/cli-m1-http-solve.test.ts`: 7 tests passed.
- DVGA reachability preflight: HTTP 200.

## Canonical evidence

- Run ID: `run_3578399d-527a-45af-a95f-25053bf8583a`.
- Session ID: `ses_ea6b102feffe2fA0EZCjiH7R5p`.
- Candidate verification: `verification_694523ce-7ec3-45f2-a34b-8bd8062876aa`, status `verified`, generation 1, current.
- Canonical SQLite: `runtime/state/run_3578399d-527a-45af-a95f-25053bf8583a.sqlite`.
- SQLite SHA-256: `5b6ab3a1e6b6043191f7c9ee502c6032225f9017c84adc613ba3eed7910917b4`.
- The canonical candidate event records verification checks/evidence and `authoritative=false`; there is no `oracle_submit` stage.
