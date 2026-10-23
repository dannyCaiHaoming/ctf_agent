# G role permissions verification

Scope: assigned role-permissions plan only; no real model/provider, no commit or integration.

Ruling: use the existing worktree and explicit evidence directory; preserve the plan for parent review, no extra SDD folder or reviewer session. Parent owns final review.

Pre-flight: E host preparation produces pinned materials read by Intake. D specifies replay/recompute/evidence_audit but has no detailed mode implementation; G job isolation is unresolved. Role API tests and actual job boundary probes must be reported separately.

Candidates A/B/C recorded in G §6.1 before verification.

Fixture correction: initial redirect test failed because follow_redirects defaults false (verified in http-tools.ts:129/151). Explicitly enable follow_redirects to exercise the original out-of-scope redirect criterion; no product change. Initial failure retained in contract-first.log.

Result: contract 8/8, real product runtime 14 loopback requests / 14 admissions, typecheck/build exit 0, full suite 299/299. Separate security acceptance probe exit 1 (required role filesystem/network boundary FAIL); no product permission changed and no isolation fix attempted.

Ruling: keep minimal role tool permissions; align H/C Intake text to E's host-pinned workflow. D HTTP ticket/issuer remains unselected; test-side closure demonstrates only fixture behavior. Wrong-scope consequence if overclaimed: unsafe replay or evidence contamination, so design explicitly retains unresolved dependencies.

Review: author inspected product-vs-fixture paths, raw OpenCode invalid-tool errors, exact recompute output, security probe failed sentinels, and source provenance. Parent session owns independent final review and selective synchronization. Plan/worktree retained as instructed.
