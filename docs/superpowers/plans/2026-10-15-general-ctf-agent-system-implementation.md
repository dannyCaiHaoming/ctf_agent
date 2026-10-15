# 通用 CTF 解题 Agent 系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个 host-first、可恢复、以权威平台结果为准的通用 CTF 解题 Agent，先完成 Web、Misc、Crypto 的 TSecBench 单题和多题闭环，再封装并验证 Ubuntu ARM64 Core。

**Architecture:** 使用 TypeScript/npm workspace 实现单一产品控制层，按 package 隔离 Contracts、State、Policy、Tool Runtime、Platform、Browser、Reference、OpenCode Bridge 和 Supervisor；SQLite 是唯一 canonical state，Artifact Store 保存不可变内容。`host-dev` 与 `core-arm64` 共用同一组类型、状态迁移、fixture 和行为契约，Docker 只在 host 的 M0-M3 Gate 通过后加入。

**Tech Stack:** Node.js 24 LTS、TypeScript、npm workspaces、Vitest、Zod、SQLite/FTS5、Fastify、OpenCode/`@opencode-ai/plugin`/`@opencode-ai/sdk` 1.19.0、Playwright Chromium、Docker BuildKit、Ubuntu ARM64。

**Spec:** `docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`

## Global Constraints

- 当前仓库只有设计资料；本计划从新的应用骨架开始，不复用已删除的旧 `pentest-agent-harness`。
- 首版只承诺 Web、Misc、Crypto；Pwn、Reverse、Mobile、Blockchain、Cloud 等只列入 manifest，不进入首版求解承诺。
- 开发顺序固定为 `host-dev` M0 -> M1 -> M2 -> M3 -> `core-arm64` M4；M0-M3 未通过前不得以 Docker 工作替代 Agent 能力闭环。
- OpenCode、plugin 与 SDK 固定为 `1.19.0`；只使用公开 plugin、SDK、server 接口。若 contract test 证明缺少必要 hook，返回设计 blocker，不维护私有 fork。
- 每个 profile 同时只允许一个 active run；一个 session 只能绑定一个 run、challenge、task、`responsibility_set` 和 lease。
- Platform Service 是平台 credential 和平台 effect 的唯一持有者；Coordinator 是唯一 submit intent 提出者；Solver 和 Verifier 永远不能直接提交。
- Provider credential 只由 Model Data Gateway 持有；`control_secret` 永不进入模型、Tool job、Artifact 或日志。
- SQLite 是唯一 canonical write store；Artifact Store 只保存不可变内容；JSONL/Markdown 只能由 canonical state 导出。
- Effect 固定分为 `local_rebuildable`、`retryable_observation`、`protected_effect`；`unknown` protected effect 不盲重发，只隔离最小受影响 scope。
- `job.read` 必须在作业仍运行时按单调 cursor 返回现有 bytes；只有发布后的 immutable range 可用于 handoff、checkpoint、candidate 和 verification。
- Host-dev 使用受管进程树 fail-stop；Core 使用整容器 fail-stop。无法证明旧执行停止时不得建立新 mutation owner。
- Host-dev 不是安全 sandbox，也不能产生 formal 结果；硬限额非绕过性只可在 broker fixture 或 Core egress Gate 中声明。
- 首阶段只有一个按 challenge 启动的 Playwright Challenge Browser；转题时销毁整个 browser process/profile。
- TSecBench 同时最多三个活跃 instance；Worker、Browser slot 和 instance slot 分别计量。
- 没有平台或等价 local oracle 的权威接受，只能得到 `candidate_only`，不能标记 `solved`。
- 运行中不得安装依赖；正式运行不允许公共搜索、GitHub、在线文档或公开 writeup。
- 确定性 schema/state/adapter/runtime/policy tests 每次必须全部通过；M1 六条模型轨迹各独立运行 3 次且至少成功 2 次，必须保留全部结果。
- M2 与 M3 使用同一个预登记 TSecBench task A 且不中途 reset；M4 使用独立 task B，不能复用 host 已接受状态。
- 自动 commit 仅在用户明确授权后执行；未授权时完成代码和验证后停在未提交状态。

## External Input Gates

- M0 前由 release 维护者确认支持的 macOS/Linux 版本、Node 24 安装方式、OpenCode 1.19.0 binary identity、provider adapter 和可合法分发的 Reference 清单。
- M1 模型 Gate 前提供固定 provider、model ID、Base URL、参数、credential reference、prompt/template 版本和每条轨迹预算。
- M2/M3 前提供预登记 task A、`BENCHMARK_TOKEN` secret reference、`BENCHMARK_BASE_URL`、宿主 VPN、duration/elapsed/deadline 与 clean/exclusive baseline 证据。
- M4 前提供独立 task B 和原生 Ubuntu ARM64 host 的 kernel、Docker、CPU/RAM/disk、宿主 VPN 路由资料。
- M6 前提供一次性正式靶场、干净账号/任务、完整 baseline、正式 deadline/budget 和人工介入政策。
- 外部输入缺失时可以完成对应代码和 fixture，但 Gate 状态必须是 `blocked_external_input`，不得写成通过。

## Review Focus

- First List 在 intent、dispatch、response、manifest commit 四个窗口崩溃时，必须保留唯一 start anchor/deadline，且 post-start admission 前不派工；由 Task 9 和 Task 12 的 crash matrix 固定。
- Submit/Hint/instance protected effect 在 response 丢失时不得重复执行或扩大为全 run quarantine；由 Task 7、Task 8、Task 9 的 ledger/reconciliation tests 固定。
- 流式 cursor 被淘汰或 evidence 只发布一部分时，必须明确报告 gap，不能形成完整 verification evidence；由 Task 6 和 Task 16 固定。
- 未绑定 session、伪造 lease、workspace symlink escape、Tool job 继承 secret、Browser 跨 scope 导航都必须 fail closed；由 Task 4、Task 5、Task 6、Task 10 固定。
- Partial/multi-flag、unknown-total、既有 accepted、人工操作和无 oracle 不能被误算为 solved 或缩小正式分母；由 Task 8、Task 16、Task 30 固定。

---

## File Map

| 路径 | 责任 |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts` | 固定 Node/TypeScript workspace、依赖、构建和测试命令 |
| `config/release-profile.schema.json`, `config/release-profile.example.json` | 固定 profile、model、Reference、预算、OS/Core capability 输入，不保存 secret |
| `apps/cli/src/**` | `doctor/prepare/start/status/stop/report` 和一键构建入口 |
| `apps/opencode-plugin/src/index.ts` | 暴露受管 CTF tools，把 OpenCode `ToolContext.sessionID` 交给 Bridge；不接受模型自报身份 |
| `packages/contracts/src/**` | 全系统 Zod schema、branded IDs、状态枚举、service interface 和 wire DTO |
| `packages/state/src/**` | SQLite migration、repository、event/outbox、effect ledger、run lock 和 checkpoint |
| `packages/artifacts/src/**` | 内容寻址写入、原子发布、byte-range evidence 和完整性检查 |
| `packages/policy/src/**` | session/lease/scope/capability 检查、data classification 和 Model Data Gateway |
| `packages/runtime/src/**` | workspace、batch/PTY/TCP jobs、stream cursor、channels、watch、取消和 managed metering |
| `packages/platform/src/**` | Platform Service、TSecBench/local-oracle adapters、prepare/start admission 和 reconciliation |
| `packages/browser/src/**` | 单 Challenge Browser 生命周期及 scope enforcement |
| `packages/reference/src/**` | 固定离线 snapshot、FTS5/BM25 检索和引用 |
| `packages/opencode-bridge/src/**` | OpenCode server lifecycle、session binding、turn/compaction/retry contract 和本地 authenticated tool RPC |
| `packages/supervisor/src/**` | run lifecycle、任务/lease、Solver loop、candidate flow、Scheduler、deadline、checkpoint 和 recovery |
| `packages/reporting/src/**` | Gate、formal denominator、资源度量和不可变结果导出 |
| `fixtures/**` | TSecBench 0.1.2、local oracle、Web/Misc/Crypto、protected-effect 和 recovery 场景 |
| `tests/contract/**`, `tests/integration/**`, `tests/gates/**` | 跨 package 契约、端到端 fixture 和 M0-M6 Gate harness |
| `docker/**`, `scripts/build-core-image.sh` | 固定 Core image、egress helper、tool manifest、SBOM 和 ARM64 parity |
| `docs/gates/**` | Gate 输入清单和去 secret 的结果摘要；真实原始 run 数据只存于配置的 state directory |

## Dependency Order

- M0: Tasks 1-12，建立可确定性验证的 host foundation。
- M1: Tasks 13-18，只依赖通过的 M0，不依赖真实 TSecBench task。
- M2: Task 19，依赖 M1 与外部 task A/VPN/time evidence。
- M3: Tasks 20-21，依赖同一 task A 的 M2 中途状态。
- M4: Tasks 22-24，只有 M3 通过后开始，使用独立 task B 和原生 ARM64 host。
- M5: Tasks 25、26A-26C、27-29 是条件式独立 capability tracks；只执行目标 formal profile 实际需要的 track。
- M6: Tasks 30-31，依赖 M4、目标 profile 所需的 M5 tracks 和正式 run 输入。

## M0 Host Foundation

### Task 1: Bootstrap workspace and release profile

**Files:**
- Create: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `config/release-profile.schema.json`, `config/release-profile.example.json`
- Create: `apps/cli/package.json`, `apps/cli/src/main.ts`, `apps/cli/src/commands/doctor.ts`
- Modify: `.gitignore`
- Test: `tests/contract/release-profile.test.ts`, `tests/integration/cli-doctor.test.ts`

**Interfaces:**
- Consumes: design spec and External Input Gates only.
- Produces: `loadReleaseProfile(path: string): Promise<ReleaseProfile>` and root scripts `cli`, `build`, `typecheck`, `test:deterministic`, `test:contract`, `gate:m0` through `gate:m6`.

**Depends on:** none.

- [ ] **Step 1: Write failing profile and CLI tests**

```ts
it("rejects a release profile containing inline secrets", async () => {
  await expect(loadReleaseProfile(fixture("inline-secret.json"))).rejects.toMatchObject({ code: "control_secret_forbidden" });
});
it("reports missing external capabilities without claiming availability", async () => {
  expect((await runDoctor(emptyHost())).capabilities).toContainEqual(expect.objectContaining({ status: "unavailable" }));
});
```

- [ ] **Step 2: Run tests and confirm they fail because the workspace/profile loader does not exist**

Run: `npm test -- tests/contract/release-profile.test.ts tests/integration/cli-doctor.test.ts`

- [ ] **Step 3: Create the npm workspace and minimal CLI**

Use Node 24, ESM, strict TypeScript, exact dependency versions in `package-lock.json`, and `npm ci` as the only CI/install command. The profile stores secret references, never secret values.

- [ ] **Step 4: Verify bootstrap**

Run: `npm ci && npm run typecheck && npm test -- tests/contract/release-profile.test.ts tests/integration/cli-doctor.test.ts`

Expected: all commands exit 0; `doctor` reports OpenCode `1.19.0` on the current host or an explicit mismatch.

- [ ] **Step 5: Commit if authorized**

Commit scope: workspace/config/CLI bootstrap only. Suggested message: `build: bootstrap ctf agent workspace`.

### Task 2: Define canonical contracts and state machines

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/ids.ts`, `run.ts`, `challenge.ts`, `task.ts`, `runtime.ts`, `platform.ts`, `candidate.ts`, `policy.ts`, `index.ts`
- Test: `packages/contracts/test/schemas.test.ts`, `packages/contracts/test/transitions.test.ts`

**Interfaces:**
- Consumes: `ReleaseProfile` from Task 1.
- Produces: branded `RunId`, `ChallengeId`, `TaskId`, `SessionId`, `LeaseId`, `JobId`, `OperationId`, `ArtifactRef`; Zod schemas for every state named in spec section 7.1; `transition(entity, event): Result<State, TransitionError>`.

**Depends on:** Task 1.

- [ ] **Step 1: Write failing schema and illegal-transition tests**

```ts
it("does not equate finished with solved", () => {
  expect(deriveOutcome({ solveState: "finished", authoritativeAccepts: 0 })).toBe("unsolved");
});
it("rejects a verifier session that reuses the solver task", () => {
  expect(() => VerificationInput.parse(sameTaskFixture())).toThrow();
});
```

- [ ] **Step 2: Run the contract tests and confirm missing exports**

Run: `npm test -- packages/contracts/test`

- [ ] **Step 3: Implement schemas, discriminated unions and transition tables**

Encode all spec enums exactly, preserve unknown/unsupported/quarantined distinctions, and make authoritative acceptance a required input for `solved`.

- [ ] **Step 4: Verify contracts and generated type declarations**

Run: `npm run typecheck && npm test -- packages/contracts/test`

Expected: PASS with no `any` at public package boundaries.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: define canonical ctf agent contracts`.

### Task 3: Implement canonical State and Artifact services

**Files:**
- Create: `packages/state/package.json`, `packages/artifacts/package.json`
- Create: `packages/state/src/db.ts`, `migrations/001-initial.sql`, `repository.ts`, `events.ts`, `outbox.ts`, `run-lock.ts`
- Create: `packages/artifacts/src/store.ts`, `publish.ts`, `integrity.ts`
- Test: `packages/state/test/transactions.test.ts`, `packages/state/test/run-lock.test.ts`, `packages/artifacts/test/publish.test.ts`

**Interfaces:**
- Consumes: IDs and state schemas from Task 2.
- Produces: `openState(path): StateService`, `StateService.transaction<T>(fn): Promise<T>`, `appendEvent(expectedSequence, event)`, `claimOutbox(id)`, `publishArtifact(input): Promise<ArtifactRef>`, `publishStreamRange(jobId, start, end): Promise<ArtifactRef>`.

**Depends on:** Task 2.

- [ ] **Step 1: Write failing atomicity, lock and immutable-publication tests**

```ts
it("never commits an artifact ref before the file is durable", async () => {
  await expect(faultInjectedPublish("after-temp-write")).rejects.toThrow();
  expect(await state.listArtifactRefs()).toEqual([]);
});
it("allows only one active run lock per state directory", async () => {
  await expect(acquireSecondLock()).rejects.toMatchObject({ code: "active_run_exists" });
});
it("keeps a published ref stable when the workspace file changes", async () => {
  expect(await publishThenMutateWorkspace()).toMatchObject({ publishedBytes: originalBytes, currentWorkspaceBytes: changedBytes });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npm test -- packages/state/test packages/artifacts/test`

- [ ] **Step 3: Implement WAL SQLite migrations, expected-sequence writes, transactional outbox and content-addressed rename**

Keep mutable job stream bytes outside canonical evidence until `publishStreamRange` succeeds; do not expose arbitrary SQL through public interfaces.

- [ ] **Step 4: Verify crash points and integrity scan**

Run: `npm test -- packages/state/test packages/artifacts/test && npm run typecheck`

Expected: every injected crash leaves either no reference or a fully readable hash-verified artifact.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add canonical state and artifact stores`.

### Task 4: Enforce identity, scope, capability and model-data policy

**Files:**
- Create: `packages/policy/package.json`
- Create: `packages/policy/src/gateway.ts`, `session-bindings.ts`, `scope.ts`, `capabilities.ts`, `data-classification.ts`, `model-gateway.ts`
- Test: `packages/policy/test/identity.test.ts`, `scope.test.ts`, `model-data.test.ts`, `secret-boundary.test.ts`

**Interfaces:**
- Consumes: `SessionBinding`, `ScopeGrant`, `CapabilityProfile`, `ReleaseProfile` from Tasks 1-2.
- Produces: `authorizeTool(context, request): AuthorizationDecision`, `classifyModelPayload(parts): DataDecision`, `createModelGateway(config): ModelGateway`, `registerSession(binding)`, `revokeLease(leaseId)`.

**Depends on:** Tasks 2-3.

- [ ] **Step 1: Write failing impersonation, scope and secret tests**

```ts
it("ignores model-supplied task identity", () => {
  expect(authorize(boundContext, { claimedTaskId: "other", path: "work/a" })).toMatchObject({ allowed: true, taskId: boundContext.taskId });
});
it("blocks bulk artifacts and control secrets from every provider route", async () => {
  await expect(sendVia("compaction", controlSecretPart())).rejects.toMatchObject({ code: "model_data_denied" });
});
```

- [ ] **Step 2: Run tests and confirm policy is absent**

Run: `npm test -- packages/policy/test`

- [ ] **Step 3: Implement fail-closed policy and local provider proxy**

The gateway alone receives provider credentials; log only classifications, sizes and refs. Cover normal turns, retry, compaction, summary, subagent and multimodal requests. Enforce profile-defined per-request text/image limits and reject attempts to split one `artifact_bulk` across requests to evade policy.

- [ ] **Step 4: Verify denials and redacted logs**

Run: `npm test -- packages/policy/test && npm run typecheck`

Expected: all bypass fixtures fail; no fixture secret appears in captured logs or child environments.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: enforce session scope and model data policy`.

### Task 5: Build the OpenCode 1.19.0 bridge and plugin contract

**Files:**
- Create: `packages/opencode-bridge/package.json`
- Create: `packages/opencode-bridge/src/server.ts`, `client.ts`, `sessions.ts`, `contract-probe.ts`
- Create: `apps/opencode-plugin/package.json`, `apps/opencode-plugin/src/index.ts`, `opencode.jsonc`
- Create: `.opencode/agents/ctf-coordinator.md`, `.opencode/agents/ctf-worker.md`, `.opencode/agents/ctf-verifier.md`
- Test: `tests/contract/opencode-1.19.test.ts`, `tests/integration/opencode-session-binding.test.ts`

**Interfaces:**
- Consumes: Task 4 session/policy APIs and OpenCode `ToolContext.sessionID`.
- Produces: `startOpenCodeServer(config): Promise<OpenCodeHandle>`, `createBoundSession(input): Promise<BoundSession>`, `sendTurn(sessionId, parts)`, `compactSession(sessionId)`, and authenticated loopback `POST /v1/tools/:tool`.

**Depends on:** Task 4.

- [ ] **Step 1: Write contract probes for main session, subagent, tool call, retry, compaction, summary and multimodal paths**

```ts
it("derives tool identity from OpenCode ToolContext", async () => {
  expect(await invokePluginTool({ sessionID: boundSession, args: { sessionID: "forged" } })).toMatchObject({ sessionId: boundSession });
});
it("denies built-in unmanaged shell and mutation tools to worker agents", async () => {
  expect(await exposedTools("ctf-worker")).not.toEqual(expect.arrayContaining(["bash", "write", "edit"]));
});
```

- [ ] **Step 2: Run probes against pinned OpenCode 1.19.0 and record any public-hook blocker**

Run: `npm test -- tests/contract/opencode-1.19.test.ts`

Expected before implementation: FAIL on missing bridge. If a required identity/data hook is absent in 1.19.0, stop this task with `blocked_opencode_contract` and update the design rather than adding a fork.

- [ ] **Step 3: Implement the bridge, plugin tools and deny-by-default agent config**

Use a bridge credential injected into the plugin process, never tool args. Bind each OpenCode session in State before its first CTF tool call.

- [ ] **Step 4: Verify all contract paths**

Run: `npm test -- tests/contract/opencode-1.19.test.ts tests/integration/opencode-session-binding.test.ts`

Expected: every path reaches Model Data Gateway and every tool call resolves the immutable server-side binding.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: integrate pinned opencode bridge`.

### Task 6: Implement workspace and streaming Job Runtime

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/src/workspace.ts`, `jobs.ts`, `process-tree.ts`, `streams.ts`, `pty.ts`, `errors.ts`
- Test: `packages/runtime/test/workspace.test.ts`, `jobs.test.ts`, `streams.test.ts`, `process-tree.test.ts`

**Interfaces:**
- Consumes: authorized server-side tool context from Task 4 and State/Artifact APIs from Task 3.
- Produces: `workspace.list/read/search/patch/stat/publish`, `job.start/status/read/write/cancel/transfer/list`; `job.read(jobId, cursor, maxBytes): JobReadResult` with `retainedStartCursor`, `nextCursor`, and `running|waiting|eof|lost|cursor_evicted`.

**Depends on:** Tasks 3-5.

- [ ] **Step 1: Write failing path escape, response-loss, live-read and cursor-eviction tests**

```ts
it("returns output before the batch job exits", async () => {
  const read = await startSlowJobAndReadFirstLine();
  expect(read).toMatchObject({ state: "running", bytes: expect.any(Uint8Array) });
});
it("does not silently advance an evicted cursor", async () => {
  expect(await readEvictedCursor()).toMatchObject({ state: "cursor_evicted", requestedCursor: 0, retainedStartCursor: 1024 });
});
```

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `npm test -- packages/runtime/test/workspace.test.ts packages/runtime/test/jobs.test.ts packages/runtime/test/streams.test.ts`

- [ ] **Step 3: Implement fixed workspaces, process-group jobs, PTY and bounded cursor buffers**

Persist the Job ID before spawn, filter child env, reject symlink escapes, and make cancellation wait for confirmed process-tree termination.

- [ ] **Step 4: Verify live observation and evidence publication behavior**

Run: `npm test -- packages/runtime/test packages/artifacts/test/publish.test.ts`

Expected: response loss finds the existing Job by ID; a gap prevents full-range publication.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add managed workspace and job runtime`.

### Task 7: Implement channels, metering and protected effects

**Files:**
- Create: `packages/runtime/src/channels.ts`, `tcp-session.ts`, `http-session.ts`, `listener.ts`, `metering.ts`, `protected-call.ts`
- Create: `packages/state/src/effect-ledger.ts`
- Test: `packages/runtime/test/channels.test.ts`, `metering.test.ts`, `protected-call.test.ts`

**Interfaces:**
- Consumes: Runtime jobs from Task 6 and State transactions from Task 3.
- Produces: `channel.open/status/read/write/transfer/close`, `http_session.open/request/close`, `listener.start/status/accept/read/write/stop`, `prepareProtectedCall(input)`, `dispatchProtectedCall(operationId)`, `reconcileProtectedCall(operationId, evidence)`.

**Depends on:** Tasks 3, 4 and 6.

- [ ] **Step 1: Write failing crash-window and hard-unit tests**

```ts
it.each(["prepared", "dispatching", "response-before-commit"])("does not blind-retry after %s crash", async (point) => {
  expect(await recoverProtectedCall(point)).toMatchObject({ redispatched: false });
});
it("rejects the next unit before bytes are sent", async () => {
  expect(await sendAfterLimit()).toMatchObject({ code: "remote_budget_exhausted", bytesSent: 0 });
});
```

- [ ] **Step 2: Run tests and confirm missing channel/effect support**

Run: `npm test -- packages/runtime/test/channels.test.ts packages/runtime/test/metering.test.ts packages/runtime/test/protected-call.test.ts`

- [ ] **Step 3: Implement framed channels and the `prepared -> dispatching -> confirmed|failed_not_dispatched|unknown` ledger**

Disable implicit retries/redirects unless the capability profile defines their counting semantics. Host-dev raw targets remain `metering_unavailable` unless a broker fixture makes bypass impossible.

- [ ] **Step 4: Verify local broker and smallest-scope quarantine**

Run: `npm test -- packages/runtime/test`

Expected: an unknown call consumes reserved units and blocks only the matching operation/endpoint/challenge scope.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add managed channels and protected effects`.

### Task 8: Implement the TSecBench 0.1.2 fixture and adapter

**Files:**
- Create: `packages/platform/package.json`
- Create: `packages/platform/src/adapter.ts`, `tsecbench/client.ts`, `tsecbench/mapper.ts`, `tsecbench/reconcile.ts`
- Create: `fixtures/tsecbench/server.ts`, `fixtures/tsecbench/scenarios/*.json`
- Test: `packages/platform/test/tsecbench-contract.test.ts`, `tsecbench-reconcile.test.ts`, `tests/contract/tsecbench-fixture.test.ts`

**Interfaces:**
- Consumes: protected effect API from Task 7.
- Produces: `PlatformAdapter.inspect()`, `listChallenges()`, `startInstance(uniqueCode)`, `getHint(uniqueCode)`, `submitFlag(uniqueCode, flag)`, `closeInstance(uniqueCode)`, and canonical `CapabilityDescriptor[]`.

**Depends on:** Tasks 2, 3 and 7.

- [ ] **Step 1: Encode all verified wire cases as failing fixture tests**

```ts
it("treats HTTP 200 correct=false as confirmed rejection", async () => {
  expect(await adapter.submitFlag("web-1", "wrong")).toMatchObject({ effectState: "confirmed", outcome: "rejected" });
});
it("does not treat total_score as earned score", async () => {
  expect((await adapter.listChallenges()).challenges[0].earnedScore).toBeUndefined();
});
```

- [ ] **Step 2: Run adapter tests and confirm failure**

Run: `npm test -- packages/platform/test/tsecbench-contract.test.ts packages/platform/test/tsecbench-reconcile.test.ts`

- [ ] **Step 3: Implement the exact five-operation mapping and scenario server**

Cover null description/hint, multiple addresses, all four container states, partial/complete/duplicate, 404 task errors, 409 variants, 422 detail arrays, response loss and no pagination.

- [ ] **Step 4: Verify the full fixture matrix**

Run: `npm test -- packages/platform/test tests/contract/tsecbench-fixture.test.ts`

Expected: start/close reconcile from List; unknown submit/hint remains local and never invents history, earned score or slot identity.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add tsecbench fixture and adapter`.

### Task 9: Implement Platform Service, local oracle and prepare/start admission

**Files:**
- Create: `packages/platform/src/service.ts`, `secrets.ts`, `manifest.ts`, `admission.ts`, `start-intent.ts`, `local-entry.ts`, `local-oracle.ts`, `cleanup.ts`
- Create: `apps/cli/src/commands/prepare.ts`, `start.ts`
- Test: `packages/platform/test/service-boundary.test.ts`, `manifest.test.ts`, `admission.test.ts`, `start-crash-matrix.test.ts`, `local-entry.test.ts`, `local-oracle.test.ts`

**Interfaces:**
- Consumes: TSecBench adapter from Task 8, State from Task 3 and policy from Task 4.
- Produces: `prepareRun(input): Promise<PreparedRun>`, `startRun(runId): Promise<AdmittedRun>`, `executePlatformIntent(binding, intent)`, `submitLocalCandidate(intent)`.

**Depends on:** Tasks 3, 4 and 8.

- [ ] **Step 1: Write failing pre/post admission and First List crash-matrix tests**

```ts
it.each(["before-dispatch", "after-dispatch", "after-response", "after-manifest"])("keeps one anchor across %s", async (point) => {
  const recovered = await crashAndRecoverFirstList(point);
  expect(new Set(recovered.startAnchors).size).toBe(1);
  expect(recovered.solverDispatchesBeforeAdmission).toBe(0);
});
it("returns candidate_only when a local target has no oracle", async () => {
  expect(await finalizeLocal(noOracleCandidate())).toMatchObject({ outcome: "candidate_only" });
});
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `npm test -- packages/platform/test/service-boundary.test.ts packages/platform/test/admission.test.ts packages/platform/test/start-crash-matrix.test.ts`

- [ ] **Step 3: Implement credential isolation and two-phase admission**

`prepare` performs only local/user-evidence checks plus the Tool Runtime VPN probe; `start` commits immutable intent/anchor before the first List byte, then freezes manifest revision 0 before any solving effect. A direct local target creates exactly one challenge without requiring a separate manifest; raw statement, addresses and supplied materials are ingested with source identity.

- [ ] **Step 4: Verify auth, baseline and crash behavior**

Run: `npm test -- packages/platform/test`

Expected: `404 task_not_found` is auth/task failure, empty denominator is `insufficient_gate_coverage`, and no platform secret reaches tool/model logs.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add platform admission and effect boundary`.

### Task 10: Implement the single scoped Challenge Browser

**Files:**
- Create: `packages/browser/package.json`
- Create: `packages/browser/src/service.ts`, `process.ts`, `scope-router.ts`, `downloads.ts`
- Test: `packages/browser/test/scope.test.ts`, `lifecycle.test.ts`, `downloads.test.ts`

**Interfaces:**
- Consumes: challenge scope grants from Task 4 and Artifact publication from Task 3.
- Produces: `browser.open/action/status/close`; exactly one active `BrowserLease` bound to run/challenge/resource generation.

**Depends on:** Tasks 3-4 and 9.

- [ ] **Step 1: Write failing navigation/fetch/WebSocket/download and teardown tests**

```ts
it.each(["navigation", "fetch", "websocket", "download"])("blocks out-of-scope %s", async (kind) => {
  expect(await attemptBrowserBypass(kind)).toMatchObject({ code: "scope_denied" });
});
it("kills the whole process and profile when switching challenge", async () => {
  expect(await switchChallenge()).toMatchObject({ oldProcessAlive: false, oldProfileReused: false });
});
```

- [ ] **Step 2: Run browser tests and confirm failure**

Run: `npm test -- packages/browser/test`

- [ ] **Step 3: Implement Playwright child-process lifecycle and route enforcement**

Use a fresh persistent profile directory per lease, no Platform credential, and publish downloads before exposing refs.

- [ ] **Step 4: Verify browser contract**

Run: `npm test -- packages/browser/test`

Expected: all direct and page-initiated network paths obey the same grants; close removes the process and ephemeral profile.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add scoped challenge browser`.

### Task 11: Implement Supervisor lifecycle, checkpoint and host fail-stop

**Files:**
- Create: `packages/supervisor/package.json`
- Create: `packages/supervisor/src/supervisor.ts`, `run-lifecycle.ts`, `sessions.ts`, `leases.ts`, `deadlines.ts`, `checkpoint.ts`, `recovery.ts`, `host-fail-stop.ts`
- Create: `apps/cli/src/commands/status.ts`, `stop.ts`
- Test: `packages/supervisor/test/lifecycle.test.ts`, `deadline.test.ts`, `checkpoint.test.ts`, `host-recovery.test.ts`

**Interfaces:**
- Consumes: Tasks 3-10 service interfaces.
- Produces: `prepare/start/status/stop`, `createTask`, `bindSession`, `renewLease`, `checkpointRun`, `recoverRun`; immutable run incarnation and one active run lock.

**Depends on:** Tasks 3-10.

- [ ] **Step 1: Write failing deadline, process-stop and recovery tests**

```ts
it("does not extend deadline after restart", async () => {
  expect((await restartFromCheckpoint()).deadline).toEqual(originalDeadline);
});
it("blocks a new incarnation when an old process cannot be proven dead", async () => {
  await expect(recoverWithUnkillableChild()).rejects.toMatchObject({ code: "old_execution_not_stopped" });
});
it("starts no experiment, model turn or submit after the hard deadline", async () => {
  expect(await dispatchAtHardDeadline()).toMatchObject({ modelTurns: 0, experiments: 0, submits: 0, cleanupAllowed: true });
});
```

- [ ] **Step 2: Run lifecycle tests and confirm failure**

Run: `npm test -- packages/supervisor/test`

- [ ] **Step 3: Implement run lock, incarnation, task lease, checkpoint and startup reconciliation**

On crash stop dispatch/effects, TERM/KILL registered groups, close browser/channels/listeners, mark unpublished/live handles lost, convert dispatching effects to unknown, then reconcile before new work. At `stop_new_experiments_at`, allow only already in-flight experiment/candidate finalization; at hard deadline allow deterministic archival and explicitly authorized cleanup only.

- [ ] **Step 4: Verify host fail-stop matrix**

Run: `npm test -- packages/supervisor/test packages/runtime/test/process-tree.test.ts`

Expected: accepted results survive; unknown operations quarantine only their scope; rejected fingerprints and next action survive checkpoint.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add supervisor lifecycle and recovery`.

### Task 12: Close the M0 deterministic Gate

**Files:**
- Create: `.github/workflows/m0-host.yml`
- Create: `tests/gates/m0-host.test.ts`, `tests/gates/m0-crash-matrix.test.ts`
- Create: `docs/gates/m0-host-foundation.md`
- Modify: `apps/cli/src/commands/doctor.ts`, root npm scripts

**Interfaces:**
- Consumes: all M0 services from Tasks 1-11.
- Produces: `npm run gate:m0` and a sanitized Gate result with per-capability `available|unavailable|blocked`.

**Depends on:** Tasks 1-11.

- [ ] **Step 1: Write the failing end-to-end M0 fixture**

```ts
it("completes a scoped tool loop without leaking secrets or bypassing effects", async () => {
  expect(await runM0Fixture()).toMatchObject({ outcome: "passed", falseSuccesses: 0, leakedSecrets: 0 });
});
```

- [ ] **Step 2: Run the complete Gate and record failures by contract**

Run: `npm run gate:m0`

- [ ] **Step 3: Add macOS/Linux CI and fill only missing integration wiring**

Do not add new product scope. CI must run deterministic tests on both supported host families and publish the doctor/capability report.

- [ ] **Step 4: Re-run the Gate**

Run: `npm ci && npm run typecheck && npm run build && npm run test:deterministic && npm run gate:m0`

Acceptance: identity/scope/deadline, runtime streaming, effect crash windows, artifact atomicity, secret boundary and browser scope/lifecycle all pass. Missing Linux-only host capability is reported, not faked.

- [ ] **Step 5: Commit if authorized**

Suggested message: `test: close host foundation gate`.

## M1 Solver Loop

### Task 13: Implement adaptive responsibilities and the hypothesis/experiment loop

**Files:**
- Create: `packages/supervisor/src/work-graph.ts`, `responsibilities.ts`, `intake.ts`, `hypotheses.ts`, `experiments.ts`, `repair-policy.ts`, `strategy.ts`
- Create: `packages/contracts/src/solver.ts`
- Test: `packages/supervisor/test/intake.test.ts`, `solver-loop.test.ts`, `strategy.test.ts`, `repair-policy.test.ts`

**Interfaces:**
- Consumes: bound OpenCode sessions and Runtime tools from M0.
- Produces: `classifyChallenge(observations)`, `createSolverTask(responsibilitySet)`, `recordExperimentResult`, `classifyFailure`, `selectNextRoute`; `TaskResult` envelope exactly matching spec section 6.2.

**Depends on:** Task 12.

- [ ] **Step 1: Write failing same-session repair and falsifier route tests**

```ts
it("keeps syntax and parse repair in the same solver task", async () => {
  expect(await runRepairFixture()).toMatchObject({ solverTaskCount: 1, strategyFallbacks: 0 });
});
it("does not retry a falsified fingerprint", async () => {
  expect((await runFalsifierFixture()).attemptedFingerprints).toEqual(["route-a", "route-b"]);
});
it("does not infer category from challenge ID or level", () => {
  expect(classifyChallenge({ id: "web-100", level: 1, observableMaterials: [] })).toBe("ambiguous");
});
```

- [ ] **Step 2: Run solver tests and confirm failure**

Run: `npm test -- packages/supervisor/test/intake.test.ts packages/supervisor/test/solver-loop.test.ts packages/supervisor/test/strategy.test.ts`

- [ ] **Step 3: Implement intake, structured responsibilities, hypotheses, experiments and semantic-progress windows**

Preserve raw statement/material/source metadata, classify from observable evidence rather than names, and retain ambiguous/out-of-scope items in the manifest. Allow one primary route plus one low-cost counterprobe; only premise/resource changes or exhausted repair budget return to Strategy.

- [ ] **Step 4: Verify deterministic solver transitions**

Run: `npm test -- packages/supervisor/test/intake.test.ts packages/supervisor/test/solver-loop.test.ts packages/supervisor/test/strategy.test.ts packages/supervisor/test/repair-policy.test.ts`

Expected: timeouts/tool errors do not automatically falsify mechanisms; two no-progress windows trigger replan then optional Recovery Critic.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add adaptive solver work graph`.

### Task 14: Implement durable long-job watches and continuations

**Files:**
- Create: `packages/runtime/src/watch.ts`
- Create: `packages/supervisor/src/continuations.ts`
- Modify: `packages/state/src/outbox.ts`
- Test: `packages/runtime/test/watch.test.ts`, `packages/supervisor/test/continuations.test.ts`

**Interfaces:**
- Consumes: Job Runtime and transactional outbox.
- Produces: `job.watch(jobId, cursor, continuationRef)`, `claimContinuation(eventId, taskId)`, `resumeContinuation(claim)`.

**Depends on:** Tasks 11 and 13.

- [ ] **Step 1: Write failing duplicate-delivery and lost-job tests**

```ts
it("grants exactly one runnable continuation for duplicate terminal events", async () => {
  expect(await deliverTerminalEventTwice()).toMatchObject({ runnableClaims: 1 });
});
```

- [ ] **Step 2: Run watch tests and confirm failure**

Run: `npm test -- packages/runtime/test/watch.test.ts packages/supervisor/test/continuations.test.ts`

- [ ] **Step 3: Implement atomic watch/event/outbox state and completion wake-up**

Persist job, waiting task, experiment, cursor, deadline and next action; `completed|error|cancelled|lost` all wake one deterministic branch.

- [ ] **Step 4: Verify without model polling**

Run: `npm test -- packages/runtime/test/watch.test.ts packages/supervisor/test/continuations.test.ts`

Expected: Worker can exit while job runs; duplicate outbox delivery cannot repeat the continuation.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: resume solver work from durable job watches`.

### Task 15: Implement fixed offline Reference snapshots

**Files:**
- Create: `packages/reference/package.json`
- Create: `packages/reference/src/service.ts`, `indexer.ts`, `query.ts`, `manifest.ts`, `sanitize.ts`
- Create: `config/reference/manifest.json`, `fixtures/reference/approved/*.md`
- Test: `packages/reference/test/search.test.ts`, `visibility.test.ts`, `snapshot.test.ts`

**Interfaces:**
- Consumes: release profile and State/Artifact refs.
- Produces: `openReferenceSnapshot(manifest)`, `reference.search(query, filters)`, `reference.get(ref, range)`.

**Depends on:** Tasks 3-4 and 12.

- [ ] **Step 1: Write failing visibility and no-hot-update tests**

```ts
it("does not expose another challenge namespace", async () => {
  expect(await searchAs("challenge-a", "challenge-b-only")).toEqual([]);
});
it("keeps the run snapshot stable after the source index changes", async () => {
  expect(await resultAfterSourceMutation()).toEqual(resultBeforeMutation);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- packages/reference/test`

- [ ] **Step 3: Implement SQLite FTS5/BM25 with source/version/capability filters and bilingual synonyms**

Return small cited chunks; never let reference content grant scope or capability. Candidate knowledge remains invisible until post-run human approval.

- [ ] **Step 4: Verify snapshot identity and namespace policy**

Run: `npm test -- packages/reference/test`

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add fixed offline reference service`.

### Task 16: Implement candidate engineering, independent verification and submission

**Files:**
- Create: `packages/supervisor/src/candidates.ts`, `engineering.ts`, `verification.ts`, `submission.ts`
- Create: `packages/contracts/src/verification.ts`
- Test: `packages/supervisor/test/candidate-flow.test.ts`, `verification.test.ts`, `submission.test.ts`

**Interfaces:**
- Consumes: published artifacts, independent task/session creation and Platform Service intents.
- Produces: `candidate.register`, `publishSolution`, `verifyCandidate(mode: replay|recompute|evidence_audit)`, `proposeSubmission`, `handleSubmissionResult`.

**Depends on:** Tasks 9, 11, 13 and 15.

- [ ] **Step 1: Write failing independence, gap, stale and rejection tests**

```ts
it("rejects verification when the evidence range has a cursor gap", async () => {
  expect(await verify(gappedEvidence())).toMatchObject({ status: "inconclusive" });
});
it("continues after verified candidate is rejected by the platform", async () => {
  expect(await rejectVerifiedCandidate()).toMatchObject({ solved: false, nextStage: "solving" });
});
```

- [ ] **Step 2: Run candidate tests and confirm failure**

Run: `npm test -- packages/supervisor/test/candidate-flow.test.ts packages/supervisor/test/verification.test.ts packages/supervisor/test/submission.test.ts`

- [ ] **Step 3: Implement immutable candidate revisions and verifier capability restrictions**

Bind verification to candidate bytes/hash, solution, inputs, generation, evidence refs and `validUntil`. Rejected/inconclusive/stale states must return to a deterministic next branch, never hang.

- [ ] **Step 4: Verify candidate state matrix**

Run: `npm test -- packages/supervisor/test/candidate-flow.test.ts packages/supervisor/test/verification.test.ts packages/supervisor/test/submission.test.ts`

Expected: only Coordinator can propose submit; only Platform Service executes it; partial acceptance preserves score/slot and continues.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add independent candidate verification`.

### Task 17: Implement compaction and session reconstruction

**Files:**
- Create: `packages/supervisor/src/working-set.ts`, `session-recovery.ts`
- Modify: `packages/opencode-bridge/src/sessions.ts`
- Test: `packages/supervisor/test/compaction.test.ts`, `session-recovery.test.ts`

**Interfaces:**
- Consumes: checkpoints, artifact refs, OpenCode compaction hooks and work graph.
- Produces: `buildWorkingSet(snapshot)`, `compactAndCheckpoint(sessionId)`, `recreateSession(taskId, snapshotSequence)`.

**Depends on:** Tasks 13-16.

- [ ] **Step 1: Write failing raw-retrieval and no-repeat tests**

```ts
it("retrieves the cited raw range after compaction", async () => {
  expect(await compactThenInspect()).toMatchObject({ rawBytesRecovered: true });
});
it("executes the saved next action without rerunning a rejected fingerprint", async () => {
  expect((await rebuildSession()).executed).toEqual(["saved-next-action"]);
});
```

- [ ] **Step 2: Run recovery tests and confirm failure**

Run: `npm test -- packages/supervisor/test/compaction.test.ts packages/supervisor/test/session-recovery.test.ts`

- [ ] **Step 3: Implement compact working sets as pointers, not evidence replacements**

Validate dependency versions and resource generation before continuing; stale only the affected engineering/verification revision.

- [ ] **Step 4: Verify forced compaction and new-session paths**

Run: `npm test -- packages/supervisor/test/compaction.test.ts packages/supervisor/test/session-recovery.test.ts`

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: recover solver work across compaction`.

### Task 18: Build domain fixtures and pass the six M1 model trajectories

**Files:**
- Create: `fixtures/solver/{repair,route-switch,long-job,compaction,rejected-submit,partial}/**`
- Create: `fixtures/domains/{web,misc,crypto}/**`
- Create: `packages/supervisor/src/domain-methods.ts`
- Create: `tests/gates/m1-domain-capability.test.ts`, `tests/gates/m1-model-trajectories.test.ts`, `tests/gates/model-runner.ts`
- Create: `docs/gates/m1-solver-loop.md`
- Modify: `config/release-profile.schema.json`, root npm scripts

**Interfaces:**
- Consumes: complete M1 solver stack and fixed model/profile input.
- Produces: evidence-driven Web/Misc/Crypto method templates, functional domain capability fixtures, and `npm run gate:m1 -- --trajectory <name> --runs 3`; sanitized summary plus immutable per-run state/artifact directories.

**Depends on:** Tasks 13-17 and M1 External Input Gate.

- [ ] **Step 1: Write deterministic fixture assertions for all three domains and six trajectories**

```ts
it.each(["repair", "route-switch", "long-job", "compaction", "rejected-submit", "partial"])("records a complete %s trajectory", async (name) => {
  expect(await inspectTrajectory(name)).toMatchObject({ authoritativeTransitions: true, falseSuccesses: 0 });
});
it.each(["web", "misc", "crypto"])("executes a real bounded %s experiment", async (domain) => {
  expect(await runDomainFixture(domain)).toMatchObject({ realToolObservation: true, candidateDerivationVerified: true });
});
```

- [ ] **Step 2: Run deterministic fixtures before any model Gate**

Run: `npm run test:deterministic && npm test -- tests/gates/m1-domain-capability.test.ts tests/gates/m1-model-trajectories.test.ts`

- [ ] **Step 3: Implement the Web method and fixture**

Establish a normal request/page/session baseline before controlled variants, require an input-to-effect hypothesis before exploitation, and preserve state-sensitive replay evidence.

- [ ] **Step 4: Implement the Misc method and fixture**

Record source identity and a bounded provenance DAG for published transformations; limit depth, artifact count and expanded bytes, and avoid expanding the same content twice.

- [ ] **Step 5: Implement the Crypto method and fixture**

Preserve bytes/integer/endianness/leading-zero/padding semantics, check cheap preconditions before expensive work, and verify candidates against original equations. All three methods emit hypotheses, falsifiers, stop conditions and evidence refs rather than treating a flag-shaped string as proof.

- [ ] **Step 6: Re-run deterministic domain and trajectory fixtures**

Run: `npm run test:deterministic && npm test -- tests/gates/m1-domain-capability.test.ts tests/gates/m1-model-trajectories.test.ts`

- [ ] **Step 7: Run each trajectory three times from clean state with identical fixed configuration**

Run: `npm run gate:m1 -- --all --runs 3`

Do not retry inside one conversation to manufacture an independent run; preserve all failures and costs.

- [ ] **Step 8: Evaluate M1 acceptance**

Acceptance: all three functional domain fixtures pass, every model trajectory succeeds at least 2/3, deterministic suite remains green, and reports include all 18 model runs, token/tool/wall costs and failure codes. Otherwise keep M1 incomplete.

- [ ] **Step 9: Commit if authorized**

Suggested message: `test: validate solver loop trajectories`.

## M2 TSecBench Live Single

### Task 19: Execute the host live single-challenge Gate

**Files:**
- Create: `tests/gates/m2-live-single.ts`
- Create: `docs/gates/m2-tsecbench-live-single.md`
- Modify: `apps/cli/src/commands/doctor.ts`, `prepare.ts`, `start.ts`

**Interfaces:**
- Consumes: passed M0/M1, task A secret refs, host VPN and time/baseline evidence.
- Produces: a live run with immutable first-List baseline and at least one new authoritative accepted transition.

**Depends on:** Task 18 and M2 External Input Gate.

- [ ] **Step 1: Add a dry-run validator for required live inputs**

```ts
it("refuses live start when time evidence is missing", async () => {
  await expect(validateM2Input(withoutTimeEvidence())).rejects.toMatchObject({ code: "missing_task_time_evidence" });
});
```

- [ ] **Step 2: Run all deterministic tests and `ctf-agent prepare`**

Run: `npm run test:deterministic && npm run cli -- prepare --profile host-dev --run-mode live --config <task-a-profile>`

Acceptance before start: VPN probe is HTTP 200 with JSON `status == "ok"`; no Challenges API request occurred; preview names timing/quota effects.

- [ ] **Step 3: Obtain explicit user approval, then run start once**

Run: `npm run cli -- start --prepared-run <run-id>`

Do not reset task A or replace the run after First List.

- [ ] **Step 4: Verify and preserve the M2 Gate result**

Run: `npm run gate:m2 -- --run <run-id>`

Acceptance: relative to revision-0 baseline, this run has at least one confirmed accepted Submit or clean/exclusive unambiguous accepted reconciliation; no false solved; raw secrets absent from report.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: validate live tsecbench single challenge`.

## M3 Host Portfolio

### Task 20: Implement portfolio scheduling, instance budgets and cleanup

**Files:**
- Create: `packages/supervisor/src/scheduler.ts`, `portfolio.ts`, `budgets.ts`, `instance-slots.ts`, `cleanup.ts`
- Test: `packages/supervisor/test/scheduler.test.ts`, `instance-slots.test.ts`, `cleanup.test.ts`

**Interfaces:**
- Consumes: challenge snapshots, strategy estimates, budgets and Platform Service.
- Produces: `rankPortfolio(snapshot): ScheduleDecision[]`, `acquireInstanceSlot`, `releaseInstanceSlot`, `beginCleanup`, `finalizeCleanup`.

**Depends on:** Tasks 16, 19.

- [ ] **Step 1: Write failing score/time, tie-break, three-slot and cleanup tests**

```ts
it("ranks by expected remaining score per remaining wall time", () => {
  expect(rankPortfolio(portfolioFixture()).map((x) => x.challengeId)).toEqual(["fast-value", "slow-value"]);
});
it("never conflates worker, browser and instance capacity", () => {
  expect(resourceDecisionFixture()).toMatchObject({ instanceSlots: 3, browserSlots: 1 });
});
```

- [ ] **Step 2: Run scheduler tests and confirm failure**

Run: `npm test -- packages/supervisor/test/scheduler.test.ts packages/supervisor/test/instance-slots.test.ts packages/supervisor/test/cleanup.test.ts`

- [ ] **Step 3: Implement evidence-backed ranking and cleanup state machine**

Use remaining score only; budgets remain separate dimensions. Confirm stopped via List and preserve accepted score even when cleanup fails.

- [ ] **Step 4: Verify fixture portfolio**

Run: `npm test -- packages/supervisor/test/scheduler.test.ts packages/supervisor/test/instance-slots.test.ts packages/supervisor/test/cleanup.test.ts packages/platform/test/tsecbench-reconcile.test.ts`

Acceptance: fixture covers three active instances, pending/stop_pending, start limit, switching, deadline and cleanup unknown.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: schedule multi-challenge portfolio`.

### Task 21: Continue task A through the host portfolio and fail-stop Gate

**Files:**
- Create: `tests/gates/m3-host-portfolio.ts`, `tests/gates/m3-host-recovery.test.ts`
- Create: `docs/gates/m3-host-portfolio.md`

**Interfaces:**
- Consumes: the same non-reset task A/run lineage from Task 19.
- Produces: complete supported-challenge manifest, cross-challenge scheduling evidence, cleanup report and recovery result.

**Depends on:** Task 20 and the still-valid task A.

- [ ] **Step 1: Run deterministic M3 fixture and recovery injection**

Run: `npm run test:deterministic && npm test -- tests/gates/m3-host-recovery.test.ts`

- [ ] **Step 2: Resume the existing task A run, never create a replacement baseline**

Run: `npm run cli -- start --prepared-run <existing-run-id> --resume`

- [ ] **Step 3: Exercise portfolio scheduling and one controlled host fail-stop**

Verify old process groups stop, handles become lost, deadline does not move, accepted progress remains, and unaffected challenges resume from checkpoint.

- [ ] **Step 4: Evaluate M3 acceptance**

Run: `npm run gate:m3 -- --run <run-id>`

Acceptance: all visible supported challenges remain in the report, cross-challenge decisions are evidence-backed, no more than three active instances occur, and at least one challenge is authoritatively accepted in the uninterrupted task A trajectory.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: validate host portfolio gate`.

## M4 ARM64 Package

### Task 22: Build the fixed Core image and capability manifest

**Files:**
- Create: `docker/core/Dockerfile`, `docker/core/entrypoint.sh`, `docker/core/healthcheck.sh`, `docker/core/tool-manifest.json`
- Create: `scripts/build-core-image.sh`, `scripts/generate-sbom.sh`
- Create: `packages/runtime/src/capability-matrix.ts`
- Test: `tests/gates/core-build.test.ts`, `tests/gates/core-tools.test.ts`

**Interfaces:**
- Consumes: passed M3 commit/worktree, package lock and versioned Reference manifest.
- Produces: noninteractive `scripts/build-core-image.sh`, image `ctf-agent:core-arm64`, SBOM, version report and capability manifest.

**Depends on:** Task 21.

- [ ] **Step 1: Write failing reproducibility, no-secret and offline-start tests**

```ts
it("contains no configured provider, platform or VPN secret", async () => {
  expect(await scanImageForFixtureSecrets()).toEqual([]);
});
it("starts cold without registry or dependency downloads", async () => {
  expect((await coldStartWithRegistryBlocked()).downloadAttempts).toBe(0);
});
```

- [ ] **Step 2: Run Core build tests and confirm missing image**

Run: `npm test -- tests/gates/core-build.test.ts tests/gates/core-tools.test.ts`

- [ ] **Step 3: Implement digest-pinned multi-stage build and functional tool recipes**

Package OpenCode 1.19.0, services, Chromium and only tested Web/Misc/Crypto tools. Worker runs non-root; system/site packages are read-only; `/data` is persistent; no Docker socket.

- [ ] **Step 4: Build and run fixture contracts in the image**

Run: `scripts/build-core-image.sh && docker run --rm ctf-agent:core-arm64 npm run gate:m0`

Acceptance: SBOM/version/capability files exist, fixture suite passes, and missing tools are `unavailable`, never inferred from binary presence alone.

- [ ] **Step 5: Commit if authorized**

Suggested message: `build: package arm64 ctf agent core`.

### Task 23: Enforce Core egress and whole-container fail-stop

**Files:**
- Create: `packages/core-egress/package.json`
- Create: `packages/core-egress/src/egressd.ts`, `namespaces.ts`, `grants.ts`
- Create: `docker/core/egress/nftables.conf`, `docker/core/egress/users.conf`
- Create: `scripts/run-core.sh`, `scripts/recover-core.sh`
- Test: `tests/gates/core-egress.test.ts`, `tests/gates/core-fail-stop.test.ts`
- Modify: root npm scripts

**Interfaces:**
- Consumes: signed run scope grants and Core image from Task 22.
- Produces: per-service/per-challenge network namespaces; narrow root-owned `egressd` API `createNamespace`, `applyGrantSet`, `launchInNamespace`, `destroyNamespace`; Core incarnation recovery.

**Depends on:** Task 22.

- [ ] **Step 1: Write failing raw bypass and stale-container tests**

```ts
it.each(["curl", "python-socket", "browser"])("blocks public, provider, platform and other-challenge targets via %s", async (client) => {
  expect(await runBypassMatrix(client)).toMatchObject({ bypasses: 0 });
});
it("does not start a new core until Docker confirms the old core stopped", async () => {
  expect(await recoverWhileOldCoreAlive()).toMatchObject({ newCoreStarted: false });
});
```

- [ ] **Step 2: Run egress/fail-stop tests and confirm failure**

Run: `npm test -- tests/gates/core-egress.test.ts tests/gates/core-fail-stop.test.ts`

- [ ] **Step 3: Implement namespace/UID enforcement and container-level recovery**

Only Model Gateway reaches provider, only Platform Service reaches platform control API, and each Tool job/Browser reaches only its current grants. Public search, registry and cross-challenge targets remain unreachable.

- [ ] **Step 4: Verify positive and negative paths on Linux ARM64**

Run: `npm run gate:core-egress && npm test -- tests/gates/core-fail-stop.test.ts`

Acceptance: approved endpoints work; every raw bypass fails; recovery marks all old connections lost and keeps original deadline.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: enforce core egress and fail-stop`.

### Task 24: Pass native ARM64 parity and task B live Gate

**Files:**
- Create: `tests/gates/m4-arm64-parity.ts`, `tests/gates/m4-live-core.ts`
- Create: `docs/gates/m4-arm64-package.md`

**Interfaces:**
- Consumes: native Ubuntu ARM64 host, task B, host VPN and passed Core image.
- Produces: M0-M3 parity report, egress report, cold-start report and one new task B accepted result.

**Depends on:** Tasks 22-23 and M4 External Input Gate.

- [ ] **Step 1: Verify host prerequisites and native architecture**

Run: `uname -m && docker info && scripts/build-core-image.sh`

Acceptance: architecture is native `aarch64/arm64`; QEMU alone cannot satisfy this step.

- [ ] **Step 2: Run deterministic parity and raw egress matrix**

Run: `npm run gate:m4 -- --phase deterministic --image ctf-agent:core-arm64`

- [ ] **Step 3: Prepare task B, obtain explicit approval and run the Core live trajectory once**

Run: `npm run gate:m4 -- --phase live --config <task-b-profile> --image ctf-agent:core-arm64`

- [ ] **Step 4: Evaluate M4 acceptance**

Acceptance: M0-M3 contracts pass in Core, all negative egress tests fail closed, cold start downloads nothing, host VPN reaches platform/target through Tool Runtime, and task B gains at least one new authoritative accepted result.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: validate native arm64 core`.

## M5 Conditional Delivery Hardening

### Task 25: Add a container VPN capability track when required

**Files:**
- Create: `docker/profiles/container-vpn/**`, `packages/core-egress/src/vpn-profile.ts`
- Test: `tests/gates/m5-container-vpn.test.ts`
- Create: `docs/gates/m5-container-vpn.md`

**Interfaces:**
- Consumes: M4 egress namespaces and an approved VPN profile.
- Produces: explicit `container_vpn` capability with route/DNS/credential lifecycle and positive/negative tests.

**Depends on:** Task 24. Conditional: skip unless a target formal profile requires container VPN.

- [ ] Write failing route, DNS leak, credential leak and reconnect attribution tests.
- [ ] Run `npm test -- tests/gates/m5-container-vpn.test.ts` and confirm failure.
- [ ] Implement TUN lifecycle without exposing VPN credential to model/jobs and preserve formal intervention rules.
- [ ] Run `npm run gate:m5 -- --track container-vpn`; accept only if approved targets work and all other egress remains blocked.
- [ ] Commit if authorized with suggested message `feat: add container vpn profile`.

### Task 26A: Add the multi-Challenge-Browser track when required

**Files:**
- Create: `packages/browser/src/pool.ts`, `browser-slots.ts`
- Create: `docker/profiles/multi-browser/**`
- Test: `tests/gates/m5-multi-browser.test.ts`
- Create: `docs/gates/m5-multi-browser.md`

**Interfaces:**
- Consumes: M4 namespace grants and the single Browser Service.
- Produces: `multi_browser` capability, `acquireBrowserSlot(challengeId)` and independent process/UID/profile/proxy ownership per slot.

**Depends on:** Task 24. Conditional on a profile that needs simultaneous Challenge Browsers.

- [ ] Write a failing test asserting two challenge browsers cannot read each other's profile, cookies, downloads or network grants.
- [ ] Run `npm test -- tests/gates/m5-multi-browser.test.ts` and confirm failure.
- [ ] Implement the pool and a browser-slot budget independent from Worker and instance slots.
- [ ] Run `npm run gate:m5 -- --track multi-browser`; accept only if isolation and teardown tests pass while the original single-browser profile remains unchanged.
- [ ] Commit if authorized with suggested message `feat: add multi challenge browser profile`.

### Task 26B: Add the Platform Browser and noVNC handoff tracks when required

**Files:**
- Create: `packages/browser/src/platform-browser.ts`, `display.ts`, `novnc.ts`, `handoff-attribution.ts`
- Create: `docker/profiles/platform-browser/**`
- Test: `tests/gates/m5-platform-browser.test.ts`, `m5-novnc.test.ts`
- Create: `docs/gates/m5-platform-browser.md`

**Interfaces:**
- Consumes: M4 egress service identity and immutable intervention policy.
- Produces: separately declared `platform_browser` and `novnc_handoff` capabilities; `recordHumanHandoff(input): InterventionRecord`.

**Depends on:** Task 24. Conditional on a platform or live profile that cannot use its approved API alone.

- [ ] Write failing tests proving Challenge Browser cannot inherit Platform Browser credentials and noVNC interaction invalidates a formal run when policy requires it.
- [ ] Run `npm test -- tests/gates/m5-platform-browser.test.ts tests/gates/m5-novnc.test.ts` and confirm failure.
- [ ] Implement separate process/UID/profile/display and explicit human-handoff attribution without giving platform credentials to Solver sessions.
- [ ] Run `npm run gate:m5 -- --track platform-browser` and `npm run gate:m5 -- --track novnc`; accept each capability independently.
- [ ] Commit each authorized track separately.

### Task 26C: Add management/data network separation and callback track when required

**Files:**
- Create: `packages/core-egress/src/network-identities.ts`, `packages/runtime/src/callback.ts`
- Create: `docker/profiles/callback/**`
- Test: `tests/gates/m5-network-identities.test.ts`, `m5-callback.test.ts`
- Create: `docs/gates/m5-callback-network.md`

**Interfaces:**
- Consumes: M4 namespaces and Runtime listener lifecycle.
- Produces: `callback_listener` capability, `publishListenerGrant(listenerId, scope)` and distinct management/data identities.

**Depends on:** Task 24. Conditional on a challenge requiring inbound callback/listener behavior.

- [ ] Write failing tests proving callback routes are unavailable before publication and cannot reach provider/platform/other-challenge networks.
- [ ] Run `npm test -- tests/gates/m5-network-identities.test.ts tests/gates/m5-callback.test.ts` and confirm failure.
- [ ] Implement narrow listener publication, expiry, ownership transfer and teardown through the approved data path.
- [ ] Run `npm run gate:m5 -- --track callback`; accept only if positive callback and all negative cross-boundary tests pass.
- [ ] Commit if authorized with suggested message `feat: add scoped callback network profile`.

### Task 27: Add the CTFd adapter track when required

**Files:**
- Create: `packages/platform/src/ctfd/client.ts`, `mapper.ts`, `reconcile.ts`
- Create: `fixtures/ctfd/**`
- Test: `packages/platform/test/ctfd-contract.test.ts`
- Create: `docs/gates/m5-ctfd.md`

**Interfaces:**
- Consumes: generic `PlatformAdapter` and Platform Service effect ledger.
- Produces: only capabilities proven by the selected CTFd version; unsupported operations remain explicit.

**Depends on:** Task 24. Conditional on a CTFd target.

- [ ] Capture approved CTFd version/auth/API evidence and write failing wire-contract tests.
- [ ] Run `npm test -- packages/platform/test/ctfd-contract.test.ts`.
- [ ] Implement list/get/download/instance/hint/submit/score/history only where authoritative endpoints exist.
- [ ] Run fixture plus one authorized integration Gate; verify no browser fallback silently expands capability.
- [ ] Commit if authorized with suggested message `feat: add ctfd platform adapter`.

### Task 28: Add the rCTF adapter track when required

**Files:**
- Create: `packages/platform/src/rctf/client.ts`, `mapper.ts`, `reconcile.ts`
- Create: `fixtures/rctf/**`
- Test: `packages/platform/test/rctf-contract.test.ts`
- Create: `docs/gates/m5-rctf.md`

**Interfaces:**
- Consumes: generic `PlatformAdapter` and Platform Service effect ledger.
- Produces: version-pinned rCTF capabilities without inventing TSecBench semantics.

**Depends on:** Task 24. Conditional on an rCTF target.

- [ ] Capture approved rCTF version/auth/API evidence and write failing contract tests.
- [ ] Run `npm test -- packages/platform/test/rctf-contract.test.ts`.
- [ ] Implement only observed capabilities, effect classes and reconciliation rules.
- [ ] Run fixture plus one authorized integration Gate, including partial/error/unknown outcomes.
- [ ] Commit if authorized with suggested message `feat: add rctf platform adapter`.

### Task 29: Add an approved unknown-platform exploration track when required

**Files:**
- Create: `packages/platform/src/exploration/inspector.ts`, `proposal.ts`, `approval.ts`
- Test: `packages/platform/test/exploration-approval.test.ts`
- Create: `docs/gates/m5-unknown-platform.md`

**Interfaces:**
- Consumes: Platform Browser capability from Task 26B and generic adapter contracts.
- Produces: read-only capability proposal, explicit human approval record and generated one-run adapter profile; no unapproved mutation.

**Depends on:** Tasks 24 and 26B. Conditional on an unknown platform.

- [ ] Write failing tests proving page content cannot approve capability, reveal credentials or trigger submit/Hint/instance effects.
- [ ] Run `npm test -- packages/platform/test/exploration-approval.test.ts`.
- [ ] Implement read-only inspection, typed proposal diff and explicit out-of-band approval.
- [ ] Run `npm run gate:m5 -- --track unknown-platform` against an authorized fixture before any live use.
- [ ] Commit if authorized with suggested message `feat: gate unknown platform exploration`.

## M6 Formal Acceptance

### Task 30: Implement formal evaluation, metrics and reporting

**Files:**
- Create: `packages/reporting/package.json`
- Create: `packages/reporting/src/evaluator.ts`, `denominators.ts`, `metrics.ts`, `export.ts`, `redaction.ts`
- Create: `apps/cli/src/commands/report.ts`
- Test: `packages/reporting/test/evaluator.test.ts`, `denominators.test.ts`, `redaction.test.ts`

**Interfaces:**
- Consumes: canonical run/challenge/task/effect state and immutable artifacts only.
- Produces: `evaluateFormalRun(snapshot): FormalResult`, `exportRunReport(runId, destination)`, exact `passed|failed|insufficient_gate_coverage|infrastructure_invalid` Gate status.

**Depends on:** Task 24 and any M5 tracks required by the selected profile.

- [ ] **Step 1: Write failing denominator, attribution and redaction tests**

```ts
it("keeps timeout, needs_capability and unsolved supported challenges in the denominator", () => {
  expect(evaluateFormalRun(denominatorFixture()).inScopeCount).toBe(4);
});
it("does not count partial, candidate_only or pre-existing accepts as solved", () => {
  expect(evaluateFormalRun(attributionFixture()).solvedCount).toBe(1);
});
it("requires authoritative completion for unknown-total and local targets", () => {
  expect(evaluateFormalRun(unknownTotalWithoutOracleFixture()).solvedCount).toBe(0);
});
```

- [ ] **Step 2: Run reporting tests and confirm failure**

Run: `npm test -- packages/reporting/test`

- [ ] **Step 3: Implement exact easy/medium/unknown thresholds and zero-false-success checks**

Use `ceil(easy*60%)`, `ceil(medium*30%)`, `ceil(unknown*45%)`, or `ceil(all-in-scope*45%)` when no trusted difficulty exists. Hard remains reported but outside the version threshold.

- [ ] **Step 4: Verify metrics and immutable export**

Run: `npm test -- packages/reporting/test && npm run typecheck`

Acceptance: empty/vacuous denominator cannot pass; multi-flag needs challenge complete/all frozen slots; external failure yields `infrastructure_invalid`; reports contain required wall/token/tool/recovery metrics and no secrets.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: evaluate and report formal runs`.

### Task 31: Execute one registered formal acceptance run

**Files:**
- Create: `tests/gates/m6-formal.ts`
- Create: `docs/gates/m6-formal-acceptance.md`
- Modify: root npm scripts

**Interfaces:**
- Consumes: passed deterministic/Core gates, selected capability tracks, clean formal target, frozen model/reference/tool/budget profile and human-intervention policy.
- Produces: one immutable formal run and final sanitized report; diagnostic reruns always use a new run ID and never merge results.

**Depends on:** Task 30 and M6 External Input Gate.

- [ ] **Step 1: Run pre-start admission without touching the platform Challenges API**

Run: `npm run gate:m6 -- --phase pre-start --config <formal-profile>`

Acceptance: clean/exclusive account/task evidence, score/Hint/resource baseline, duration/elapsed/deadline source, model/reference/tool budgets and intervention policy are frozen.

- [ ] **Step 2: Obtain explicit user approval for the timed one-shot run**

Record approval reference outside model-visible challenge content.

- [ ] **Step 3: Start once and complete post-start admission before any solving effect**

Run: `npm run gate:m6 -- --phase run --prepared-run <run-id>`

Acceptance before solving: manifest/progress revision 0 is immutable; every visible item is classified; no locked/ambiguous/discovery-incomplete item exists; a non-empty calculable denominator exists.

- [ ] **Step 4: Evaluate without deleting failures or merging reruns**

Run: `npm run gate:m6 -- --phase evaluate --run <run-id>`

Acceptance: section 12.5 thresholds pass, zero false success, every supported challenge has a real experiment or verified blocker, secret/VPN recovery has before/after evidence of no challenge side effect, any human solving/submission/instance/Challenge Browser action makes the run invalid, and cleanup/reporting does not rewrite accepted outcomes.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: record formal ctf agent acceptance`.

## Plan Completion Checklist

- [ ] M0 deterministic host Gate passes on supported macOS and Linux.
- [ ] M1 all six trajectories pass the fixed 2/3 rule with all 18 results retained.
- [ ] M2 and M3 pass on the same uninterrupted task A lineage.
- [ ] M4 passes on native Ubuntu ARM64 with independent task B and raw egress bypass tests.
- [ ] Only required M5 capability tracks are implemented and each has an independent Gate.
- [ ] M6 one-shot formal run meets exact denominator/threshold rules with zero false success.
- [ ] No report claims a live, ARM64, network-isolation or formal result that was only proven by fixture/mock/QEMU.
