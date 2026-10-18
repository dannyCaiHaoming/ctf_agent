# M1 Task 5 report — benign synthetic subset, full task incomplete

Worktree: `/Users/caihaoming/.codex/worktrees/m1-task1-responsibilities/pentest-agent`

Branch: `codex/m1-task1-responsibilities`

Authoritative requirement read: `task-5-brief.md`, including controller integration notes, and `docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md` §7.6. Task 3's report/API was also read. Existing dirty Task 1/2/3/4 work was preserved.

## Scope decision and completion status

The controller narrowed this turn after safety filtering to benign local synthetic data processing. Consequently **Task 5 is partially implemented and must not be checked off as fully complete**. This implementation makes no exploit/vulnerability-discovery, cryptanalytic, live-model, or production-knowledge acceptance claim.

Implemented scope: on-demand four-field method metadata; ordinary localhost response baselines and one benign query change; byte identity/magic/size/metadata ingestion plus bounded base64/hex transforms; exact bytes/hex/unsigned integer conversions; functionally verified bounded Python integer arithmetic; candidate-only registration; three synthetic local equality-oracle puzzles.

No live model calls, provider connections, external network targets, downloaded dependencies, subagents, commits or pushes were used. All requests in the tests go to a fresh `127.0.0.1` server. All supplied puzzle data is synthetic. Existing artifact/runtime/oracle APIs are reused, without modifying those packages. No shared Supervisor index or SolverLoop file was edited.

## Files and public APIs

Standalone owned modules, imported directly by their module paths:

- `packages/supervisor/src/skills/index.ts`: `loadDomainSkill(domain)` dynamically imports just the requested `web`, `misc` or `crypto` metadata module. `DomainSkill` has immutable `applicabilityClues`, `minimalExperiment`, `failureBranches`, `verification` arrays and explicit `benign_synthetic_fixtures` scope. `defineSkill` freezes the object and arrays.
- `packages/supervisor/src/skills/{web,misc,crypto}.ts`: concise four-field methods covering only the narrowed benign scope, including failure interpretation and independent acceptance boundaries.
- `packages/supervisor/src/domain-web.ts`: `WebMethod(artifacts, transport)`, `capture(request)`, `establishBaseline({normal,login,error})`, `compare(baseline,variant)`; associated request/capture/baseline/transport types. The caller supplies an authorized transport; the test connects it to actual `ToolRuntime.httpRequest`. Captures retain exact request, response and transcript refs. Reads verify artifact integrity and capture/transcript agreement. Baseline classification excludes login pages, matching unified-error content, redirects, declared client rewrites, server errors and unexpected statuses. Comparisons permit exactly one query variable with endpoint/method/body/session headers held fixed. Every comparison has `vulnerabilityClaim: false`; a response difference or 500 never becomes a finding.
- `packages/supervisor/src/domain-misc.ts`: `MiscMethod(artifacts,limits)`, `ingest(bytes,metadata)`, `transform(parentId,'base64'|'hex')`, `save(id)`, `consume(id)`. Ingestion records SHA-256 identity, size, signature magic, text/opaque structure and source metadata. Transforms validate canonical encoding roundtrips. Staged outputs are held in memory without publication until saved or actually consumed. Published transformation receipts refer to immutable output, parent output/provenance, recipe, normalization parameters, depth, disposition and validation. Duplicate content and duplicate parent/recipe expansion are refused. Depth, successful product count and cumulative expanded bytes are bounded; input byte size is separately bounded. Mutations are serialized through an explicit busy rejection.
- `packages/supervisor/src/domain-crypto.ts`: `byteIntegerRecord(bytes,{endian,domain,padding,sourceRef})`, `integerToBytes(decimal,width,endian)`, and `PythonArithmetic(runtime,artifacts,taskId,pythonExecutable?)`. Exact byte records include unchanged hex, unsigned decimal value, byte width, numeric bit length, leading/trailing zero-byte counts, endian, domain, declared padding and source ref; supplied source hash and size must match the bytes. Reverse conversion requires explicit width and refuses overflow/ambiguous decimals/endian. `probe()` runs actual Python gcd, inverse and modular-power self-checks. `compute(input)` handles only `gcd`, `mod_inverse`, `mod_pow`, after cheap necessary-condition and range checks; inputs are at most 4096 bits, and requested timeout is 1..5000ms. Fixed scripts run through `ToolRuntime.jobStart`, with retained raw output and `publishJobEvidence`; no arbitrary Python source is accepted by this helper. Results are independently recomputed with host BigInt arithmetic, and return input/output refs and actual job ID. `requireCapability(name)` returns a concrete `needs_capability` for unprovided/unprobed capabilities while naming genuinely verified integer arithmetic as an available alternative, without asserting that it implements the requested symbolic capability.
- `packages/supervisor/src/domain-candidates.ts`: `DomainCandidateRegistry(artifacts).register({value,format,minBytes,maxBytes,evidenceRefs})`. Requires bounded UTF-8 byte length, anchored whole-value format without global/sticky/multiline flags, at least one evidence ref, and successful integrity verification of every ref. It publishes the exact candidate bytes and returns `status: 'candidate_only'`. It does not run full T9 verification or submit to a platform.

Fixtures:

- `fixtures/challenges/web/server.ts`: fresh ordinary greeting HTTP server plus login/error/redirect/synthetic-failure controls; no exploit mechanism or private data. `README.md` contains the public puzzle procedure. `oracle.ts` is a separate controller-only equality oracle.
- `fixtures/challenges/misc/input.txt`: real text file holding base64 of hex of a synthetic string. `README.md` describes that supplied encoding puzzle. `oracle.ts` is separate controller-only ground truth.
- `fixtures/challenges/crypto/input.json`: small synthetic modular arithmetic puzzle with explicit domain and padding. `README.md` states the arithmetic procedure. `oracle.ts` is separate controller-only ground truth.
- `tests/integration/domain-{methods,web,misc,crypto}.test.ts`: 12 deterministic tests, including three actual local tool/data puzzle paths and negative controls.

Oracle modules import the existing `LocalFlagOracle`. They are imported only by the test controller, never passed to a method/transport/computation. No live model is involved; therefore this is separation of test ground truth from solver inputs, not proof of a production model-data access boundary.

## TDD and validation

Initial red was recorded before any production domain module or fixture implementation:

```text
./node_modules/.bin/vitest run tests/integration/domain-methods.test.ts tests/integration/domain-misc.test.ts tests/integration/domain-web.test.ts tests/integration/domain-crypto.test.ts
4 suites failed: domain/skills modules did not exist (expected TDD red).
```

After initial implementation: 4 files / 11 tests passed. Initial typecheck then found one test narrowing error accessing a discriminated-union field. That owned test was corrected; no unrelated files were changed. Subsequent improvements added source hash/size matching, stronger capture/transcript identity checks, same-context query-only comparison and an explicit saved-output provenance regression.

Final commands:

```text
./node_modules/.bin/vitest run tests/integration/domain-methods.test.ts tests/integration/domain-misc.test.ts tests/integration/domain-web.test.ts tests/integration/domain-crypto.test.ts
4 files passed; 12 tests passed.
  domain-methods: 2
  domain-web:     3
  domain-misc:    4
  domain-crypto:  3

./node_modules/.bin/tsc --noEmit
exit 0

git diff --check
exit 0
```

These are the targeted domain tests plus full repository typecheck. The whole repository test gate was not rerun by this task; controller integration/review owns that step. Test-created directories and HTTP servers are cleaned up. Artifact paths/refs in tests are real and integrity checked; the test run does not preserve a durable run directory after cleanup.

## Actual local puzzle evidence

| Domain | Real local operation | Derived candidate | Separate local oracle |
| --- | --- | --- | --- |
| Web | Actual `ToolRuntime.httpRequest` normal/control requests, then `/greet?name=reader` with only `name` changed | `puzzle{hello_reader}` read from the immutable response ref; pair transcript verified | `authoritative: true`, `status: accepted` |
| Misc | Actual file read, canonical base64 decode, then hex decode with consumed immutable provenance | `puzzle{encoded_text}` read from consumed bytes/output artifact | `authoritative: true`, `status: accepted` |
| Crypto | Actual Python functional probe plus child-process `pow(5,3,23)` through ToolRuntime; independent host recomputation | Raw JSON output value `"10"`; exact `puzzle{10}` registered with job evidence refs | `authoritative: true`, `status: accepted` |

All three candidates remain `candidate_only` at registration; only the separate controller oracle asserts equality acceptance. These are **standalone deterministic method tests**, not SolverLoop trajectories, provider-driven reasoning, independent T9 verification, protected Platform Service submission, or the six-trajectory M1 formal gate.

Negative coverage includes login/error/redirect exclusion, synthetic 500 and reflection without a vulnerability claim, extra query/session changes rejected, forged capture status rejected, explicitly supplied synthetic client rewrite provenance, unused staged output not published, explicitly saved output published once, deduplication, depth/product/byte exhaustion, malformed encoding, binary magic, exact leading zeros/endian roundtrips, source identity mismatch, unsigned/width errors, non-coprime inverse preconditions, input/timeout range limits, concrete unprobed Sage capability gap with working integer alternative, missing Python executable, candidate length/format/evidence/integrity failures.

## Requirement checklist and remaining work

- [x] On-demand four-element metadata for the narrowed benign Web/Misc/Crypto subset.
- [x] Normal/login/unified-error HTTP baseline exclusion and ordinary controlled query comparison.
- [x] Preserve real request/response evidence; single 500/reflection does not imply vulnerability.
- [x] File content identity, signature magic, size, bounded structure summary and source metadata.
- [x] Base64/hex transforms, saved-or-consumed immutable publication, parent/recipe/parameter provenance, deduplication and branch limits.
- [x] Exact bytes/hex/unsigned integer records, leading/trailing zeros, endian, width, declared domain/padding/source.
- [x] Real Python integer arithmetic self-checks, bounded operations, necessary-condition checks, independently recomputed results and specific capability gaps.
- [x] Candidate-only format/length/evidence registration.
- [x] Three benign synthetic local puzzles each accepted by a separate equality oracle using real local operations.
- [ ] Full §7.6 Web source+DOM+API input-to-effect hypothesis support and exploit-chain methods; outside the controller's narrowed scope.
- [ ] Real browser/client rewrite observation; this task validates only supplied synthetic provenance and claims no GUI/browser acceptance.
- [ ] Misc container/compression/media/traffic parsing or analysis; magic is recorded, and only base64/hex transformations are implemented.
- [ ] Cryptanalytic algorithms or verified SymPy/gmpy2/Z3/Sage backend capability matrix; only the explicitly functionally tested Python integer subset is supplied.
- [ ] Independent candidate verifier/replay/evidence-audit, protected submission and canonical candidate persistence/binding; these remain T9/T10 integration responsibilities.
- [ ] SolverLoop tool routing, session/lease/generation authority for these standalone helpers, CLI/provider wiring, live skill reasoning and M1 statistical/trajectory acceptance.

The transform graph, limits and candidate return records are in-memory host helper state. Published artifacts are immutable, but this implementation does not claim graph/candidate restart recovery or canonical StateStore integration. Web transport authorization, request quota enforcement and real browser ownership belong to the caller/existing Runtime and are not claimed by this helper. There is no public internet use or OS sandbox claim. Parent owns plan/status checkboxes and independent review; this report must be read as partial safe-scope delivery.

## Independent review fix round 1

Read `task-5-review.md` and reproduced its three P2 data-integrity findings in the same benign synthetic scope. Before changes, saved 13 relevant current owned source/test/report files as a flat path-to-content JSON object in `task-5-fix1-before.json`; the snapshot was reread and its entry count checked. Existing concurrent Task 6/8/shared files were not edited.

Round ownership: only `packages/supervisor/src/domain-misc.ts`, `packages/supervisor/src/domain-web.ts`, new `tests/integration/domain-fix1.test.ts`, this report append, and the requested before snapshot. No skill scope, fixture mechanism, cryptanalytic/backend scope, Supervisor routing or shared plan/status row was expanded.

TDD red, before helper edits:

```text
./node_modules/.bin/vitest run tests/integration/domain-fix1.test.ts
1 file failed; 9 regressions failed, 1 stable-context control passed.
  public ingestion reference mutation changed child parent bytes/provenance
  publisher-held reference aliases changed private graph lineage
  caller edits raised each original byte/depth/product/input quota
  username-only, password-only and combined userinfo changes plus query were accepted
```

Fixes:

- Artifact references are copied into private scalar-only frozen snapshots immediately after publication. Every public ingestion/save/consume reference is a separate copied frozen snapshot, preventing mutation through either publisher-held or caller-held aliases. Public result wrappers and metadata records are also frozen. Mutable output byte buffers from `consume` are detached copies: mutating them cannot alter the private graph bytes or published evidence. Staged private nodes remain internally mutable only for their publication state; no node or internal byte buffer is returned.
- Constructor configuration is copied into a private snapshot, default input size is resolved there, every captured value is validated, and the snapshot is frozen. Checks consult these fixed values rather than the caller's object. Regressions prove post-construction edits cannot raise any of `maxExpandedBytes`, `maxDepth`, `maxProducts`, or `maxInputBytes`.
- Controlled HTTP request comparison now compares URL `username` and `password` as separate context variables in addition to origin/path/fragment, method/body/headers and query values. Changes to URL credentials plus a query are rejected; unchanged synthetic credentials with one query change still pass. These new credential tests use an ordinary in-memory response transport and make no network connection.

The lineage regressions inspect actual immutable receipt bytes, both parent output/provenance refs, and actual decoded `AB` bytes. They mutate public aliases, separately captured ArtifactStore return aliases, caller metadata, saved/consumed return aliases, and detached output bytes; repeating a consume preserves the correct lineage and original `AB` bytes. All tested reference records remain integrity-valid, so passing this regression establishes semantic parent identity rather than relying on a hash failure to detect corruption.

Final validation after the fixes:

```text
./node_modules/.bin/vitest run tests/integration/domain-methods.test.ts tests/integration/domain-misc.test.ts tests/integration/domain-web.test.ts tests/integration/domain-crypto.test.ts tests/integration/domain-fix1.test.ts
5 files passed; 22 tests passed.
  Original four domain suites: 12 tests
  Review round-1 regressions:  10 tests

./node_modules/.bin/tsc --noEmit
exit 0

git diff --check
exit 0
```

No code edits followed these passing tests. This is implementation/regression evidence awaiting scoped independent re-review, not an approval claim. Full Task 5 remains **PARTIAL**.

### Exact original-plan row mapping after fix round 1

Identifiers follow the original brief/plan order, not the finer-grained local subset checklist above. Source: `docs/superpowers/plans/2026-10-18-m1-solver-loop-plan.md`, Task 5, implementation rows 148–153 and acceptance rows 156–160. No original checkbox was changed by this task.

| Original row | Exact scope assessment | Original checkbox guidance |
| --- | --- | --- |
| I1 / line 148: on-demand four-element Skills; generic main prompt | Satisfied for the explicitly declared benign subset; no claim that metadata implements all §7.6 methods | Eligible for subset acknowledgement only |
| I2 / line 149: complete Web method chain | Partial. Controlled ordinary responses now retain credential/session context; full source+DOM+API mechanism workflow, actual client observation and original broader methods remain absent | Keep unchecked |
| I3 / line 150: complete Misc method | Partial. Fixed immutable lineage/quota semantics, ingestion, encoding transforms, publication and dedup are implemented; broader evidence-driven container/media/traffic methods are absent | Keep unchecked |
| I4 / line 151: complete Crypto method/capability matrix | Partial. Exact representation and bounded verified integer operations exist; original broader methods and verified SymPy/gmpy2/Z3/Sage capability matrix remain absent | Keep unchecked |
| I5 / line 152: Python math, optional Sage gap, candidate registration | Satisfied within the stated integer input range and standalone candidate-only boundary | Eligible within the declared bounded helper scope; no T9/T10 implication |
| I6 / line 153: representative local domain questions with oracle | Construction clause met by three synthetic puzzles/oracles; original representative-domain solver intent is not established | Keep unchecked |
| A1 / line 156: every Skill has four elements | Satisfied by three nonempty frozen metadata objects | Eligible within declared subset |
| A2 / line 157: login/unified-error exclusion without false vulnerability signal | Satisfied for actual supplied localhost controls; real browser observation remains unproven | Eligible for supplied controls only |
| A3 / line 158: unused intermediates unpublished; duplicate expansion refused | Satisfied for these exact behaviors; review regressions additionally repair lineage and fixed-limit correctness | Eligible for the implemented encoding graph |
| A4 / line 159: specific Sage capability gap plus verified available backend | Satisfied within the explicitly bounded Python integer scope; no symbolic/lattice equivalence claim | Eligible within that stated scope |
| A5 / line 160: representative Web/Misc/Crypto solvers accepted by oracle | Partial. Three synthetic deterministic equality paths pass, without proving original representative-domain solver capability or T12 trajectories | Keep unchecked |

Full §7.6 methods, observed browser/client behavior, cross-domain handoff, broader verified capabilities, original representative-domain acceptance, SolverLoop/canonical persistence/authority integration, independent T9 verification and protected submission remain as previously documented. They were not implemented or relabeled by this defect-fix round.

## Incremental implementation follow-up (2026-10-18)

This follow-up extends the bounded helper surface after the scoped review above. The earlier independent approval applies only to its reviewed subset; it does not review these additional changes.

- Web now joins immutable source, DOM, request, response and controlled-variation evidence into a `supported` or `inconclusive` input-effect hypothesis. The result includes alternatives and a falsifier, and always carries `vulnerabilityClaim: false`. The DOM evidence in the fixture is supplied evidence; this does not establish real browser execution or client rewrite observation.
- Misc now supports bounded gzip expansion and selected-entry ZIP listing/extraction. ZIP64, multi-disk, encrypted, symlink and unsafe-path entries are rejected; extraction checks header agreement, declared size and CRC without writing archive paths. Expanded bytes stay staged until saved or consumed, with immutable parent/recipe provenance. PNG inspection checks chunk boundaries and CRC; classic PCAP inspection checks endian/version, timestamps, captured/original lengths and packet bounds. These are narrow parsers, not general media or traffic analysis.
- Crypto now has an isolated optional-backend probe that performs operation self-checks for SymPy, gmpy2 and Z3 and returns evidence-backed available/missing entries; results are cached per helper. It does not add cryptanalytic routines or replace the Python integer backend used by the representative fixture.
- SolverLoop now accepts a host-owned candidate resolver. Accepted, partial or rejected results are usable only when the resolver supplies a current Verification binding matching candidate bytes and challenge generation. Rejection returns to the same Solver as an observation; partial does not become solved; a claimed acceptance without verification fails closed. The host application has not yet composed this interface with `SolutionEngineeringService`, `IndependentVerificationService`, `VerifiedCoordinator` and `MultiFlagContinuation` as a production pipeline.

Follow-up validation: `npm test` passed 40 files / 248 tests, including `gate:m0`; `npm run typecheck`, `npm run build` and `git diff --check` passed. Task 5 scoped suites currently contain 26 tests. T5/T9/T10 remain PARTIAL pending the full methods, application-level composition and M1 live trajectory gate.

## 独立复审

安全限定子集质量 APPROVED，三项 P2 已修复；完整 Task 5 仍为 PARTIAL。只勾选 I1、I5、A1–A4，原始完整方法和代表性 Solver 验收保留未勾选。
