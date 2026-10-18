# Task 4 implementation report

Status: implemented and deterministically verified; **real human approval of the frozen candidate remains pending**. No models, network dependency installs, subagents, commits, or pushes were used.

## Owned changes

- `packages/reference/src/index.ts`: immutable run-bound offline snapshot loader, SQLite FTS5/BM25 service, strict read-only `reference.search` / `reference.get` adapter.
- `fixtures/reference-snapshot/manifest.json`: concrete complete candidate manifest, three chunks, `approved` target namespace and explicit `candidate` review status.
- `fixtures/reference-snapshot/sources/recipes.md`: original local CC0-1.0 source material, version `2026-10-18.1`, exact quotes and whole-source SHA-256.
- `fixtures/reference-snapshot/README.md`: review artifact, exact digest, host integration and approval boundary.
- `tests/contract/reference-service.test.ts`: six functional and admission contracts.
- `tests/contract/reference-boundaries.test.ts`: two adversarial/data-only and denied-egress contracts.

No contracts, runtime, supervisor, other tests, tsconfig or Vitest configuration changed. Existing dirty files preserved.

## TDD and actual validation

1. Initial service test import failed because implementation did not exist.
2. Introduced explicit not-implemented API skeleton; six tests ran and failed before implementation, including snapshot loading, approval, immutability, tool bounds and offline retrieval. The missing-source fixture branch also failed on absent manifest. This is the recorded red state, not a passing stub.
3. Implemented real `node:sqlite` FTS5 virtual table and `bm25()` queries. Targeted suite passed 6/6.
4. Added independent adversarial inert-data and denied HTTP/HTTPS/TCP/TLS/UDP/fetch checks. Final targeted suite passed **8/8 across 2 files** using `npx vitest run tests/contract/reference-*.test.ts`.
5. `npx tsc --noEmit` passed twice before the final run. The latest run was temporarily blocked by Task 5 red-state files: `tests/integration/domain-methods.test.ts` cannot resolve `packages/supervisor/src/skills/index.js` or `domain-candidates.js` (plus dependent implicit-any); `tests/integration/domain-misc.test.ts` cannot resolve `domain-misc.js`, `domain-candidates.js` or `fixtures/challenges/misc/oracle.js`. No reference-owned diagnostic appeared, and no other ownership files were touched. Runtime actually used: local Node `v26.3.0`, satisfying repository Node >=24. No fixture substitutes SQLite; results assert negative actual BM25 rank.

Checks include whole-source hash tampering, unsourced/incomplete provenance, invented quote, path traversal, forbidden namespace, missing approval, wrong approval digest, fixture-only approval in production, same-run replacement, persistent loaded content after disk edits, strict input shape, maximum 5 hits / 512-character query / 1,200-character quotation, deterministic tie order, source/version/license/applicability, exact original quote, unknown ID, no result, and returned-object isolation. Instruction-like source content remains an inert quotation and cannot alter `PolicyEngine` scope/capability decisions. Network API hooks are denied during inspection, loading, indexing, search and get; none were called. This is deterministic local code-path evidence, not OS-level packet-capture evidence.

## API and host boundary

- `inspectReferenceSnapshot(root)` returns digest, snapshot ID/version/namespace/reviewStatus, without approval.
- Trusted host creates one `ReferenceHost` for a run lifetime and calls `open({ runId, root, mode, approval })` before exposing tools. Approval is external trusted-host testimony, with actual reviewer/time and exact digest. Snapshot metadata cannot approve itself.
- Production mode requires `kind: human`; fixture mode admits clearly separated `fixture-only` approval. Tests use synthetic testimony, including one explicitly synthetic human-path test; none constitutes real artifact approval.
- Service `search({ query, limit? })` defaults to three hits; `get({ id })` returns the exact bounded original chunk or null. Query syntax is reduced to quoted lexical terms, never interpolated SQL/FTS operators.
- `createReferenceTools(service)` exposes only `reference.search` / `reference.get`, descriptions, strict Zod input schemas and data-returning execution functions. No host admission, update, shell, network, permission or execution callback is exposed. No solver change was necessary or made.
- Full source and manifest are loaded once into a private in-memory SQLite index set query-only. Same run registry rejects changing digest, mode or approval. The trusted host must retain this registry for the run lifetime and preserve its returned identity in the existing run manifest/checkpoint for resume. Runtime integration/persistence is outside Task 4 ownership.

## Frozen candidate for real review

Snapshot ID: `local-recipes-candidate-1`

Snapshot version: `1.0.0-candidate`

Digest: `09bb5085c9fab4892d11403bfc8c5be6a138689a16505855a2c2242b3fbdfc4c`

The manifest and source were frozen at the controller's request. Candidate topics: observation fingerprint, scope boundary, minimal reproducibility. Complete local original source is included; no third-party source was downloaded. Real human approval for this exact digest must come from the user through the trusted host. **Do not mark the approved-snapshot plan item complete until that actual approval exists.** All implementation/API/fixture acceptance is ready independently.

M5 extra namespaces, version filtering and post-run publication workflow are absent as requested. The loader rejects non-approved namespaces. No new dependency or live model call was introduced.

## 实际人工批准补充

用户于 2026-10-18 明确批准 3 条内容和完整快照摘要 `09bb5085c9fab4892d11403bfc8c5be6a138689a16505855a2c2242b3fbdfc4c`。`fixtures/reference-snapshot/approval.json` 在冻结 manifest/sources 之外保存批准；实际生产模式宿主读取成功，检索 1 条且 dataOnly=true。独立审查进一步核实所有引用、来源 hash 与完整摘要，结论 spec PASS/quality APPROVED，无问题。此前报告的 pending approval 状态已被此次真实批准取代。
