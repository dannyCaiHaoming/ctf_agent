# G-V4 HTTP lifecycle execution

Authorization: only G-V4 prototype/tests/no-model checks/docs in this managed worktree. No merge/commit/push/provider/model/job/OS isolation.

Ruling: copied current main-workspace documents instead of HEAD; existing G-V1/G-V3 conclusions remain historical and untouched.
Ruling: host lifecycle will use a test-only trusted boundary substitute, not actual C/RPC integration; §3 remains separate.

Task: original DNS regression RED (allowed, authorized connections=1, not settled before release) -> GREEN.
Task: lifecycle RED: 7 failures/1 pass; 127.0.0.2 unavailable fixture corrected to ::1 (standalone address test passes without code change); cancellation/deadline implemented.
Ruling: real socket close must be awaited, not guessed after one event-loop turn; redirect cancellation regression now awaits settlement before releasing DNS. Cost if wrong: no prompt teardown bound; final test plus cleanup bound covers it.
Task: initial directed18/18 and suite241/241, typecheck/build passed.
Final review: independent read-only reviewer found Important unbounded persistence; no Critical/minors.
Final: fixed persistence/close cleanup bound — cancellation and timeout blocked-file tests RED (late 1.bin, freed reservation) -> GREEN (cleanup_unknown, retained reservation, no late file).
Ruling: HTTP execution deadline remains unchanged; a separate 1000ms cleanup grace reports unknown if resources cannot be confirmed closed. Unknown reservations must remain with host, not released. Cost if wrong: conservative retained capacity until host reconciliation. Real C reconciliation is outside this slice.
Task: final directed20/20, suite243/243, typecheck/build logs preserved.
No commits/push/merge/provider calls or modifications to main/old worktrees. All copied source hashes rechecked.
