> ⚫ **已废弃（archived）** · 旧的单体实施计划，水平分层 + 累加膨胀导致死循环，已被 [`../2026-10-16-ctf-agent-mvp-roadmap.md`](../2026-10-16-ctf-agent-mvp-roadmap.md) 取代。加固细节可按需取用，但不再执行。

# 通用 CTF 解题 Agent 系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个 host-first、可恢复、以权威平台结果为准的通用 CTF 解题 Agent，先完成 Web、Misc、Crypto 的 TSecBench 单题和多题闭环，再封装并验证 Ubuntu ARM64 Core。

**Architecture:** 使用 TypeScript/npm workspace 实现单一产品控制层，按 package 隔离 Contracts、State、Policy、Tool Runtime、Platform、Browser、Reference、OpenCode Bridge 和 Supervisor；SQLite 是唯一 canonical state，Artifact Store 保存不可变内容。`host-dev` 与 `core-arm64` 共用同一组类型、状态迁移、fixture 和行为契约，Docker 只在 host 的 M0-M3 Gate 通过后加入。

**Tech Stack:** Node.js 24 LTS、TypeScript、npm workspaces、Vitest、Zod、SQLite/FTS5、Fastify、OpenCode/`@opencode-ai/plugin`/`@opencode-ai/sdk` 1.19.0、Playwright Chromium、Docker BuildKit、Ubuntu ARM64。

**Spec:** `docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`

## Global Constraints

- 当前仓库只有设计资料；本计划从新的应用骨架开始，不复用已删除的旧 `pentest-agent-harness`。
- 首版只承诺 Web、Misc、Crypto；Pwn、Reverse、Mobile、Blockchain、Cloud 等只列入 manifest，不进入首版求解承诺。
- Gate 顺序固定为 `host-dev` M0 -> M1 -> M2 -> M3 -> `core-arm64` M4；Task 20 的 M3 产品 readiness 必须在首次 M2 live call 前完成，但 M2 仍先作为同一 live 轨迹的中途 Gate。M0-M3 未通过前不得以 Docker 工作替代 Agent 能力闭环。
- OpenCode、plugin 与 SDK 固定为 `1.19.0`；只使用公开 plugin、SDK、server 接口。若 contract test 证明缺少必要 hook，返回设计 blocker，不维护私有 fork。
- 每个 profile 同时只允许一个 active run；一个 State-authenticated execution/session binding 固定携带 run、challenge、incarnation、task、attempt、`responsibility_set`、lease 和 Worker reservation，任何服务不得另收可替换 incarnation/owner 标量。
- Platform Service 是平台 credential 和平台 effect 的唯一持有者；Coordinator 是唯一 submit intent 提出者；Solver 和 Verifier 永远不能直接提交。
- Provider credential 只由 Model Data Gateway 持有；`control_secret` 永不进入模型、Tool job、Artifact 或日志。
- SQLite 是唯一 canonical write store；Artifact Store 只保存不可变内容；JSONL/Markdown 只能由 canonical state 导出。
- Effect 固定分为 `local_rebuildable`、`retryable_observation`、`protected_effect`；`unknown` protected effect 不盲重发，只隔离最小受影响 scope。
- `job.read` 必须在作业仍运行时按单调 cursor 返回现有 bytes；只有发布后的 immutable range 可用于 handoff、checkpoint、candidate 和 verification。
- Host-dev 使用受管进程树 fail-stop；Core 使用整容器 fail-stop。Host 上的 Supervisor、Job 和 Browser process 一律经 CLI/Launcher-owned gated spawn 建立：Launcher 在 payload 可执行前持久接管 OS identity，未完成握手的 child 不得执行题目 payload。State 只能通过 host composition 注入的 nominal authenticated `LauncherAuthorityClient` 解析当前 opaque run-lock capability 并从中派生 run/incarnation，不能接受结构化 client/lock proof 或平行 identity 参数。无法证明 pending/active launch 与旧执行均已停止时，不得签发 opaque `LauncherStopProof` 或建立新 mutation owner。
- Host-dev 不是安全 sandbox，也不能产生 formal 结果；硬限额非绕过性只可在 broker fixture 或 Core egress Gate 中声明。
- 首阶段只有一个按 challenge 启动的 Playwright Challenge Browser；转题时销毁整个 browser process/profile。
- TSecBench 同时最多三个活跃 instance；Worker、Browser slot 和 instance slot 分别计量。
- 共享 BudgetLedger 同时承载累计消耗与可归还容量，但语义固定分开：`model_tokens/tool_wall_ms/submissions/hints/remote_units` 是不可通过 teardown 退款的 consumable，`worker_slots/browser_slots/instances` 是 capacity。容量激活固定为 `reserved -> activating -> occupied`，teardown 固定为 `occupied -> teardown_pending -> released`；不确定状态按阶段区分为 `activation_unknown`／`teardown_unknown`。同一 owner/generation 的权威 active proof 可把 `activation_unknown|teardown_pending|teardown_unknown` 恢复为 `occupied`；只有绑定 operation/reservation/dimension/owner/generation/canonical phase-record sequence/issuer 且 canonical ledger 同时证明未 first-byte/action-start 的 discriminated `NonDispatchProof`，才可取消未发送的 consumable、取消 `reserved|activating` capacity 或把 `teardown_pending` abort 回 `occupied`。三个转换分别只接受 dispatch、activation、teardown phase proof。任何 byte、signal、ingress-close 或 profile mutation 后该 proof 无效；matching terminal input 才能变为 `released`。`reserved|activating|activation_unknown|occupied|teardown_pending|teardown_unknown` 均计入限额，`cancelled_not_dispatched|released` 不计。同一 operation/scope/dimension 只有一个 canonical reservation。
- Dispatch 只检查该动作需要的新增维度、既有 capacity ownership 和对应 budget scope；某个无关维度、其他 challenge 或 endpoint 的余额为零，不得全局阻止合法续跑、observation、checkpoint 或不申请新容量的 cleanup。
- Long-job 等待可释放 Worker capacity，但 continuation claim 本身不恢复执行权限；续跑必须重新取得 `worker_slots`、建立新的 execution lease/attempt 和受该 reservation 约束的 session。旧 session、lease 或已释放 reservation 一律拒绝，累计 token/tool 消耗不重置。
- 同一 occupied Worker reservation 内的 compaction session replacement 不得重做容量 activation；必须先关闭旧 session ingress、等待 model/tool 零 in-flight、取得 old/new `SessionHandoffProof`，再由 Supervisor 原子换绑并只启用新 session。Worker fail-stop 后即使 State 已从 nominal `LauncherAuthorityClient` 记录 subject-bound `StateStopBinding`，也必须分别经 Model Gateway reconciliation 和 State-owned accepted Bridge-call reconciliation 把所有 call 记为 terminal、detached managed activity 或 durable unknown，匹配两份 accounting sequence 并取得 State-issued recovered terminal proof 后才可释放 slot。
- 同一远端状态的 mutator 必须经 State 持有的 mutation lease 串行。任何可访问 challenge network 的 Job、Channel、HTTP session、Listener 或 Browser 活动默认视为 mutation-capable，除非 server-owned capability 明确证明 read-only；模型参数不能自行降级。受管活动在 connect/listen/process/page payload 前取得 lease，并持有到 kind/issuer/owner/scope/generation 匹配且对应 in-flight 计数为零的 service-issued terminal proof；单次 RPC 返回本身不释放。Job/Channel ownership transfer 必须使用 Supervisor permit 并原子改写活动与 lease owner。Task 7 内部 protected broker transport 使用 protected lease，不能作为无 lease 的 public session 暴露。纯附件计算和不同 challenge 可并行。
- Protected effect 的最终 precondition 检查、durable `dispatching` 和实际 transport 发送固定由 Task 7 的唯一出口完成。Platform 与 Runtime context/request 必须以 family-typed envelope 成对进入该出口，不能交叉组合；Platform Service 让 adapter 在零 reservation context 下纯映射 intent、预分类实际 wire shape，再由 Task 7 原子 reserve/adopt 并返回 canonical refs，最后从实际 method/path/query/body 与这些 refs 封存完整 `ProtectedDispatchContext`。Runtime broker 同样先从 exact framed bytes 算 identity，再原子 prepare 和封存。Observation dispatcher 也必须按服务端 wire-capability policy 重分类实际请求，未知或 protected 形状不得发送；adapter 不得拥有 raw credential transport。First List/Scheduler/finalization/cleanup 只能使用 State-issued current `RunLifecycleBinding` 派生 owner，旧 incarnation 在 `StateStopBinding` 验证前不可释放或把 ownership 交给新 owner。
- 已占用 instance 的跨 incarnation cleanup 只允许 State 在旧 owner 的 `StateStopBinding`、旧 authority/grant fence、零旧 owner nonterminal effect/lease 和 current same-run successor lineage 全部成立后，原子推进其 `lifecycleOwnerSequence`；不得重新 reserve/occupy、改变 generation/challenge/历史 Start authorization，或把它伪装成 Job/Channel managed transfer。新 incarnation 必须使用 State 返回的新 occupied ref、fresh grant 和 fresh mutation lease，旧 ref 一律零 Platform bytes。
- 没有平台或等价 local oracle 的权威接受，只能得到 `candidate_only`，不能标记 `solved`。
- 运行中不得安装依赖；正式运行不允许公共搜索、GitHub、在线文档或公开 writeup。
- 建立或修改 npm workspace/package manifest 的任务由 release 维护者在产品 run 外执行 `npm install --package-lock-only --ignore-scripts` 更新 lockfile，再以干净的 `npm ci` 验证；CI/开发 checkout 只以 `npm ci` 安装，解题产品 run 不执行任何 package-manager 命令。
- 确定性 schema/state/adapter/runtime/policy tests 每次必须全部通过；M1 六条模型轨迹各独立运行 3 次且至少成功 2 次，必须保留全部结果。
- M2 与 M3 使用同一个预登记 TSecBench task A 且不中途 reset；M4 使用独立 task B，不能复用 host 已接受状态。
- Task 12 在任何 identity-aware Gate consumer 前产出唯一的 `computeBuildIdentity`／included-path policy；source identity 覆盖所有产品、fixture、测试、脚本和 evidence-runner 配置输入，不以 executable bit 筛选。Tasks 18/20 必须复用它。Task 20 必须先完成 M2/M3 所需的 CLI policy、live harness、deterministic evaluator、metric-coverage gate 和 recovery instrumentation，再对最终 source/build identity 重跑 M0、M1 与 M2/M3 readiness 并冻结 `LiveBuildManifest`；First List 后 Tasks 19/21 只执行该 manifest 已包含的入口，不修改产品或 Gate harness。
- Task 21 终态后新增的任何 `LIVE_BUILD_INCLUDED_PATHS` 内容都会使 `LiveBuildManifest` 只成为 parent lineage，不能继续证明当前代码。Tasks 22-23 全部 source/image/egress 变更完成后，Task 24 必须用 Task 12 的同一 helper 重算 identity、重建 immutable ARM64 image digest，并封存含 parent host manifest、base-image digest、SBOM/capability digest 和同 identity M4 evidence 的 `CoreBuildManifest`；mutable image tag 仅可作本地 alias，任何 Gate/运行都以 digest 或 manifest 调用。每个被选择的 M5 track 必须从前一 manifest 派生新的 `FinalProfileManifest`、重建 digest 并为新 identity 重跑规定的 base/track checks。Tasks 30-31 的 reporting/formal source 与 harness 也在 identity coverage 内；实际 M6 pre-start 前必须再次派生最终 manifest、重跑 required checks，并在 start 前立即重算验证，旧 manifest/evidence 不得直接沿用。
- 所有 MetricEvent 都携带 producer、scope、correlation 和可比较 clock-domain 资料；跨 clock domain 的 interval 由拥有完整区间的 producer记录 duration。Metric projection 同时消费与同一 snapshot sequence 对齐、从 canonical business state 推导的 `MetricCoverageSnapshot`：已发生活动但整组 metric 缺失必须是 `missing`，终态证明确未发生的 optional activity 才是 `not_applicable`。模型能力 Gate 的求解动作必须使用 Bridge 生成且不可由工具参数伪造的 model-response/tool-call provenance，harness injection 不得满足模型动作要求。
- 自动 commit 仅在用户明确授权后执行；未授权时完成代码和验证后停在未提交状态。

## External Input Gates

- M0 前由 release 维护者确认支持的 macOS/Linux 版本、Node 24 安装方式、OpenCode 1.19.0 binary identity、provider adapter 和可合法分发的 Reference 清单。
- M1 模型 Gate 前提供固定 provider、model ID、Base URL、参数、credential reference、prompt/template 版本和每条轨迹预算。
- M2/M3 前提供预登记 task A、`BENCHMARK_TOKEN` secret reference、`BENCHMARK_BASE_URL`、宿主 VPN、duration/elapsed/deadline 与 clean/exclusive baseline 证据；Task 20 的 final M0/M1/deterministic-readiness evidence 与待执行 `LiveBuildManifest` 必须先按同一 identity 封存，之后才可发出 task A 的 First List。
- M4 前提供独立 task B 和原生 Ubuntu ARM64 host 的 kernel、Docker、CPU/RAM/disk、宿主 VPN 路由资料。
- M6 前提供一次性正式靶场、干净账号/任务、完整 baseline、正式 deadline/budget 和人工介入政策。
- 外部输入缺失时可以完成对应代码和 fixture，但 Gate 状态必须是 `blocked_external_input`，不得写成通过。

## Review Focus

- First List 只能由 Task 20 已完成全部 M2/M3 source/harness、以相同 identity 重跑 M0/M1/readiness 后冻结的 build 发出；intent/dispatch/response/manifest crash 保留唯一 anchor，formal 缺可信时间证据必须拒绝，而 dev/live 本地 anchor 只能产生保守非正式计时声明。由 Tasks 9、12、18-21 固定。
- 最后一份动作所需预算、capacity activation/teardown/reuse、continuation reacquire、protected effect unknown、每个 reservation-to-dispatch fault、候选入队后 stale/generation 改变、Coordinator intent authority、Job/Channel/HTTP/Listener/Browser/Platform 共用 mutation lease 交错，以及同 operation ID 不同 payload 都必须在 bytes 发出前 fail closed，且只隔离最小 scope；无关的零余额不得阻止合法工作。由 Tasks 2-7、9-14、16、20 固定。
- 题目或用户 `.opencode`、单个未受管工具、raw 同题 metered endpoint、workspace symlink、Browser 跨 scope、public/generic State mutation、结构伪造 service/Launcher authority、test-support import 和未授权 internal source import 都不得绕过可信配置、canonical writer、server-side policy 或 managed transport。由 Tasks 1-7、10、12、23-24 固定。
- 从 OS spawn 到 durable Launcher ownership/payload activation 的每个窗口外部 `SIGKILL` Supervisor/Runtime 后，CLI/Launcher 必须以 fixture PID/heartbeat 等独立观测证明 pending/active child 均停止，不能只查询已登记集合；stop proof 必须与预期 prior lifecycle subject 一致。无法证明停止、失去独占性或人工题目操作时，live 使用合法 `run_state` 加 `solve_state: blocked_runtime`，formal 为 `invalid`，且单一 unknown effect 不抹掉其他 accepted。由 Tasks 3、6、9-12、20-21、30-31 固定。
- M1 trajectory 必须从 canonical events、artifacts、权威平台状态及不可伪造的 model-action provenance 重算；Bridge response-loss retry 必须从 fresh process 以 authenticated stable invocation key 取回同一组 State-allocated IDs，改 bytes 必须冲突。成本/延迟 metrics 必须有 start anchor、producer payload、clock domain/duration，以及涵盖 managed Runtime 与 Browser 的独立 canonical activity coverage 来区分整组 producer 缺失与真正 N/A。不能信任 Solver/summary 布尔值，harness 代做、cursor gap、既有 accepted、partial、无 oracle、hard-only/空分母都不能形成虚假通过。由 Tasks 2-6、8-11、13-18、30-31 固定。
- M4/M5/M6 的每份 evidence 必须指向执行时重算相等的 source/build identity、immutable image digest/platform、base-image digests、SBOM/capability identities 及 parent manifest；Tasks 22-23、任何 selected M5 track 或 Tasks 30-31 改变 included input 后，旧 image tag、manifest 或 Gate 结果不得证明新 build。由 Tasks 12、20、22-31 固定。

---

## Audit Closure Map

| Review ID | Plan closure |
| --- | --- |
| R01 | Task 20 executes before Tasks 19/21, creates every M2/M3 product/harness input, reruns M0/M1/readiness for the final identity, and freezes it before task A First List. |
| R02 | Tasks 2-3 distinguish consumable usage from releasable capacity and authorize only dimensions required by each scoped action; Tasks 4/6/7/9-11/20 share those contracts. |
| R03 | Task 5 checks each denied tool, the complete allowlist and server-side rejection of an injected tool. |
| R04 | Tasks 5/6 fix and probe a release-owned config root, isolated global config and challenge `.opencode` as data; Task 12 gates it. |
| R05 | Task 6 makes the existing CLI/Launcher the Supervisor-external process-tree owner; Tasks 11/12/20/21 test real external death and conservative recovery. |
| R06 | Task 7 defines/fixtures broker-only grants; Tasks 23/24 prove managed success and raw same-endpoint denial in Core. |
| R07 | Tasks 2-3 define stable operation/precondition and mutation-lease contracts; Task 7 is the sole final-check/dispatch boundary; Tasks 9/16 only create and pass canonical intents. |
| R08 | Tasks 2-7, 9-11, 13-18 define, persist or emit typed source events with producer/clock semantics at the owning boundary; Task 30 only aggregates and reports them. |
| R09 | Task 9 separates product formal/live time policy; Task 19 applies stricter M2 Gate input policy without redefining live mode. |
| R10 | Task 1 boots a working test harness/initial lockfile before product red tests; Global Constraints govern later manifest updates. |
| R11 | Tasks 2-6, 9, 13 and 23 name producer/consumer contracts for admission, grants, stream publication, mutation leases, metric projection and public types. |
| R12 | Tasks 2/4/5/13/16/18 fix server-derived action provenance plus each trajectory's input, injection, required/forbidden events, terminal condition, negative controls and canonical verdict. |
| R13 | Tasks 2/3/9/11 own baseline intervention/integrity data and enforcement; Task 26B only adapts UI handoff; Tasks 30/31 map invalid to failed with reasons. |
| R14 | Tasks 2-3 define consumable plus two-phase capacity activation state machines and stable per-operation reservations; Tasks 5/7/9-11/14/20 activate, occupy or release only with matching proofs. |
| R15 | Tasks 2-3 provide scoped `authorizeDispatch`; Tasks 4/6/7/9/11/20 test required dimensions, existing ownership, cleanup and unrelated scopes instead of global exhaustion. |
| R16 | Tasks 2-3 produce the mutation-lease API before its consumers; Task 7 owns final validation/transport, and Tasks 7/9/11/16 test interleaving, crash and old-incarnation denial. |
| R17 | Task 20 owns all M2/M3 source and harness changes and freezes a final `LiveBuildManifest`; Tasks 19/21 only consume immutable entrypoints and produce run artifacts. |
| R18 | Tasks 2-3 define metric payloads, clock domains, producer projection and missing/N/A semantics; Runtime/Browser/other owning tasks emit them and Tasks 18/20/30 test raw-event reconstruction and whole-producer deletion across restart. |
| R19 | Tasks 2/4/5 define trusted model-action lineage; Tasks 13-18 preserve it and Task 18 rejects harness substitution or broken response/action/result chains. |
| R20 | Task 6 replaces post-spawn registration with Launcher-owned gated spawn, independent orphan observation and authenticated opaque run-lock capability verification; Tasks 10-12/20-21 reuse and exercise every pre-activation/old-lock crash window. |
| R21 | Tasks 2-3 define managed remote-mutation activity leases plus kind/issuer/owner/scope/generation-bound zero-in-flight terminal inputs; Tasks 6-7/10 require permits for Job/Channel/HTTP/Listener/Browser, authenticated transfer is atomic, Browser proof includes background requests, Task 13 derives canonical scope/ownership, and Tasks 7/16 prove every managed/Platform mutator shares one key. |
| R22 | Tasks 4-6/11 define keyed execution/session allocation, run/challenge/incarnation-bound Supervisor ownership, named Model/Bridge fail-stop accounting, normal/recovered terminal proofs and an occupied-capacity zero-in-flight session handoff; Task 14 durably recovers every new-attempt capacity/allocation/bind/run substate, while Tasks 17-18 verify crash-safe same-attempt replacement and exactly-once resumed work. |
| R23 | Tasks 2/7 separate payload and recomputed Platform wire/Runtime framed identity, couple each context to its request in a family-typed envelope, hide the broad dispatcher and compile-test public signatures, carry complete mutation ownership, classify actual shape server-side and expose one protected transport outlet; Tasks 8-9 preserve/seal context around pure mapping, and Tasks 16/27/28 prove no adapter, cross-family or observation-path bypass. |
| R24 | Task 2 defines the identity schema and Task 12 produces the sole computation/verification helper plus complete evidence-input path policy before M0/M1 consumers; Tasks 18/20 reuse it for host sealing, Task 24 rebuilds/seals post-Task-23 Core source and immutable image/SBOM/capability identity, every selected M5 track derives a same-evidence `FinalProfileManifest`, and Task 31 reseals/verifies after M6 source before start. |
| R25 | Tasks 2-3 pair metric events with sequence-aligned canonical activity coverage; Task 10 owns Browser producer/coverage data, and Tasks 11/17-18/20/30 distinguish absent optional activity from a missing entire producer group, including Browser-backed M1 plus M2/M3 checkpoint/terminal evaluation. |
| R26 | Task 11 validates recovery output through Task 2's exact enums: live uses `interrupted` plus `blocked_runtime`, while formal uses `invalid`; neither creates a new mutation owner. |

## File Map

| 路径 | 责任 |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts` | 固定 Node/TypeScript workspace、依赖、构建和测试命令 |
| `config/release-profile.schema.json`, `config/release-profile.example.json` | 固定 profile、model、Reference、预算、OS/Core capability 输入，不保存 secret |
| `apps/cli/src/**` | `doctor/prepare/start/status/stop/report`、Supervisor 外部的 host Launcher/process-tree owner、唯一 State/protected-dispatch host composition 和一键构建入口 |
| `apps/opencode-plugin/src/index.ts` | 只暴露 allowlist 内的受管 CTF tools，把 OpenCode `ToolContext.sessionID` 交给 Bridge；不接受模型自报身份 |
| `packages/contracts/src/**` | 全系统 Zod schema、branded IDs、状态枚举、consumable/capacity budget、managed mutation activity、Platform adapter/dispatch contexts、typed protected-dispatch envelopes、BuildIdentity、metric clock/coverage/action provenance、intervention/network grant、service interface 和 wire DTO |
| `packages/state/src/**` | SQLite migration、repository、event/outbox、effect ledger、共享 budget ledger、protected/managed mutation lease、lifecycle binding、fail-stop Worker accounting proof、metric event/sequence-aligned activity coverage、intervention、run lock 和 checkpoint |
| `packages/artifacts/src/**` | 内容寻址写入、原子发布、byte-range evidence 和完整性检查 |
| `packages/policy/src/**` | session/lease/scope/capability 检查、data classification、可信 IPC network grants 和 Model Data Gateway |
| `packages/runtime/src/**` | workspace、Launcher-owned gated process spawn、batch/PTY/TCP jobs、remote-mutation permit enforcement、stream cursor、channels、watch、取消、stream publication bridge 和 managed metering/broker |
| `packages/platform/src/**` | Platform Service、context-bound pure TSecBench/local-oracle wire mappers、server-owned wire policy/identity、opaque internal transport port、prepare/start admission 和 reconciliation；不组装 protected dispatcher |
| `packages/browser/src/**` | 单 Challenge Browser 生命周期、managed spawn、remote-mutation activity 和 scope enforcement |
| `packages/reference/src/**` | 固定离线 snapshot、FTS5/BM25 检索和引用 |
| `packages/opencode-bridge/src/**` | OpenCode server lifecycle、session binding、turn/compaction/retry contract 和本地 authenticated tool RPC |
| `packages/supervisor/src/**` | run lifecycle、任务/execution lease、continuation capacity reacquire、Solver loop、candidate flow、共享 build identity、Scheduler、deadline、checkpoint 和 recovery |
| `packages/reporting/src/**` | Gate、formal denominator、canonical metric event+coverage 聚合和不可变结果导出；不在此首次采集运行事件 |
| `fixtures/**` | TSecBench 0.1.2、local oracle、Web/Misc/Crypto、protected-effect 和 recovery 场景 |
| `tests/contract/**`, `tests/integration/**`, `tests/gates/**` | 跨 package 契约、端到端 fixture 和 M0-M6 Gate harness |
| `docker/**`, `scripts/build-core-image.sh` | 固定 Core image、egress helper、tool manifest、SBOM 和 ARM64 parity |
| `docs/gates/**` | Gate 输入清单和去 secret 的结果摘要；真实原始 run 数据只存于配置的 state directory |

## Dependency Order

- M0: Tasks 1-12，建立可确定性验证的 host foundation。
- M1: Tasks 13-18，只依赖通过的 M0，不依赖真实 TSecBench task；identity-aware M1 evidence 复用 Task 12 已完成的 `computeBuildIdentity`，不等待 Task 20。
- M2/M3 readiness: Task 20 依赖 Task 18，在 task A First List 前完成 Scheduler、slots、cleanup、M2/M3 CLI policy、全部 live/recovery harness，并复用 Task 12 helper 让最终 `LiveBuildManifest` 的同一 identity 通过 M0、M1 和 deterministic readiness；任务编号是稳定 ID，不代表此处的执行顺序。
- M2: Task 19 依赖 Task 20 的 immutable manifest 与外部 task A/VPN/time evidence，只调用已冻结的 validate/prepare/start/evaluate 入口，启动同一条 live 轨迹并记录中途 Gate。
- M3: Task 21 紧接 Task 19，依赖同一 immutable manifest、run lineage 和仍有效的 task A；两者之间及 task A 计时窗口内不得修改产品、配置、fixture 或 Gate harness，也不得 reset。
- M4: Tasks 22-24，只有 M3 通过后开始；Task 24 在 Tasks 22-23 的所有 included source 完成后重建最终 digest，以独立 task B 和原生 ARM64 host 产生并封存 `CoreBuildManifest`。
- M5: Tasks 25、26A-26C、27-29 是条件式 capability tracks；只实施目标 formal profile 实际需要的 track，但每个 selected track 都从前一 immutable manifest 派生、重建并为新 identity 重跑 base/track Gates。
- M6: Tasks 30-31，依赖 M4、目标 profile 所需的 M5 tracks 和正式 run 输入；Task 31 在 Tasks 30-31 source/harness 完成后封存并立即验证实际执行的最终 `FinalProfileManifest`。

## M0 Host Foundation

### Task 1: Bootstrap workspace and release profile

**Files:**
- Create: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `config/release-profile.schema.json`, `config/release-profile.example.json`, `config/import-boundaries.json`
- Create: `apps/cli/package.json`, `apps/cli/src/main.ts`, `apps/cli/src/commands/doctor.ts`
- Create: `scripts/check-import-boundaries.mjs`
- Modify: `.gitignore`
- Test: `tests/bootstrap/test-harness.test.ts`, `tests/contract/release-profile.test.ts`, `tests/contract/import-boundaries.test.ts`, `tests/contract/internal-imports.type-test.ts`, `tests/integration/cli-doctor.test.ts`

**Interfaces:**
- Consumes: design spec and External Input Gates only.
- Produces: `loadReleaseProfile(path: string): Promise<ReleaseProfile>` and root scripts `cli`, `build`, `check:boundaries`, `typecheck`, `test:deterministic`, `test:contract`, `gate:m0` through `gate:m6`. Root `typecheck` includes every `**/*.type-test.ts` fixture with `noEmit`, then runs `check:boundaries`; Vitest explicitly excludes that suffix so expected-error import fixtures are never executed as runtime tests. Every workspace package has an explicit `exports` map with no `src/internal` subpath. `check:boundaries` resolves static/dynamic TypeScript imports and rejects every cross-package relative source import, including non-exported `db.ts`/repository files, except the exact host-composition edges in `config/import-boundaries.json`; package consumers must resolve through declared exports. It also rejects production access to `test-support/**` and any app/package edge outside the dependency policy. Temporary forbidden-import fixtures cover public-looking State source files, `src/internal`, and test support so the checker fails closed rather than merely documenting the rule.
- Produces: ESM-only boundary enforcement using the TypeScript AST: literal static/dynamic imports are resolved to real workspace paths; non-literal dynamic imports, `require`, `createRequire`, and source-path aliases that could evade resolution are rejected in product code. The same checker runs in `typecheck`, `build`, every Gate, and CI, so an unauthorized internal edge cannot ship merely by skipping a standalone lint command.
- Produces: manifest authority rules under the same checker: only `@ctf/state` may declare/import the SQLite driver, only CLI host composition receives the canonical state-directory path, and no other workspace package may depend on State implementation files or a second database writer. Artifact storage receives only its own root and the nominal publication command.

**Depends on:** none.

- [ ] **Step 1: Create the minimal workspace, deterministic test harness and initial lockfile**

Create the root manifests/config, strict no-emit TypeScript project (including `*.type-test.ts`), Vitest configuration that excludes `*.type-test.ts`, explicit package-export/import-boundary policy, and a single passing harness smoke test without product imports. The boundary test creates unauthorized package-subpath imports, relative imports of both `packages/state/src/db.ts` and `src/internal` files, a production test-support import, and a non-State package manifest/import using the SQLite driver; `check:boundaries` must reject all of them while accepting only the exact composition allowlist and State-owned driver. In `internal-imports.type-test.ts`, use `@ts-expect-error` imports for `@ctf/state/internal/compose-state`, `@ctf/runtime/internal/protected-call-composition`, and `@ctf/platform/internal/transport-port`; those package subpaths must remain unresolved because no package exports them. Run `npm install --package-lock-only --ignore-scripts` once outside any product run, then use the resulting lockfile for all installs.

- [ ] **Step 2: Prove a fresh checkout can install and run the harness**

Run: `npm ci && npm test -- tests/bootstrap/test-harness.test.ts`

Expected: PASS; failure cannot be a missing package, script, workspace or test runner.

- [ ] **Step 3: Write failing profile and CLI behavior tests**

```ts
it("rejects a release profile containing inline secrets", async () => {
  await expect(loadReleaseProfile(fixture("inline-secret.json"))).rejects.toMatchObject({ code: "control_secret_forbidden" });
});
it("reports missing external capabilities without claiming availability", async () => {
  expect((await runDoctor(emptyHost())).capabilities).toContainEqual(expect.objectContaining({ status: "unavailable" }));
});
```

- [ ] **Step 4: Run tests and confirm product behavior, not bootstrap, is red**

Run: `npm test -- tests/contract/release-profile.test.ts tests/integration/cli-doctor.test.ts`

Expected: FAIL because `loadReleaseProfile`/`runDoctor` behavior is absent; Vitest and module resolution themselves succeed.

- [ ] **Step 5: Implement the release profile loader and minimal CLI**

Use Node 24, ESM, strict TypeScript and exact dependency versions. The profile stores secret references, never secret values. Future manifest changes update the lockfile with the Global Constraints maintenance command before a clean `npm ci` check.

- [ ] **Step 6: Verify bootstrap**

Run: `npm ci && npm run typecheck && npm run check:boundaries && npm test -- tests/contract/release-profile.test.ts tests/contract/import-boundaries.test.ts tests/integration/cli-doctor.test.ts`

Expected: all commands exit 0; `doctor` reports OpenCode `1.19.0` on the current host or an explicit mismatch.

- [ ] **Step 7: Commit if authorized**

Commit scope: workspace/config/CLI bootstrap only. Suggested message: `build: bootstrap ctf agent workspace`.

### Task 2: Define canonical contracts and state machines

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/ids.ts`, `run.ts`, `challenge.ts`, `task.ts`, `runtime.ts`, `platform.ts`, `candidate.ts`, `verification.ts`, `admission.ts`, `policy.ts`, `budget.ts`, `mutation.ts`, `metrics.ts`, `build-identity.ts`, `provenance.ts`, `intervention.ts`, `network.ts`, `index.ts`, `internal/launcher-authority-sdk.ts`, `test-support/launcher-authority.ts`
- Test: `packages/contracts/test/schemas.test.ts`, `packages/contracts/test/transitions.test.ts`, `packages/contracts/test/core-state-budget.test.ts`, `packages/contracts/test/platform-mutation.test.ts`, `packages/contracts/test/metrics-build-provenance.test.ts`, `packages/contracts/test/opaque-capabilities.type-test.ts`

**Interfaces:**
- Consumes: `ReleaseProfile` from Task 1.
- Produces: branded `RunId`, `IncarnationId`, `RunLifecycleBindingId`, `LauncherRunLockCapabilityId`, `LauncherStopProofId`, `ChallengeId`, `TaskId`, `ExecutionAttemptId`, `ExecutionAcquireKey`, `SessionAllocationKey`, `SessionAllocationId`, `SessionId`, `LeaseId`, `MutationLeaseId`, `ManagedActivityTransferId`, `ManagedLaunchId`, `JobId`, `ChannelActivityId`, `HttpSessionActivityId`, `ListenerActivityId`, `BrowserActivityId`, `BridgeCallId`, `ObservationId`, `OperationId`, `PayloadIdentity`, `WireRequestIdentity`, `FramedRequestIdentity`, `BudgetReservationId`, `GrantSetId`, `CandidateRevisionId`, `VerificationRevisionId`, `ModelRequestId`, `ModelResponseId`, `ToolCallId`, `MetricClockDomainId`, `ArtifactRef`; exact `Responsibility = "intake" | "recon" | "strategy" | "solving" | "engineering" | "verifying" | "submitting" | "finalizing"` and canonical non-empty, sorted, duplicate-free `ResponsibilitySet` whose values must be a subset of the release-owned role policy. `ExecutionReservation { acquireKey, runId, challengeId: ChallengeId, incarnationId, taskId, role, responsibilitySet, attemptId, leaseId, workerCapacityReservationId }`, `ExecutionBinding = ExecutionReservation & { sessionId, sessionAllocationId, bindingSequence }`, and `UnboundSessionAllocation { allocationId, allocationKey, sessionId, runId, challengeId: ChallengeId, incarnationId, taskId, role, responsibilitySet, attemptId, leaseId, workerCapacityReservationId, allocationSequence }` carry immutable identity; run-level controller work uses `RunLifecycleBinding`, never a null-challenge execution. Also produces opaque authenticated `RunLifecycleBinding { id, runId, incarnationId, issuedSequence, issuer: "state" }` and `ManagedActivityTransferPermit { id, activityKind: "job" | "channel", activityId, mutationLeaseId, fromOwner, toOwner, scopeKey, resourceGeneration, transferSequence, issuer: "supervisor" }`; `ManagedProcessIdentity`, `PendingManagedLaunch` and `ManagedProcessHandle`; exact Zod schemas for every state named in spec section 7.1 including `RunSchema`, plus `ExecutionReservationSchema`, `ExecutionBindingSchema`, `UnboundSessionAllocationSchema`, `PlatformAdapterContextSchema`, `ProtectedDispatchContextSchema`, `ProtectedMutationContextSchema`, `ProtectedDispatchEnvelopeSchema`, `NonDispatchProofSchema`, `ManagedMutationFinishInputSchema`, `CapacityReleaseInputSchema`, `VerificationInput`; `transition(entity, event): Result<State, TransitionError>`.
- Produces: exact `SessionRole = "coordinator" | "solver" | "verifier"` and release-owned `RoleResponsibilityPolicy`: Coordinator is limited to `intake|submitting|finalizing`, Solver to `recon|strategy|solving|engineering`, and Verifier exactly to `verifying`; no role accepts an empty set or a responsibility from another role. Also produces exact `ManagedToolName = "ctf_workspace" | "ctf_job" | "ctf_channel" | "ctf_http_session" | "ctf_listener" | "ctf_browser" | "ctf_artifact" | "ctf_candidate" | "ctf_platform_intent" | "ctf_reference"` and release-owned `RoleToolPolicy`; no policy accepts an unknown tool, Solver/Verifier platform intent, or a role/tool expansion from runtime input.
- Produces: branded `ToolInvocationKey`, derived only from authenticated upstream invocation context and stable across a Bridge process restart; neither model/tool arguments nor retry-local memory may supply it.
- Produces: `PendingSessionAllocation { allocationId, allocationKey, reservationIdentity, allocationSequence }`, whose reservation identity is copied from canonical State and cannot dispatch; only completion with one idempotent OpenCode `sessionId` yields `UnboundSessionAllocation`.
- Produces: opaque non-serializable `LauncherRunLockCapability`, `LauncherStopProof`, and nominal `LauncherAuthorityClient`, each with an unexported authority brand; canonical internal `VerifiedRunLock { runId, incarnationId, launcherBootId, lockGeneration, observedSequence }` and `VerifiedIncarnationStop { stopProofId, runId, incarnationId, launcherBootId, lockGeneration, launchRegistrySequence, observationSequence }`; and `LauncherAuthorityClient.verifyCurrent(capability): Promise<VerifiedRunLock>` / `verifyStopped(proof): Promise<VerifiedIncarnationStop>`. Only the non-exported `internal/launcher-authority-sdk.ts` factory used by Task 6 can wrap authenticated Launcher control IPC. Public package exports expose the nominal client type but no constructor/factory; structural objects or copied IDs cannot satisfy it or authenticated lookup. The explicit `@ctf/contracts/test-support/launcher-authority` entrypoint may mint a fake only for `*.test.ts`/`*.type-test.ts`, and Task 1's boundary checker rejects that import from production. A released lock, wrong caller, old boot/generation, incomplete launch registry, live independently observed process, or proof replayed against another run/incarnation/binding fails verification; exact reuse for the same expected stopped incarnation is idempotent. State derives lifecycle/stop identity only from client results and never accepts parallel scalar identity or raw proof fields.
- Produces: opaque non-serializable State-issued `StateStopBinding` around branded `StateStopBindingId`, bound to the canonical recorded `VerifiedIncarnationStop`, its expected prior `RunLifecycleBinding`, and State sequence. Only Task 3's `recordIncarnationStop(subject: RunLifecycleBinding, proof: LauncherStopProof)` can issue it; downstream fail-stop APIs accept this binding and revalidate its canonical row rather than accepting Launcher proof fields. A proof verified for another subject is rejected, while exact reuse against the same subject returns the same binding. Each later lifecycle-binding issuance row internally records its canonical preceding stop binding, so State can prove a same-run stopped-and-revoked A-to-B successor/descendant chain without adding caller-selected predecessor fields to `issueRunLifecycleBinding`.
- Produces: `TransportNonDispatchProof { kind: "transport_non_dispatch", phase: "dispatch" | "activation" | "teardown", operationId, reservationId, dimension, owner, resourceGeneration, phaseRecordSequence, effectState: "failed_not_dispatched", firstByteWritten: false, issuer: "protected_dispatcher" | "model_gateway" }`, `LocalActionNonDispatchProof { kind: "local_action_non_dispatch", phase: "dispatch" | "activation" | "teardown", operationId, reservationId, dimension: "tool_wall_ms" | "worker_slots" | "browser_slots", owner, resourceGeneration, phaseRecordSequence, actionStarted: false, issuer: "job_runtime" | "supervisor" | "opencode_bridge" | "browser_service" }`, and their `NonDispatchProof` union. `phaseRecordSequence` names the exact canonical dispatch/activation/teardown record; for capacity cancelled while still `reserved`, it names the reservation record and State additionally proves that no activation record exists. Proof issuance is tied to canonical first-byte/action records; literal flags alone are not evidence. Also produces `ManagedProcessStopProof`, `WorkerActivationProof`, `BrowserActivationProof`, `InstanceActivationProof`, and `CapacityOccupancyProof`. Normal Worker shutdown issues `WorkerTerminalProof { kind: "worker", attemptId, sessionId, leaseId, workerCapacityReservationId, incarnationId, resourceGeneration, terminalSequence, openModelRequests: 0, openToolCalls: 0, issuer: "opencode_bridge" }`; fail-stop recovery may instead use `RecoveredWorkerTerminalProof { kind: "worker_recovered", attemptId, sessionId, leaseId, workerCapacityReservationId, incarnationId, resourceGeneration, stopProofId, modelAccountingSequence, bridgeAccountingSequence, terminalSequence, unsettledModelRequests: 0, unsettledToolCalls: 0, unknownModelRequestIds, unknownToolCallIds, issuer: "state_recovery" }`. Same-capacity replacement uses `SessionHandoffProof { attemptId, fromSessionId, toSessionId, leaseId, workerCapacityReservationId, terminalSequence, openModelRequests: 0, openToolCalls: 0, issuer: "opencode_bridge" }` and is not a capacity terminal proof.
- Produces: exact dispatch aliases `ProtectedConsumableNonDispatchProof = TransportNonDispatchProof & { phase: "dispatch", dimension: "submissions" | "hints" | "remote_units", issuer: "protected_dispatcher" }`, `ModelConsumableNonDispatchProof = TransportNonDispatchProof & { phase: "dispatch", dimension: "model_tokens", issuer: "model_gateway" }`, `ToolConsumableNonDispatchProof = LocalActionNonDispatchProof & { phase: "dispatch", dimension: "tool_wall_ms", issuer: "job_runtime" }`, and `ConsumableDispatchNonDispatchProof` as their union. `ActivationNonDispatchProof = NonDispatchProof & { phase: "activation" }` and `TeardownNonDispatchProof = NonDispatchProof & { phase: "teardown" }`; no capacity proof type-checks at consumable cancellation.
- Produces: exact aliases `WorkerActivationNonDispatchProof = LocalActionNonDispatchProof & { phase: "activation", dimension: "worker_slots", issuer: "supervisor" }`, `WorkerTeardownNonDispatchProof = LocalActionNonDispatchProof & { phase: "teardown", dimension: "worker_slots", issuer: "opencode_bridge" }`, `BrowserActivationNonDispatchProof = LocalActionNonDispatchProof & { phase: "activation", dimension: "browser_slots", issuer: "browser_service" }`, `BrowserTeardownNonDispatchProof = LocalActionNonDispatchProof & { phase: "teardown", dimension: "browser_slots", issuer: "browser_service" }`, `InstanceActivationNonDispatchProof = TransportNonDispatchProof & { phase: "activation", dimension: "instances", issuer: "protected_dispatcher" }`, and `InstanceTeardownNonDispatchProof = TransportNonDispatchProof & { phase: "teardown", dimension: "instances", issuer: "protected_dispatcher" }`.
- Produces: `CapacityActivationNonDispatchProof = WorkerActivationNonDispatchProof | BrowserActivationNonDispatchProof | InstanceActivationNonDispatchProof` and `CapacityTeardownNonDispatchProof = WorkerTeardownNonDispatchProof | BrowserTeardownNonDispatchProof | InstanceTeardownNonDispatchProof`; BudgetLedger capacity APIs accept only these exact unions, not phase-only base proofs.
- Produces: `PreparedCallCancellation = { kind: "no_reservation", operationKind: "first_list", reservationRefs: [] } | { kind: "consumable", proof: ProtectedConsumableNonDispatchProof } | { kind: "start", proof: InstanceActivationNonDispatchProof } | { kind: "close_before_teardown", capacityState: "occupied" } | { kind: "close_after_teardown_intent", proof: InstanceTeardownNonDispatchProof }`. Cancelling a prepared First List marks only its effect failed-not-dispatched; it has no budget transition. Cancelling a prepared Close before dispatch marks only the effect record cancelled and leaves occupied capacity unchanged; `abortCapacityTeardown` is called only when a canonical teardown intent was actually written.
- Produces: `ProtectedDispatchDisposition = { outcome: "failed_not_dispatched", cancellation: PreparedCallCancellation } | { outcome: "prepared_wait", operationId, reason: "lease_busy", retryUntil, recoveryOwner: "protected_dispatcher" } | { outcome: "rejected_envelope", operationId, preparedState: "prepared", recoveryOwner: "protected_dispatcher" } | { outcome: "unknown", operationId, reservationState: "none" | "unknown" | "activation_unknown" | "teardown_unknown", recoveryOwner: "protected_dispatcher" }`, branded `RuntimeProtectedResponseRef`, `RuntimeProtectedResultRef { kind: "runtime_protected_response", operationId, responseRef: RuntimeProtectedResponseRef, responseIdentity: PayloadIdentity }`, `RuntimeProtectedDispatchResult = { outcome: "confirmed", operationId, family: "runtime", effectState: "confirmed", response: FramedRuntimeResponse, resultRef: RuntimeProtectedResultRef, terminalSequence }`, `PlatformProtectedDispatchResult = { outcome: "confirmed", operationId, family: "platform", effectState: "confirmed", response: PlatformWireResponse, terminalSequence }`, and their `ProtectedDispatchResult` union. Only reservation-free First List may use `reservationState: "none"`. Final classification/precondition rejection, lease deadline, and any transport-open failure before a durable first-byte intent take the first disposition branch atomically with the matching budget/capacity transition. Transient lease contention remains owned/prepared only until its deadline. A malformed/copied envelope cannot cancel someone else's valid prepared operation and takes the third branch. Any first-byte intent or uncertain write takes the unknown branch.
- Produces: `RuntimeBrokerConfirmationInput { operationId, expectedDispatchSequence, expectedFirstByteIntentSequence, response: FramedRuntimeResponse }`, `RuntimeBrokerResponseLimitInput { operationId, expectedDispatchSequence, expectedFirstByteIntentSequence, observedBytesAtLeast: 1_048_577 }`, `RuntimeTransportUnresolvedInput { operationId, expectedDispatchSequence, expectedFirstByteIntentSequence, reason: "transport_terminal_without_authenticated_response" | "recovery_cannot_resolve_transport" }`, and State-authored canonical `RuntimeProtectedReconciliationEvidence = { kind: "broker_confirmation", operationId, framedRequestIdentity, owner: MutationOwner, scopeKey: MutationScopeKey, resourceGeneration, managedTransportId, responseIdentity: PayloadIdentity, responseRef: RuntimeProtectedResponseRef, evidenceSequence, issuer: "metered_broker" } | { kind: "broker_response_limit_exceeded", operationId, framedRequestIdentity, owner: MutationOwner, scopeKey: MutationScopeKey, resourceGeneration, managedTransportId, observedBytesAtLeast: 1_048_577, limitBytes: 1_048_576, evidenceSequence, issuer: "metered_broker" } | { kind: "runtime_transport_unresolved", operationId, framedRequestIdentity, owner: MutationOwner, scopeKey: MutationScopeKey, resourceGeneration, managedTransportId, evidenceSequence, issuer: "protected_dispatcher" }`. Inputs contain no caller-selected request/owner/scope/generation/transport/issuer/evidence sequence. Confirmation atomically stores the exact bounded `FramedRuntimeResponse`, State-computed identity, immutable response ref and evidence, then settles the reservation, marks the effect confirmed and creates its result/terminal sequence before acknowledging the broker; no evidence may reference absent response bytes. The two unresolved branches atomically mark unknown and install quarantine without a response ref. Exact retries return the same terminal record/ref; changed response/reason/sequence conflicts, and no terminal branch can overwrite another.
- Produces: `RuntimeProtectedReconciliationResolution = { status: "awaiting_evidence", operationId } | { status: "resolved", result: { family: "runtime", operationId, effectState: "confirmed", reservationState: "settled", resultRef: RuntimeProtectedResultRef, terminalSequence }, response: FramedRuntimeResponse } | { status: "resolved", result: { family: "runtime", operationId, effectState: "unknown", reservationState: "unknown", quarantineScope, terminalSequence } }`. Runtime reconciliation accepts only `OperationId`, never an evidence DTO. The producer transaction owns the terminal transition; resolution is a non-destructive operation-keyed read of that canonical terminal row and persisted response. Absence returns `awaiting_evidence` without a transition or inference. Concurrent/exact retries return the same terminal sequence, result ref and response. A missing/corrupt response ref or digest mismatch is canonical corruption and blocks Bridge/fail-stop recovery rather than becoming unknown.
- Produces: `PlatformProtectedReconciliationEvidence = { kind: "platform_response", operationKind, operationId, wireRequestIdentity, response: PlatformWireResponse, evidenceSequence, issuer: "platform_service" } | { kind: "first_list_observation", operationKind: "first_list", operationId, wireRequestIdentity, baselineObservationId, evidenceSequence, issuer: "platform_service" } | { kind: "instance_observation", operationKind: "start" | "close", operationId, wireRequestIdentity, challengeId, resourceGeneration, lifecycleOwnerSequence, authoritativeState: "active" | "stopped", observationId, evidenceSequence, issuer: "platform_service" } | { kind: "platform_history_unavailable", operationKind: "submit" | "hint", operationId, wireRequestIdentity, evidenceSequence, issuer: "platform_service" }`. Every branch also carries the canonical owner/scope. `PlatformProtectedReconciliationResult` is correspondingly discriminated: First List becomes confirmed or remains unknown with no reservation; Submit/Hint become confirmed+settled or remain unknown+charged; Start becomes `occupied|released|activation_unknown`; and Close becomes `occupied|released|teardown_unknown`. Schemas reject cross-family evidence, stale/wrong operation, request identity, challenge, owner, lifecycle-owner sequence, generation or issuer; absence and elapsed time never confirm an effect or release capacity.
- Produces: `BridgeCallAcceptInput { invocationKey: ToolInvocationKey, execution: ExecutionBinding, tool, requestIdentity, prospectiveDownstreamKind }`, discriminated `BridgeDownstreamLink`, and `BridgeCallCompletionInput = { outcome: "returned", resultRef: ArtifactRef | RuntimeProtectedResultRef | ServiceResultRef } | { outcome: "failed", errorRef }`. For a linked Runtime protected operation, State accepts only the exact canonical `RuntimeProtectedResultRef` whose operation and response identity match that Bridge link. State uniquely keys acceptance by the exact execution binding identity plus invocation key, allocates `BridgeCallId`, `ToolCallId`, `OperationId`, prospective downstream refs and accepted/link/terminal sequences, returns every same-input replay unchanged, and rejects the same key with changed execution/tool/request/result bytes/downstream kind. Canonical `BridgeCallRecord` transitions only `accepted -> returned | failed | detached_managed_activity | terminal_unknown`; only State recovery may issue the last two states. Also produces `ModelDispatchRecoveryResult { attemptId, sessionId, leaseId, stopProofId, modelAccountingSequence, unsettledModelRequests: 0, unknownModelRequestIds, issuer: "model_gateway" }` and `BridgeCallRecoveryResult { attemptId, sessionId, leaseId, stopProofId, bridgeAccountingSequence, unsettledToolCalls: 0, returnedCallIds, failedCallIds, detachedActivityIds, unknownToolCallIds, issuer: "state_recovery" }`. Recovered Worker proof requires both exact results for the same binding/stop proof and current canonical sequences; neither result alone is a capacity proof.
- Produces: `BridgeCallResolution = { status: "pending", callId, downstreamState: "unlinked" | "awaiting_evidence" } | { status: "returned", callId, resultRef, payload: { kind: "runtime_protected_response", response: FramedRuntimeResponse, terminalSequence } | { kind: "artifact", artifactRef: ArtifactRef } | ServiceResultPayload } | { status: "failed", callId, errorRef }`. Resolution accepts only the exact current execution and a call ID returned by `acceptBridgeCall`. For an accepted Runtime link, hidden State code reads the already-terminal canonical Runtime operation: confirmed atomically writes `accepted -> returned` with its result ref and returns the persisted response, canonical unknown writes `accepted -> failed` with a State-authored downstream-unknown error, and missing evidence remains pending. Existing returned/failed rows replay identically. A missing response row, digest mismatch or result-ref mismatch is canonical corruption: no Bridge transition occurs and normal or fail-stop Worker terminal proof is withheld.
- Produces: issuer-bound managed terminal proofs with exact `mutationLeaseId`, `MutationOwner`, `MutationScopeKey`, resource generation and terminal sequence: `JobTerminalProof { kind: "job", jobId, processIdentity, openProcesses: 0, openIoOperations: 0, issuer: "job_runtime" }`; `ChannelActivityTerminalProof { kind: "channel", activityId, openReads: 0, openWrites: 0, issuer: "channel_service" }`; `HttpSessionTerminalProof { kind: "http_session", activityId, openRequests: 0, openResponseBodies: 0, issuer: "http_session_service" }`; `ListenerActivityTerminalProof { kind: "listener", activityId, openAccepts: 0, openConnections: 0, openIoOperations: 0, issuer: "listener_service" }`; and `BrowserActivityTerminalProof { kind: "browser", activityId, browserLeaseId, processIdentity, profileGeneration, networkGeneration, openTrackedRequests: 0, issuer: "browser_service" }`. Capacity terminal proofs are `BrowserTeardownProof { kind: "browser", capacityReservationId, browserLeaseId, processIdentity, profileGeneration, networkGeneration, terminalSequence, openProcesses: 0, profileRemoved: true, issuer: "browser_service" }` and `InstanceStoppedProof { kind: "instance", capacityReservationId, instanceIdentity, resourceGeneration, lifecycleOwnerSequence, observationId, authoritativeState: "stopped", terminalSequence, issuer: "platform_service" }`. `ManagedMutationTerminalProof`, `WorkerCapacityTerminalProof = WorkerTerminalProof | RecoveredWorkerTerminalProof` and `CapacityTerminalProof = WorkerCapacityTerminalProof | BrowserTeardownProof | InstanceStoppedProof` are discriminated unions.
- Produces: `ManagedMutationFinishInput`, which couples each `completed | failed | cancelled` activity kind only to its matching managed terminal proof, plus a `lost` branch carrying that activity's identity/owner/lease and the covering `StateStopBinding`; and `CapacityReleaseInput = { dimension: "worker_slots", proof: WorkerCapacityTerminalProof } | { dimension: "browser_slots", proof: BrowserTeardownProof } | { dimension: "instances", proof: InstanceStoppedProof }`. Cross-kind, wrong-issuer, stale-owner/lifecycle-owner-sequence/generation, wrong-reservation and non-quiescent proofs fail schema or State validation.
- Produces: `AdmissionClassifier.classify(input: AdmissionInput): Promise<EvidenceBackedClassification>` with `EvidenceBackedClassification { category: web|misc|crypto|out_of_scope|ambiguous, evidenceRefs: ArtifactRef[] }`, so Task 9 can inject a fail-closed deterministic classifier and Task 13 can later provide the model-backed implementation without an M0 forward dependency.
- Produces: candidate/verification contracts including `SubmissionIntent { operationId, candidateRevisionId, verificationRevisionId, payloadIdentity, generation, validUntil, proposer: { taskId, attemptId, sessionId, bindingSequence, role: "coordinator", responsibility: "submitting", validatedSequence } }` and a canonical `DispatchPrecondition` evaluated against current State immediately before transport dispatch. The proposer fields are copied only by State while atomically validating the exact current `ExecutionBinding`; they are never caller-selected identity. Candidate/domain payload identity is distinct from the full wire request identity.
- Produces: `PlatformWireRequest`, `PlatformWireResponse`, `PlatformObservationContext { kind: "observation", operationId, serviceIdentity, capability, scope, gate: ObservationPrecondition }`; `PlatformEffectIntentContext { kind: "protected_effect", operationId, serviceIdentity, capability, payloadIdentity, gate: DispatchPrecondition, mutation: RemoteMutationContext, reservationRefs }`; `ProtectedDispatchContext = PlatformEffectIntentContext & { wireRequestIdentity }`; `PlatformAdapterContext = PlatformObservationContext | PlatformEffectIntentContext`; `FramedRuntimeRequest { protocol, endpoint, frameBytes, messageCount }`, `FramedRuntimeResponse`, `RuntimeProtectedCallContext { kind: "runtime_protected_effect", operationId, serviceIdentity: "runtime", capability, payloadIdentity, framedRequestIdentity, gate: DispatchPrecondition, mutation: RemoteMutationContext, reservationRefs, managedTransportId, confirmationPolicy }`; and `ProtectedMutationContext = ProtectedDispatchContext | RuntimeProtectedCallContext`. Context and request are inseparable discriminated families: `PlatformProtectedDispatchEnvelope { family: "platform", context: ProtectedDispatchContext, request: PlatformWireRequest }`, `RuntimeProtectedDispatchEnvelope { family: "runtime", context: RuntimeProtectedCallContext, request: FramedRuntimeRequest }`, and `ProtectedDispatchEnvelope` is their union. `ProtectedRequestIdentityPolicy<Envelope extends ProtectedDispatchEnvelope>` canonicalizes/classifies the actual request bytes for exactly one bound family; a dispatcher factory cannot bind the union-wide envelope. `computeFramedRequestIdentity` hashes transport/protocol/endpoint/exact frame bytes/message count, while `computeWireRequestIdentity` hashes canonical Platform capability/method/path/query/body. Caller DTOs carry no asserted request identity. `WireCapabilityPolicy.classify(context, request)` uses an immutable service-owned route registry and defaults unknown shapes to protected/denied. `PlatformObservationDispatcher.dispatch(context, request)` recomputes identity and sends only when current State satisfies the server-issued observation gate and both context capability and actual wire shape classify as `retryable_observation`. `PlatformAdapter` receives only that observation capability; protected methods are pure intent-to-wire mappers whose output returns to Platform Service for context sealing and Task 7 dispatch, never raw credential transport or a protected sender.
- Defines `MAX_FRAMED_RUNTIME_RESPONSE_BYTES = 1_048_576` and exact `FramedRuntimeResponse { protocol: string, frameBytes: Uint8Array, messageCount: number, terminal: "complete" }`. Its Zod schema requires non-empty protocol, integer `messageCount >= 1`, exact complete framing and `frameBytes.byteLength <= MAX_FRAMED_RUNTIME_RESPONSE_BYTES`; `computeFramedResponseIdentity(response): PayloadIdentity` hashes the canonical tuple of protocol, exact frame bytes, message count and terminal marker, and every `RuntimeProtectedResultRef.responseIdentity` is exactly that `PayloadIdentity`. The broker parser stops retaining bytes at the limit plus one: a complete in-limit response calls confirmation, while the first excess byte calls the limit writer and can never produce a response ref/result payload. Request and response limits are per canonical protected operation, so chunking/retry cannot bypass them.
- Produces operation-discriminated prepare inputs with exact tuple cardinality. `RuntimeProtectedCallPrepareInput` has `family: "runtime"`, `operationKind: "remote_unit"`, `newConsumableRequests: [ConsumablePrepareRequest<"remote_units">]`, and `existingCapacityRefs: []`. `PlatformProtectedCallPrepareInput` is exactly one of: First List with `operationKind: "first_list"` and both tuples empty; Submit or Hint with one matching `ConsumablePrepareRequest<"submissions">` or `ConsumablePrepareRequest<"hints">` and no capacity ref; Start with no consumable and one `InstanceCapacityReservation`; or Close with no consumable and one `OccupiedInstanceCapacityRef`. The schemas reject multiple consumables, mixed consumable/capacity input, a wrong dimension/phase, and all extra refs before creating a reservation or prepared row.
- Produces their `ProtectedCallPrepareInput` union, each carrying its exact family, authenticated authority binding, operation/payload/mutation/precondition identity, service-computed framed/wire request identity and optional trusted Bridge allocated ref; Start additionally carries the State-issued reservation whose historical `authorizationOrigin` and `lifecycleOwnerBinding` are both checked, while Close carries the occupied ref and current lifecycle authority. Also produces `PreparedCall { operationId, family, operationKind, preparationSequence, requestIdentity, reservationRefs }`. Platform mapping uses `PlatformEffectIntentContext & { reservationRefs: [] }`; only State-backed preparation can return refs sealed into the final `ProtectedDispatchContext`. Exact retry returns the same record, while changed operation kind/request/budget/capacity/Bridge identity conflicts. Because every accepted variant has zero or one budget/capacity ref, one `PreparedCallCancellation` is total for the whole operation.
- Produces: `BudgetDimension = model_tokens | tool_wall_ms | worker_slots | browser_slots | instances | submissions | hints | remote_units` and fixed `BudgetSemantics`: `model_tokens | tool_wall_ms | submissions | hints | remote_units` are `consumable`, while `worker_slots | browser_slots | instances` are `capacity`. `BudgetScope` is a discriminated `run | challenge | endpoint | operation` union. `BudgetReservationKey = { operationId, scope, dimension }` is unique and idempotent; same key/different units or semantics is a conflict. `ConsumablePrepareRequest<D extends "submissions" | "hints" | "remote_units"> = DispatchBudgetRequest & { dimension: D, ownedCapacityReservationIds: [] }` fixes the single consumable requested by each protected operation variant.
- Produces: `InstanceAuthorizationOrigin = { kind: "run_lifecycle", binding: RunLifecycleBinding } | { kind: "coordinator_execution", binding: ExecutionBinding }`, `InstanceCapacityReservation = CapacityReservation & { dimension: "instances", operationId, challengeId, authorizationOrigin: InstanceAuthorizationOrigin, lifecycleOwnerBinding: RunLifecycleBinding, owner: MutationOwner & { kind: "run_lifecycle" }, lifecycleOwnerSequence }`, State-issued `OccupiedInstanceCapacityRef { reservationId: BudgetReservationId, dimension: "instances", operationId, challengeId, authorizationOrigin, lifecycleOwnerBinding, owner, resourceGeneration, phase: "occupied", occupancySequence, lifecycleOwnerSequence }`, and `SucceedInstanceLifecycleOwnerInput { expectedOccupied: OccupiedInstanceCapacityRef, stop: StateStopBinding, successor: RunLifecycleBinding }`. At reservation time State validates the supplied authorization binding, resolves the exact current lifecycle binding for the same run/incarnation, derives the long-lived capacity/mutation owner from that lifecycle binding and allocates the initial owner sequence; activation and first occupancy preserve it. A Coordinator authorization must carry the same challenge, have `role: "coordinator"`, and include immutable `intake`; a lifecycle authorization must equal the resolved owner binding and may target only an admitted challenge. No caller supplies run/incarnation/owner scalars. Start preparation compares the complete historical authorization snapshot, lifecycle owner and owner sequence; pre-activation cancellation may match a released historical authorization while retaining the original owner revision. After verified fail-stop, only State succession may update `lifecycleOwnerBinding`, derived owner and `lifecycleOwnerSequence`; reservation/operation/challenge/authorization origin/resource generation/phase/occupancy sequence and all capacity/consumable accounting remain byte-for-byte unchanged. Later observation, Close and stopped evidence use the current owner sequence and never require the historical Coordinator execution to remain active.
- Instance succession accepts only canonical phase `occupied`. It rejects `reserved|activating|activation_unknown|teardown_pending|teardown_unknown|cancelled_not_dispatched|released`; unknown active evidence must first restore occupied, and stopped evidence releases instead. Its idempotency key is `(reservationId, expected lifecycleOwnerSequence, stop.id, successor.id)`: exact commit-response retry returns the same ref/event/sequence; changed stop/successor conflicts. Current same-run descendants are allowed only across a complete stop-and-revocation lineage, so B dying before succession does not strand an A-owned instance. Stale/cross-run/same-incarnation successor, stale owner sequence, changed challenge/generation, incomplete old-authority/grant/lease/effect barrier, and old ref use all fail before Platform bytes.
- Produces State-issued `StoppedOwnerInstanceRecoveryRef { reservationId, challengeId, instanceIdentity, lifecycleOwnerBinding, lifecycleOwnerSequence, resourceGeneration, phase: "activating" | "activation_unknown" | "occupied" | "teardown_pending" | "teardown_unknown" }`, `ReleasedInstanceCapacityRef = ReleasedCapacity & { dimension: "instances", reservationId, challengeId, resourceGeneration, lifecycleOwnerSequence, phase: "released" }`, and `StoppedOwnerInstanceReconciliationInput { expected: StoppedOwnerInstanceRecoveryRef, stop: StateStopBinding, observer: RunLifecycleBinding, evidence: PlatformProtectedReconciliationEvidence & { kind: "instance_observation" } }`. This is observation-only recovery, not succession: State validates `stop` against A, `observer` as current same-run B/descendant, exact instance/challenge/generation/owner sequence and Platform-authenticated List evidence. Authoritative active restores the same A-owned row to occupied without changing owner sequence; stopped releases the same reservation. It issues no grant, lease, mutation permit or Platform effect. `reserved` uses existing no-dispatch cancellation; terminal phases reject. Only an occupied result may then enter succession.
- Produces: `ConsumableReservation | CapacityReservation`, `CapacityActivationIntent`, `CapacityTeardownIntent`, `DispatchBudgetRequest { scope, requiredNewUnits, ownedCapacityReservationIds }`, and `BudgetLedger`: `authorizeDispatch(input): Promise<BudgetDecision>`, `reserve(input): Promise<ConsumableReservation | CapacityReservation>`, `settleConsumption(id, actualUnits, confirmation)`, `cancelUndispatchedConsumption(id, proof: ConsumableDispatchNonDispatchProof): Promise<CancelledConsumableReservation>`, `beginCapacityActivation(id, intent): Promise<CapacityActivation>`, `occupyCapacity(id, proof: CapacityOccupancyProof): Promise<OccupiedCapacity>`, `cancelCapacityActivation(id, proof: CapacityActivationNonDispatchProof): Promise<CancelledCapacityReservation>`, `beginCapacityTeardown(id, intent): Promise<CapacityTeardown>`, `abortCapacityTeardown(id, proof: CapacityTeardownNonDispatchProof): Promise<OccupiedCapacity>`, `markCapacityUnknown(id, phase: "activation" | "teardown", evidence): Promise<UnknownCapacity>`, `releaseCapacity(id, input: CapacityReleaseInput)`, `markConsumptionUnknown(id, quarantineScope)`, `readSnapshot(runId)`. Every transition is idempotent for the same reservation/owner/generation and conflicts on changed identity. `cancelUndispatchedConsumption` permits only consumable `reserved -> cancelled_not_dispatched`; `cancelCapacityActivation` permits only capacity `reserved|activating -> cancelled_not_dispatched`; `occupyCapacity` reconciles `activating|activation_unknown|teardown_pending|teardown_unknown` to occupied only with matching active proof; `abortCapacityTeardown` restores only `teardown_pending -> occupied`; and `releaseCapacity` reconciles `activating|activation_unknown|occupied|teardown_pending|teardown_unknown -> released` only with the matching dimension, reservation, owner, generation and terminal proof. Authorization examines only requested new units in that scope and validates supplied capacity ownership plus action-specific state: provider/tool dispatch requires an occupied Worker reservation; Browser payload requires occupied Browser capacity; Platform Start itself may consume its reserved/activating instance ref. No cancellation/teardown path refunds a settled or unknown consumable.
- Non-dispatch transition validation is atomic with the effect/activity ledger. `cancelUndispatchedConsumption` requires a `dispatch` proof, `cancelCapacityActivation` requires an `activation` proof, and `abortCapacityTeardown` requires a `teardown` proof. Each matches operation, reservation, dimension, owner, generation, exact canonical phase-record sequence and issuer. State additionally requires canonical `failed_not_dispatched` plus no later first-byte/action-start record. Capacity cancelled directly from `reserved` must prove that the cited reservation sequence is current and that no activation record exists. A proof is rejected after any transport byte, process signal, ingress close that begins shutdown, profile mutation or other service-recorded external action, even if its DTO carries `false`.
- Produces: `MutationScopeKey = { scope: "run", runId, resourceKey } | { scope: "challenge", runId, challengeId, resourceKey }`, `MutationOwner = { kind: "execution", taskId, attemptId, incarnationId } | { kind: "run_lifecycle", runId, incarnationId }`, server-derived `RemoteActivityContext = { access: "local", operationId, owner: MutationOwner } | { access: "read_only" | "mutation", operationId, scopeKey, owner: MutationOwner }`, its `RemoteMutationContext` subtype, `MutationLease`, `MutationPermit`, `DispatchPermit`, and `MutationLeaseStore`: `acquire(context: RemoteMutationContext): Promise<MutationLease>`, `activateManaged(leaseId, context): Promise<MutationPermit>`, `transferManaged(leaseId, permit: ManagedActivityTransferPermit): Promise<MutationPermit>`, `finishManaged(leaseId, input: ManagedMutationFinishInput): Promise<void>`, `markDispatching(leaseId, context: ProtectedMutationContext): Promise<DispatchPermit>`, `finishProtected(leaseId, terminalEffectState, evidence): Promise<void>`, `revokeIncarnation(stop: StateStopBinding): Promise<void>`. Network-capable Job/Channel/HTTP-session/Listener/Browser activity defaults to `mutation` unless trusted policy proves read-only; local activity has no mutation scope. A managed permit remains active from pre-connect/listen/process/page activation until the owning activity is terminal; completed/failed/cancelled requires the matching activity-kind, issuer, owner, scope, lease, generation and zero-in-flight terminal proof, and `lost` cannot release before State validates the matching owner's `StateStopBinding`. Transfer is supported only for Job/Channel, requires a Supervisor-issued permit that binds the canonical current source and target execution, and atomically changes both activity and lease owner; stale source/target, changed scope/generation or replay with different data fails without releasing the lease. Protected Platform or Runtime dispatch requires `context.mutation.operationId == context.operationId`; Task 7 calls `acquire(context.mutation)` then `markDispatching(lease.id, context)`. The latter atomically verifies current preconditions, actual request/payload identities, reservation refs and lease owner; `finishProtected(...unknown...)` installs matching quarantine before release.
- Instance lifecycle succession is not `transferManaged`: `ManagedActivityTransferPermit` remains Job/Channel-only and no old grant, route, socket or mutation lease moves to the successor. Before owner revision State requires the stopped owner fenced from grant resolution and new lease/dispatch acquisition, and every old-owner operation on that instance scope terminal, cancelled or durably unknown with quarantine. The successor obtains fresh grants and a fresh lease; any existing quarantine remains and can still block Close. State emits one immutable `instance.lifecycle_owner_succeeded` event only after this barrier.
- Produces: `MetricClock`, `MetricTimestamp { clockDomainId, tickNs }`, `MetricProducer`, `MetricEventInput`, `MetricEvent`, `MetricActivityKind`, `MetricCoverageExpectation = { group, status: "required", activityRefs, evidenceSequence } | { group, status: "not_applicable", evidenceSequence }`, `MetricCoverageSnapshot { runId, snapshotSequence, terminal, expectations }`, `MetricValue<T> = { status: "measured", value: T } | { status: "not_applicable" } | { status: "missing", reason: string }`, `MetricProjection`, and `RunMetrics`. Coverage is derived from canonical business entities/events at the same snapshot sequence, not from metric summaries: required activity without its whole metric group is `missing`; only a terminal snapshot may mark an optional activity `not_applicable`; incomplete coverage is `missing/coverage_incomplete`. Every metric event carries producer, run/scope, correlation and timestamp; duration-bearing completion payloads name their start event or contain a producer-measured `durationMs`. The union includes `run.start_anchored`, model request/usage, job dispatch/terminal, managed channel/HTTP/listener activity, Browser activity/action/observation/terminal, observation visibility, artifact publish/range read, protected-call result, capacity activation/occupancy, blocker open/close, experiment dispatch/complete, semantic progress, repair/fallback, continuation/capacity reacquire, candidate/engineering/verification/platform, compaction/session reconstruction/fingerprint/next-action, fail-stop/recovery/recomputation and checkpoint events.
- Produces: `BuildIdentityInput`, `BuildIdentity { id, includedPathDigest, executableArtifactDigest, lockfileDigest, toolchainIdentity }`, `BuildIdentityVerification` and their schemas. `id` is the digest of the canonical tuple of the other four fields. Task 12 owns the only filesystem/toolchain computation implementation; later Gates import it rather than reimplementing or echoing a supplied ID.
- Produces: server-derived `ActionProvenance = model | deterministic_control | harness_injection`. A `model` action requires bound `modelRequestId`, `modelResponseId`, `toolCallId`, `sessionId`, `taskId` and consumed observation/artifact refs; caller payload cannot select or forge the origin. Also produces `InterventionRecord`, `InterventionEvidence` and `IntegrityDecision` schemas.
- Produces: pure `NetworkGrantRequest`, `NetworkGrantExpectation { callerServiceIdentity, runId, incarnationId, challengeId, resourceGeneration, managedTransportId? }`, and canonical `NetworkGrantRecord { grantSetId, mode: "direct" | "broker_only", runId, incarnationId, challengeId, serviceIdentity, resourceGeneration, endpoints, managedTransportId?, expiresAt, issuedSequence, revocationSequence, state: "active" | "revoked" }`. The record and ID are data, never bearer authority. Task 4 wraps exact State results in its own nominal in-process handle/resolution types; cross-process consumers submit only `GrantSetId` plus authenticated expected context to Task 4. Forged/structural/copied handles, wrong caller/scope/generation/transport, expiry, revocation or prior incarnation fail closed. No static signature or unspecified signing protocol substitutes for authenticated canonical resolution.

Metric ownership is fixed before implementation:

| Metric source | Owning producer | Required correlation/input | Independent coverage source |
| --- | --- | --- | --- |
| start -> first experiment | Task 9 start anchor + Task 13 experiment | run ID, anchor ID, experiment ID, shared clock domain or explicit duration | `run_start_intent` and canonical experiment row/event |
| model request/usage/latency | Task 4 Model Gateway | model request/response IDs, run/session/task, reservation ID | durable provider dispatch/response record |
| job/observation/tool wait | Task 6 Runtime | job/read IDs, dispatch/visibility pair, action provenance | canonical Job and read/visibility records |
| managed channel/HTTP/listener wait | Task 7 Runtime | activity/operation IDs, connect/request/terminal pair, action provenance | canonical managed network activity and in-flight-operation records |
| Browser activity/action/observation | Task 10 Browser Service | activity/action IDs, page/network generation, dispatch/visibility/terminal pair, action provenance | canonical Browser activity/action/observation and terminal-proof records |
| artifact publish/hash/I/O | Task 3 Artifact/State | publication ID, start/completion or producer duration, bytes/hash | publication intent plus durable artifact ref |
| protected/platform effect | Tasks 7/9 | operation ID, reservation refs, mutation scope, dispatch/result | protected-effect/platform-operation ledger |
| blocker/fail-stop/recovery/recompute | Task 11 plus Task 6 Launcher clock | blocker/incarnation/checkpoint IDs and same-domain pair or owner duration | blocker/incarnation/checkpoint/recovery state |
| solver/candidate/compaction/raw retrieval/next action | Tasks 13-17 | task/attempt/candidate/snapshot/ref/fingerprint IDs and action provenance where applicable | experiment/candidate/verification/compaction/session business records |

**Depends on:** Task 1.

- [ ] **Step 1: Write failing core state, execution and budget tests**

```ts
it("does not equate finished with solved", () => {
  expect(deriveOutcome({ solveState: "finished", authoritativeAccepts: 0 })).toBe("unsolved");
});
it("rejects a verifier session that reuses the solver task", () => {
  expect(() => VerificationInput.parse(sameTaskFixture())).toThrow();
});
it.each([
  bindingWithoutCanonicalIncarnation(),
  bindingWithNullChallenge(),
  bindingWithoutResponsibilitySet(),
  bindingWithExpandedResponsibilitySet(),
])("requires immutable run/challenge/incarnation/responsibility identity in every execution binding", (binding) => {
  expect(() => ExecutionBindingSchema.parse(binding)).toThrow();
});
it("does not let a capacity release refund consumable usage", () => {
  expect(() => CapacityTerminalProofSchema.parse(consumableReservation())).toThrow();
});
it("does not release Worker capacity with another capacity family's proof", () => {
  expect(() => CapacityReleaseInputSchema.parse({ dimension: "worker_slots", proof: browserTeardownProof() })).toThrow();
});
it("keeps instance lifecycle succession out of the Job/Channel transfer permit", () => {
  expect(() => ManagedActivityTransferPermitSchema.parse(instanceTransferPermit())).toThrow();
});
it("requires current lifecycle-owner sequence on occupied instance refs and stopped evidence", () => {
  expect(() => OccupiedInstanceCapacityRefSchema.parse(occupiedInstanceWithoutOwnerSequence())).toThrow();
  expect(() => InstanceStoppedProofSchema.parse(instanceStoppedWithoutOwnerSequence())).toThrow();
});
it.each([
  transportNonDispatchProof({ firstByteWritten: true }),
  localActionNonDispatchProof({ actionStarted: true }),
])("rejects a non-dispatch proof whose own discriminant admits external action", (proof) => {
  expect(() => NonDispatchProofSchema.parse(proof)).toThrow();
});
it("does not let a reserved capacity owner dispatch before occupancy proof", () => {
  expect(authorizeDispatchWithReservedWorker()).toMatchObject({ allowed: false, code: "capacity_not_occupied" });
});
it("rejects solve_state values in run_state", () => {
  expect(() => RunSchema.parse({ ...validRun(), runState: "blocked_runtime" })).toThrow();
});
```

In `opaque-capabilities.type-test.ts`, import only public contracts and require structural construction to fail:

```ts
declare const copiedCapabilityId: LauncherRunLockCapabilityId;
declare const copiedStopProofId: LauncherStopProofId;
declare const copiedStateStopBindingId: StateStopBindingId;
declare const budgetLedger: BudgetLedger;
declare const reservationId: BudgetReservationId;
declare const workerActivationProof: WorkerActivationNonDispatchProof;
declare const modelDispatchProof: ModelConsumableNonDispatchProof;
declare const structuralLauncherClient: {
  verifyCurrent: LauncherAuthorityClient["verifyCurrent"];
  verifyStopped: LauncherAuthorityClient["verifyStopped"];
};

if (false) {
  // @ts-expect-error Launcher lock capabilities have no public structural constructor.
  const forgedLockCapability: LauncherRunLockCapability = { id: copiedCapabilityId };
  // @ts-expect-error Launcher stop proofs have no public structural constructor.
  const forgedStopProof: LauncherStopProof = { id: copiedStopProofId };
  // @ts-expect-error State stop bindings have no public structural constructor.
  const forgedStateStopBinding: StateStopBinding = { id: copiedStateStopBindingId };
  // @ts-expect-error The hidden authority brand prevents a structural Launcher client.
  const forgedLauncherClient: LauncherAuthorityClient = structuralLauncherClient;
  // @ts-expect-error Capacity activation evidence cannot cancel a consumable.
  budgetLedger.cancelUndispatchedConsumption(reservationId, workerActivationProof);
  // @ts-expect-error Consumable dispatch evidence cannot cancel capacity activation.
  budgetLedger.cancelCapacityActivation(reservationId, modelDispatchProof);
  void [forgedLockCapability, forgedStopProof, forgedStateStopBinding, forgedLauncherClient];
}
```

- [ ] **Step 2: Run the focused core contract tests and confirm failure**

Run: `npm run typecheck && npm test -- packages/contracts/test/core-state-budget.test.ts packages/contracts/test/transitions.test.ts`

- [ ] **Step 3: Implement IDs, state transitions, execution proofs and budget contracts**

Encode all spec enums exactly, preserve unknown/unsupported/quarantined distinctions, make authoritative acceptance a required input for `solved`, and keep product `run_state: invalid` distinct from the later Gate-status mapping. Implement non-null challenge execution reservation/binding, immutable role-bounded responsibility sets, opaque Launcher stop/run-lock/client authorities, stable authenticated tool-invocation keys, phase-specific non-dispatch evidence, terminal proofs and consumable/capacity unions before adding network-facing contracts. Keep the Launcher client factory out of package exports and expose its fake only through the test-support subpath guarded by Task 1.

- [ ] **Step 4: Verify the core contract group**

Run: `npm run typecheck && npm test -- packages/contracts/test/core-state-budget.test.ts packages/contracts/test/transitions.test.ts`

- [ ] **Step 5: Write failing mutation and Platform boundary tests**

```ts
it("requires complete mutation ownership and wire identity for a platform effect", () => {
  expect(() => ProtectedDispatchContextSchema.parse(protectedContextWithoutOwnerOrWireIdentity())).toThrow();
});
it("requires framing, managed transport and confirmation policy for a Runtime protected call", () => {
  expect(() => ProtectedMutationContextSchema.parse(runtimeProtectedContextWithoutFraming())).toThrow();
});
it.each([
  ["platform", runtimeProtectedContext(), platformWireRequest()],
  ["runtime", platformProtectedContext(), framedRuntimeRequest()],
])("rejects a %s envelope with a cross-family context/request", (family, context, request) => {
  expect(() => ProtectedDispatchEnvelopeSchema.parse({ family, context, request })).toThrow();
});
it("does not accept a caller-asserted identity in a raw wire request", () => {
  expect(() => PlatformWireRequestSchema.parse(wireRequestWithRequestIdentity())).toThrow();
});
it("accepts exactly 1 MiB of completely framed Runtime response bytes and hashes every framing field", () => {
  const response = framedRuntimeResponse({ frameBytes: new Uint8Array(1_048_576), messageCount: 2, terminal: "complete" });
  expect(FramedRuntimeResponseSchema.parse(response)).toEqual(response);
  expect(computeFramedResponseIdentity(response)).not.toEqual(computeFramedResponseIdentity({ ...response, messageCount: 1 }));
});
it.each([1_048_577, "incomplete-frame", "zero-messages"])("rejects invalid Runtime response bound/framing %s", (kind) => {
  expect(() => FramedRuntimeResponseSchema.parse(invalidFramedRuntimeResponse(kind))).toThrow();
});
it("does not finish one managed activity kind with another service's proof", () => {
  expect(() => ManagedMutationFinishInputSchema.parse({ kind: "job", outcome: "completed", proof: channelTerminalProof() })).toThrow();
});
it("rejects browser terminal proof while an activity-bound request is open", () => {
  expect(() => BrowserActivityTerminalProofSchema.parse(browserProof({ openTrackedRequests: 1 }))).toThrow();
});
```

- [ ] **Step 6: Run the focused mutation and Platform tests and confirm failure**

Run: `npm test -- packages/contracts/test/platform-mutation.test.ts packages/contracts/test/schemas.test.ts`.

- [ ] **Step 7: Implement and verify scoped mutation and Platform dispatch contracts**

Encode `MutationOwner`, remote activity/access, managed/protected lease, Platform wire/Runtime framed request identity, capability policy and contextual unions as discriminated types rather than caller conventions. Run: `npm test -- packages/contracts/test/platform-mutation.test.ts packages/contracts/test/schemas.test.ts`.

- [ ] **Step 8: Write failing metrics, build, provenance and network tests**

```ts
it("requires broker identity for a broker-only metered grant", () => {
  expect(() => NetworkGrantRequestSchema.parse(rawJobBrokerOnlyGrant())).toThrow();
});
it("requires complete model lineage when an action claims model origin", () => {
  expect(() => ActionProvenance.parse({ origin: "model", toolCallId })).toThrow();
});
it("does not mark an optional metric group N/A before terminal coverage", () => {
  expect(() => MetricCoverageSnapshotSchema.parse(nonTerminalNotApplicableCoverage())).toThrow();
});
it("requires every component of the canonical build identity", () => {
  expect(() => BuildIdentitySchema.parse(buildIdentityWithoutExecutableDigest())).toThrow();
});
```

- [ ] **Step 9: Run the focused telemetry/identity tests and confirm failure**

Run: `npm test -- packages/contracts/test/metrics-build-provenance.test.ts packages/contracts/test/schemas.test.ts`.

- [ ] **Step 10: Implement telemetry, identity, provenance, intervention and network contracts**

Implement sequence-aligned metric coverage, canonical build identity, trusted action origin, intervention and grant variants. Run: `npm test -- packages/contracts/test/metrics-build-provenance.test.ts packages/contracts/test/schemas.test.ts`.

- [ ] **Step 11: Verify all contracts and generated type declarations**

Run: `npm run typecheck && npm test -- packages/contracts/test`

Expected: PASS with no `any` at public package boundaries.

- [ ] **Step 12: Commit if authorized**

Suggested message: `feat: define canonical ctf agent contracts`.

### Task 3: Implement canonical State and Artifact services

**Files:**
- Create: `packages/state/package.json`, `packages/artifacts/package.json`
- Create: `packages/state/src/index.ts`, `db.ts`, `migrations/001-initial.sql`, `repository.ts`, `events.ts`, `outbox.ts`, `run-lock.ts`, `execution-bindings.ts`, `budget-ledger.ts`, `instance-lifecycle.ts`, `effect-ledger.ts`, `runtime-reconciliation.ts`, `bridge-calls.ts`, `mutation-leases.ts`, `worker-recovery.ts`, `metric-events.ts`, `metric-coverage.ts`, `interventions.ts`, `service-ports.ts`, `internal/state-kernel.ts`, `internal/compose-state.ts`, `test-support/open-test-state.ts`
- Create: `packages/artifacts/src/store.ts`, `publish.ts`, `integrity.ts`
- Test: `packages/state/test/transactions.test.ts`, `packages/state/test/authority-boundary.test.ts`, `packages/state/test/state-ports.type-test.ts`, `packages/state/test/run-lock.test.ts`, `packages/state/test/execution-bindings.test.ts`, `packages/state/test/budget-ledger.test.ts`, `packages/state/test/runtime-reconciliation.test.ts`, `packages/state/test/bridge-calls.test.ts`, `packages/state/test/mutation-leases.test.ts`, `packages/state/test/worker-recovery.test.ts`, `packages/state/test/metric-events.test.ts`, `packages/state/test/metric-coverage.test.ts`, `packages/state/test/interventions.test.ts`, `packages/artifacts/test/publish.test.ts`

**Interfaces:**
- Consumes: IDs/state schemas and the opaque `LauncherAuthorityClient` type from Task 2.
- Produces: public command-shape interfaces plus nominal facade types `ArtifactStatePort`, `PolicyStatePort`, `BridgeStatePort`, `SupervisorStatePort`, `RuntimeStatePort`, `BrowserStatePort`, `MeteredBrokerStatePort`, `ProtectedDispatchStatePort`, `PlatformStatePort`, `CandidateStatePort`, `RecoveryStatePort`, and `ReportingStatePort`. Each nominal port is exactly its complete `*StateCommands` interface intersected with an unexported runtime unique-symbol authority; no port adds public methods outside its command-shape interface. Constructors and authority symbols are unexported. The package root exports only command/port types, immutable readers, and pure projectors; it does not export `StateKernel`, a database/repository handle, transaction callback, raw event append, generic outbox claim, writer factory, or authority-minting function. `internal/state-kernel.ts` alone owns the sole SQLite dependency, canonical path, transactions and expected-sequence append/outbox primitives. Non-exported `internal/compose-state.ts` accepts a real nominal `LauncherAuthorityClient`, opens one kernel, and mints frozen facades whose methods close over the matching runtime authority. Task 6's allowlisted host composition is its only production importer. State tests use `@ctf/state/test-support`, whose fake Launcher authority, port bundle, and authority probe are unavailable to production under Task 1's boundary check. Every facade command verifies its closed-over service authority and performs its own event/coverage/outbox writes in the same hidden kernel transaction; no facade accepts SQL, a transaction callback, state path, asserted caller identity, or arbitrary event/outbox input.
- Produces on `ArtifactStatePort`: `publishArtifact(input): Promise<ArtifactRef>`; Task 6 owns the Job-stream reader bridge into this byte-oriented API.
- Produces on the lifecycle portion of `SupervisorStatePort`: `issueRunLifecycleBinding(lockCapability: LauncherRunLockCapability): Promise<RunLifecycleBinding>`, `recordIncarnationStop(subject: RunLifecycleBinding, proof: LauncherStopProof): Promise<StateStopBinding>`, `readCurrentRunLifecycleBinding(runId)`, `validateRunLifecycleBinding(binding)`, `validateStateStopBinding(stop, subject: ExecutionBinding | RunLifecycleBinding)`, `revokeRunLifecycleBinding(binding, stop: StateStopBinding)`, and `succeedInstanceLifecycleOwner(input: SucceedInstanceLifecycleOwnerInput): Promise<OccupiedInstanceCapacityRef>`. State asks the injected nominal authenticated client to derive and persist the current lock or stopped-incarnation tuple, then compares the verified stop to the supplied canonical prior lifecycle subject in the same transaction. Lifecycle issuance records the canonical preceding stop/revocation lineage internally. Succession verifies the exact occupied row and owner sequence, stop subject, current same-run successor/descendant, old grant/lease/effect barrier and unchanged challenge/generation before updating only lifecycle binding, derived owner and owner sequence. Exact stop or succession commit-response retry is idempotent; changed stop/successor conflicts. No API accepts parallel run/incarnation/boot/generation/registry/observation scalars. Structural/copy/fabricated proof/client, old boot/generation, incomplete registry, changed identity or independently live process fails before authority or recovery transition.
- The same lifecycle command shape exposes only two instance readers needed for recovery: `listRecoverableInstancesOwnedByStoppedLifecycle(stop: StateStopBinding): Promise<StoppedOwnerInstanceRecoveryRef[]>` and `readCurrentOccupiedInstance(binding: RunLifecycleBinding, reservationId: BudgetReservationId): Promise<OccupiedInstanceCapacityRef>`. The first revalidates the stop subject and returns exact canonical nonterminal recovery refs; the second requires the current owner binding/sequence. Neither accepts owner scalars or returns a mutable repository handle.
- Produces on complete `PlatformStateCommands`: existing Platform-owned effect/observation/budget commands plus `reconcileStoppedOwnerInstance(input: StoppedOwnerInstanceReconciliationInput): Promise<OccupiedInstanceCapacityRef | ReleasedInstanceCapacityRef>`; `PlatformStatePort = PlatformStateCommands & StatePortAuthority<"platform">`. The command accepts only evidence recorded by the same nominal Platform service from a current successor's retryable List, changes only the exact capacity phase, and cannot revise owner or dispatch Close. Structural callers and every other facade lack it.
- Produces complete `PolicyStateCommands`, including Policy-owned budget/model/metric commands plus `issueNetworkGrant(binding: ExecutionBinding | RunLifecycleBinding, request: NetworkGrantRequest): Promise<NetworkGrantRecord>`, `resolveNetworkGrant(grantSetId: GrantSetId, expected: NetworkGrantExpectation): Promise<NetworkGrantRecord>`, and `revokeNetworkGrant(grantSetId, expectedRevocationSequence): Promise<NetworkGrantRecord>`; `PolicyStatePort = PolicyStateCommands & StatePortAuthority<"policy">`. Issue derives run/incarnation/challenge and permitted service scope from the exact current binding plus release-owned policy. Resolve atomically checks canonical active state, caller service, scope, generation, managed transport, expiry and revocation against State's trusted clock/sequence; revoke is monotonic and idempotent. No other facade can issue/resolve/revoke grants, and State never treats a caller-supplied grant body as authority.
- Produces: complete `BridgeStateCommands` with `beginSessionAllocation`, `completeSessionAllocation`, `beginWorkerSessionActivation`, `occupyWorkerSession`, `readBridgeQuiescence`, `beginWorkerSessionTeardown`, `recordWorkerTeardownActionStart`, `proveWorkerDeactivationNotStarted`, `recordWorkerTerminal`, `acceptBridgeCall`, `resolveBridgeCall(input: { execution: ExecutionBinding, callId: BridgeCallId }): Promise<BridgeCallResolution>`, and `completeBridgeCall`; `BridgeStatePort = BridgeStateCommands & StatePortAuthority<"bridge">` and has no additional public methods. `resolveBridgeCall` validates the exact current execution/call row and uses hidden read-only downstream projectors; it can write only that Bridge row's canonical returned/failed transition, never a protected effect, response, budget or mutation row. The complete `SupervisorStateCommands` includes bind/replace/release, pre-activation Worker cancellation, and `abortWorkerSessionTeardown(binding: ExecutionBinding, proof: WorkerTeardownNonDispatchProof): Promise<OccupiedCapacity>`; `SupervisorStatePort = SupervisorStateCommands & StatePortAuthority<"supervisor">`. The abort command atomically compares the exact current binding/reservation/owner/generation/teardown sequence, Bridge issuer and canonical absence of teardown action-start before restoring `teardown_pending -> occupied`; it does not issue the proof. Allocation/bind/swap compare canonical non-null run/challenge/incarnation/task/role/responsibility/attempt/lease/reservation identity. Bridge acceptance uniquely constrains `(sessionId, bindingSequence, invocationKey)`, allocates all call/tool/operation/downstream IDs in State, returns the same row for exact replay after a fresh process, and rejects changed request identity without forwarding. Worker commands accept only the exact binding/reservation and phase-specific Bridge-owned evidence; the Bridge port can record/issue its own teardown/terminal evidence but cannot mint Supervisor activation proof, abort/release capacity, or perform binding writes.
- `SupervisorStateCommands` is exactly the lifecycle commands above, including `succeedInstanceLifecycleOwner`, plus its execution bind/replace/release, pre-activation cancellation and teardown-abort commands; succession is not exposed on Policy, Platform, Scheduler, Recovery or any generic budget/lease facade.
- Produces service-specific downstream preparation commands such as `RuntimeStatePort.prepareLinkedRuntimeActivity(callId, allocatedRef, input)`, `ProtectedDispatchStatePort.prepareLinkedProtectedCall(callId, allocatedRef, input)`, `BrowserStatePort.prepareLinkedBrowserActivity(callId, allocatedRef, input)`, and `CandidateStatePort.prepareLinkedCandidateAction(callId, allocatedRef, input)`. Each command verifies that the exact ref was allocated by `acceptBridgeCall` for that service kind, creates the canonical prepared effect/activity row and Bridge link in one hidden kernel transaction, and returns the prepared handle before external action. There is no generic link-only/claim method; a conflicting kind/ref or second preparation fails.
- Produces complete, separately branded Runtime terminal writers and resolver. `MeteredBrokerStateCommands` contains `recordRuntimeBrokerConfirmation(input: RuntimeBrokerConfirmationInput): Promise<RuntimeProtectedReconciliationEvidence & { kind: "broker_confirmation" }>`, `recordRuntimeBrokerResponseLimit(input: RuntimeBrokerResponseLimitInput): Promise<RuntimeProtectedReconciliationEvidence & { kind: "broker_response_limit_exceeded" }>`, and broker-owned metrics; `MeteredBrokerStatePort = MeteredBrokerStateCommands & StatePortAuthority<"metered_broker">`. `ProtectedDispatchStateCommands` includes protected prepare/dispatch/cancel transitions, `recordRuntimeTransportUnresolved(input: RuntimeTransportUnresolvedInput): Promise<RuntimeProtectedReconciliationEvidence & { kind: "runtime_transport_unresolved" }>`, and `resolveRuntimeProtectedReconciliation(operationId: OperationId): Promise<RuntimeProtectedReconciliationResolution>`; `ProtectedDispatchStatePort = ProtectedDispatchStateCommands & StatePortAuthority<"protected_dispatcher">`. Host composition injects the first only into `metered-broker.ts` and the second only into the private dispatcher; neither producer receives the other's command. Each writer verifies the expected canonical dispatch and first-byte-intent sequences, derives request/owner/scope/generation/managed-transport identity, and atomically writes its evidence plus the one terminal effect/reservation/quarantine transition before returning. Confirmation also stores the bounded response, computed identity, immutable response/result refs and terminal sequence; the limit writer stores no response bytes/ref and transitions unknown. Exact retries return the same terminal row/ref; changed response/reason/sequence conflicts; no branch overwrites another. The resolver accepts no evidence payload and performs no terminal write: under its closed-over nominal authority it loads the operation's canonical terminal row, returns `awaiting_evidence` when absent, or returns the same persisted response/result on every process or concurrency replay.
- Produces on `CandidateStatePort`: `proposeSubmission(coordinator: ExecutionBinding, candidateRevisionId, verificationRevisionId): Promise<SubmissionIntent>`. In one hidden transaction State validates that the binding is current/occupied for the same challenge and exact candidate lineage, has `role: "coordinator"` and immutable responsibility `submitting`, copies its canonical task/attempt/session/binding sequence into `SubmissionIntent.proposer`, and writes the intent. Solver, Verifier, stale, released, cross-challenge or responsibility-expanded bindings fail before an intent/event/outbox row exists.
- Produces per-service nominal budget and mutation commands implementing only the Task 2 transitions that service owns. The hidden kernel implements the full `BudgetLedger` and `MutationLeaseStore` semantics: consumable `reserved -> settled | cancelled_not_dispatched | unknown`; capacity `reserved -> activating -> occupied -> teardown_pending -> released` with distinct unknown/cancel/abort paths; and same-scope managed/protected serialization. A facade cannot issue another service's proof or invoke a transition for an unowned dimension. All proof, owner, generation, phase-sequence, first-byte/action-start, terminal and zero-in-flight checks remain atomic with canonical effect/activity state.
- Produces on `RecoveryStatePort`: `reconcileStoppedBridgeCalls(binding, stop: StateStopBinding): Promise<BridgeCallRecoveryResult>` and `proveRecoveredWorkerTerminal(binding, stop, modelRecovery, bridgeRecovery): Promise<RecoveredWorkerTerminalProof>`. Reconciliation enumerates accepted rows and resolves every durable downstream link before fallback. A linked Runtime row already confirmed by its producer is atomically completed `accepted -> returned` with the exact canonical result ref before accounting; canonical Runtime unknown becomes terminal-unknown, and only a genuinely nonterminal/`awaiting_evidence` linked effect may take conservative unknown fallback after the covering stop proves its producer cannot still commit. A corrupt/missing confirmed response/result row aborts reconciliation and withholds Worker proof. Durable linked managed activity becomes detached. Unlinked accepted rows become terminal-unknown; existing completion remains returned/failed. It requires the subject-bound stop binding and exact Model/Bridge accounting sequences; missing rows or process absence alone are never terminal proof.
- Produces named service event/outbox commands, including `SupervisorStatePort.claimContinuation(taskId, eventId)`, plus `ReportingStatePort.readMetricProjectionInput(runId, snapshotSequence)`, pure `projectMetrics(input)`, and service-owned metric/intervention recording. There is no raw `appendEvent` or `claimOutbox`. The same hidden transaction that commits business activity updates coverage/outbox state; projection retains the existing clock-domain and measured/missing/not-applicable semantics.

**Depends on:** Task 2.

- [ ] **Step 1: Write failing atomicity, lock, budget, event and immutable-publication tests**

```ts
it("never commits an artifact ref before the file is durable", async () => {
  await expect(faultInjectedPublish("after-temp-write")).rejects.toThrow();
  expect(await state.listArtifactRefs()).toEqual([]);
});
it("allows only one active run lock per state directory", async () => {
  await expect(acquireSecondLock()).rejects.toMatchObject({ code: "active_run_exists" });
});
it.each(["copied-id", "wrong-boot", "old-generation", "released-lock"])("rejects %s Launcher lock capability before lifecycle binding issuance", async (kind) => {
  expect(await issueLifecycleBindingWithInvalidCapability(kind)).toMatchObject({ bindingsIssued: 0, verifierAccepted: false });
});
it.each(["structural-object", "copied-id", "wrong-boot", "old-generation", "incomplete-registry", "live-process", "cross-incarnation-replay"])("rejects %s Launcher stop evidence before a State stop binding is issued", async (kind) => {
  expect(await recordInvalidIncarnationStop(kind)).toMatchObject({ stopBindingsIssued: 0, verifierAccepted: false });
});
it("records exact reuse of one authenticated stop proof idempotently", async () => {
  expect(await recordSameIncarnationStopTwice()).toMatchObject({ stopBindings: [expectedStopBindingId, expectedStopBindingId], canonicalStopRows: 1 });
});
it("rejects a valid stop proof when the expected lifecycle subject is another incarnation", async () => {
  expect(await recordStopAgainstDifferentLifecycleBinding()).toMatchObject({ stopBindingsIssued: 0, code: "stop_subject_mismatch" });
});
it("exposes no generic State mutation and rejects a forged or wrong-service facade", async () => {
  expect(await attemptUnauthorizedStateWrites()).toMatchObject({ publicTransactions: 0, publicRawAppends: 0, nonStateSqliteDependencies: 0, leakedStatePaths: 0, forgedPortsAccepted: 0, forgedPortError: "state_port_authority_required", crossServiceWrites: 0, canonicalRowsChanged: 0 });
});
it("derives lifecycle identity from the one verified lock capability and rejects it after rotation", async () => {
  expect(await exerciseLifecycleBindingRotation()).toMatchObject({ callerSelectedRunOrIncarnation: false, concurrentCurrentBindings: 1, oldBindingAcceptedAfterRotation: false, fabricatedBindingAccepted: false });
});
it.each(["null-challenge", "changed-role", "expanded-responsibility", "different-attempt", "reused-session"])("rejects a %s unbound-session allocation at execution binding", async (kind) => {
  expect(await bindMismatchedSessionAllocation(kind)).toMatchObject({ bindingsWritten: 0, dispatchableSessions: 0 });
});
it("keeps a published ref stable when the workspace file changes", async () => {
  expect(await publishThenMutateWorkspace()).toMatchObject({ publishedBytes: originalBytes, currentWorkspaceBytes: changedBytes });
});
it("allows only one caller to reserve the final shared unit", async () => {
  const results = await reserveLastUnitConcurrently();
  expect(results.filter((x) => x.status === "reserved")).toHaveLength(1);
});
it("stores Coordinator Start authorization separately from the lifecycle instance owner", async () => {
  expect(await reserveInstanceFromCoordinator()).toMatchObject({ authorizationKind: "coordinator_execution", authorizationBinding: expectedCoordinatorBinding, ownerKind: "run_lifecycle", lifecycleOwnerBinding: expectedLifecycleBinding, callerSelectedOwner: false });
});
it("succeeds an occupied A-owned instance to current B without another capacity transition", async () => {
  expect(await succeedOccupiedInstanceFromAToB()).toMatchObject({ reservationIds: [expectedReservationId, expectedReservationId], operationIds: [expectedStartOperationId, expectedStartOperationId], challengeIds: [expectedChallengeId, expectedChallengeId], authorizationOrigins: [expectedAuthorizationOrigin, expectedAuthorizationOrigin], resourceGenerations: [expectedGeneration, expectedGeneration], occupancySequences: [expectedOccupancySequence, expectedOccupancySequence], lifecycleOwners: [bindingA, bindingB], ownerSequences: [expectedOwnerSequenceA, expectedOwnerSequenceB], reservations: 1, occupancyProofs: 1, successionRows: 1, occupiedUnits: 1, consumableUsageChanged: false, platformOutboxRowsCreatedBySuccession: 0, networkGrantRowsCreatedBySuccession: 0, mutationLeasesCreatedBySuccession: 0 });
});
it("replays a committed instance-owner succession response exactly once", async () => {
  expect(await retryInstanceSuccessionAfterCommitResponseLoss()).toMatchObject({ returnedOwnerSequences: [expectedOwnerSequenceB, expectedOwnerSequenceB], successionRows: 1, reservations: 1, occupancyProofs: 1 });
});
it.each(["missing-stop", "wrong-stop-subject", "cross-run-successor", "same-incarnation-successor", "stale-successor", "unrelated-incarnation", "stale-owner-sequence", "changed-challenge", "changed-generation", "active-old-grant", "active-old-lease", "prepared-old-close", "dispatching-old-effect", "activation-unknown", "teardown-pending", "teardown-unknown", "released"])("rejects invalid instance lifecycle succession: %s", async (kind) => {
  expect(await attemptInvalidInstanceSuccession(kind)).toMatchObject({ accepted: false, successionRows: 0, capacityReleased: false, newReservations: 0, platformBytes: 0 });
});
it.each(["activating", "activation_unknown", "teardown_pending", "teardown_unknown"])("lets current B reconcile stopped-owner %s by List before succession", async (phase) => {
  expect(await observeStoppedOwnerInstanceFromB(phase, "active")).toMatchObject({ observationKind: "retryable_list", mutationAuthorityUsed: false, before: phase, after: "occupied", ownerIncarnationAfterObservation: incarnationA, ownerSequenceChangedByObservation: false, successionAcceptedAfterObservation: true, finalOwnerIncarnation: incarnationB });
  expect(await observeStoppedOwnerInstanceFromB(phase, "stopped")).toMatchObject({ observationKind: "retryable_list", mutationAuthorityUsed: false, before: phase, after: "released", successionAcceptedAfterObservation: false, reusableSlots: 1 });
});
it.each(["stale-observer", "cross-run-observer", "wrong-instance", "wrong-generation", "wrong-owner-sequence", "non-platform-evidence"])("rejects stopped-owner observation recovery from %s", async (kind) => {
  expect(await reconcileStoppedOwnerInstanceWithInvalidObservation(kind)).toMatchObject({ accepted: false, capacityTransitions: 0, successionRows: 0, platformMutationBytes: 0 });
});
it("lets succession or stopped release win once without stale owner evidence mutating the loser", async () => {
  expect(await raceInstanceSuccessionWithStoppedRelease()).toMatchObject({ acceptedTerminalTransitions: 1, capacityRows: 1, staleOwnerProofsAccepted: 0, duplicateSuccessionRows: 0 });
});
it("does not release an unknown hard-unit reservation after recovery", async () => {
  expect(await recoverUnknownReservation()).toMatchObject({ availableUnits: 0, reservationState: "unknown" });
});
it("reuses capacity after terminal teardown without refunding usage", async () => {
  expect(await releaseBrowserThenAcquireNext()).toMatchObject({ nextBrowserAcquired: true, consumedToolMs: 25, releasedCapacity: 1 });
});
it.each(["after-activation-intent", "after-external-activation-before-occupancy-proof"])("recovers capacity activation crash %s without overcommit", async (point) => {
  expect(await recoverCapacityActivation(point)).toMatchObject({ concurrentOwners: 1, duplicateActivations: 0, unprovedUnitsAvailable: 0 });
});
it.each(["activation_unknown", "teardown_unknown"])("reconciles %s as active or stopped without freeing it early", async (state) => {
  expect(await reconcileCapacityUnknown(state, "active")).toMatchObject({ capacityState: "occupied", availableUnits: 0 });
  expect(await reconcileCapacityUnknown(state, "stopped")).toMatchObject({ capacityState: "released", availableUnits: 1 });
});
it("restores occupied capacity when Close is proved not dispatched", async () => {
  expect(await abortCloseBeforeFirstByte()).toMatchObject({ before: "teardown_pending", after: "occupied", availableUnits: 0 });
});
it("lets only Supervisor consume Bridge proof to abort a pre-action Worker teardown", async () => {
  expect(await abortWorkerTeardownBeforeAction()).toMatchObject({ proofIssuer: "opencode_bridge", consumer: "supervisor", before: "teardown_pending", after: "occupied", teardownActions: 0 });
});
it.each(["model_tokens", "tool_wall_ms", "submissions", "hints", "remote_units"])("cancels undispatched %s only with its issuer-bound dispatch proof", async (dimension) => {
  expect(await cancelNoByteConsumable(dimension)).toMatchObject({ reservationState: "cancelled_not_dispatched", bytesSent: 0 });
  await expect(cancelNoByteConsumableWithActivationProof(dimension)).rejects.toMatchObject({ code: "non_dispatch_phase_mismatch" });
});
it("cancels a reserved Worker before an activation record only from its reservation sequence", async () => {
  expect(await cancelReservedWorkerBeforeActivation()).toMatchObject({ capacityState: "cancelled_not_dispatched", activationRecords: 0, reusableWorkerSlots: 1 });
});
it("restores occupied capacity from teardown intent only with matching active or non-dispatch proof", async () => {
  await expect(restoreTeardownWithStaleGenerationProof()).rejects.toMatchObject({ code: "capacity_proof_mismatch" });
  expect(await inspectCapacity()).toMatchObject({ capacityState: "teardown_pending", availableUnits: 0 });
});
it.each(["stale-intent", "wrong-dimension", "post-byte", "post-signal", "post-profile-mutation"])("rejects teardown abort proof after %s evidence", async (kind) => {
  await expect(abortCapacityTeardownWithInvalidEvidence(kind)).rejects.toMatchObject({ code: "non_dispatch_proof_invalid" });
  expect(await inspectCapacity()).toMatchObject({ capacityState: "teardown_pending", availableUnits: 0 });
});
it("authorizes only the new dimensions required by the scoped action", async () => {
  expect(await authorizeLocalExperimentWithNoHints()).toMatchObject({ allowed: true, hintUnitsReserved: 0 });
});
it("serializes the same mutation scope but not independent challenges", async () => {
  expect(await acquireMutationLeaseMatrix()).toMatchObject({ sameScopeConcurrentOwners: 1, independentScopeConcurrentOwners: 2 });
});
it("does not transfer a stale incarnation lease without external stop proof", async () => {
  await expect(revokeMutationLeaseWithoutStopProof()).rejects.toMatchObject({ code: "old_execution_not_stopped" });
});
it("atomically transfers a managed Job/Channel lease only with a current Supervisor permit", async () => {
  expect(await raceManagedTransferWithStaleOwner()).toMatchObject({ acceptedTransfers: 1, activityOwner: newOwner, leaseOwner: newOwner, staleOwnerOperations: 0 });
});
it("serializes every managed Runtime, Browser and Platform mutation with the same resource key", async () => {
  expect(await exerciseManagedMutationMatrix()).toMatchObject({ ownerKinds: ["job", "channel", "http_session", "listener", "browser", "platform"], sameScopeConcurrentOwners: 1, differentChallengeConcurrentOwners: 2 });
});
it("does not release a long Job mutation lease when job.start returns", async () => {
  expect(await inspectRunningMutationJob()).toMatchObject({ jobRunning: true, leaseState: "active", competingBrowserActions: 0 });
});
it.each(["channel", "http_session", "listener"])("holds a %s mutation lease through service terminal", async (kind) => {
  expect(await inspectManagedNetworkActivity(kind)).toMatchObject({ rpcReturned: true, leaseState: "active", competingPlatformDispatches: 0, releasedAfterTerminalProof: true });
});
it("does not finish a managed lease with a cross-kind or stale-generation proof", async () => {
  await expect(finishJobLeaseWithChannelProof()).rejects.toMatchObject({ code: "managed_terminal_proof_mismatch" });
  await expect(finishJobLeaseWithStaleGenerationProof()).rejects.toMatchObject({ code: "managed_terminal_proof_mismatch" });
  expect(await inspectJobMutationLease()).toMatchObject({ leaseState: "active" });
});
it.each(["stop-proof-missing", "model-unsettled", "tool-unsettled"])("withholds recovered Worker terminal proof when %s", async (missing) => {
  expect(await attemptRecoveredWorkerProof(missing)).toMatchObject({ proofIssued: false, capacityState: "teardown_unknown" });
});
it.each(["after-accept", "after-downstream-commit-before-bridge-response", "during-protected-dispatch", "detached-job"])("reconciles stopped Bridge call crash %s before Worker proof", async (point) => {
  expect(await reconcileStoppedBridgeCall(point)).toMatchObject({ unsettledToolCalls: 0, detachedActivitiesStillLeased: point === "detached-job" ? 1 : 0, protectedUnknownsQuarantined: point === "during-protected-dispatch" ? 1 : 0, recoveredWorkerProofIssued: true });
});
it("completes a stopped Bridge call as returned when Runtime confirmation committed first", async () => {
  expect(await reconcileStoppedBridgeAfterRuntimeConfirmation()).toMatchObject({ bridgeState: "returned", returnedCallIds: [expectedCallId], unknownToolCallIds: [], resultRef: expectedResultRef, responseBytes: expectedFramedResponseBytes, terminalSequence: expectedTerminalSequence, recoveredWorkerProofIssued: true });
});
it("withholds stopped-Worker proof rather than downgrading a corrupt confirmed Runtime result", async () => {
  expect(await reconcileStoppedBridgeWithCorruptRuntimeResponse()).toMatchObject({ code: "canonical_runtime_response_corrupt", bridgeState: "accepted", unknownToolCallIds: [], recoveredWorkerProofIssued: false });
});
it.each(["broker_confirmation", "broker_response_limit_exceeded", "runtime_transport_unresolved"])("makes exact %s terminal writer retry idempotent after a response-loss crash", async (kind) => {
  expect(await retryRuntimeEvidenceWriteAfterCommit(kind)).toMatchObject({ canonicalEvidenceRows: 1, returnedEvidenceSequences: [expectedEvidenceSequence, expectedEvidenceSequence], terminalTransitions: 1, resolutionReads: 2 });
});
it.each(["before-evidence-record", "after-evidence-record-before-return"])("resolves Runtime reconciliation only from the operation's canonical row across %s", async (point) => {
  expect(await crashRuntimeEvidenceWriter(point)).toMatchObject({ callerEvidenceAccepted: 0, terminalBeforeCanonicalEvidence: false, canonicalEvidenceRows: point === "after-evidence-record-before-return" ? 1 : 0, terminalTransitions: point === "after-evidence-record-before-return" ? 1 : 0 });
});
it("returns awaiting_evidence without settlement, quarantine release or broker I/O", async () => {
  expect(await resolveRuntimeOperationBeforeEvidence()).toMatchObject({ status: "awaiting_evidence", canonicalTransitions: 0, reservationSettled: false, brokerRequests: 0 });
});
it.each(["missing-sequence", "wrong-owner", "wrong-scope", "wrong-generation", "wrong-managed-transport", "changed-response", "changed-reason", "wrong-producer-port"])("rejects a corrupt or competing %s Runtime producer row", async (kind) => {
  expect(await corruptRuntimeProducerRowForTest(kind)).toMatchObject({ resolved: false, canonicalTransitions: 0, reservationSettled: false, quarantineReleased: false });
});
it("returns the exact committed Runtime response and result ref from a fresh State port", async () => {
  expect(await resolveCommittedRuntimeResponseFromFreshProcess()).toMatchObject({ status: "resolved", responseBytes: expectedFramedResponseBytes, resultRefs: [expectedResultRef, expectedResultRef], terminalSequences: [expectedTerminalSequence, expectedTerminalSequence], brokerRequests: 1, canonicalTransitions: 1 });
});
it.each(["missing", "digest-mismatch"])("fails closed on a %s Runtime response row instead of inferring unknown", async (kind) => {
  expect(await resolveRuntimeOperationWithCorruptResponse(kind)).toMatchObject({ code: "canonical_runtime_response_corrupt", bridgeTransitions: 0, recoveryProofIssued: false });
});
it("records an oversized broker response as unknown without retaining bytes or creating a result ref", async () => {
  expect(await exceedRuntimeResponseLimitByOne()).toMatchObject({ observedBytes: 1_048_577, retainedResponseBytes: 0, responseRefs: 0, effectState: "unknown", reservationState: "unknown", quarantineInstalled: true, terminalTransitions: 1 });
});
it.each(["after-accept", "after-atomic-downstream-link", "after-completion-before-response"])("persists canonical Bridge writer state across %s", async (point) => {
  expect(await crashCanonicalBridgeWriter(point)).toMatchObject({ acceptedRows: 1, unlinkedStartedDownstreams: 0, duplicateDownstreams: 0, recoverableTerminalRows: 1 });
});
it("deduplicates an authenticated invocation retry from a fresh Bridge process without caller IDs", async () => {
  expect(await retryToolInvocationFromFreshBridge()).toMatchObject({ acceptedRows: 1, callIds: [expectedCallId, expectedCallId], toolCallIds: [expectedToolCallId, expectedToolCallId], downstreamOperationIds: [expectedOperationId, expectedOperationId], duplicateDownstreams: 0 });
});
it("rejects changed request bytes under the same authenticated invocation key", async () => {
  expect(await replayInvocationWithChangedRequest()).toMatchObject({ code: "bridge_invocation_conflict", acceptedRows: 1, downstreamStarts: 0 });
});
it("does not finish a Browser mutation activity with an open tracked request", async () => {
  await expect(finishBrowserLeaseWithLiveFetch()).rejects.toMatchObject({ code: "browser_activity_not_quiescent" });
  expect(await inspectBrowserMutationLease()).toMatchObject({ leaseState: "active", competingPlatformDispatches: 0 });
});
it("distinguishes absent optional activity from a missing whole metric group", async () => {
  const events = [];
  expect(projectMetrics({ events, coverage: noCompactionCoverage() }).compactionMs.status).toBe("not_applicable");
  expect(projectMetrics({ events, coverage: completedCompactionCoverage() }).compactionMs.status).toBe("missing");
});
```

In `state-ports.type-test.ts`, import only `@ctf/state` and prove a matching method shape has no authority:

```ts
import type { BridgeStateCommands, BridgeStatePort } from "@ctf/state";
declare const structuralBridgeWriter: BridgeStateCommands;
if (false) {
  // @ts-expect-error Complete commands still lack the unexported State authority.
  const forgedBridgeWriter: BridgeStatePort = structuralBridgeWriter;
  void forgedBridgeWriter;
}
```

Repeat the same command-complete `@ts-expect-error` assignment for every exported `*StateCommands`/`*StatePort` pair. Each structural value must already satisfy every public method, parameter and return type, so removing the hidden authority makes every directive unused and fails typecheck; a missing method may not be the reason any assertion passes.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npm test -- packages/state/test packages/artifacts/test`

- [ ] **Step 3: Implement WAL SQLite state and content-addressed publication**

Implement expected-sequence writes, transactional outbox, run lock and temp-write/fsync/rename publication only behind `StateKernel`. Bind lifecycle issuance and stop recording to the injected nominal `LauncherAuthorityClient`: resolve the opaque capability/proof, compare a stop against its explicit prior `RunLifecycleBinding`, derive and persist the verified tuple, and expose no scalar-identity overload. Define every nominal port as its complete command interface plus the runtime authority, then mint frozen closures only inside `internal/compose-state.ts`; public exports contain neither kernel/open-store functions nor generic mutation. The test-support authority probe must reject a command-complete structural fake with `state_port_authority_required`, proving runtime authority rather than a missing method. Issue `StateStopBinding` only from the canonical subject-bound stop row. Keep mutable job stream bytes outside canonical evidence until Task 6 passes a fixed byte range to `ArtifactStatePort.publishArtifact`.

Persist the predecessor stop/revocation link with each successor lifecycle issuance. Before succession, `PlatformStatePort.reconcileStoppedOwnerInstance` may consume only a current successor's authenticated retryable-List observation against a State-issued stopped-owner recovery ref. Active evidence restores the unchanged A-owned row to occupied; stopped evidence releases it. This path cannot issue a mutation permit, revise ownership or send a protected effect, and exact observation retry is idempotent.

`succeedInstanceLifecycleOwner` runs one expected-sequence transaction keyed by reservation, prior owner sequence, stop and successor: verify the exact occupied row, stop against its owner binding, current same-run successor/descendant lineage, fenced old lifecycle/grants, no old-owner nonterminal lease or prepared/waiting/dispatching effect on the instance scope, then append one succession event and update only lifecycle binding, derived owner and owner sequence. It creates no Platform outbox request, grant row, reservation, activation/occupancy/teardown row, proof, generation or lease. Exact retry returns the same ref; stale prior ref, changed successor/stop, terminal/non-occupied phase or incomplete barrier changes nothing.

- [ ] **Step 4: Implement the shared BudgetLedger with separate consumable and capacity state machines**

Map each dimension to the Task 2 semantics table. `authorizeDispatch` atomically checks only `requiredNewUnits` in the request scope plus the caller's already-owned capacity refs and required occupancy state. For `instances`, validate and persist the exact lifecycle/Coordinator authorization snapshot separately, resolve the same-incarnation current `RunLifecycleBinding`, and derive the reservation owner only from that lifecycle binding; never transfer instance ownership to an execution. `cancelUndispatchedConsumption` accepts only a matching dispatch-phase proof for a reserved consumable. `beginCapacityActivation` durably binds reservation, owner, resource generation and activation kind before local activation or remote Start bytes; `occupyCapacity` accepts only matching active proof. `cancelCapacityActivation` accepts an activation-phase proof for `reserved|activating`; a direct reserved cancellation cites the canonical reservation sequence and requires absence of an activation/action record. `beginCapacityTeardown` records shutdown/Close intent before external action. Failure to determine activation becomes `activation_unknown`; failure to determine teardown becomes `teardown_unknown`. Reconciliation uses matching active proof to restore `teardown_pending` or either unknown phase to `occupied`, `abortCapacityTeardown` restores `teardown_pending` only from a matching teardown proof, and a dimension-matched terminal input releases capacity. Each transaction compares proof phase, operation, reservation, dimension, owner, generation, phase-record sequence and issuer with the canonical effect/activity and first-byte/action-start ledger; reject stale/cross-phase/wrong-dimension evidence and any later transport byte, process signal, ingress-close, profile mutation or external action. Preserve every phase across recovery and count all capacity states except `cancelled_not_dispatched|released` against the limit. Return the same transition for the same key/payload and reject changed identity.

Instance occupancy, active/stopped reconciliation, Close preparation/final dispatch and release additionally compare `lifecycleOwnerSequence`. Succession never changes occupied-unit counts or availability. If succession races stopped release, exactly one expected-sequence transition wins; the loser sees stale owner sequence or terminal capacity and cannot revive or free the row.

- [ ] **Step 5: Implement canonical execution bindings, Bridge-call writes and mutation leases**

Persist pending/completed unbound-session allocations before and after OpenCode session creation. At bind or handoff, atomically compare canonical non-null challenge, run/incarnation/task/role/responsibility/attempt/lease/reservation identity and refuse any expansion or copied session. For every Bridge request, accept only a server-derived stable invocation key plus current binding and request identity. Allocate the call/tool/operation/downstream IDs in State; exact replay returns them unchanged and changed bytes conflict. Expose acceptance/completion/resolution only on the Bridge facade. `resolveBridgeCall` verifies the current execution and exact allocated link, reads a service terminal projection through hidden kernel code, and writes only the matching Bridge returned/failed row; it cannot produce or mutate downstream terminal state. Expose each downstream kind only through its own atomic `prepareLinked*` command, which creates the prepared effect/activity and link together; there is no link-only writer. Reserve detached/unknown transitions to the Recovery facade.

Acquire mutation ownership by `MutationScopeKey`, persist operation plus the exact execution/run-lifecycle `MutationOwner`, and reject or wait on a held overlapping scope regardless of whether the owner is a Job, Channel, HTTP session, Listener, Browser or Platform effect. `activateManaged` issues the permit consumed by Tasks 6/7/10 and holds it through matching terminal activity evidence. For Job/Channel handoff, validate the one Supervisor permit and atomically update canonical activity plus lease owner without releasing/reacquiring the scope. Decode `ManagedMutationFinishInput` by activity kind; validate the service issuer, canonical activity/owner/scope/lease/generation/terminal sequence and all kind-specific in-flight counters. A `lost` managed activity releases only after its covering `StateStopBinding` while recording that remote state needs fresh observation. `markDispatching(lease.id, context)` performs the final State precondition, recomputed request identity, payload identity, reservation and owner check in the same transaction that marks a protected effect dispatching.

For instance succession, `revokeRunLifecycleBinding` first fences new old-owner grant resolution, mutation acquisition and `markDispatching`; existing old-owner effects/leases must then become terminal, cancelled or durably unknown with quarantine before succession. Never rewrite an old lease owner. B receives the new occupied ref and must resolve fresh network authority and acquire a fresh mutation lease; retained quarantine continues to block unsafe dispatch.

For Runtime effects, persist in-limit broker confirmation or limit overflow only through `MeteredBrokerStatePort`, and unresolved transport only through `ProtectedDispatchStatePort`; every writer looks up the exact dispatch/first-byte rows. The confirmation transaction stores the framed response, digest and immutable response/result refs, settles the reservation, marks confirmed, finishes the protected mutation and assigns evidence/terminal sequences before returning. Limit overflow and unresolved transport instead atomically mark unknown and install quarantine before finishing the lease. `resolveRuntimeProtectedReconciliation(operationId)` is then a read-only terminal lookup; exact fresh-process or concurrent calls return the same resolution without broker I/O, absence is `awaiting_evidence`, and corrupt/missing bytes fail closed. Make exact post-commit retries idempotent and reject competing terminal evidence or any changed sequence/response/reason. Revoke an old incarnation only with its State stop binding.

After fail-stop, consume Task 4's model reconciliation and run `RecoveryStatePort.reconcileStoppedBridgeCalls` with the same `StateStopBinding` before `proveRecoveredWorkerTerminal`. Start only from Bridge accept/complete rows and service-specific atomic downstream links. Resolve each link first: a confirmed Runtime terminal row completes the Bridge call as returned with its exact result ref; a canonical Runtime unknown becomes terminal-unknown; a durable managed activity becomes detached; and only an unlinked call or a linked operation still genuinely nonterminal after its producer is covered by the stop binding takes conservative terminal-unknown fallback. Canonical response corruption aborts the recovery transaction and withholds Worker proof instead of downgrading confirmation. Verify both accounting sequences and current zero-unsettled state before issuing the recovery proof. Unknown model usage remains charged; unknown protected effects remain quarantined; detached managed activity remains under its own lease. Never manufacture this proof from elapsed time, session absence or process death alone.

- [ ] **Step 6: Implement canonical metric and intervention event storage**

Use the injected `MetricClock`, explicit producer and correlation IDs. Artifact publication emits start/completion, wait duration and hash/I/O byte events; reject completion pairs whose ticks use different clock domains unless the owning producer supplied `durationMs`. Build `MetricCoverageSnapshot` from canonical run/task/job/effect/compaction/recovery business records at the requested sequence and implement `projectMetrics` here so M1 and reporting use the same reducer. Do not infer coverage from the presence of metric events: reconstruct exact fake-clock durations from raw inputs, report a missing whole producer group when business activity exists, and emit N/A only from terminal canonical non-occurrence.

- [ ] **Step 7: Verify crash points, ledgers, leases, metric clocks and integrity scan**

Run: `npm test -- packages/state/test packages/artifacts/test && npm run typecheck`

Expected: every injected crash leaves either no reference or a fully readable hash-verified artifact; no production import or runtime caller can obtain generic State mutation, test Launcher authority, or another service's writer facade; copied/stale/released Launcher lock capabilities and fabricated/stale/cross-subject stop proofs issue no State authority; session binding rejects null/changed challenge, role or responsibility identity; concurrent reservations cannot overspend; dispatch-phase consumables and activation/teardown capacity use only their matching non-dispatch APIs; active/no-byte/stopped evidence restores or releases the exact phase while stale/cross-phase/wrong-dimension/post-action proof fails; confirmed teardown reuses capacity without refunding consumables; a fresh-Bridge exact invocation retry reuses State-allocated IDs while changed bytes conflict; every externally started downstream has an atomically prepared linked accepted row and recoverable terminal state; cross-kind/stale/non-quiescent proofs release no lease or capacity; recovered Worker proof requires State-authenticated stop plus model and Bridge accounting; same-scope managed/Platform mutation owners never overlap or release on RPC return; stale incarnations cannot dispatch; metric/intervention events retain producer, clock-domain and correlation data; sequence-aligned coverage distinguishes N/A from a missing complete producer group.

Instance-specific acceptance: exact A-to-B succession preserves one reservation, one occupancy proof, capacity counts, generation, challenge and authorization history; advances one owner sequence/event; rejects every non-occupied phase and incomplete old-owner barrier; and makes stale A/B refs, observations, Close dispatch and terminal evidence fail before state or Platform mutation.

- [ ] **Step 8: Commit if authorized**

Suggested message: `feat: add canonical state and artifact stores`.

### Task 4: Enforce identity, scope, capability and model-data policy

**Files:**
- Create: `packages/policy/package.json`
- Create: `packages/policy/src/gateway.ts`, `session-bindings.ts`, `scope.ts`, `capabilities.ts`, `data-classification.ts`, `model-gateway.ts`, `dispatch-quiescence.ts`, `grant-authority.ts`
- Test: `packages/policy/test/identity.test.ts`, `scope.test.ts`, `bound-context.type-test.ts`, `model-data.test.ts`, `secret-boundary.test.ts`, `model-budget.test.ts`, `grant-authority.test.ts`

**Interfaces:**
- Consumes: `ReleaseProfile` from Task 1; current `ExecutionBinding`, release-owned `RoleResponsibilityPolicy`/`RoleToolPolicy` and Task 2's `NetworkGrantRequest`/`NetworkGrantExpectation`/`NetworkGrantRecord` data contracts; and only Task 3's nominal `PolicyStatePort`, including its named grant commands. There is no generic `ScopeGrant` or `CapabilityProfile`: execution scope comes from the exact State binding, static capability policy comes from the validated release-profile digest plus release-owned role policies, and network authority comes only from canonical grant resolution.
- Produces: nominal `BoundToolContext { execution: ExecutionBinding, releaseProfileDigest, workspaceScope, allowedToolNames: ManagedToolName[], networkGrantSetIds, issuedSequence, issuer: "policy" }`, with an unexported runtime authority and no public constructor; `ToolRequest` as the closed managed-tool/action union; `AuthorizationDecision = { allowed: true, execution, effectiveResponsibility, scope } | { allowed: false, code }`; and `DataDecision = { allowed: true, classification } | { allowed: false, code }`. `bindToolContext(binding, releaseProfile): Promise<BoundToolContext>` revalidates the entire current occupied binding through `PolicyStatePort`, derives scope/capabilities from that binding, Task 2's frozen role policies and the immutable release profile, and rejects stale/released/fabricated identity or profile drift before issuing context. `authorizeTool(context, request)` verifies the nominal authority and current issuance sequence, ignores caller identity/capability claims, and intersects the role/responsibility policy, managed-tool allowlist, workspace scope and current network grants fail closed.
- Produces: `classifyModelPayload(parts: ModelPart[]): DataDecision`, `createModelGateway(config): ModelGateway`, `registerSession(binding)`, `quiesceExecution(binding): Promise<ModelDispatchQuiescenceProof>`, `reconcileStoppedExecution(binding, stop: StateStopBinding): Promise<ModelDispatchRecoveryResult>`, `revokeLease(leaseId)`. Normal quiescence closes new provider ingress for that binding, waits for every dispatched request to reach response/error/transport-terminal unknown accounting, and reports `openModelRequests: 0`; fail-stop reconciliation first asks State to validate the stop binding against the exact execution, prevents new ingress, converts each accepted request lacking a response/error into durable `transport_terminal_unknown`, conservatively settles usage, and reports the canonical request IDs/accounting sequence consumed by Task 3. Neither path kills detached Runtime Jobs.
- Produces: `ModelGateway.dispatch(input): Promise<ModelResponse>` where State-generated `ModelRequestId` and `ModelResponseId` bind the originating run/session/task, consumed refs, fixed model config and provider usage. Only this trusted boundary may create the model portion of Task 2 `ActionProvenance`.
- Produces nominal non-serializable `NetworkGrantHandle { grantSetId, issuedSequence }`, `ResolvedNetworkGrant { grantSetId, validationSequence, revocationSequence, expectedConsumer, allowedEndpoints, mode, managedTransportId? }`, `NetworkGrantInvalidation { grantSetId, validationSequence, reason: "revoked" | "expired" | "generation_changed" | "incarnation_changed" }`, `NetworkGrantInvalidationSubscription { close(): void }`, complete public `NetworkGrantResolverCommands { resolve(grant: NetworkGrantHandle | GrantSetId, expected: NetworkGrantExpectation): Promise<ResolvedNetworkGrant>; subscribeInvalidation(resolution: ResolvedNetworkGrant, listener: (event: NetworkGrantInvalidation) => void): NetworkGrantInvalidationSubscription }`, and `NetworkGrantResolver = NetworkGrantResolverCommands &` one unexported runtime authority brand. Handles, resolutions and resolver have no public constructor; the subscription only closes its authenticated stream and grants no resolution authority. Also produces `issueNetworkGrantSet(binding, input: NetworkGrantRequest): Promise<NetworkGrantHandle>` and `revokeNetworkGrantSet(grantSetId, nextRevocationSequence)`. Task 4 authorizes the control caller, delegates every write/read to the named `PolicyStatePort` commands, mints a local handle/resolution only for the exact returned record, and never returns a caller-trusted `NetworkGrantRecord` as authority. Across IPC, Runtime/Browser/egress identify themselves on the authenticated control channel and submit only `GrantSetId` plus `NetworkGrantExpectation`; the resolver calls State and returns a nominal `ResolvedNetworkGrant` only on an exact current match. Revocation/generation/incarnation changes invalidate future resolution and actively close installed routes/handles through the subscribed owning service. Model/data content cannot issue or expand grants.

**Depends on:** Tasks 2-3.

- [ ] **Step 1: Write failing impersonation, scope and secret tests**

```ts
it("ignores model-supplied task identity", () => {
  expect(authorizeTool(boundContext, { claimedTaskId: "other", path: "work/a" })).toMatchObject({ allowed: true, execution: { taskId: boundContext.execution.taskId } });
});
it("rejects a responsibility outside the immutable session binding", () => {
  expect(authorizeTool(boundContext, { responsibility: "verifying", path: "work/a" })).toMatchObject({ allowed: false, code: "responsibility_not_bound" });
});
it.each(["structural-context", "stale-binding", "released-binding", "changed-profile-digest", "expanded-tool-set"])("rejects %s at the tool policy boundary", async (kind) => {
  expect(await authorizeWithInvalidBoundContext(kind)).toMatchObject({ allowed: false, policyRowsChanged: 0, toolDispatches: 0 });
});
it("blocks bulk artifacts and control secrets from every provider route", async () => {
  await expect(sendVia("compaction", controlSecretPart())).rejects.toMatchObject({ code: "model_data_denied" });
});
it.each(["turn", "retry", "summary", "compaction", "subagent", "multimodal"])("charges %s to its originating run", async (route) => {
  expect(await chargeProviderRoute(route)).toMatchObject({ reservationRunId: originalRunId, unmeteredCalls: 0 });
});
it("cancels model tokens only when the provider first-byte ledger proves no dispatch", async () => {
  expect(await failProviderBeforeFirstByte()).toMatchObject({ providerBytes: 0, proofIssuer: "model_gateway", reservationState: "cancelled_not_dispatched" });
});
it("allows a model turn that needs tokens when an unrelated Hint budget is zero", async () => {
  expect(await dispatchModelWithZeroHints()).toMatchObject({ dispatched: true, hintReservations: 0 });
});
it("rejects a network grant from an untrusted control-plane caller", async () => {
  await expect(issueNetworkGrantSet(modelSession, grantRequest())).rejects.toMatchObject({ code: "grant_issuer_denied" });
});
it.each(["structural-handle", "copied-id", "revoked", "expired", "wrong-service", "wrong-challenge", "wrong-generation", "wrong-managed-transport", "prior-incarnation"])("rejects %s network grant at consumer resolution", async (kind) => {
  expect(await resolveInvalidNetworkGrant(kind)).toMatchObject({ resolved: false, networkActivations: 0, installedRoutes: 0 });
});
it("resolves one canonical grant only for its authenticated expected consumer", async () => {
  expect(await issueAndResolveNetworkGrant()).toMatchObject({ canonicalGrantRows: 1, nominalHandles: 1, expectedConsumerResolutions: 1, otherConsumerResolutions: 0 });
});
it("rejects a released Worker binding and accepts only a newly capacity-backed continuation binding", async () => {
  expect(await dispatchAcrossContinuationRebind()).toMatchObject({ oldSessionDispatches: 0, newSessionDispatches: 1, newWorkerReservations: 1 });
});
it("does not issue model quiescence proof while a provider dispatch is in flight", async () => {
  expect(await quiesceDuringDelayedProviderResponse()).toMatchObject({ proofBeforeTerminal: false, newRequestsAfterQuiesce: 0, openModelRequestsAtProof: 0 });
});
it("accounts an in-flight provider request as charged terminal-unknown after proved process stop", async () => {
  expect(await reconcileKilledProviderDispatch()).toMatchObject({ stopProofValidated: true, unsettledModelRequests: 0, unknownUsageCharged: true, newProviderRequests: 0 });
});
```

In `bound-context.type-test.ts`, import only the package public entrypoint and make every structural value field/method-complete before testing the hidden authority:

```ts
import type { BoundToolContext, NetworkGrantHandle, NetworkGrantResolver, NetworkGrantResolverCommands, ResolvedNetworkGrant } from "@ctf/policy";

declare const structuralBoundContext: {
  execution: BoundToolContext["execution"];
  releaseProfileDigest: BoundToolContext["releaseProfileDigest"];
  workspaceScope: BoundToolContext["workspaceScope"];
  allowedToolNames: BoundToolContext["allowedToolNames"];
  networkGrantSetIds: BoundToolContext["networkGrantSetIds"];
  issuedSequence: BoundToolContext["issuedSequence"];
  issuer: "policy";
};
declare const structuralGrantHandle: { grantSetId: NetworkGrantHandle["grantSetId"]; issuedSequence: NetworkGrantHandle["issuedSequence"] };
declare const structuralResolution: {
  grantSetId: ResolvedNetworkGrant["grantSetId"];
  validationSequence: ResolvedNetworkGrant["validationSequence"];
  revocationSequence: ResolvedNetworkGrant["revocationSequence"];
  expectedConsumer: ResolvedNetworkGrant["expectedConsumer"];
  allowedEndpoints: ResolvedNetworkGrant["allowedEndpoints"];
  mode: ResolvedNetworkGrant["mode"];
  managedTransportId?: ResolvedNetworkGrant["managedTransportId"];
};
declare const structuralResolver: NetworkGrantResolverCommands;

if (false) {
  // @ts-expect-error Complete context data still lacks Policy authority.
  const forgedContext: BoundToolContext = structuralBoundContext;
  // @ts-expect-error Complete handle data still lacks grant authority.
  const forgedHandle: NetworkGrantHandle = structuralGrantHandle;
  // @ts-expect-error Complete resolution data still lacks grant authority.
  const forgedResolution: ResolvedNetworkGrant = structuralResolution;
  // @ts-expect-error Complete resolver commands still lack resolver authority.
  const forgedResolver: NetworkGrantResolver = structuralResolver;
  void [forgedContext, forgedHandle, forgedResolution, forgedResolver];
}
```

Each structural declaration spells every documented public field or method without importing an authority symbol. Each directive must fail only on the hidden brand, never a missing public member.

- [ ] **Step 2: Run tests and confirm policy is absent**

Run: `npm test -- packages/policy/test`

- [ ] **Step 3: Implement fail-closed policy and local provider proxy**

Mint `BoundToolContext` only after nominal State validation of the whole occupied execution and release-profile digest; freeze it, keep its constructor/authority internal, and compare its issuance sequence on every tool authorization. Do not add a second generic scope/capability grant: workspace and role scope derive from the binding/profile, while target network access requires a current nominal `ResolvedNetworkGrant` obtained for that exact consumer. Implement the field-complete structural context, handle, resolution and `NetworkGrantResolverCommands` assignments above so each fails only on its hidden authority. The gateway alone receives provider credentials; before every turn/retry/compaction/summary/subagent/multimodal dispatch it validates the entire current `ExecutionBinding`, including non-null challenge, role and immutable responsibility set, and its occupied Worker reservation, then calls `authorizeDispatch` with only required token units/scope. A quiescing/released/terminal attempt or unbound responsibility is rejected. Commit canonical provider intent and first-byte records around transport. If canonical state reaches `failed_not_dispatched` with no first byte, Gateway issues exact `ModelConsumableNonDispatchProof` and calls `cancelUndispatchedConsumption`; after any byte it settles known usage or conservatively charges unknown usage and cannot cancel. `quiesceExecution` closes ingress before waiting and treats transport-terminal unknown as charged. Fail-stop reconciliation requires the matching State stop binding, closes ingress, classifies every unfinished accepted dispatch as terminal unknown, settles conservatively and returns accounting sequence. Emit correlated metrics, keep logs redacted and enforce payload limits including anti-splitting.

- [ ] **Step 4: Implement authenticated network-grant issuance and revocation**

Accept only the bound Supervisor/Policy control identity; persist issuance and monotonic revocation through `PolicyStatePort`, and bind every record to run, incarnation, challenge, service, generation, managed transport and expiry. A local nominal handle contains no grant body; every network activation resolves it, or its ID over authenticated IPC, against canonical State and the authenticated expected consumer. Propagate revoke/generation/incarnation invalidation to installed connections/routes. Never derive a grant from model output, challenge data or an endpoint returned outside the Platform/Policy path.

- [ ] **Step 5: Verify policy, grants, budget denials and redacted logs**

Run: `npm test -- packages/policy/test && npm run typecheck`

Expected: all bypass fixtures fail; no structural/stale/released/profile-drifted context gains tool authority; no structural/forged/revoked/expired/wrong-consumer grant reaches Runtime, Browser or egress; grant issue/resolve/revoke rows are canonical and monotonic; execution/profile/network sources remain distinct and there is no undefined generic grant path; two sessions cannot spend the same final token allowance; every provider path is attributed to its original run; no fixture secret appears in captured logs or child environments.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: enforce session scope and model data policy`.

### Task 5: Build the OpenCode 1.19.0 bridge and plugin contract

**Files:**
- Create: `packages/opencode-bridge/package.json`
- Create: `packages/opencode-bridge/src/server.ts`, `client.ts`, `sessions.ts`, `action-provenance.ts`, `contract-probe.ts`, `trusted-config.ts`
- Create: `apps/opencode-plugin/package.json`, `apps/opencode-plugin/src/index.ts`
- Create: `config/opencode/opencode.jsonc`, `config/opencode/agents/ctf-coordinator.md`, `config/opencode/agents/ctf-worker.md`, `config/opencode/agents/ctf-verifier.md`
- Test: `tests/contract/opencode-1.19.test.ts`, `tests/contract/opencode-config-isolation.test.ts`, `tests/integration/opencode-session-binding.test.ts`

**Interfaces:**
- Consumes: Task 4 session/policy/Model Gateway APIs, only Task 3's nominal `BridgeStatePort` plus Bridge-owned Worker budget commands, and OpenCode `ToolContext.sessionID`.
- Produces: `resolveTrustedOpenCodeConfig(releaseRoot): TrustedOpenCodeLaunchConfig` and `startOpenCodeServer(config: TrustedOpenCodeLaunchConfig): Promise<OpenCodeHandle>`; config pins a read-only release-owned root, isolated home/global-config directories and challenge workspace as data only.
- Produces: role-keyed `MANAGED_CTF_TOOL_ALLOWLIST` whose only possible names are `ctf_workspace`, `ctf_job`, `ctf_channel`, `ctf_http_session`, `ctf_listener`, `ctf_browser`, `ctf_artifact`, `ctf_candidate`, `ctf_platform_intent`, `ctf_reference`; Worker/Verifier omit `ctf_platform_intent`, and action-level server policy further restricts Verifier mutations. Also produces `allocateSession(input: { allocationKey: SessionAllocationKey, reservation: ExecutionReservation }): Promise<UnboundSessionAllocation>`, first-occupancy `activateBoundSession(binding: ExecutionBinding): Promise<{ session: BoundSession, occupancy: WorkerActivationProof }>`, `prepareSessionHandoff(currentBinding, replacement: UnboundSessionAllocation): Promise<SessionHandoffProof>`, `activateReplacementSession(replacementBinding, proof): Promise<BoundSession>`, `deactivateBoundSession(binding: ExecutionBinding, reason): Promise<WorkerTerminalProof>`, `sendTurn(sessionId, parts)`, `compactSession(sessionId)`, and authenticated loopback `POST /v1/tools/:tool`. Allocation first calls Task 3 `beginSessionAllocation` with the canonical reservation, creates/retries one inert OpenCode session by allocation key, then calls `completeSessionAllocation`; it conflicts on any changed run/challenge/incarnation/task/role/responsibility/attempt/lease/reservation identity and creates no model/tool authority. Only Task 11 invokes Task 3 `bindExecutionSession`/`replaceExecutionSession`. First activation validates the whole current binding, durably begins Worker-capacity activation, enables the session with provider/tool dispatch still gated, then records matching occupancy before returning. Same-capacity handoff closes old-session model/tool ingress, combines Task 4 quiescence with zero accepted Bridge calls, binds the exact inert replacement allocation in `SessionHandoffProof`, and never changes occupied capacity; after Task 11 atomically swaps the binding, only the replacement opens. Deactivation begins Worker-capacity teardown and issues the exact normal terminal proof only after quiescence; detached Jobs remain independent. Task 14 uses first activation only after continuation capacity is reacquired; Task 17 uses the handoff path.
- `MANAGED_CTF_TOOL_ALLOWLIST` is a frozen projection of Task 2 `RoleToolPolicy` and uses only `ManagedToolName`; Task 4 derives `BoundToolContext` from that same Task 2 policy rather than importing Task 5, so Bridge and Policy cannot drift or create a dependency cycle.
- Produces: `registerModelResponse(response): Promise<BoundModelResponse>`, `deriveToolInvocationKey(context: ToolContext | AuthenticatedControlContext): Promise<ToolInvocationKey>`, and `resolveActionProvenance(context): Promise<ActionProvenance>`. The contract probe must establish an authenticated OpenCode invocation identity that is stable when OpenCode retries after Bridge response loss; Bridge derives the key from that identity plus the current session/binding rather than tool arguments or process memory. Deterministic controller and harness callers use their own authenticated idempotency-key namespace. State allocates `ToolCallId` at Bridge acceptance and binds it to the observed Task 4 response/session/task and consumed refs; tool arguments cannot claim origin or supply invocation/call IDs.
- Produces: canonical Bridge call records only through the injected `BridgeStatePort`. Before forwarding an authenticated tool call, Bridge derives the stable invocation key and calls `acceptBridgeCall` without a caller-selected call/operation/activity ID. State returns the same allocated IDs/refs for exact replay under the same binding and rejects changed bytes. Bridge then calls `resolveBridgeCall` for that canonical call: an existing returned/failed row replays its typed payload/error; an accepted link whose service terminal row is already confirmed/unknown is atomically completed returned/failed by State; `pending` alone permits resume/observation of that exact downstream operation. Thus Task 5 requires no Task 7 import or Runtime dispatcher dependency. If accepted and unlinked, Bridge prepares only the preallocated ref. Bridge passes `BridgeDispatchContext { callId, allocatedDownstreamRef }` to the selected downstream service; that service invokes only its own State facade's `prepareLinked*` command, atomically creating the canonical prepared effect/activity and Bridge link before external action. On a synchronous result Bridge calls `completeBridgeCall` with the exact typed result ref before replying. It cannot write detached/unknown or downstream terminal states, persist caller-supplied response bytes, or turn `awaiting_evidence` into failure/success; `RecoveryStatePort` alone derives detached/unknown states.
- Produces: `proveWorkerDeactivationNotStarted(binding, phaseRecordSequence): Promise<WorkerTeardownNonDispatchProof>`. Bridge records teardown action-start before closing model/tool ingress, signalling or otherwise changing session/process state; only absence of that record for the exact current binding/phase record permits its issuer-bound teardown proof and `abortCapacityTeardown`. Once any shutdown action starts, normal terminal/unknown reconciliation is mandatory.

**Depends on:** Tasks 3-4.

- [ ] **Step 1: Write contract probes for main session, subagent, tool call, retry, compaction, summary and multimodal paths**

```ts
it("derives tool identity from OpenCode ToolContext", async () => {
  expect(await invokePluginTool({ sessionID: boundSession, args: { sessionID: "forged" } })).toMatchObject({ sessionId: boundSession });
});
it.each(["ctf-coordinator", "ctf-worker", "ctf-verifier"])("exposes only the managed allowlist to %s", async (role) => {
  const tools = await exposedTools(role);
  for (const denied of ["bash", "write", "edit", "read", "webfetch", "task"]) expect(tools).not.toContain(denied);
  expect(tools.sort()).toEqual([...MANAGED_CTF_TOOL_ALLOWLIST[role]].sort());
});
it.each(["bash", "write", "edit", "read", "webfetch", "task"])("server-side policy rejects injected unmanaged tool %s", async (tool) => {
  await expect(invokeInjectedTool(tool, { role: "ctf-worker" })).rejects.toMatchObject({ code: "tool_denied" });
});
it.each(["main", "subagent", "reconstructed"])("treats challenge and global OpenCode config as data for %s", async (path) => {
  expect(await runConfigSentinels(path)).toMatchObject({ sentinelsExecuted: 0, addedTools: [], providerChanged: false });
});
it("binds a real model response to its tool call and ignores forged provenance args", async () => {
  expect(await invokeModelToolWithForgedLineage()).toMatchObject({ origin: "model", forgedIdsAccepted: false, responseBoundToCall: true });
});
it("labels a harness-issued call as injection even when it copies model IDs", async () => {
  expect(await invokeHarnessToolWithCopiedIds()).toMatchObject({ origin: "harness_injection" });
});
it.each(["after-accept", "after-atomic-downstream-link", "after-completion-before-response"])("persists recoverable Bridge call lineage across crash %s", async (point) => {
  expect(await crashBridgeToolCall(point)).toMatchObject({ acceptedRows: 1, startedDownstreamsWithoutLink: 0, callsWithoutCanonicalBinding: 0, duplicateDownstreamOperations: 0 });
});
it("reuses State-allocated call and downstream IDs when OpenCode retries into a fresh Bridge process", async () => {
  expect(await retryAuthenticatedToolCallAfterBridgeRestart()).toMatchObject({ callerSuppliedPriorIds: false, invocationKeys: [expectedInvocationKey, expectedInvocationKey], acceptedRows: 1, downstreamOperations: 1, responses: 1 });
});
it("replays an exact canonical Runtime terminal result from a fresh Bridge through BridgeStatePort", async () => {
  expect(await retryCanonicalRuntimeResultAfterBridgeRestart()).toMatchObject({ invocationKeys: [expectedInvocationKey, expectedInvocationKey], acceptedRows: 1, downstreamOperations: 1, bridgeStates: ["returned", "returned"], resultRefs: [expectedResultRef, expectedResultRef], responseBytes: [expectedFramedResponseBytes, expectedFramedResponseBytes], terminalSequences: [expectedTerminalSequence, expectedTerminalSequence], downstreamResumeCalls: 0 });
});
it.each(["missing-response", "digest-mismatch"])("keeps a canonical-corrupt Runtime result unresolved in a fresh Bridge: %s", async (kind) => {
  expect(await retryCorruptRuntimeResultAfterBridgeRestart(kind)).toMatchObject({ code: "canonical_runtime_response_corrupt", bridgeState: "accepted", bridgeTransitions: 0, responseReturned: false });
});
it("rejects changed tool bytes under a replayed authenticated invocation", async () => {
  expect(await retryInvocationWithChangedArgs()).toMatchObject({ code: "bridge_invocation_conflict", downstreamOperations: 0 });
});
it("cannot dispatch from an allocated session before Supervisor binds it", async () => {
  expect(await sendTurnFromUnboundSession()).toMatchObject({ code: "session_not_bound", modelRequests: 0, toolCalls: 0 });
});
it("returns one inert session for a repeated allocation key", async () => {
  expect(await allocateSameSessionKeyAcrossCrash()).toMatchObject({ allocatedSessionIds: [expectedSessionId, expectedSessionId], liveSessions: 1 });
});
it("cannot expand responsibility between session allocation and binding", async () => {
  expect(await bindSessionAfterResponsibilityMutation()).toMatchObject({ bindingWritten: false, dispatchableSessions: 0, code: "session_allocation_identity_mismatch" });
});
it.each(["after-capacity-activation-intent", "after-session-enable-before-occupancy"])("recovers Worker activation crash %s without model/tool dispatch or a second slot", async (point) => {
  expect(await recoverBoundSessionActivation(point)).toMatchObject({ modelRequestsBeforeOccupancy: 0, toolCallsBeforeOccupancy: 0, workerReservations: 1, occupiedWorkersAfterRecovery: 1 });
});
it.each(["model", "tool"])("does not issue Worker terminal proof while a %s dispatch is in flight", async (kind) => {
  expect(await deactivateWithDelayedDispatch(kind)).toMatchObject({ proofBeforeDispatchTerminal: false, newDispatchesAfterTeardownIntent: 0, openModelRequestsAtProof: 0, openToolCallsAtProof: 0 });
});
it("does not issue Worker non-dispatch proof after teardown action-start", async () => {
  expect(await requestWorkerNonDispatchProofAfterIngressClose()).toMatchObject({ proofIssued: false, capacityState: "teardown_pending" });
});
it.each(["model", "tool"])("does not issue session handoff proof while a %s dispatch is in flight", async (kind) => {
  expect(await handoffWithDelayedDispatch(kind)).toMatchObject({ proofBeforeDispatchTerminal: false, replacementDispatchesBeforeSwap: 0, oldDispatchesAfterProof: 0 });
});
it("activates a replacement on the occupied reservation without a second capacity transition", async () => {
  expect(await handoffBoundSession()).toMatchObject({ workerReservations: 1, activationIntents: 1, occupancyProofs: 1, capacityState: "occupied", concurrentlyDispatchableSessions: 1 });
});
it("releases Worker execution while its detached long Job remains managed", async () => {
  expect(await deactivateAfterLongJobStart()).toMatchObject({ workerTerminalProofIssued: true, jobState: "running", jobMutationLeaseState: "active" });
});
it.each(["active", "stopped"])("reconciles unknown Worker teardown as %s", async (outcome) => {
  expect(await reconcileUnknownWorkerTeardown(outcome)).toMatchObject({ capacityState: outcome === "active" ? "occupied" : "released", newWorkerReservations: 0 });
});
```

- [ ] **Step 2: Run probes against pinned OpenCode 1.19.0 and record any public-hook blocker**

Run: `npm test -- tests/contract/opencode-1.19.test.ts tests/contract/opencode-config-isolation.test.ts`

Expected before implementation: FAIL on missing bridge. Probe public configuration-source isolation, identity/data hooks, a stable authenticated invocation identity across response-loss retry into a fresh Bridge process, and the event information needed to bind each tool call to the actual model response. If OpenCode 1.19.0 cannot prevent challenge/global config discovery or establish both durable invocation identity and server-derived response/tool-call lineage for every model capability path, stop with `blocked_opencode_contract` and update the design rather than adding a fork, retaining caller IDs in memory, or trusting tool arguments.

- [ ] **Step 3: Implement the bridge, plugin tools and deny-by-default agent config**

Use a bridge credential injected into the plugin process, never tool args. Start OpenCode outside the challenge directory with the trusted root and isolated config/home environment proven by the contract probe; never copy trusted agent/plugin config into a challenge workspace. Begin the canonical allocation from the whole reservation before creating an inert session, complete it with one idempotent session ID, let Task 11 bind that allocation only after State atomically matches non-null challenge plus role/responsibility identity, and activate it only after reading the binding. First-occupancy activation writes capacity intent, opens no dispatch path before occupancy proof, then opens model/tool ingress. No unbound, activating or merely reserved Worker can dispatch. For each tool call derive its authenticated stable invocation key, use only Bridge accept/resolve/complete commands, and require the selected downstream's service-specific atomic preparation command before external action; never write canonical rows through direct SQL, retain retry IDs or response bytes only in process memory, or infer a missing row. After every replayed acceptance, call `resolveBridgeCall` first. State alone projects the exact linked terminal result, validates any Runtime response ref/digest, and completes or replays the Bridge row; `pending` may resume only the already-linked operation and corruption returns no payload. The Bridge package therefore compiles and its tests run with only Tasks 2-4; Task 7 later supplies real Runtime producer rows and end-to-end broker tests without a reverse package edge. For Task 17 handoff, close old ingress, quiesce model/tool calls, bind the exact inert replacement allocation in the proof, atomically swap through Task 3, and only then open replacement ingress without another capacity activation. Deactivation writes teardown intent and terminal proof after quiescence; uncertain shutdown remains unavailable. Restoring occupied requires revalidating the same full binding/session and reopening ingress explicitly. Detached Runtime ownership remains live. Revoke the binding when Task 11 consumes terminal proof, route every model path through Task 4, and persist response-to-tool provenance before forwarding. Deterministic controller and harness APIs use separate authenticated callers and explicit non-model origins.

For Worker teardown, persist the capacity intent first. If setup fails before any shutdown action, issue the exact `WorkerTeardownNonDispatchProof` and let Task 11 abort the teardown. Otherwise persist action-start before closing ingress or signalling anything; from that sequence onward no non-dispatch proof may be issued, and crash recovery must use active/terminal evidence or `teardown_unknown`.

- [ ] **Step 4: Verify all contract paths**

Run: `npm test -- tests/contract/opencode-1.19.test.ts tests/contract/opencode-config-isolation.test.ts tests/integration/opencode-session-binding.test.ts`

Expected: every path reaches Model Data Gateway and the shared budget ledger; every allocated/bound session preserves exact non-null challenge, role and immutable responsibility set; every accepted tool call has a durable authenticated invocation key, reuses State-allocated IDs after fresh-process retry, rejects changed bytes, and has an atomically prepared downstream link plus terminal/recovery lineage before effect or response; canonical linked Runtime results replay the same Bridge returned state, result ref, terminal sequence and bytes without a Task 7 dependency, while corrupt response storage returns nothing; every tool call resolves immutable identity plus action provenance; forged/copied model IDs cannot upgrade controller or harness actions; forbidden tools and config sentinels remain inert; Worker non-dispatch proof is impossible after teardown action-start; terminal/handoff proof waits for zero in-flight calls; replacement never changes occupied capacity or overlaps sessions; detached Jobs remain independently managed.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: integrate pinned opencode bridge`.

### Task 6: Implement workspace and streaming Job Runtime

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/src/workspace.ts`, `jobs.ts`, `process-tree.ts`, `managed-spawn.ts`, `streams.ts`, `stream-publication.ts`, `pty.ts`, `errors.ts`
- Create: `apps/cli/src/host-launcher.ts`, `apps/cli/src/composition/state.ts`
- Test: `packages/runtime/test/workspace.test.ts`, `jobs.test.ts`, `streams.test.ts`, `stream-publication.test.ts`, `process-tree.test.ts`, `tests/integration/host-launcher-fail-stop.test.ts`

**Interfaces:**
- Consumes: authorized server-side tool context/network grants from Task 4, trusted challenge-workspace/action provenance and current execution binding from Task 5, and only Task 3's nominal `RuntimeStatePort`/`ArtifactStatePort` commands.
- Produces: `workspace.list/read/search/patch/stat/publish`, `job.start(input: JobStartInput, context: { execution: ExecutionBinding, activity: RemoteActivityContext, provenance: ActionProvenance })/status/read/write/cancel/list` and controller-only `job.transfer(jobId, permit: ManagedActivityTransferPermit)`; the start context and transfer permit are injected by Bridge/Supervisor and are not model tool arguments. `job.read(jobId, cursor, maxBytes): JobReadResult` returns `retainedStartCursor`, `nextCursor`, and `running|waiting|eof|lost|cursor_evicted`; `publishJobStreamRange(jobId, start, end): Promise<ArtifactRef>` rejects any evicted gap before calling `ArtifactStatePort.publishArtifact`. For a mutation-capable network Job, Runtime invokes its own facade's named acquire/activate command before process activation and holds it through process terminal, not `job.start` return; caller arguments cannot supply or forge a permit. Transfer validates the exact current activity/source/target/scope/generation and invokes `RuntimeStatePort.transferManaged`; the old owner loses status/write/cancel authority in the same commit.
- Produces: canonical tool action/result events including `workspace.patched`, job dispatch/terminal and observation visibility, each carrying the trusted Task 5 provenance, exact input refs and resulting file/job/artifact identity needed for trajectory lineage. After independently observing the complete process tree terminal and draining Runtime-owned I/O, Job Runtime issues the exact `JobTerminalProof` with canonical job/process/owner/scope/lease/generation, terminal sequence, `openProcesses: 0` and `openIoOperations: 0`; Task 3 alone validates it and finishes that managed mutation activity.
- Produces: the real nominal `LauncherAuthorityClient` through Task 2's unexported SDK and `apps/cli/src/composition/state.ts`, the sole production importer allowlisted to Task 3's unexported `internal/compose-state.ts`. For this path, Task 1's boundary config contains only `apps/cli/src/host-launcher.ts -> packages/contracts/src/internal/launcher-authority-sdk.ts` and `apps/cli/src/composition/state.ts -> packages/state/src/internal/compose-state.ts`; its only other internal-source exceptions are Task 9's two exact protected-dispatch composition edges. Host composition passes the authenticated client into State once and injects only each minted narrow facade into its owning service; it never exports the facade bundle, kernel, client factory, or test-support fake. Package exports make both internal subpaths unresolved to ordinary consumers, while `check:boundaries` rejects an equivalent source import from any other file.
- Produces: CLI-owned `launchManagedSupervisor(input): Promise<LauncherHandle>` whose returned handle is already bound to the Launcher registry's run/incarnation and exposes `currentRunLockCapability(): LauncherRunLockCapability`, `stopCurrentIncarnation(): Promise<LauncherStopProof>` and `proveCurrentIncarnationStopped(): Promise<LauncherStopProof>`; local `LauncherControl.spawnManagedProcess(request): Promise<PendingManagedLaunch>`, `activateManagedProcess(launchId): Promise<ManagedProcessHandle>`, `abortManagedProcess(launchId): Promise<ManagedProcessStopProof>`, authenticated `LauncherAuthorityClient.verifyCurrent(capability): Promise<VerifiedRunLock>`, `LauncherAuthorityClient.verifyStopped(proof): Promise<VerifiedIncarnationStop>`, and `readMetricClock(): MetricTimestamp`. `spawnManagedProcess` writes a pending launch record before OS spawn, creates a gated process group whose challenge payload cannot execute, persists PID/PGID identity, then acknowledges; only `activateManagedProcess` releases the gate. Caller or Launcher loss before activation terminates the gated child. The bound handle can create capabilities only for its registry-bound current incarnation; no public API accepts caller-selected run/incarnation. The client is bound to authenticated local control IPC, resolves private capability state from the Launcher registry, and rejects structural/copy/unknown IDs, wrong caller, old boot/generation, released locks, incomplete pending/active coverage, live independent observations and cross-incarnation replay. A `LauncherStopProof` covers the complete launch-registry sequence plus independent observation sequence, not merely registered processes or one process proof, and reaches State only through subject-bound `recordIncarnationStop`; no raw proof fields reach any transition. The existing CLI/Launcher holds the run lock, stays outside the Supervisor process group, owns teardown and supplies one authenticated boot-scoped monotonic clock domain to all run services. This is not a new recovery-only binary or surviving-executor adoption protocol.

**Depends on:** Tasks 3-5.

- [ ] **Step 1: Write failing path escape, budget, response-loss, live-read, cursor-eviction and external-kill tests**

```ts
it("returns output before the batch job exits", async () => {
  const read = await startSlowJobAndReadFirstLine();
  expect(read).toMatchObject({ state: "running", bytes: expect.any(Uint8Array) });
});
it("does not silently advance an evicted cursor", async () => {
  expect(await readEvictedCursor()).toMatchObject({ state: "cursor_evicted", requestedCursor: 0, retainedStartCursor: 1024 });
});
it("spawns no process when the tool-time reservation is denied", async () => {
  expect(await startJobWithExhaustedBudget()).toMatchObject({ code: "tool_budget_exhausted", childPids: [] });
});
it("cancels tool time when canonical spawn action-start never occurs", async () => {
  expect(await failJobBeforeSpawnAction()).toMatchObject({ childPids: [], proofIssuer: "job_runtime", reservationState: "cancelled_not_dispatched" });
});
it("continues an owned Worker task when an unrelated capacity dimension is full", async () => {
  expect(await runJobWithOwnedWorkerAndFullInstances()).toMatchObject({ childPids: [expect.any(Number)], newWorkerReservations: 0 });
});
it.each(["supervisor", "runtime"])("the external launcher stops the complete managed tree after %s SIGKILL", async (victim) => {
  expect(await killFixtureProcessFromOutside(victim)).toMatchObject({ independentlyObservedFixturePidsAlive: 0, payloadHeartbeatsAfterKill: 0, stopProofIssued: true, newIncarnationAllowed: true });
});
it.each(["after-os-spawn", "before-identity-persist", "before-launch-ack", "before-payload-activation"])("contains the managed launch when the owner dies %s", async (point) => {
  expect(await killDuringManagedSpawn(point)).toMatchObject({ payloadHeartbeats: 0, independentlyObservedFixturePidsAlive: 0, stopProofBeforeIndependentObservation: false, finalStopProofIssued: true });
});
it.each(["copied-id", "wrong-control-caller", "old-boot", "old-generation", "released-lock"])("does not verify %s run-lock capability", async (kind) => {
  expect(await verifyInvalidRunLockCapability(kind)).toMatchObject({ verified: false, lifecycleBindingsIssued: 0 });
});
it.each(["structural-object", "copied-id", "wrong-control-caller", "old-boot", "old-generation", "incomplete-registry", "live-process", "cross-incarnation-replay"])("does not verify %s stop capability", async (kind) => {
  expect(await verifyInvalidStopCapability(kind)).toMatchObject({ verified: false, stateStopBindingsIssued: 0 });
});
it("holds a network Job's mutation lease until process terminal", async () => {
  expect(await raceRunningJobWithBrowserMutation()).toMatchObject({ concurrentSameScopeMutators: 1, browserStartedAfterJobTerminal: true });
});
```

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `npm test -- packages/runtime/test tests/integration/host-launcher-fail-stop.test.ts`

- [ ] **Step 3: Implement fixed workspaces, budgeted process-group jobs, PTY and bounded cursor buffers**

Persist Job ID, tool-time reservation and canonical spawn action-start record, authorizing only required units while validating the whole current execution and occupied Worker ref. A failure before action-start issues exact `ToolConsumableNonDispatchProof` and calls `cancelUndispatchedConsumption`; after action-start, settle actual time or mark/charge unknown and never cancel. For mutation-capable network activity, acquire/activate the State lease before Launcher payload activation and retain it through terminal/cancel proof; a lost process keeps ownership until matching `StateStopBinding`. Filter child env, block escapes, preserve provenance/metrics and make cancellation wait for confirmed process-tree termination.

- [ ] **Step 4: Implement the stream publication bridge and CLI-owned process-tree lifecycle**

The Launcher starts Supervisor, Runtime Job and Browser processes only through the gated spawn protocol; remove any public post-spawn `registerProcessGroup` path. The gated bootstrap cannot execute challenge payload until pending record, PID/PGID and ownership are durable and acknowledged. If caller/Launcher control disappears in any pre-activation window, it exits without payload; recovery scans pending/active records and independently probes their identities before proof. Bind both lock and stop capability lookup to the same authenticated control socket and Launcher boot identity: mint private opaque handles only for canonical registry rows, derive every verified field server-side, invalidate lock capabilities on release/boot/generation change, and give State only the nominal `LauncherAuthorityClient` rather than verification secrets or structural proof DTOs. Stop verification requires the complete registry sequence and a later independent zero-live observation sequence. The Launcher exposes one kernel-monotonic clock domain across Supervisor incarnations. Unexpected Supervisor/Runtime exit triggers TERM/KILL and verification before a new incarnation; Launcher death leaves persisted identities for conservative startup inspection, which blocks until every old identity is proved dead.

- [ ] **Step 5: Verify live observation, publication and fail-stop behavior**

Run: `npm test -- packages/runtime/test packages/artifacts/test/publish.test.ts tests/integration/host-launcher-fail-stop.test.ts`

Expected: response loss finds the existing Job by ID; a gap prevents full-range publication; every pre-activation kill produces no payload heartbeat or independently observed survivor; external `SIGKILL` leaves no pending/active process/browser alive; failed stop proof leaves the run blocked and starts no replacement owner; copied/wrong-caller/old/released lock capabilities and structural/copied/stale/incomplete/live-process stop capabilities fail authenticated verification and issue no State binding; same-scope managed mutation does not overlap while unrelated/local work remains concurrent.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: add managed workspace and job runtime`.

### Task 7: Implement channels, metering and protected effects

**Files:**
- Create: `packages/runtime/src/channels.ts`, `tcp-session.ts`, `http-session.ts`, `listener.ts`, `managed-activity.ts`, `metering.ts`, `metered-broker.ts`, `protected-call.ts`, `internal/protected-call-composition.ts`
- Modify: `packages/runtime/package.json`, `packages/state/src/effect-ledger.ts`
- Create: `fixtures/metered-broker/server.ts`, `fixtures/metered-broker/topology.ts`
- Test: `packages/runtime/test/channels.test.ts`, `managed-activity.test.ts`, `metering.test.ts`, `metered-broker.test.ts`, `protected-call.test.ts`, `protected-call.type-test.ts`

**Interfaces:**
- Consumes: Runtime jobs from Task 6, Task 2 `ExecutionBinding`/`RemoteActivityContext`/`ActionProvenance`, Task 4's nominal `NetworkGrantHandle`/`NetworkGrantResolver`, and only Task 3's nominal `RuntimeStatePort` plus separately injected `MeteredBrokerStatePort`/`ProtectedDispatchStatePort`; no Runtime code receives a generic State transaction or trusts a grant body. Host composition gives the broker only its confirmation writer and the private dispatcher only its unresolved/dispatch writer. Execution/activity/provenance context is injected by Bridge/Supervisor, never accepted from model arguments. Runtime resolves the handle for its authenticated service/challenge/generation/managed-transport identity before every connect/listen/protected activation and closes active routes when resolution is revoked.
- Produces: `channel.open(input, context): Promise<ChannelHandle>`, status/read/write, controller-only `channel.transfer(id, permit: ManagedActivityTransferPermit)` and `channel.close(id): Promise<ChannelActivityTerminalProof>`; `http_session.open(input, context): Promise<HttpSessionHandle>`, request and `http_session.close(id): Promise<HttpSessionTerminalProof>`; `listener.start(input, context): Promise<ListenerHandle>`, status/accept/read/write and `listener.stop(id): Promise<ListenerActivityTerminalProof>`. Every challenge-network handle defaults mutation-capable, invokes `RuntimeStatePort`'s named acquire/activate command before connect/listen, and retains the resulting lease until its issuer-bound proof matches canonical activity/owner/scope/lease/generation and zero in-flight work; an RPC return never releases it. Channel transfer is unavailable to model arguments and atomically changes handle plus lease owner through the same nominal port using the exact current Supervisor permit; stale owners lose all handle operations. Broker-only transports bound to `managedTransportId` are private Task 7 protected-dispatch closures, not public generic handles.
- Produces: logical tool paths `ctf_channel.protectedCall(input, trustedContext)` and `ctf_http_session.protectedRequest(input, trustedContext)` for grants declaring hard-limit `broker_only`. They canonicalize exact framed request bytes first, call `RuntimeProtectedDispatcher.prepare` to atomically reserve `remote_units` at the profile counting point, seal its returned refs into one `RuntimeProtectedDispatchEnvelope`, and dispatch. Generic open/request to that endpoint returns `managed_transport_required`; the protected path uses exactly one protected mutation lease and never also opens a managed-activity lease. Retry/redirect/batch/protocol-message behavior follows the grant's counting and confirmation policy.
- Produces: separate complete `RuntimeProtectedDispatcherCommands` and `PlatformProtectedDispatcherCommands` command shapes; neither extends the other. Runtime has `prepare(input: RuntimeProtectedCallPrepareInput)`, `dispatch(envelope: RuntimeProtectedDispatchEnvelope): Promise<ProtectedDispatchDisposition | RuntimeProtectedDispatchResult>`, and `reconcile(operationId: OperationId): Promise<RuntimeProtectedReconciliationResolution>`. Platform has `prepare(input: PlatformProtectedCallPrepareInput)`, `dispatch(envelope: PlatformProtectedDispatchEnvelope): Promise<ProtectedDispatchDisposition | PlatformProtectedDispatchResult>`, and `reconcile(input: PlatformProtectedReconciliationEvidence): Promise<PlatformProtectedReconciliationResult>`. Both expose `cancelPrepared(operationId): Promise<PreparedCallCancellation>`; only Platform adds `cancelReservedStart(input: { operationId, reservationId, expectedAuthorization: RunLifecycleBinding | ExecutionBinding }): Promise<InstanceActivationNonDispatchProof>`. The nominal dispatcher types are exactly their corresponding command shape plus one unexported runtime authority brand, with no extra public methods. `prepare` decodes the operation-specific zero-or-one reservation tuple plus immutable intent/origin/mutation/precondition and service-computed request identity. In one `ProtectedDispatchStatePort` transaction it revalidates identity, performs that complete reservation/adoption transition, writes the canonical `prepared` effect plus refs, and, for Bridge-originated work, atomically writes its allocated Bridge link. Exact retry returns the same `PreparedCall`; changed operation kind/payload/request/budget/ref conflicts. `cancelPrepared` derives the dimension/phase result from canonical state: it handles reservation-free First List, cancels the one consumable or reserved Start with the exact proof, marks a pre-dispatch Close cancelled while leaving occupied capacity untouched, or aborts Close teardown only if dispatch already wrote teardown intent and still wrote no byte. `cancelReservedStart` compares `expectedAuthorization` to the reservation's stored historical authorization binding; that authorization need not remain current after failure, but a changed/fabricated binding cannot cancel. Runtime `reconcile` accepts only the canonical operation ID and delegates to `resolveRuntimeProtectedReconciliation`; it never accepts producer evidence, reads volatile broker memory or redispatches. Platform `reconcile` accepts only Platform's family-specific evidence. Both invoke family-specific named State commands atomically with settlement/quarantine/capacity reconciliation. Generic implementation, binding types, constructors and `createProtectedDispatcher` exist only in `internal/protected-call-composition.ts`; they are absent from package exports. Task 7 composes only its Runtime dispatcher; Task 9 owns the later host composition that can see both Runtime internal composition and Platform internal transport. No public caller can structurally construct a dispatcher, import a binding/factory, supply transport/policy, bind the union envelope, or pass context/request separately.
- At `dispatch`, the implementation loads the matching prepared row by operation ID, requires the envelope's exact intent/origin/reservation/request identity, reclassifies/recomputes the concrete request, acquires or durably waits for the mutation lease, and atomically calls `markDispatching`; Start also begins instance activation and Close begins teardown before bytes. Every transport writes a durable first-byte intent before attempting the first write, so dispatcher death with no such intent proves no write was attempted, while an intent without confirmation is conservatively unknown. A private `settlePreByteFailure(operationId, stage, reason)` owns final classification/precondition rejection, lease deadline, post-mark crash recovery, and transport-open failure: in one State transaction it writes `failed_not_dispatched` and applies reservation-free First List cancellation, the exact consumable cancellation, Start activation cancellation, pre-teardown Close cancellation, or post-teardown Close abort. Transient lease contention remains `prepared_wait` with Task 7 recovery ownership; envelope mismatch retains the canonical prepared row rather than allowing denial-by-cancellation. A crash after preparation is therefore exact-resumable, atomically cancellable, durably waiting, or unknown, never unowned. After first-byte intent, cancellation is impossible and the dispatcher retains mutation lease/capacity phase through durable terminal/unknown reconciliation; a First List unknown records `reservationState: "none"` while retaining the effect quarantine.

- For Start, the emitted public declaration uses `expectedAuthorization` for the exact stored `authorizationOrigin.binding`. The dispatcher validates that historical authorization plus the reservation's `lifecycleOwnerBinding` and initial owner sequence; the protected mutation owner is always that lifecycle binding. Activation and first occupancy preserve that owner revision. Later Close uses only the current State-issued occupied ref and owner sequence; only `SupervisorStatePort.succeedInstanceLifecycleOwner` may advance them after verified stop/fencing. No execution-to-lifecycle or caller-directed transfer exists or is inferred.

**Depends on:** Tasks 2-4 and 6.

- [ ] **Step 1: Write failing crash-window and hard-unit tests**

```ts
it.each(["prepared", "dispatching", "response-before-commit"])("does not blind-retry after %s crash", async (point) => {
  expect(await recoverProtectedCall(point)).toMatchObject({ redispatched: false });
});
it("rejects the next unit before bytes are sent", async () => {
  expect(await sendAfterLimit()).toMatchObject({ code: "remote_budget_exhausted", bytesSent: 0 });
});
it("cancels a no-byte remote-unit reservation only with dispatch-phase evidence", async () => {
  expect(await failBrokerBeforeFirstByte()).toMatchObject({ bytesSent: 0, reservationState: "cancelled_not_dispatched", proofPhase: "dispatch" });
});
it.each(["after-prepare", "after-envelope-seal", "before-dispatch-call"])("recovers or cancels every no-byte prepared call after %s failure", async (point) => {
  expect(await failPreparedCallBoundary(point)).toMatchObject({ bytesSent: 0, strandedReservations: 0, duplicatePreparations: 0, proofIssuedBy: "protected_dispatcher" });
});
it.each(["multiple-consumables", "mixed-consumable-capacity", "wrong-consumable-dimension", "wrong-capacity-phase", "extra-capacity-ref"])("rejects %s before protected preparation", async (kind) => {
  expect(await prepareInvalidReservationShape(kind)).toMatchObject({ preparedCalls: 0, newReservations: 0, adoptedCapacityRefs: 0, bytesSent: 0 });
});
it.each(["first_list", "submit", "hint", "remote_unit", "start", "close"])("owns every %s failure inside dispatcher entry", async (kind) => {
  for (const point of ["final-classification-denied", "final-precondition-stale", "lease-deadline", "transport-open-no-byte", "crash-after-mark-before-first-byte-intent"] as const) {
    const expected = expectedNoByteDisposition(kind, point);
    expect(await failInsideDispatcherEntry(kind, point)).toMatchObject({ ...expected, effectState: "failed_not_dispatched", bytesSent: 0, strandedReservations: 0, recoveryOwner: null });
  }
});
it("keeps transient lease contention durably owned until retry deadline", async () => {
  expect(await contendForLeaseBeforeDeadline()).toMatchObject({ disposition: "prepared_wait", preparedCalls: 1, reservationState: "reserved", recoveryOwner: "protected_dispatcher", bytesSent: 0 });
});
it("does not let a malformed envelope cancel the canonical prepared operation", async () => {
  expect(await dispatchMalformedEnvelopeForPreparedCall()).toMatchObject({ disposition: "rejected_envelope", preparedCalls: 1, reservationState: "reserved", recoveryOwner: "protected_dispatcher", bytesSent: 0 });
});
it("makes a first-byte intent conservatively unknown rather than cancelling", async () => {
  expect(await failAfterFirstByteIntent()).toMatchObject({ disposition: "unknown", reservationCancelled: false, quarantineInstalled: true, bytesPossiblySent: true });
});
it("makes First List first-byte uncertainty unknown without inventing a reservation", async () => {
  expect(await failFirstListAfterFirstByteIntent()).toMatchObject({ disposition: "unknown", reservationState: "none", reservationRefs: [], quarantineInstalled: true, bytesPossiblySent: true });
});
it.each(["auth-rejected", "mapper-threw", "deadline-expired"])("cancels an existing Start reservation when %s occurs before preparation", async (point) => {
  expect(await failStartBeforePreparation(point)).toMatchObject({ preparedCalls: 0, activationRecords: 0, bytesSent: 0, capacityState: "cancelled_not_dispatched", proofPhase: "activation" });
});
it("allows the managed broker but blocks raw clients to the same metered endpoint", async () => {
  expect(await invokeBrokerThroughCtfHttpSessionTool()).toMatchObject({ bridgeToolCalls: 1, runtimeProtectedCalls: 1, protectedMutationLeases: 1, brokerRequests: 1, rawJobBytes: 0, browserBytes: 0 });
});
it("rejects generic Channel/HTTP open when a grant requires managed hard-limit transport", async () => {
  expect(await bypassBrokerThroughGenericTools()).toMatchObject({ channelCode: "managed_transport_required", httpCode: "managed_transport_required", brokerRequests: 0 });
});
it.each(["structural-handle", "revoked", "expired", "wrong-service", "wrong-challenge", "wrong-generation", "wrong-managed-transport"])("rejects Runtime network authority from %s", async (kind) => {
  expect(await openRuntimeNetworkWithInvalidGrant(kind)).toMatchObject({ grantResolved: false, socketsOpened: 0, brokerRequests: 0, mutationLeases: 0 });
});
it("rejects operation ID reuse with a different payload", async () => {
  expect(await reuseOperationIdWithDifferentPayload()).toMatchObject({ code: "operation_payload_conflict", bytesSent: 0 });
});
it("rejects altered wire bytes carrying a copied dispatch identity", async () => {
  expect(await dispatchAlteredRequestWithCopiedIdentity()).toMatchObject({ code: "wire_request_identity_mismatch", bytesSent: 0 });
});
it.each([
  ["platform-context/runtime-request"],
  ["runtime-context/platform-request"],
])("rejects cross-family protected envelope %s before lease or bytes", async (fixture) => {
  expect(await dispatchCrossFamilyEnvelope(fixture)).toMatchObject({ code: "protected_dispatch_family_mismatch", mutationLeases: 0, bytesSent: 0 });
});
it.each(["runtime-operation-to-platform", "platform-evidence-to-runtime", "wrong-operation", "wrong-request-identity", "wrong-owner", "stale-generation"])("rejects protected reconciliation input %s", async (kind) => {
  expect(await reconcileWithInvalidFamilyOrIdentity(kind)).toMatchObject({ accepted: false, canonicalTransitions: 0, capacityReleased: 0, reservationSettled: false });
});
it.each(["fabricated-operation", "platform-operation", "unprepared-operation", "wrong-runtime-family"])("rejects Runtime reconciliation for %s without accepting caller evidence", async (kind) => {
  expect(await reconcileInvalidRuntimeOperation(kind)).toMatchObject({ accepted: false, callerEvidenceFields: 0, canonicalTransitions: 0, reservationSettled: false, quarantineRemoved: false });
});
it.each(["broker-confirmation", "broker-response-limit", "transport-unresolved"])("recovers a %s commit/response-loss with one terminal row", async (kind) => {
  expect(await retryRuntimeEvidenceAfterWriterResponseLoss(kind)).toMatchObject({ canonicalEvidenceRows: 1, terminalTransitions: 1, redispatched: false, resolutionReads: 2 });
});
it("settles a Runtime protected call only from exact broker confirmation", async () => {
  expect(await reconcileRuntimeBrokerConfirmationByOperation()).toMatchObject({ status: "resolved", family: "runtime", effectState: "confirmed", reservationState: "settled", responseBytes: expectedFramedResponseBytes, quarantineRemoved: true });
});
it("returns the direct dispatch response from persisted State rather than volatile broker memory", async () => {
  expect(await dispatchRuntimeConfirmationThenDiscardBrokerReturn()).toMatchObject({ outcome: "confirmed", responseBytes: expectedFramedResponseBytes, resultRef: expectedResultRef, terminalSequence: expectedTerminalSequence, stateResolutionReads: 1, volatileBrokerResponseUsed: false });
});
it("replays one broker-committed response from a fresh dispatcher after the writer response is lost", async () => {
  expect(await restartDispatcherAfterBrokerCommit()).toMatchObject({ status: "resolved", brokerRequests: 1, redispatched: false, responseBytes: expectedFramedResponseBytes, resultRefs: [expectedResultRef, expectedResultRef], terminalSequences: [expectedTerminalSequence, expectedTerminalSequence] });
});
it("fails a response over 1 MiB into canonical unknown without a replayable response", async () => {
  expect(await dispatchRuntimeResponseBytes(1_048_577)).toMatchObject({ effectState: "unknown", reservationState: "unknown", retainedResponseBytes: 0, responseRefs: 0, quarantineInstalled: true, redispatched: false });
});
it.each(["missing-response", "digest-mismatch"])("does not complete or reply through Bridge when Runtime response storage is %s", async (kind) => {
  expect(await replayRuntimeCallWithCorruptResponse(kind)).toMatchObject({ code: "canonical_runtime_response_corrupt", bridgeState: "accepted", bridgeTransitions: 0, responseReturned: false, workerTerminalProofIssued: false });
});
it("leaves an operation pending when no canonical Runtime evidence exists", async () => {
  expect(await reconcileRuntimeOperationBeforeProducerCommit()).toMatchObject({ status: "awaiting_evidence", brokerRequests: 0, canonicalTransitions: 0, reservationSettled: false });
});
it("keeps response-lost Submit unknown when Platform exposes no authoritative history", async () => {
  expect(await reconcileSubmitWithoutHistory()).toMatchObject({ family: "platform", operationKind: "submit", effectState: "unknown", reservationState: "unknown", unitsRefunded: 0, quarantineRetained: true });
});
it("preserves the exact mutation owner from intent through final dispatch", async () => {
  expect(await captureProtectedMutationOwner()).toEqual(expectedMutationOwner);
});
it("does not double-reserve a dimension when upper layers pass the canonical reservation", async () => {
  expect(await dispatchWithExistingReservation()).toMatchObject({ reservationsForOperationAndDimension: 1, requests: 1 });
});
it.each(["after-instance-activation-intent", "after-first-byte-before-response"])("keeps Start capacity unavailable across %s", async (point) => {
  expect(await crashProtectedStart(point)).toMatchObject({ newInstanceReservations: 0, duplicateStartRequests: 0, capacityAvailableBeforeReconcile: 0 });
});
it.each(["after-instance-teardown-intent", "after-close-byte-before-response"])("keeps Close capacity unavailable across %s", async (point) => {
  expect(await crashProtectedClose(point)).toMatchObject({ capacityState: "teardown_unknown", replacementStarts: 0, duplicateCloseRequests: 0 });
});
it("cannot use a forged no-byte proof to abort Close after the first byte", async () => {
  expect(await abortCloseAfterFirstByte()).toMatchObject({ abortAccepted: false, capacityState: "teardown_unknown", replacementStarts: 0 });
});
it("restores occupied instance capacity when Close fails before its first byte", async () => {
  expect(await failCloseBeforeFirstByte()).toMatchObject({ closeBytes: 0, before: "teardown_pending", after: "occupied", replacementStarts: 0 });
});
it("restores occupied instance capacity when authoritative evidence remains active after Close", async () => {
  expect(await reconcileCloseAsStillActive()).toMatchObject({ before: "teardown_pending", after: "occupied", activeProofMatched: true });
});
it("dispatches Close under successor B using the same occupied reservation and a fresh lease", async () => {
  expect(await closeSucceededInstanceUnderB()).toMatchObject({ reservationIds: [expectedReservationId, expectedReservationId], resourceGenerations: [expectedGeneration, expectedGeneration], historicalAuthorization: expectedAuthorizationOrigin, closeOwnerIncarnation: incarnationB, closeOwnerSequence: expectedOwnerSequenceB, newReservations: 0, successionMutationLeases: 0, closeFreshMutationLeases: 1, closeRequests: 1 });
});
it("rejects A's grant and uses a separately issued/resolved B grant for the retained target", async () => {
  expect(await probeSucceededInstanceTargetUnderB()).toMatchObject({ oldGrantResolutionsAfterFence: 0, successorGrantRows: 1, successorGrantResolutions: 1, grantIncarnation: incarnationB, grantSetChanged: true, successorSocketsOpened: 1, successorProbeBytes: 1, staleOwnerSocketsOpened: 0 });
});
it.each(["old-A-ref", "stale-B-ref"])("rejects %s after instance owner succession before lease or bytes", async (kind) => {
  expect(await closeWithStaleInstanceOwnerRef(kind)).toMatchObject({ code: "instance_owner_stale", mutationLeases: 0, closeBytes: 0, capacityState: "occupied" });
});
it("revalidates lifecycle owner sequence at final Close dispatch", async () => {
  expect(await supersedeInstanceOwnerBetweenClosePrepareAndDispatch()).toMatchObject({ preparedCalls: 1, closeBytes: 0, staleLeaseAcquired: false, code: "instance_owner_stale" });
});
it("sends zero Submit bytes when a generation-changing mutation wins the lease", async () => {
  expect(await interleaveSubmitAndRestart("restart-first")).toMatchObject({ overlappingMutationOwners: 0, staleSubmitBytes: 0 });
});
it("holds a generation-changing mutation until the leased Submit is terminal", async () => {
  expect(await interleaveSubmitAndRestart("submit-first")).toMatchObject({ overlappingMutationOwners: 0, submitRequests: 1, restartBeganAfterSubmitTerminal: true });
});
it.each(["channel", "http_session", "listener"])("blocks a same-resource Platform effect while a managed %s is active", async (kind) => {
  expect(await raceManagedNetworkActivityWithPlatform(kind)).toMatchObject({ overlappingMutationOwners: 0, platformBytesBeforeActivityTerminal: 0 });
});
it("does not release an HTTP-session mutation lease when one request RPC returns", async () => {
  expect(await keepHttpMutationSessionAcrossRequests()).toMatchObject({ requestReturned: true, leaseState: "active", competingBrowserMutations: 0 });
});
it("rejects Channel transfer from a stale owner or to an unbound target", async () => {
  expect(await attemptUnauthorizedChannelTransfers()).toMatchObject({ acceptedTransfers: 0, leaseState: "active", owner: originalOwner, staleOwnerWrites: 0 });
});
it("rejects a model claim that a challenge-network channel is read-only", async () => {
  expect(await openChannelWithForgedReadOnlyContext()).toMatchObject({ opened: false, code: "trusted_activity_context_required" });
});
```

`expectedNoByteDisposition` is the following fixed matrix: First List has no reservation/proof and only marks the effect `failed_not_dispatched`; Submit/Hint/remote-unit always use their one dispatch proof and end the one reservation `cancelled_not_dispatched`; Start always uses its one activation proof and ends the one reservation `cancelled_not_dispatched`; Close rejected before `markDispatching` emits no capacity proof and leaves its one ref `occupied`, while Close failing after its teardown intent uses one teardown proof and returns that ref to `occupied`. Every accepted operation kind has exactly zero or one transition, and the effect plus that whole transition commit atomically. Any first-byte intent instead selects `unknown` and never this matrix.

In `protected-call.type-test.ts`, import only the package public entrypoint and require the compiler to reject every authority/broad/mixed form:

```ts
import type { PlatformProtectedDispatcher, PlatformProtectedDispatcherCommands, RuntimeProtectedDispatcher, RuntimeProtectedDispatcherCommands } from "@ctf/runtime";
import type { OperationId, PlatformProtectedDispatchEnvelope, RuntimeProtectedDispatchEnvelope, PlatformProtectedReconciliationEvidence } from "@ctf/contracts";
// @ts-expect-error The generic implementation type is not public.
import type { ProtectedDispatcher } from "@ctf/runtime";
// @ts-expect-error Dispatcher factories are composition-internal.
import { createProtectedDispatcher } from "@ctf/runtime";
// @ts-expect-error Dispatcher bindings are composition-internal.
import type { PlatformProtectedDispatcherBinding } from "@ctf/runtime";
// @ts-expect-error The internal composition subpath is absent from package exports.
import { createProtectedDispatcher as internalFactory } from "@ctf/runtime/internal/protected-call-composition";

declare const platformDispatcher: PlatformProtectedDispatcher;
declare const runtimeDispatcher: RuntimeProtectedDispatcher;
declare const platformEnvelope: PlatformProtectedDispatchEnvelope;
declare const runtimeEnvelope: RuntimeProtectedDispatchEnvelope;
declare const platformReconciliation: PlatformProtectedReconciliationEvidence;
declare const runtimeOperationId: OperationId;
declare const callerRuntimeEvidence: { kind: "broker_confirmation"; operationId: OperationId; response: Uint8Array };
declare const leakedGenericType: ProtectedDispatcher<any, any>;
declare const leakedBindingType: PlatformProtectedDispatcherBinding;
declare const structuralPlatformDispatcher: PlatformProtectedDispatcherCommands;
declare const structuralRuntimeDispatcher: RuntimeProtectedDispatcherCommands;

if (false) {
  platformDispatcher.dispatch(platformEnvelope);
  // @ts-expect-error Runtime envelopes cannot enter a Platform dispatcher.
  platformDispatcher.dispatch(runtimeEnvelope);
  // @ts-expect-error Context and request cannot be supplied independently.
  platformDispatcher.dispatch(platformEnvelope.context, platformEnvelope.request);
  platformDispatcher.reconcile(platformReconciliation);
  // @ts-expect-error A Runtime operation ID cannot enter Platform reconciliation.
  platformDispatcher.reconcile(runtimeOperationId);
  runtimeDispatcher.reconcile(runtimeOperationId);
  // @ts-expect-error Runtime reconciliation never accepts caller-supplied producer evidence.
  runtimeDispatcher.reconcile(callerRuntimeEvidence);
  // @ts-expect-error Platform evidence cannot enter Runtime reconciliation.
  runtimeDispatcher.reconcile(platformReconciliation);
  // @ts-expect-error The private Platform authority brand prevents command-complete structural construction.
  const forgedPlatformDispatcher: PlatformProtectedDispatcher = structuralPlatformDispatcher;
  // @ts-expect-error The private Runtime authority brand prevents command-complete structural construction.
  const forgedRuntimeDispatcher: RuntimeProtectedDispatcher = structuralRuntimeDispatcher;
  void [createProtectedDispatcher, internalFactory, leakedGenericType, leakedBindingType, forgedPlatformDispatcher, forgedRuntimeDispatcher];
}
```

- [ ] **Step 2: Run tests and confirm missing channel/effect support**

Run: `npm run typecheck && npm test -- packages/runtime/test/channels.test.ts packages/runtime/test/managed-activity.test.ts packages/runtime/test/metering.test.ts packages/runtime/test/metered-broker.test.ts packages/runtime/test/protected-call.test.ts`

- [ ] **Step 3: Implement framed channels and the lease-guarded `prepared -> dispatching -> confirmed|failed_not_dispatched|unknown` ledger**

For public Channel/HTTP/Listener handles, validate the whole injected current execution and server-derived activity scope, call the Runtime facade's named acquire/activate commands before socket connect/listen, and tag every in-flight operation to that activity. Close/stop first rejects new operations, drains or terminates tagged work, persists the matching kind/issuer/owner/scope/lease/generation proof with all proof-specific open counters at zero, and only then invokes the named finish command; process loss uses the `lost` branch plus the covering `StateStopBinding`. A trusted grant may mark a specific operation read-only, but neither model arguments nor generic GET/read naming can do so. Before generic open/request, inspect the authenticated grant: `broker_only` rejects that path and routes the logical tool call into Runtime's injected nominal dispatcher. The builder frames and hashes the request before `prepare`; that atomic call creates the one remote-unit reservation and protected-effect row, then the returned refs are sealed into one stable `RuntimeProtectedDispatchEnvelope`. It uses one protected mutation lease instead of a second managed activity.

Pure-map or frame before reserving transport-owned consumables. Decode the operation-discriminated prepare schema before mutation: First List accepts no ref, Submit/Hint/remote-unit each reserve exactly their one matching consumable, Start adopts exactly one matching reserved instance, and Close adopts exactly one matching occupied instance. Reject mixed, multiple, wrong-dimension, wrong-phase or extra refs with no write. `prepare` then atomically performs that complete zero-or-one transition, writes the protected-effect row and returns canonical refs; no caller creates a Submit/Hint/remote-unit reservation earlier. Disable implicit retries/redirects unless counting semantics define them. Keep implementation, binding and composition authority internal; validate the concrete family envelope against its prepared row before acquiring a lease. At dispatch, classify actual bytes with the immutable service policy, recompute identity, then invoke the protected-dispatch State facade's named acquire/mark command before transport. Start writes activation intent and Close teardown intent in that transaction. Complete/release the mutation lease only after confirmed, proved not-dispatched, or durable unknown quarantine. Any setup failure after `prepare` calls `cancelPrepared`; a failure before preparation of an existing Start calls `cancelReservedStart`. These issue and consume the operation's complete zero-or-one no-byte transition atomically. Any byte invalidates cancellation and yields the matching unknown phase.

For Close, both `prepare` and final `markDispatching` compare the occupied ref's current `lifecycleOwnerBinding` and `lifecycleOwnerSequence` to State. A succession between those points makes the prepared call stale with zero lease/bytes; the caller must rebuild from the newly returned ref. The successor never reuses A's grant or mutation lease.

The authenticated broker validates complete framing and the 1 MiB response bound, then records an in-limit response through only `MeteredBrokerStatePort.recordRuntimeBrokerConfirmation` or the first excess byte through `recordRuntimeBrokerResponseLimit`; the dispatcher records other terminal uncertainty through only `ProtectedDispatchStatePort.recordRuntimeTransportUnresolved`. Each writer derives identity from canonical dispatch rows and atomically commits its evidence plus the one confirmed/unknown effect, reservation, mutation and quarantine transition. Confirmation additionally persists the framed response, State-computed digest, immutable response/result refs and terminal sequence before acknowledging the broker; overflow retains no response bytes/ref. Exact writer retries return one terminal record and competing input conflicts. Both direct `dispatch` and fresh-process `reconcile(operationId)` discard any volatile broker return and invoke the read-only `resolveRuntimeProtectedReconciliation`: State returns `awaiting_evidence` when no producer transaction exists or the exact stored response/result/terminal sequence when confirmed. Neither path needs a producer DTO or another broker request. Platform reconciliation alone accepts its operation-specific response/List/history evidence. Both families compare canonical operation/request/owner/scope/generation/managed transport and never infer a result from absence. Emit correlated prepare/cancel/activity/call/first-byte/evidence/confirmation/quarantine/reconciliation/capacity events.

- [ ] **Step 4: Implement the broker-only host fixture**

Place the fixture oracle on a route unavailable to ordinary Tool jobs and Browser, with only the identified managed broker able to connect. Exercise it end-to-end from an authenticated Bridge call to the logical `ctf_channel`/`ctf_http_session` tool, Runtime context/framing, remote-unit ledger, private protected dispatcher and broker confirmation; direct fixture invocation does not satisfy M0. Host-dev outside this topology remains `metering_unavailable` and cannot claim raw-socket non-bypassability.

- [ ] **Step 5: Verify local broker and smallest-scope quarantine**

Run: `npm test -- packages/runtime/test`

Expected: public declarations expose only nominal family dispatchers and reject command-complete structural construction, root/internal factory or binding imports, unauthorized relative-internal imports, cross-family dispatch/reconciliation, positional context/request and mixed/multiple reservation shapes; final classification/precondition denial, lease deadline, post-mark crash and transport-open/no-byte failure all take the fixed atomic disposition matrix with no stranded reservation; transient lease wait and malformed-envelope rejection retain explicit Task 7 recovery ownership, while first-byte intent becomes unknown; every pre-prepare Start failure cancels against its historical authorization while preserving its lifecycle owner through State-validated Task 7 authority; no-byte remote-unit calls use dispatch-phase cancellation while Start/Close use activation/teardown semantics; family-specific reconciliation never infers confirmation or release from absence; an unknown call consumes reserved units and blocks only its scope; same-scope managed/Browser/Platform mutators never overlap or release on RPC return; the logical Solver tool reaches broker framing through one protected lease, generic clients cannot reach it, existing refs are not double-charged, and duplicate/conflicting operations never emit a second request.

For instance succession, only the current State-issued owner revision may observe/reconcile/Close; stale A/B refs fail at prepare or final dispatch with zero lease and bytes, while B uses the unchanged reservation/generation and one fresh lease.

For Runtime specifically, a broker commit followed by broker-response, dispatcher and Bridge process loss must resolve by canonical operation ID to the same terminal sequence, result ref and framed response bytes with one broker request; no public reconciliation API accepts a producer evidence DTO.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: add managed channels and protected effects`.

### Task 8: Implement the TSecBench 0.1.2 fixture and adapter

**Files:**
- Create: `packages/platform/package.json`
- Create: `packages/platform/src/adapter.ts`, `tsecbench/client.ts`, `tsecbench/mapper.ts`, `tsecbench/reconcile.ts`
- Create: `fixtures/tsecbench/server.ts`, `fixtures/tsecbench/scenarios/*.json`
- Test: `packages/platform/test/tsecbench-contract.test.ts`, `tsecbench-reconcile.test.ts`, `tests/contract/tsecbench-fixture.test.ts`

**Interfaces:**
- Consumes: Task 2 `PlatformObservationContext` and a pre-reservation `PlatformEffectIntentContext` whose `reservationRefs` is exactly empty, plus `PlatformWireRequest` and a capability-bound `PlatformObservationDispatcher` injected by Task 9; it never receives Task 7's protected dispatcher, State budget authority, or the raw credential-bearing transport.
- Produces: contextual `PlatformAdapter.inspect()`, retryable `listChallenges(context: PlatformObservationContext)` for observations after the initial attempt, pure `mapFirstListRequest(context: PlatformEffectIntentContext & { capability: "first_list", reservationRefs: [] }): PlatformWireRequest`, pure `mapProtectedRequest(context: PlatformEffectIntentContext & { reservationRefs: [] }, input: Start | Hint | Submit | Close): PlatformWireRequest`, `decodeProtectedResponse(context, response: PlatformWireResponse): CanonicalPlatformResult`, reconciliation mapping and canonical `CapabilityDescriptor[]`. First List and every protected mutation preserve operation/payload/owner/scope/precondition identity but perform no I/O or reservation. Platform Service alone sends the mapped First List through Task 7's zero-reservation `first_list` prepare variant; later retryable List observations use `listChallenges` only after the canonical initial-attempt row exists.

**Depends on:** Tasks 2-3.

- [ ] **Step 1: Encode all verified wire cases as failing fixture tests**

```ts
it("treats HTTP 200 correct=false as confirmed rejection", async () => {
  expect(adapter.decodeProtectedResponse(submitIntentContext("submit-1"), correctFalseResponse())).toMatchObject({ effectState: "confirmed", outcome: "rejected" });
});
it("does not treat total_score as earned score", async () => {
  expect((await adapter.listChallenges(platformObservationContext("list-1"))).challenges[0].earnedScore).toBeUndefined();
});
it("preserves canonical intent context while mapping and has no transport", async () => {
  expect(await captureProtectedMapping()).toMatchObject({ operationId: "submit-1", payloadIdentity: expectedPayloadIdentity, mutationOwner: expectedMutationOwner, reservationRefs: [], adapterTransportCapabilities: 0, budgetAuthority: 0 });
});
it("pure-maps First List without observation dispatch, reservation or transport", async () => {
  expect(await captureFirstListMapping()).toMatchObject({ operationKind: "first_list", reservationRefs: [], observationDispatches: 0, adapterTransportCapabilities: 0, mappedRequests: 1 });
});
```

- [ ] **Step 2: Run adapter tests and confirm failure**

Run: `npm test -- packages/platform/test/tsecbench-contract.test.ts packages/platform/test/tsecbench-reconcile.test.ts`

- [ ] **Step 3: Implement the exact five-operation mapping and scenario server**

Cover null description/hint, multiple addresses, all four container states, partial/complete/duplicate, 404 task errors, 409 variants, 422 detail arrays, response loss and no pagination. Regular retryable observations after the canonical first attempt use only the capability-bound `PlatformObservationDispatcher`. `mapFirstListRequest` and every protected mutation mapper return a pure request to Platform Service from an empty-reservation mapping context; the adapter cannot dispatch it, create an operation ID/reservation, assert a wire identity, invoke raw transport, or replace the caller's domain payload identity/mutation owner. Response decoding and reconciliation remain pure.

- [ ] **Step 4: Verify the full fixture matrix**

Run: `npm test -- packages/platform/test tests/contract/tsecbench-fixture.test.ts`

Expected: start/close reconcile from List; unknown submit/hint remains local and never invents history, earned score or slot identity.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add tsecbench fixture and adapter`.

### Task 9: Implement Platform Service, local oracle and prepare/start admission

**Files:**
- Create: `packages/platform/src/service.ts`, `secrets.ts`, `manifest.ts`, `admission.ts`, `time-policy.ts`, `start-intent.ts`, `submission-dispatch.ts`, `wire-policy.ts`, `wire-identity.ts`, `interventions.ts`, `local-entry.ts`, `local-oracle.ts`, `cleanup.ts`, `internal/transport-port.ts`
- Create: `apps/cli/src/composition/protected-dispatch.ts`
- Create: `apps/cli/src/commands/prepare.ts`, `start.ts`
- Modify: `packages/platform/package.json`
- Test: `packages/platform/test/service-boundary.test.ts`, `manifest.test.ts`, `admission.test.ts`, `time-policy.test.ts`, `start-crash-matrix.test.ts`, `submission-dispatch.test.ts`, `interventions.test.ts`, `local-entry.test.ts`, `local-oracle.test.ts`, `tests/contract/protected-dispatch-internals.type-test.ts`

**Interfaces:**
- Consumes: contextual TSecBench adapter from Task 8, nominal `PlatformStatePort` plus authenticated current `RunLifecycleBinding` from Task 3, policy/grants from Task 4, a trusted-composition-injected nominal `PlatformProtectedDispatcher` from Task 7, and Task 2 admission/observation/effect-intent/protected-dispatch/wire-policy/identity contracts. Platform service code never imports Task 7's internal factory or binding types.
- Produces: `prepareRun(input: PrepareRunInput): Promise<PreparedRun>` and `startRun(runId, classifier: AdmissionClassifier): Promise<AdmittedRun>`; the M0 classifier accepts only explicit evidence and otherwise returns `ambiguous`, while Task 13 later supplies model-backed evidence classification.
- Produces: `evaluateTimePolicy(mode, evidence, localAnchor): TimePolicyDecision`, `deriveMutationScope(intent): MutationScopeKey`, `createPlatformEffectIntentContext(authorityBinding: ExecutionBinding | RunLifecycleBinding, intent: FirstList | Submit | Hint): PlatformEffectIntentContext & { reservationRefs: [] }`, `createInstanceEffectIntentContext(authorityBinding: ExecutionBinding | RunLifecycleBinding, intent: Start | Close, ref: InstanceCapacityReservation | OccupiedInstanceCapacityRef): PlatformEffectIntentContext & { reservationRefs: [] }`, `sealProtectedDispatchContext(intentContext, mappedRequest, prepared: PreparedCall): ProtectedDispatchContext`, `executePlatformIntent(authorityBinding, input: PlatformIntentExecutionInput)`, `abandonUndispatchedStart(expectedAuthorization, operationId, reservationId)`, `submitLocalCandidate(executionBinding, intent)`, `capturePlatformInterventionEvidence(runId): Promise<InterventionEvidence>` and `comparePlatformInterventionEvidence(before, after): IntegrityDecision`. `PlatformIntentExecutionInput` is discriminated exactly as First List/Submit/Hint with no capacity field, Start with one `InstanceCapacityReservation`, or Close with one `OccupiedInstanceCapacityRef`; it exposes no reservation array or generic ref field. Platform Service authenticates the exact current binding before mapping: First List and deterministic Scheduler/finalization/cleanup require State's current `RunLifecycleBinding`; model-selected Start validates a current Coordinator execution whose immutable set contains `intake`, but `createInstanceEffectIntentContext` takes the Start mutation/capacity owner only from the reservation's separately stored `lifecycleOwnerBinding`; Hint remains execution-owned; Submit requires the current Coordinator execution recorded as proposer and containing `submitting`. Close requires the current lifecycle binding and an occupied ref with that same lifecycle owner. Solver/Verifier bindings cannot invoke Platform effects. Raw identity/owner/responsibility values are not API inputs. Same-challenge mutators derive one scope key regardless of authorization kind.
- Produces: platform-intent budget ownership rules: First List pure-maps through `mapFirstListRequest` and enters Task 7's zero-reservation prepare variant; Task 9 never reserves Submit/Hint before mapping. After pure mapping and wire-identity computation succeed, it asks the injected Task 7 dispatcher to `prepare`, which atomically performs the operation's complete zero-or-one reservation transition and writes the prepared call; Task 9 then seals only the returned refs. Instance Start requires one `InstanceCapacityReservation` whose `authorizationOrigin.binding` equals the exact `RunLifecycleBinding | ExecutionBinding` passed to `executePlatformIntent`; an injected Task 3 fixture allocator supplies it in M0 and Task 20 Scheduler supplies it live. Task 9 builds the Start effect owner from `lifecycleOwnerBinding`, and Task 7 verifies both complete stored authorization and lifecycle-owner continuity before adoption; activation and first occupancy retain that owner. A later Close instead uses the current State-issued occupied owner revision after any Task 3 succession, while preserving the original authorization, reservation, occupancy and generation. If Start authentication, mapping, policy, deadline or sealing fails before preparation, `abandonUndispatchedStart` passes the exact historical authorization to Task 7 `cancelReservedStart`; State compares it to `authorizationOrigin` even if a Coordinator binding was released, while still requiring the unchanged pre-occupancy lifecycle owner. If any branch fails after preparation but before dispatch, it delegates to `cancelPrepared`. Crash recovery makes the same distinction from canonical prepared/phase rows. Task 9 cannot construct, relabel or substitute any proof or owner. Possible bytes yield activation/teardown/consumption unknown until family-specific authoritative reconciliation; confirmed First List commits its baseline, confirmed Start may occupy, active evidence may restore, and only Platform's authenticated stopped evidence with the current owner sequence releases.
- For cross-incarnation cleanup, Task 9 cannot request or construct succession. For an A-owned unknown/pending capacity phase, Task 11 supplies the State recovery ref, `stopA` and current B only to the observation path; Task 9 sends retryable List under B's run authority and calls `PlatformStatePort.reconcileStoppedOwnerInstance`. Active yields an occupied A ref that Task 11 may succeed; stopped releases it. This pre-succession path sends no Start/Close bytes and grants B no mutation authority. After Task 11 supplies the B-owned `OccupiedInstanceCapacityRef`, later List/Close correlate the unchanged challenge/reservation/generation and current owner sequence. An old A ref, a ref superseded by C, or evidence for an earlier sequence fails before mutation mapping, lease or bytes.
- Produces: immutable `TSecBenchWireCapabilityPolicy`, `createPlatformObservationDispatcher(policy, transport): PlatformObservationDispatcher`, and an opaque host-composition-only Platform transport port under `packages/platform/src/internal` that wraps the credential-bearing closure and policy. Task 9 now creates `apps/cli/src/composition/protected-dispatch.ts` after both dependencies exist. Task 1 allowlists exactly that file to import `packages/runtime/src/internal/protected-call-composition.ts` and `packages/platform/src/internal/transport-port.ts`; it combines the exact family policy/transport and injects only branded dispatchers. `@ctf/runtime/internal/protected-call-composition` and `@ctf/platform/internal/transport-port` are absent from package exports; `protected-dispatch-internals.type-test.ts` requires both direct package-subpath imports to fail, and `check:boundaries` rejects equivalent relative imports from any unauthorized file. Task 8 receives only observation authority. Protected flow is authenticate -> empty-ref intent -> pure map -> compute wire identity -> atomic Task 7 prepare -> seal returned refs -> one dispatch call; every identity except the newly State-assigned refs remains exact.

**Depends on:** Tasks 3, 4, 7 and 8.

- [ ] **Step 1: Write failing pre/post admission and First List crash-matrix tests**

```ts
it.each(["before-dispatch", "after-dispatch", "after-response", "after-manifest"])("keeps one anchor across %s", async (point) => {
  const recovered = await crashAndRecoverFirstList(point);
  expect(new Set(recovered.startAnchors).size).toBe(1);
  expect(recovered.solverDispatchesBeforeAdmission).toBe(0);
});
it("maps and prepares First List through the protected zero-reservation path", async () => {
  expect(await traceFirstListDispatch()).toMatchObject({ pureFirstListMappings: 1, observationDispatchesBeforeAttempt: 0, preparedOperationKind: "first_list", reservationRefs: [], transportOwner: "protected_dispatcher" });
});
it.each(["first-list-with-ref", "submit-with-capacity", "start-with-consumable", "close-with-two-refs"])("rejects invalid Platform intent shape %s before mapping", async (kind) => {
  expect(await executeInvalidPlatformIntent(kind)).toMatchObject({ mappedRequests: 0, preparedCalls: 0, reservationsChanged: 0, bytesSent: 0 });
});
it("returns candidate_only when a local target has no oracle", async () => {
  expect(await finalizeLocal(noOracleCandidate())).toMatchObject({ outcome: "candidate_only" });
});
it("rejects formal mode without trusted task-time evidence before First List", async () => {
  await expect(prepareRun(formalWithoutTrustedTime())).rejects.toMatchObject({ code: "formal_time_evidence_required", firstListBytes: 0 });
});
it("allows dev/live local-anchor fallback without a formal timing claim", async () => {
  expect(await prepareRun(liveWithLocalAnchorOnly())).toMatchObject({ timing: "conservative_non_formal", formalTimingClaim: false });
});
it.each(["expired", "generation_changed", "related_unknown"])("dispatches zero Submit bytes when verification becomes %s", async (change) => {
  expect(await queueThenInvalidateSubmission(change)).toMatchObject({ submitBytes: 0, unaffectedChallengesRunnable: true });
});
it.each(["solver", "verifier", "different-coordinator", "replaced-coordinator"])("rejects Submit dispatch from %s instead of the recorded proposer", async (kind) => {
  expect(await dispatchSubmissionWithWrongAuthority(kind)).toMatchObject({ submitBytes: 0, consumableReservations: 0, code: "submission_proposer_mismatch" });
});
it.each(["submit", "hint"])("cancels a no-byte %s consumable with dispatch-phase evidence", async (kind) => {
  expect(await failPlatformConsumableBeforeFirstByte(kind)).toMatchObject({ bytesSent: 0, proofPhase: "dispatch", reservationState: "cancelled_not_dispatched" });
});
it.each(["mapper-threw", "policy-rejected", "deadline-expired"])("creates no Submit/Hint reservation when %s before preparation", async (point) => {
  expect(await failConsumableBeforeProtectedPreparation(point)).toMatchObject({ preparedCalls: 0, consumableReservations: 0, bytesSent: 0 });
});
it.each(["after-prepare", "during-seal", "before-dispatch"])("cancels the prepared consumable after %s with no bytes", async (point) => {
  expect(await failConsumableAfterProtectedPreparation(point)).toMatchObject({ consumableReservations: 1, strandedReservations: 0, bytesSent: 0, proofPhase: "dispatch" });
});
it("uses one instance reservation from Scheduler through protected dispatch", async () => {
  expect(await startWithCanonicalInstanceReservation()).toMatchObject({ instanceReservations: 1, activationIntents: 1, occupiedAfterAuthoritativeActive: true, platformStartRequests: 1 });
});
it.each(["run_lifecycle", "coordinator_execution"])("preserves %s authorization while lifecycle ownership remains exact through Start", async (authorizationKind) => {
  expect(await startWithBoundInstanceOrigin(authorizationKind)).toMatchObject({ authorizationKind, coordinatorResponsibility: authorizationKind === "coordinator_execution" ? "intake" : undefined, reservationOwnerKind: "run_lifecycle", reservationOwnerMatchesIntent: true, preparedOwnerMatchesReservation: true, startRequests: 1 });
});
it.each(["fabricated-binding", "stale-at-reservation", "execution-challenge-mismatch", "solver-origin", "coordinator-without-intake", "different-authorization-at-prepare", "substituted-lifecycle-owner"])("rejects %s instance authority", async (kind) => {
  expect(await startWithInvalidInstanceOrigin(kind)).toMatchObject({ instanceReservations: ["different-authorization-at-prepare", "substituted-lifecycle-owner"].includes(kind) ? 1 : 0, preparedCalls: 0, startRequests: 0, ownerMismatchAccepted: false, strandedReservationsAfterRecovery: 0 });
});
it("cancels against the exact stored historical authorization after that Coordinator binding is released", async () => {
  expect(await cancelReservedStartAfterOriginRelease()).toMatchObject({ currentAuthorizationRequired: false, historicalAuthorizationMatched: true, lifecycleOwnerUnchanged: true, wrongAuthorizationCancellationAccepted: false, capacityState: "cancelled_not_dispatched" });
});
it.each(["stale-binding", "mapper-threw", "policy-rejected", "deadline-expired"])("cancels the existing Start reservation when %s occurs before Task 7 preparation", async (point) => {
  expect(await failStartBeforeProtectedPreparation(point)).toMatchObject({ instanceReservations: 1, preparedCalls: 0, activationIntents: 0, strandedReservations: 0, bytesSent: 0, capacityState: "cancelled_not_dispatched" });
});
it.each(["after-prepare", "during-seal", "before-dispatch"])("cancels the adopted Start reservation after %s with no bytes", async (point) => {
  expect(await failStartAfterProtectedPreparation(point)).toMatchObject({ instanceReservations: 1, preparedCalls: 1, activationIntents: 0, strandedReservations: 0, bytesSent: 0, capacityState: "cancelled_not_dispatched" });
});
it.each(["active", "stopped"])("reconciles an unknown Start as %s", async (outcome) => {
  expect(await reconcileUnknownStart(outcome)).toMatchObject({ capacityState: outcome === "active" ? "occupied" : "released", duplicateStartRequests: 0 });
});
it("allows close while instance capacity is full without acquiring another slot", async () => {
  expect(await closeAtFullInstanceCapacity()).toMatchObject({ closeRequests: 1, newInstanceReservations: 0 });
});
it("closes a Coordinator-authorized instance under its retained lifecycle owner after execution release", async () => {
  expect(await startReleaseExecutionThenClose()).toMatchObject({ startAuthorizationKind: "coordinator_execution", startOwner: expectedRunLifecycleOwner, releasedCoordinatorBindings: 1, activeWorkerBindings: 0, closeOwner: expectedRunLifecycleOwner, closeRequests: 1, capacityState: "released", newWorkerReservations: 0 });
});
it("lets current B observe and Close the same instance after A is stopped and State succeeds ownership", async () => {
  expect(await startUnderAStopThenCloseUnderB()).toMatchObject({ startOwnerIncarnation: incarnationA, closeOwnerIncarnation: incarnationB, historicalAuthorizationIncarnation: incarnationA, reservationIds: [expectedReservationId, expectedReservationId], challengeIds: [expectedChallengeId, expectedChallengeId], resourceGenerations: [expectedGeneration, expectedGeneration], occupancySequences: [expectedOccupancySequence, expectedOccupancySequence], ownerSequences: [expectedOwnerSequenceA, expectedOwnerSequenceB], instanceReservations: 1, occupancyProofs: 1, newActivationRowsDuringSuccession: 0, listObservationsUnderB: 1, closeRequests: 1, staleABytes: 0 });
});
it.each(["activation_unknown", "teardown_pending", "teardown_unknown"])("uses B List to reconcile A-owned %s before owner succession", async (phase) => {
  expect(await recoverStoppedOwnerInstanceThroughBList(phase, "active")).toMatchObject({ listRequests: 1, protectedMutationRequestsBeforeSuccession: 0, phaseAfterObservation: "occupied", observationOwnerIncarnation: incarnationB, capacityOwnerBeforeSuccession: incarnationA, successionRows: 1, closeOwnerIncarnation: incarnationB });
  expect(await recoverStoppedOwnerInstanceThroughBList(phase, "stopped")).toMatchObject({ listRequests: 1, phaseAfterObservation: "released", successionRows: 0, closeRequests: 0, reusableSlots: 1 });
});
it.each(["old-A-ref", "stale-B-ref", "old-owner-observation", "old-owner-stopped-proof"])("rejects %s after lifecycle-owner succession", async (kind) => {
  expect(await useStaleInstanceOwnerRevision(kind)).toMatchObject({ accepted: false, listOrCloseBytes: 0, capacityReleased: false, ownerSequenceChanged: false });
});
it.each(["fabricated", "stale"])("rejects a %s lifecycle binding before Platform bytes", async (kind) => {
  expect(await firstListWithLifecycleBinding(kind)).toMatchObject({ code: "run_lifecycle_binding_stale", firstListBytes: 0, mutationLeases: 0 });
});
it("restores the occupied reservation when Close is definitively not dispatched", async () => {
  expect(await closeWithPreWriteFailure()).toMatchObject({ closeBytes: 0, capacityState: "occupied", newInstanceReservations: 0 });
});
it("preserves intent context through mapping and seals actual wire bytes before dispatch", async () => {
  expect(await tracePlatformOperation("submit")).toMatchObject({ operationIds: [expectedOperationId, expectedOperationId, expectedOperationId], payloadIdentities: [expectedPayloadIdentity, expectedPayloadIdentity, expectedPayloadIdentity], mutationOwners: [expectedMutationOwner, expectedMutationOwner, expectedMutationOwner], reservationRefSets: [[], [submissionReservationId], [submissionReservationId]], finalWireIdentity: expectedCanonicalWireIdentity });
});
it("sends zero bytes and cancels the reservation when verification becomes stale at protected dispatch", async () => {
  expect(await invalidateAtProtectedDispatch()).toMatchObject({ preparedCalls: 1, serverSubmitBytes: 0, effectState: "failed_not_dispatched", reservationState: "cancelled_not_dispatched", strandedReservations: 0, adapterBypassCalls: 0 });
});
it("cannot route a protected capability through the observation dispatcher", async () => {
  expect(await submitViaObservationDispatcher()).toMatchObject({ code: "wire_capability_class_mismatch", serverSubmitBytes: 0 });
});
it("rejects Submit wire bytes mislabeled with a valid List observation context", async () => {
  expect(await sendSubmitShapeUnderListObservation()).toMatchObject({ code: "wire_capability_class_mismatch", serverSubmitBytes: 0 });
});
it("cannot send the first List through recovery observation before its protected attempt", async () => {
  expect(await firstListViaObservationDispatcher()).toMatchObject({ code: "observation_precondition_failed", firstListBytes: 0 });
});
```

In `protected-dispatch-internals.type-test.ts`, require direct package-subpath imports to remain unresolved:

```ts
// @ts-expect-error Runtime composition is not a package export.
import { createProtectedDispatcher } from "@ctf/runtime/internal/protected-call-composition";
// @ts-expect-error Credential-bearing Platform transport is not a package export.
import { openPlatformTransportPort } from "@ctf/platform/internal/transport-port";
void [createProtectedDispatcher, openPlatformTransportPort];
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `npm run typecheck && npm run check:boundaries && npm test -- packages/platform/test`

- [ ] **Step 3: Implement credential isolation, mode-specific time policy and two-phase admission**

`prepare` performs only local/user-evidence checks plus the Tool Runtime VPN probe. Formal requires trusted duration/elapsed/source evidence; dev/live may use the local anchor but carries `conservative_non_formal`, and a later Gate may require stricter evidence without changing this product contract. `start` commits immutable intent/anchor and emits `run.start_anchored` with the canonical anchor/correlation before the first List byte, then freezes manifest revision 0 and runs the injected classifier before any solving effect. A direct local target creates exactly one challenge without requiring a separate manifest; raw statement, addresses and supplied materials are ingested with source identity.

- [ ] **Step 4: Implement budgeted platform dispatch and intervention records**

Call `authorizeDispatch` with only the operation's required dimensions and scope. Authenticate the whole current execution or lifecycle binding, derive owner internally and reject stale identity before reservation or lease. Decode `PlatformIntentExecutionInput` before mapping so no generic/multiple ref shape reaches the adapter. Construct an empty-ref intent once; use `mapFirstListRequest` for the canonical initial attempt and `mapProtectedRequest` for Start/Hint/Submit/Close; recompute wire identity and perform Platform's preliminary immutable route-policy classification before Task 7 `prepare`, which repeats classification at final dispatch. Then call the exact prepare variant with zero refs for First List, one Submit/Hint request, one Start reservation or one Close occupied ref, seal only its returned canonical refs into one `PlatformProtectedDispatchEnvelope`, and invoke the injected nominal dispatcher; expose no factory, binding, transport callback or alternate sender. Mapping/preliminary-policy/deadline failure therefore creates no Platform consumable. For an existing Start reservation, every pre-prepare failure calls `cancelReservedStart`; every post-prepare/pre-dispatch failure calls `cancelPrepared`, including seal exceptions and recovery after a crash. Task 7 alone derives and consumes the matching no-byte result and records dispatch/activation/teardown before bytes. After any byte those proofs are impossible and the phase remains unknown until typed authoritative reconciliation. Later `listChallenges` observations are unavailable until the initial-attempt row is durable and use immutable service policy/current State gate. Credential closures remain in the internal Platform port and Task 9 host composition, never Runtime/adapter/model arguments. Emit correlated platform/capacity events and implement Task 11 intervention evidence comparison. Human solving/submission/instance/Challenge Browser evidence yields an invalid formal decision; secret/VPN refresh resumes only when comparison proves no challenge effect.

For the instance variants specifically, "derive owner internally" means: validate the Start authorization binding, then copy owner only from the reservation's State-issued `lifecycleOwnerBinding`; Close validates the current lifecycle binding and owner sequence against the latest occupied ref. The Coordinator binding is never the instance owner, and its later release cannot change or invalidate the occupied ref. Only Task 3's post-stop succession may return a revised lifecycle owner; Task 9 cannot transfer it. Pre-prepare Start cancellation still compares the exact historical authorization snapshot plus unchanged pre-occupancy lifecycle owner.

- [ ] **Step 5: Verify auth, baseline, dispatch and intervention behavior**

Run: `npm run typecheck && npm run check:boundaries && npm test -- packages/platform/test`

Expected: `404 task_not_found` is auth/task failure, empty denominator is `insufficient_gate_coverage`, formal/live timing stays distinct, First List uses the pure zero-reservation protected path before any observation dispatcher, invalid mixed/multiple Platform intent shapes fail before mapping, stale identity emits zero bytes, duplicate operations do not resubmit/double-reserve, pre-map failures create no consumable, and final classification/precondition, lease-deadline, sealing, dispatcher-entry, transport-open/no-byte and crash faults all leave zero stranded reservations; no-byte Submit/Hint consumables cancel only with dispatch proof, Start uses activation proof, and Close stays/returns occupied according to whether teardown began; nominal injected dispatch preserves intent identity and Task 7-assigned refs, public callers cannot import either internal composition subpath or obtain composition authority, protected wire shapes cannot use observation, no adapter bypass exists, full capacity still permits Close, and no platform secret reaches tool/model logs.

Cross-incarnation instance acceptance: B observes and closes the unchanged A-started reservation only through State's current owner ref/sequence; historical authorization remains A, no occupancy/capacity transition repeats, and every stale owner revision produces zero observation/Close bytes or release.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: add platform admission and effect boundary`.

### Task 10: Implement the single scoped Challenge Browser

**Files:**
- Create: `packages/browser/package.json`
- Create: `packages/browser/src/service.ts`, `process.ts`, `scope-router.ts`, `activity-tracker.ts`, `metrics.ts`, `downloads.ts`
- Test: `packages/browser/test/scope.test.ts`, `lifecycle.test.ts`, `activity-tracker.test.ts`, `metrics.test.ts`, `downloads.test.ts`

**Interfaces:**
- Consumes: a challenge `NetworkGrantHandle` plus Task 4's nominal resolver, Artifact publication, `MetricClock` and only the nominal `BrowserStatePort` commands for Browser-owned metric/budget/mutation state from Tasks 3-4, Task 2 `RemoteActivityContext`/`ActionProvenance` (later populated by Task 13), plus Task 6's gated managed-spawn API. Browser resolves canonical authority for its exact service/challenge/profile/network generation before process/page/network activation and accepts no structural grant body.
- Produces: `browser.open/status/close`, `beginBrowserActivity(context: { execution: ExecutionBinding, activity: RemoteActivityContext }): Promise<BrowserActivityHandle>`, `browser.action(activityId, action)`, `finishBrowserActivity(activityId, outcome): Promise<BrowserActivityTerminalProof>`, and `loseBrowserActivity(activityId, stop: StateStopBinding)`; the bound context is injected outside model arguments and validates the whole current execution identity. Exactly one active `BrowserLease { runId, challengeId, generation, capacityReservationId }` is bound to a Task 3 capacity reservation. Browser process/profile creation writes `beginCapacityActivation`; matching durable identity issues `BrowserActivationProof` and `occupyCapacity` before Launcher releases page payload. Browser Service issues activity terminal proof only after closing ingress and proving all activity-owned page/worker/fetch/WebSocket/route work terminal; the proof binds exact activity/browser lease/process/profile/network generations, mutation owner/scope/lease and zero tracked requests. Mutation activity holds the scope lease through that proof; uncertain/lost activity keeps ownership until State validates the matching stop binding. Browser close issues `BrowserTeardownProof` only after independently observing zero processes and profile removal, then calls `releaseCapacity`.
- Produces: canonical Browser activity/action/observation/terminal business records and metric events carrying producer, activity/action IDs, process/profile/network generation, action provenance, clock domain and dispatch/visibility/terminal correlation. The business record is committed at the same sequence from which Task 3 independently derives Browser metric coverage; it is not proof that the Browser metric producer emitted.

**Depends on:** Tasks 2-4, 6 and 9.

- [ ] **Step 1: Write failing navigation/fetch/WebSocket/download and teardown tests**

```ts
it.each(["navigation", "fetch", "websocket", "download"])("blocks out-of-scope %s", async (kind) => {
  expect(await attemptBrowserBypass(kind)).toMatchObject({ code: "scope_denied" });
});
it.each(["structural-handle", "revoked", "expired", "wrong-service", "wrong-challenge", "wrong-generation"])("rejects Browser network authority from %s", async (kind) => {
  expect(await openBrowserWithInvalidGrant(kind)).toMatchObject({ grantResolved: false, browserProcesses: 0, pageRequests: 0, profilesCreated: 0 });
});
it("kills the whole process and profile when switching challenge", async () => {
  expect(await switchChallenge()).toMatchObject({ oldProcessAlive: false, oldProfileReused: false });
});
it("starts no browser when the browser-slot reservation is denied", async () => {
  expect(await openBrowserWithExhaustedSlots()).toMatchObject({ code: "browser_slots_exhausted", browserPids: [] });
});
it("reuses the slot only after process and profile teardown are confirmed", async () => {
  expect(await closeThenOpenForNextChallenge()).toMatchObject({ nextOpened: true, activeCapacity: 1, toolUsageRefunded: false });
});
it("keeps an unknown teardown capacity occupied until reconciliation", async () => {
  expect(await loseBrowserTeardownConfirmation()).toMatchObject({ nextOpened: false, capacityState: "teardown_unknown" });
});
it.each(["ingress-closed", "process-signalled", "profile-mutated"])("cannot abort Browser teardown after %s", async (point) => {
  expect(await abortBrowserTeardownAfterAction(point)).toMatchObject({ abortAccepted: false, capacityState: "teardown_pending", replacementOpened: false });
});
it.each(["active", "stopped"])("reconciles unknown Browser teardown as %s", async (outcome) => {
  expect(await reconcileUnknownBrowserTeardown(outcome)).toMatchObject({ capacityState: outcome === "active" ? "occupied" : "released", replacementOpened: outcome === "stopped" });
});
it.each(["after-capacity-activation-intent", "after-process-profile-before-occupancy", "after-occupancy-before-payload"])("recovers Browser activation crash %s without payload or slot overcommit", async (point) => {
  expect(await recoverBrowserActivation(point)).toMatchObject({ pagePayloadsBeforeOccupancy: 0, activeOrUncertainSlots: 1, duplicateBrowserProcesses: 0 });
});
it.each(["active", "stopped"])("reconciles unknown Browser activation as %s", async (outcome) => {
  expect(await reconcileUnknownBrowserActivation(outcome)).toMatchObject({ capacityState: outcome === "active" ? "occupied" : "released", duplicateBrowserProcesses: 0 });
});
it("waits while a same-resource network Job holds the mutation lease", async () => {
  expect(await raceBrowserWithMutationJob()).toMatchObject({ overlappingMutationOwners: 0, browserMutationBeganAfterJobTerminal: true });
});
it("does not release mutation ownership when a Playwright action RPC returns", async () => {
  expect(await keepBrowserActivityOpenAcrossActions()).toMatchObject({ actionReturned: true, leaseState: "active", competingPlatformMutations: 0 });
});
it.each(["delayed-fetch", "websocket"])('holds mutation ownership until an activity-bound %s is terminal', async (kind) => {
  expect(await finishWhileBackgroundMutationIsLive(kind)).toMatchObject({ terminalProofIssuedBeforeNetworkEnd: false, competingJobMutationsBeforeNetworkEnd: 0, terminalProofOpenRequests: 0 });
});
it("makes a completed Browser activity with its whole metric group deleted report missing", async () => {
  expect(projectMetrics(browserProjectionInputWithoutBrowserEvents())).toMatchObject({ browserActivityMs: { status: "missing", reason: "producer_group_missing" } });
});
```

- [ ] **Step 2: Run browser tests and confirm failure**

Run: `npm test -- packages/browser/test`

- [ ] **Step 3: Implement Playwright child-process lifecycle and route enforcement**

Reserve `browser_slots`, call `beginCapacityActivation` with challenge/generation/managed-launch identity, and call `cancelCapacityActivation` with exact `BrowserActivationNonDispatchProof` only when canonical state proves no process/profile action; a still-reserved cancellation cites its reservation sequence and proves no activation row. Create the browser through gated spawn; after durable process/profile identity, issue `BrowserActivationProof`, occupy capacity, then release page payload. Recovery resumes the same record or enters `activation_unknown`. Close writes teardown intent first; before any ingress close, signal or profile mutation, exact `BrowserTeardownNonDispatchProof` may abort to occupied, but action-start is persisted before the first such action and permanently disables abort. Confirmed process/profile removal issues terminal proof; uncertainty enters `teardown_unknown`; active/stopped evidence reconciles without refunding consumables. Use a fresh profile and no Platform credential. Validate the whole execution, derive activity scope, acquire mutation lease before action, tag every page/worker/fetch/WebSocket/route and retain ownership across RPCs. Persist canonical business rows and independent metrics. `finishBrowserActivity` drains all tagged work before proof; timeout/crash remains lost until the matching `StateStopBinding`. The router blocks mutation-capable background requests outside an active activity.

- [ ] **Step 4: Verify browser contract**

Run: `npm test -- packages/browser/test`

Expected: all direct and page-initiated network paths obey the same grants; same-resource Browser/managed Runtime/Platform mutators never overlap; neither action return nor a live delayed fetch/WebSocket can release mutation ownership; terminal proof has matching generations and zero tracked requests; pre-activation browser death executes no page payload; only a pre-action local proof can abort teardown, while any ingress/process/profile action keeps capacity unavailable until reconciliation; close removes the process/profile; Browser metric projection is measured when emitted and missing, never N/A, when canonical activity exists but its producer group is deleted.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: add scoped challenge browser`.

### Task 11: Implement Supervisor lifecycle, checkpoint and host fail-stop

**Files:**
- Create: `packages/supervisor/package.json`
- Create: `packages/supervisor/src/supervisor.ts`, `run-lifecycle.ts`, `sessions.ts`, `leases.ts`, `deadlines.ts`, `checkpoint.ts`, `recovery.ts`, `launcher-coordination.ts`, `integrity.ts`, `intervention-lifecycle.ts`
- Create: `apps/cli/src/commands/status.ts`, `stop.ts`
- Test: `packages/supervisor/test/lifecycle.test.ts`, `deadline.test.ts`, `budget-gate.test.ts`, `checkpoint.test.ts`, `host-recovery.test.ts`, `integrity.test.ts`, `intervention-lifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 3-10 service interfaces, including Task 6's external gated-spawn `LauncherControl`, scoped dispatch-budget decisions, managed/protected mutation leases, execution bindings and canonical metric/intervention events.
- Produces: `prepare/start/status/stop`, `currentRunLifecycleBinding(): RunLifecycleBinding`, `createTask(input: { challengeId: ChallengeId, role, responsibilitySet: ResponsibilitySet })`, `acquireTaskExecution(taskId, reason, acquireKey: ExecutionAcquireKey): Promise<ExecutionReservation | WaitingForCapacity>`, `bindSession(reservation, allocation: UnboundSessionAllocation): Promise<ExecutionBinding>`, `replaceBoundSession(currentBinding, replacement: UnboundSessionAllocation, proof: SessionHandoffProof): Promise<ExecutionBinding>`, `cancelTaskExecution(attemptId, proof: WorkerActivationNonDispatchProof)`, `abortWorkerSessionTeardown(binding: ExecutionBinding, proof: WorkerTeardownNonDispatchProof): Promise<OccupiedCapacity>`, `releaseTaskExecution(attemptId, proof: WorkerCapacityTerminalProof)`, `renewLease`, `checkpointRun`, `recoverRun`; immutable run incarnation under the Launcher-held lock. Task 11 passes the opaque lock capability to Task 3 and uses only the derived lifecycle identity. On stop it obtains an opaque `LauncherStopProof`, calls `recordIncarnationStop(currentRunLifecycleBinding, proof)`, and passes only the resulting `StateStopBinding` to lifecycle revocation, reconciliation and lost-activity transitions before successor issuance. Acquisition copies canonical non-null challenge, role and immutable responsibility set from the task into every reservation and is idempotent by key; changed reason/identity conflicts. Task 5 allocates an inert session from that reservation, while Task 11 exclusively invokes Task 3's atomic bind/replace/abort methods. Initial bind compares the complete allocation identity; replacement requires the exact handoff proof and replacement allocation, preserves occupied capacity, invalidates old session and never expands responsibility. Cancellation applies only before activation action-start. Teardown abort consumes only Task 5's exact Bridge-issued pre-action proof; Task 11 cannot construct one. Release accepts exact normal or recovered proof, atomically releases capacity/invalidates binding, and does not stop detached managed activity.
- Produces: controller-only `authorizeManagedActivityTransfer(activityRef, targetBinding): Promise<ManagedActivityTransferPermit>`. It reads the canonical Job/Channel activity and mutation lease, derives `fromOwner` from that current activity even when its originating Worker attempt has been released, authenticates the exact occupied target execution in the same run/challenge/resource generation, allocates a monotonic transfer sequence and signs no caller-selected owner/scope fields. Task 3 consumes it once idempotently; changed replay, a source that no longer owns the activity, or a stale/released target is rejected.
- Lifecycle composition is fixed: Task 11 asks Task 6 for the current opaque `LauncherRunLockCapability`, passes only that capability to Task 3, and accepts the run/incarnation values State derives in `RunLifecycleBinding`; it has no scalar identity API. Every task/reservation/allocation/binding copies canonical run/challenge/incarnation/task/role/responsibility/attempt/lease/reservation identity, and downstream services validate the whole current binding before activation or bytes.
- Recovery ordering is fixed: `recordIncarnationStop(A)` -> `revokeRunLifecycleBinding(A, stopA)` -> make every A grant unresolvable/publish invalidation and fence A lease acquisition/dispatch -> terminalize, cancel or quarantine A effects/leases -> `issueRunLifecycleBinding` for current B with mutation dispatch still gated -> use B's retryable List plus `reconcileStoppedOwnerInstance` for each stopped-owner non-occupied recovery ref -> release stopped rows or call `succeedInstanceLifecycleOwner` for each occupied row -> issue/resolve fresh B grants and acquire fresh B leases -> allow B mutation/Close. Task 11 passes exact State refs only; it cannot edit owner fields or succeed any non-occupied phase. If B stops before succession, current C may succeed the still-A-owned ref only when State proves the complete stopped/revoked A-to-B-to-C lineage and all barriers.
- Produces: `proveExecutionActivationNotStarted(attemptId, phaseRecordSequence): Promise<WorkerActivationNonDispatchProof>` for `cancelTaskExecution`. Supervisor issues it from canonical absence of session/Bridge/process action-start for the exact reserved or activating Worker attempt. For a still-reserved attempt, `phaseRecordSequence` is the reservation sequence and State requires no activation row; for `activating`, it is the activation-intent sequence. The proof cannot be caller-built, and any action forces active/unknown terminal reconciliation.
- Produces: `beginIntervention(input): Promise<InterventionRecord>`, `completeIntervention(id, evidence): Promise<IntegrityDecision>`, `evaluateRunIntegrity(snapshot): IntegrityDecision`; formal-invalid reasons include unproved old execution stop, canonical corruption, lost exclusivity and prohibited human challenge action, but not an isolated unknown protected effect.

**Depends on:** Tasks 3-10.

- [ ] **Step 1: Write failing deadline, budget, process-stop, intervention and recovery tests**

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
it("denies an action only when one of its required scoped units is exhausted", async () => {
  expect(await dispatchRequiringExhaustedUnits()).toMatchObject({ newDispatches: 0, checkpointedScope: "challenge-a" });
});
it("continues local work when only Hint or another challenge endpoint budget is exhausted", async () => {
  expect(await dispatchIndependentWork()).toMatchObject({ localExperiments: 1, hintCalls: 0, unrelatedChallengesRunnable: true });
});
it("allows an existing Worker owner and capacity-releasing cleanup without new slots", async () => {
  expect(await continueAndCleanupAtCapacity()).toMatchObject({ modelTurns: 1, cleanupRequests: 1, newCapacityReservations: 0 });
});
it("uses the run-lifecycle owner for hard-deadline cleanup after Workers are terminal", async () => {
  expect(await cleanupAfterWorkerTerminalAtDeadline()).toMatchObject({ activeWorkerBindings: 0, newWorkerReservations: 0, cleanupMutationOwner: expectedRunLifecycleOwner, cleanupRequests: 1 });
});
it("revokes the prior lifecycle binding before the recovered incarnation can dispatch", async () => {
  expect(await rotateRunLifecycleBinding()).toMatchObject({ currentBindings: 1, oldBindingPlatformBytes: 0, newBindingAccepted: true });
});
it("fences A grants, effects and leases before succeeding its occupied instance to B", async () => {
  expect(await recoverActiveInstanceAcrossIncarnations()).toMatchObject({ stopBindingIssued: true, oldLifecycleRevoked: true, oldGrantResolutionsAfterFence: 0, oldActiveMutationLeasesAtSuccession: 0, oldNonterminalEffectsAtSuccession: 0, successorBindingCurrent: true, successionRows: 1, successorGrantRows: 1, successorGrantResolutions: 1, successorGrantIncarnation: incarnationB, successorTargetProbeBytes: 1, successorCloseBytes: 1, oldOwnerBytes: 0 });
});
it.each(["activation_unknown", "teardown_pending", "teardown_unknown"])("reconciles A-owned %s under B observation authority before succession", async (phase) => {
  expect(await recoverUnknownInstanceAcrossIncarnations(phase, "active")).toMatchObject({ successorIssuedBeforeList: true, successorMutationDispatchesBeforeSuccession: 0, listRequests: 1, phaseAfterList: "occupied", successionRows: 1, finalOwnerIncarnation: incarnationB });
  expect(await recoverUnknownInstanceAcrossIncarnations(phase, "stopped")).toMatchObject({ successorIssuedBeforeList: true, listRequests: 1, phaseAfterList: "released", successionRows: 0, reusableSlots: 1 });
});
it.each(["after-stop", "after-revoke", "after-effect-reconciliation", "after-successor-issuance", "after-succession-commit"])("replays instance succession recovery exactly across crash %s", async (point) => {
  expect(await crashInstanceSuccessionRecovery(point)).toMatchObject({ successionRows: 1, reservations: 1, occupancyProofs: 1, currentOwnerIncarnation: incarnationB, concurrentInstanceOwners: 1 });
});
it("allows current C to succeed a still-A-owned instance only through complete stopped A-to-B-to-C lineage", async () => {
  expect(await stopBBeforeInstanceSuccession()).toMatchObject({ directAToCWithoutLineageAccepted: false, completeLineageAccepted: true, currentOwnerIncarnation: incarnationC, successionRows: 1, newReservations: 0 });
});
it.each(["null-challenge", "changed-role", "expanded-responsibility"])("rejects %s between task, allocation and session binding", async (kind) => {
  expect(await attemptExecutionIdentityMutation(kind)).toMatchObject({ bindingsWritten: 0, modelRequests: 0, toolCalls: 0 });
});
it.each(["fabricated", "copied-id", "wrong-incarnation", "stale-generation"])("does not rotate or recover with %s stop evidence", async (kind) => {
  expect(await recoverWithInvalidStopEvidence(kind)).toMatchObject({ stateStopBindings: 0, newMutationOwners: 0, reusableWorkerSlots: 0 });
});
it.each(["human_solving", "human_submit", "human_instance", "human_challenge_browser"])("marks formal run invalid for %s", async (kind) => {
  expect(await recordFormalIntervention(kind)).toMatchObject({ runState: "invalid", effectsPaused: true });
});
it.each(["canonical_corruption", "lost_exclusivity", "old_execution_unproved"])("rejects formal validity for %s", async (reason) => {
  expect(await evaluateIntegrityFailure(reason)).toMatchObject({ runState: "invalid", integrityReasons: [reason] });
});
it("resumes after secret/VPN refresh only when before/after evidence proves no challenge effect", async () => {
  expect(await refreshWithChangedChallengeState()).toMatchObject({ runState: "invalid", newEffectDispatches: 0 });
});
it("keeps unrelated accepted results when one protected effect is unknown", async () => {
  expect(await recoverIsolatedUnknown()).toMatchObject({ runIntegrity: "valid", preservedAccepted: 2, quarantinedScopes: 1 });
});
it("keeps live recovery in a legal run state when the old mutation owner is unproved", async () => {
  const result = await recoverWithUnprovedMutationOwner("live");
  expect(() => RunSchema.parse(result.run)).not.toThrow();
  expect(result).toMatchObject({ newMutationOwners: 0, runState: "interrupted", solveState: "blocked_runtime", blockerCodes: ["old_execution_not_stopped"] });
});
it("marks formal recovery invalid when the old mutation owner is unproved", async () => {
  const result = await recoverWithUnprovedMutationOwner("formal_gate");
  expect(() => RunSchema.parse(result.run)).not.toThrow();
  expect(result).toMatchObject({ newMutationOwners: 0, runState: "invalid", solveState: "blocked_runtime", integrityReasons: ["old_execution_not_stopped"] });
});
it("releases Worker capacity at terminal without refunding its token or tool usage", async () => {
  expect(await terminateWorkerAndReuseSlot()).toMatchObject({ reusableWorkerSlots: 1, tokenUsageRefunded: false, toolUsageRefunded: false });
});
it("does not release Worker capacity from a proof with an in-flight model or tool call", async () => {
  await expect(releaseWorkerWithNonQuiescentProof()).rejects.toMatchObject({ code: "worker_not_quiescent" });
  expect(await inspectWorkerCapacity()).toMatchObject({ availableSlots: 0, capacityState: "teardown_pending" });
});
it.each(["model", "tool"])("does not recover Worker capacity after %s-dispatch crash until stop and accounting proofs both exist", async (kind) => {
  expect(await recoverWorkerCrash(kind, "before-stop-proof")).toMatchObject({ reusableWorkerSlots: 0, recoveredProofIssued: false });
  expect(await recoverWorkerCrash(kind, "before-terminal-accounting")).toMatchObject({ reusableWorkerSlots: 0, recoveredProofIssued: false });
  expect(await recoverWorkerCrash(kind, "complete")).toMatchObject({ reusableWorkerSlots: 1, recoveredProofIssued: true, unsettledModelRequests: 0, unsettledToolCalls: 0 });
});
it("runs State-owned Bridge-call reconciliation before recovered Worker release", async () => {
  expect(await recoverKilledBridgeWithAcceptedCalls()).toMatchObject({ bridgeAccountingSequence: expect.any(Number), unsettledToolCalls: 0, proofSequenceMatched: true, reusableWorkerSlots: 1 });
});
it("does not replace a live session without a matching zero-in-flight handoff proof", async () => {
  await expect(replaceSessionWithoutHandoffProof()).rejects.toMatchObject({ code: "session_handoff_proof_required" });
  expect(await inspectCurrentBinding()).toMatchObject({ sessionId: oldSessionId, capacityState: "occupied" });
});
it("cancels an unactivated execution only with non-dispatch proof", async () => {
  expect(await cancelAllocatedButUnboundExecution()).toMatchObject({ reusableWorkerSlots: 1, activationRecords: 0, proofPhase: "activation", modelRequests: 0, toolCalls: 0, oldAttemptAccepted: false });
});
it("restores an occupied Worker when teardown setup fails before any shutdown action", async () => {
  expect(await abortWorkerTeardownBeforeIngressClose()).toMatchObject({ proofIssuer: "opencode_bridge", abortConsumer: "supervisor", capacityState: "occupied", ingressClosed: false, processSignals: 0, reusableWorkerSlots: 0 });
});
it("does not abort Worker teardown after ingress close or a process signal starts shutdown", async () => {
  expect(await attemptWorkerTeardownAbortAfterAction()).toMatchObject({ abortAccepted: false, capacityState: "teardown_pending", reusableWorkerSlots: 0 });
});
it("returns the same execution reservation after an acquire-response crash", async () => {
  expect(await retryExecutionAcquireByKey()).toMatchObject({ attemptIds: [expectedAttemptId, expectedAttemptId], workerReservations: 1 });
});
it("refuses stop proof when a gated or active launch remains independently alive", async () => {
  expect(await recoverWithHiddenLaunchFixture()).toMatchObject({ stopProofIssued: false, runState: "interrupted", newMutationOwners: 0 });
});
```

- [ ] **Step 2: Run lifecycle tests and confirm failure**

Run: `npm test -- packages/supervisor/test`

- [ ] **Step 3: Implement incarnation, scoped dispatch-budget gates, task lease, checkpoint and startup reconciliation**

Create each task with a non-null challenge, role and bounded immutable responsibility set. `acquireTaskExecution` copies those fields with run/incarnation/attempt/lease into one Worker reservation; Task 5 begins/completes one State-backed inert allocation from that reservation, and Task 11 invokes Task 3 to atomically bind the exact allocation. No other service writes the binding. Compaction replacement closes old ingress, proves zero in-flight calls, allocates an identity-equal replacement, atomically swaps via Task 3 without a capacity transition, then opens only the replacement. Normal release validates exact current terminal proof and atomically releases capacity/invalidates binding without stopping detached activity. A pre-action attempt calls `cancelCapacityActivation` only with exact `WorkerActivationNonDispatchProof`; direct cancellation from `reserved` cites the reservation sequence and canonical absence of activation. For teardown setup failure, Task 11 receives `WorkerTeardownNonDispatchProof` only from Task 5 and invokes the nominal Supervisor State command to atomically restore occupied; wrong issuer/binding/sequence or any recorded ingress close/signal/action rejects it. Crash retry resumes the same reservation/allocation rather than a second slot. Gate each action by its required budget scope. Obtain the Launcher lock capability and use only Task 3's derived lifecycle binding for controller cleanup. On stop, ask the bound Launcher handle to stop/prove its current incarnation, pass both the exact current `RunLifecycleBinding` and opaque proof to `recordIncarnationStop(subject, proof)`, and use the returned `StateStopBinding` to revoke lifecycle authority, reconcile Model/Bridge calls and release lost leases. A stop binding alone, missing call rows or process absence cannot release Worker capacity; both accounting results are still required. Only after lifecycle revocation, Worker reconciliation and old lease handling may a successor dispatch. Preserve budgets/checkpoints and represent unproved stop as `interrupted + blocked_runtime` live or `invalid + blocked_runtime` formal. Deadline behavior remains unchanged.

During recovery, enumerate stopped-owner instance capacity from canonical State rather than checkpoint-owned refs. Fence A first, drain or quarantine every A operation/lease, then issue B while all mutation dispatch remains gated. For an unknown/pending ref, let Task 9 perform only retryable List and consume its authenticated observation through `reconcileStoppedOwnerInstance`; release stopped rows and pass each resulting/existing occupied A ref plus `stopA` and B to `succeedInstanceLifecycleOwner`. Persist returned refs, issue and resolve fresh B-incarnation grants from canonical target state, and acquire fresh B mutation leases before any target probe or Close. Retry from every boundary by reading phase/owner sequence/event; never re-reserve, re-occupy, copy A grants/leases, or treat successor issuance alone as mutation authority.

Both normal and recovered Worker release call Task 3 with `{ dimension: "worker_slots", proof }` in the same transaction that invalidates the execution binding. Neither `LauncherStopProof`, `StateStopBinding`, session absence nor an untyped terminal object is accepted directly by the budget ledger.

At incarnation start, pass one opaque run-lock capability to State and use only the resulting binding to populate every execution's complete identity. At fail-stop recovery, first turn the opaque Launcher proof into one State stop binding, then call Task 4 model reconciliation and Task 3 Bridge reconciliation with that binding and pass both accounting results to `proveRecoveredWorkerTerminal`; Supervisor never edits accepted-call rows. A phase-specific non-dispatch proof may cancel/abort only before canonical action-start; once ingress close, signal or another action is recorded, retain the pending/unknown phase until reconciliation.

- [ ] **Step 4: Implement integrity and intervention lifecycle**

Pause effect dispatch before secret/VPN refresh and compare canonical before/after challenge, Hint, instance, submission and score evidence. Missing or changed evidence makes formal invalid. Prohibited human actions and loss of exclusivity invalidate formal attribution; local unknown operations remain scoped. Commit blocker/fail-stop/recovery/recomputation business state at the same canonical sequence from which Task 3 derives coverage, and emit their correlated metric events independently. The external Launcher owns fail-stop/recovery intervals that cross Supervisor incarnations and records `durationMs` in its stable clock domain; a restarted process never subtracts unrelated local ticks.

- [ ] **Step 5: Verify host fail-stop and integrity matrices**

Run: `npm test -- packages/supervisor/test packages/runtime/test/process-tree.test.ts tests/integration/host-launcher-fail-stop.test.ts`

Expected: real external death cleans every pending/active launch; inability to verify stop yields only canonical blocked states, no `StateStopBinding`, no successor owner and no reusable Worker slot. Forged/released lock capabilities issue no lifecycle binding; structural/copied/stale/cross-incarnation stop proof issues no stop binding. Task/allocation/binding identity never has null challenge or expanded role/responsibility. Proved stop still cannot release Worker capacity until named Model and Bridge accounting is terminal/unknown; Task 11 alone consumes exact Bridge evidence to restore a pre-action teardown, while post-action teardown abort fails; old lifecycle/session bindings emit zero bytes; same-capacity replacement never reactivates or overlaps. Budgets/deadlines do not reset, released sessions cannot dispatch, unrelated scopes continue, accepted results survive, unknown operations quarantine only their scope, and prohibited interventions cannot remain formal-valid.

Occupied instance recovery additionally proves stop -> authority/grant/lease/effect fence -> successor issuance -> State succession ordering. Capacity and authorization history stay unchanged, stale refs emit zero bytes, and B (or a fully linked current descendant) can observe/Close without another slot.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: add supervisor lifecycle and recovery`.

### Task 12: Close the M0 deterministic Gate

**Files:**
- Create: `.github/workflows/m0-host.yml`
- Create: `packages/supervisor/src/build-identity.ts`
- Create: `scripts/live-build-identity.ts`
- Create: `tests/gates/m0-host.test.ts`, `tests/gates/m0-crash-matrix.test.ts`, `tests/gates/m0-config-boundary.test.ts`, `tests/gates/m0-budget-metrics.test.ts`, `tests/gates/m0-host-fail-stop.test.ts`, `tests/gates/build-identity.test.ts`
- Create: `docs/gates/m0-host-foundation.md`
- Modify: `apps/cli/src/commands/doctor.ts`, root npm scripts

**Interfaces:**
- Consumes: all M0 services from Tasks 1-11.
- Produces: canonical `LIVE_BUILD_INCLUDED_PATHS`, `computeBuildIdentity(input: BuildIdentityInput): Promise<BuildIdentity>`, `verifyBuildIdentity(suppliedId, computed): BuildIdentityVerification`, `npm run live-build:identity -- --output <candidate-manifest>`, and `npm run gate:m0 [-- --build-identity <id>]`. Included source coverage is root package/workspace/TypeScript/Vitest/build config, `apps/**`, `packages/**`, `config/**`, `fixtures/**`, `scripts/**`, `tests/**`, `docker/**` and evidence-issuing `.github/workflows/**`; scripts/tests are included regardless of executable bit. The policy must include every file imported, executed or read by M0/M1/M2/M3 readiness evidence commands. Compiled executable artifact, lockfile and Node/OpenCode/toolchain identities are separate fields; mutable state and sanitized report exports are excluded. A supplied ID is always recomputed and compared before evidence issuance.

**Depends on:** Tasks 1-11.

- [ ] **Step 1: Write the failing end-to-end M0 fixture**

```ts
it("completes a scoped tool loop without leaking secrets or bypassing effects", async () => {
  expect(await runM0Fixture()).toMatchObject({ outcome: "passed", falseSuccesses: 0, leakedSecrets: 0 });
});
it("derives the M0 result from canonical boundary events", async () => {
  const result = await inspectM0CanonicalTrace();
  expect(result).toMatchObject({ unmanagedToolCalls: 0, configSentinelsExecuted: 0, budgetOverspends: 0, overlappingMutationOwners: 0, survivingProcesses: 0 });
});
it("detects a supplied build identity mismatch without echoing it", async () => {
  expect(await runM0WithIdentityFromDifferentBytes()).toMatchObject({ evidenceIssued: false, code: "build_identity_mismatch" });
});
it.each(["tests/contract/opencode-1.19.test.ts", "tests/integration/opencode-session-binding.test.ts", "scripts/live-build-identity.ts", ".github/workflows/m0-host.yml"])("changes identity when evidence input %s changes", async (path) => {
  expect(await mutateIncludedEvidenceInput(path)).toMatchObject({ identityChanged: true, oldEvidenceAccepted: false });
});
it("covers unregistered spawn windows with independent process observation", async () => {
  expect(await inspectM0SpawnCrashMatrix()).toMatchObject({ payloadHeartbeatsBeforeActivation: 0, independentlyObservedSurvivors: 0, falseStopProofs: 0 });
});
it("serializes every managed Runtime, Browser and Platform mutator on one canonical key", async () => {
  expect(await inspectM0MutationMatrix()).toMatchObject({ exercisedOwners: ["job", "channel", "http_session", "listener", "browser", "platform"], sameScopeOverlaps: 0, browserProofsWithOpenRequests: 0, invalidBindingProcessStarts: 0, invalidBindingNetworkBytes: 0, differentChallengeConcurrency: true, localAttachmentConcurrency: true });
});
it("rejects every cross-kind, stale-generation and non-quiescent terminal proof at M0", async () => {
  expect(await inspectM0TerminalProofMatrix()).toMatchObject({ invalidManagedProofsAccepted: 0, invalidCapacityProofsAccepted: 0, prematureLeaseReleases: 0, prematureCapacityReleases: 0 });
});
it("keeps protected dispatch families, lifecycle bindings and broker accounting non-bypassable", async () => {
  expect(await inspectM0ProtectedBoundaryMatrix()).toMatchObject({ publicDispatcherFactories: 0, publicInternalSubpaths: 0, unauthorizedRelativeInternalImports: 0, structuralDispatcherForgeries: 0, publicBroadDispatcherSignatures: 0, crossFamilyBytes: 0, crossFamilyReconciliations: 0, reconciliationReleasesFromAbsence: 0, structuralNetworkGrantsAccepted: 0, staleOrWrongConsumerGrantResolutions: 0, staleLifecycleBytes: 0, brokerRequests: 1, protectedMutationLeases: 1, rawBypassBytes: 0 });
});
it("replays a broker-committed Runtime response after fresh dispatcher and Bridge startup", async () => {
  expect(await inspectM0RuntimeResponseRecovery()).toMatchObject({ callerEvidenceInputs: 0, brokerRequests: 1, protectedDispatches: 1, canonicalTerminalTransitions: 1, bridgeCompletionTransitions: 1, bridgeStates: ["returned", "returned"], resultRefs: [expectedResultRef, expectedResultRef], terminalSequences: [expectedTerminalSequence, expectedTerminalSequence], responseBytes: [expectedFramedResponseBytes, expectedFramedResponseBytes], volatileBrokerResponseUsed: false });
});
it.each(["missing-response", "digest-mismatch"])("fails M0 Runtime/Bridge recovery closed on %s", async (kind) => {
  expect(await inspectM0RuntimeResponseCorruption(kind)).toMatchObject({ code: "canonical_runtime_response_corrupt", bridgeTransitions: 0, responseReturned: false, recoveredWorkerProofIssued: false });
});
it.each(["final-classification", "final-precondition", "lease-deadline", "transport-open-no-byte", "post-mark-crash"])("settles every M0 dispatcher-entry failure at %s", async (point) => {
  expect(await inspectM0DispatcherEntryFailure(point)).toMatchObject({ operationKindsCovered: ["first_list", "submit", "hint", "remote_unit", "start", "close"], invalidMixedInputsAccepted: 0, bytesSent: 0, strandedReservations: 0, wrongPhaseCancellations: 0, unownedPreparedCalls: 0 });
});
it("keeps the State kernel and service authorities unavailable outside host composition", async () => {
  expect(await inspectM0StateAuthorityMatrix()).toMatchObject({ publicStateKernels: 0, publicGenericTransactions: 0, publicRawEventOrOutboxWriters: 0, nonStateSqliteDependencies: 0, leakedStatePaths: 0, productionTestAuthorityImports: 0, structuralLauncherClientsAccepted: 0, structuralStatePortsAccepted: 0, forgedStatePortError: "state_port_authority_required", crossServiceWrites: 0 });
});
it.each(["worker", "browser", "instance"])("keeps %s capacity unavailable and reconcilable through activation/teardown crashes", async (kind) => {
  expect(await inspectM0CapacityPhaseMatrix(kind)).toMatchObject({ overcommits: 0, duplicateActivations: 0, unauthorizedConsumerDispatchesBeforeOccupancy: 0, unknownActiveReconciliations: 2, unknownStoppedReconciliations: 2 });
});
it.each(["run_lifecycle", "coordinator_execution"])("preserves M0 lifecycle instance ownership for %s authorization", async (authorizationKind) => {
  expect(await inspectM0InstanceOrigin(authorizationKind)).toMatchObject({ authorizationKind, ownerKind: "run_lifecycle", ownerDerivedByState: true, reservationPrepareOwnerMismatches: 0, fabricatedOrStaleReservations: 0, wrongHistoricalAuthorizationCancellations: 0, closeAfterExecutionRelease: true });
});
it("keeps one occupied instance reservation across verified A-to-B lifecycle succession", async () => {
  expect(await inspectM0InstanceSuccession()).toMatchObject({ stopBindings: 1, oldGrantResolutionsAfterFence: 0, oldLeasesAtSuccession: 0, successionRows: 1, reservations: 1, occupancyProofs: 1, ownerSequences: [expectedOwnerSequenceA, expectedOwnerSequenceB], generationChanged: false, authorizationChanged: false, successorGrantRows: 1, successorGrantResolutions: 1, successorTargetProbeBytes: 1, staleOwnerBytes: 0, successorCloseRequests: 1 });
});
it.each(["activation_unknown", "teardown_pending", "teardown_unknown"])("uses current-successor List to reconcile M0 stopped-owner %s before succession", async (phase) => {
  expect(await inspectM0StoppedOwnerObservationRecovery(phase)).toMatchObject({ activePathSuccessionRows: 1, stoppedPathSuccessionRows: 0, mutationBytesBeforeSuccession: 0, strandedSlots: 0 });
});
it.each(["model_tokens", "tool_wall_ms", "submissions", "hints", "remote_units"])("uses only the dimension/issuer-bound dispatch proof to cancel no-action %s", async (dimension) => {
  expect(await inspectM0ConsumableCancellation(dimension)).toMatchObject({ bytesSent: 0, dispatchProofCancellations: 1, crossPhaseCancellations: 0, refundedSettledUnits: 0 });
});
it("keeps task, allocation and execution responsibility identity immutable", async () => {
  expect(await inspectM0ExecutionIdentityMatrix()).toMatchObject({ nullChallengeBindings: 0, roleChangesAccepted: 0, responsibilityExpansionsAccepted: 0, invalidBindingBytes: 0, solverSubmissionIntents: 0, verifierSubmissionIntents: 0, staleCoordinatorSubmissionIntents: 0 });
});
it("covers no-byte Close rollback, Worker fail-stop accounting and occupied-capacity session handoff", async () => {
  expect(await inspectM0LifecycleRecoveryMatrix()).toMatchObject({ lockCapabilityForgeriesAccepted: 0, stopCapabilityForgeriesAccepted: 0, crossSubjectStopProofsAccepted: 0, stateStopBindingsWithoutVerifiedStop: 0, preActionWorkerTeardownAborts: 1, wrongIssuerWorkerTeardownAborts: 0, strandedTeardownPending: 0, strandedPredispatchReservations: 0, postActionTeardownAborts: 0, freshProcessBridgeRetryDuplicates: 0, changedInvocationReplaysAccepted: 0, startedBridgeDownstreamsWithoutAtomicLink: 0, bridgeCallsWithoutTerminalAccounting: 0, releasesBeforeStopAndAccounting: 0, handoffCapacityReactivations: 0, overlappingSessions: 0 });
});
```

- [ ] **Step 2: Run the complete Gate and record failures by contract**

Run: `npm run gate:m0`

- [ ] **Step 3: Implement the shared build-identity computation and mismatch contract**

Compute every `BuildIdentity` field from bytes/tool versions using `LIVE_BUILD_INCLUDED_PATHS`; never copy the supplied ID into output or filter scripts by mode bit. Fail identity computation if an evidence command resolves an imported/executed/config input outside the declared included roots, except mutable state and explicitly sanitized report exports. Keep final evidence collection/sealing out of this helper so Task 20 can reuse it without a dependency cycle.

- [ ] **Step 4: Add macOS/Linux CI and fill only missing integration wiring**

Do not add new product scope. CI must run deterministic tests on both supported host families and publish the doctor/capability report.

- [ ] **Step 5: Re-run the Gate**

Run: `npm ci && npm run typecheck && npm run build && npm run test:deterministic && npm run gate:m0`

Acceptance: identity/scope/deadline; opaque Launcher lock/stop/client verification plus subject-bound State stop binding; no public State kernel/generic mutation/test authority/cross-service writer; shared build identity; per-action budget races; distinct dispatch-phase consumable, activation-phase capacity and teardown-phase rollback proofs; atomic owned disposition with zero stranded reservations across every Platform reservation-to-dispatch and dispatcher-entry fault; State-derived lifecycle instance ownership with separately retained lifecycle/Coordinator authorization plus historical-authorization cancellation and post-execution lifecycle cleanup; Worker/Browser/instance crash reconciliation; no consumable refund; State-validated non-null run/challenge/incarnation/task/role/responsibility/session identity; Coordinator-authorized intent creation with Solver/Verifier zero writes; managed mutation interleavings; compile-time nominal Platform/Runtime dispatchers with no public or directly importable internal factory/binding; stale-binding zero-byte denial; metrics/runtime/broker/effect/artifact/config/provenance behavior; durable fresh-process Bridge invocation replay with State-allocated IDs and atomic downstream preparation; occupied-capacity handoff; fail-stop Worker release only after verified stop plus Model and Bridge accounting; every gated-spawn crash window; real external fail-stop; intervention integrity and browser lifecycle all pass. Missing Linux-only capability is reported, not faked.

- [ ] **Step 6: Commit if authorized**

Suggested message: `test: close host foundation gate`.

## M1 Solver Loop

### Task 13: Implement adaptive responsibilities and the hypothesis/experiment loop

**Files:**
- Create: `packages/supervisor/src/work-graph.ts`, `responsibilities.ts`, `intake.ts`, `hypotheses.ts`, `experiments.ts`, `repair-policy.ts`, `strategy.ts`
- Create: `packages/contracts/src/solver.ts`
- Test: `packages/supervisor/test/intake.test.ts`, `solver-loop.test.ts`, `strategy.test.ts`, `repair-policy.test.ts`

**Interfaces:**
- Consumes: bound OpenCode sessions with Task 5 `ActionProvenance`, Runtime tools, Task 9 admission records and `AdmissionClassifier` from M0.
- Produces: `classifyChallenge(input: AdmissionInput): Promise<EvidenceBackedClassification>` and `modelAdmissionClassifier: AdmissionClassifier` implementing Task 2, plus `createSolverTask(responsibilitySet: ResponsibilitySet)`, `deriveRemoteActivityContext(execution: ExecutionBinding, experiment, operation, grant): RemoteActivityContext`, `recordExperimentResult`, `classifyFailure`, `selectNextRoute`; `TaskResult` exactly matches spec section 6.2. Task creation validates a non-empty Solver-role subset and freezes it; every experiment/action declares one responsibility contained in that set plus canonical `state_dependencies`. Network-capable activity defaults mutation-capable unless a server grant proves read-only. Context derivation first validates the whole current binding, including challenge/role/responsibility/session allocation, and derives owner only from it; no raw identity/owner or responsibility override exists. Every model-selected action stores trusted provenance and consumed refs; deterministic actions retain distinct origin.

**Depends on:** Task 12.

- [ ] **Step 1: Write failing same-session repair and falsifier route tests**

```ts
it("keeps syntax and parse repair in the same solver task", async () => {
  expect(await runRepairFixture()).toMatchObject({ solverTaskCount: 1, strategyFallbacks: 0 });
});
it("does not retry a falsified fingerprint", async () => {
  expect((await runFalsifierFixture()).attemptedFingerprints).toEqual(["route-a", "route-b"]);
});
it("does not infer category from challenge ID or level", async () => {
  expect(await classifyChallenge({ id: "web-100", level: 1, observableMaterials: [] })).toMatchObject({ category: "ambiguous" });
});
it("replaces the M0 fail-closed classifier only through the admission interface", async () => {
  expect(await admitWithM1Classifier(observableWebEvidence())).toMatchObject({ evaluationCategory: "web", evidenceRefs: expect.any(Array) });
});
it("cannot upgrade a deterministic or harness action to model origin", async () => {
  expect(await recordSolverAction(forgedModelOrigin())).toMatchObject({ origin: "harness_injection", trustedModelLineage: false });
});
it("gives same-resource network Job and Browser actions the same mutation key", async () => {
  expect(await deriveExperimentActivityContexts()).toMatchObject({ jobScopeKey: expectedResourceKey, browserScopeKey: expectedResourceKey, jobOwner: expectedExecutionOwner, browserOwner: expectedExecutionOwner, modelDowngradeAccepted: false });
});
it.each(["channel", "http_session", "listener"])("gives same-resource %s the canonical managed mutation context", async (kind) => {
  expect(await deriveManagedNetworkContext(kind)).toMatchObject({ access: "mutation", scopeKey: expectedResourceKey, owner: expectedExecutionOwner });
});
it("keeps pure attachment computation outside remote mutation ownership", async () => {
  expect(deriveRemoteActivityContext(currentExecution, localAttachmentExperiment(), localJob(), localOnlyGrant())).toMatchObject({ access: "local", scopeKey: undefined, owner: expectedExecutionOwner });
});
it.each(["stale-binding", "mismatched-run", "mismatched-challenge", "mismatched-incarnation", "mismatched-role", "unbound-responsibility"])("rejects managed activity from %s before process or network bytes", async (kind) => {
  expect(await dispatchManagedActivityWithInvalidBinding(kind)).toMatchObject({ code: "execution_binding_stale", childProcesses: 0, networkBytes: 0, mutationLeases: 0 });
});
```

- [ ] **Step 2: Run solver tests and confirm failure**

Run: `npm test -- packages/supervisor/test/intake.test.ts packages/supervisor/test/solver-loop.test.ts packages/supervisor/test/strategy.test.ts`

- [ ] **Step 3: Implement intake, structured responsibilities, hypotheses, experiments and semantic-progress windows**

Preserve raw statement/material/source metadata, classify from observable evidence and retain ambiguous/out-of-scope items. Export `modelAdmissionClassifier` rather than modifying Task 9. Validate and freeze each role-bounded responsibility set at task creation; every model action/output carries a responsibility already in the current binding, and no runtime path can expand it or switch challenge/Verifier identity. Allow one primary route plus one counterprobe; only premise/resource changes or exhausted repair budget return to Strategy. Resolve resource key/generation from canonical dependencies and grants, validate the complete Task 11 binding, and derive ownership before Tasks 6/7/10 activation. Reject stale identity, unbound responsibility, access downgrade or owner substitution before bytes. Managed RPC return is not activity terminal. Emit canonical solver business/metric events with task/attempt/fingerprint, immutable origin and consumed refs.

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
- Consumes: Job Runtime and transactional outbox, Task 11 `acquireTaskExecution`/`bindSession`/`cancelTaskExecution`/`releaseTaskExecution`, and Task 5 inert session allocation, post-bind activation and issuer-bound deactivation proof.
- Produces: `job.watch(jobId, cursor, continuationRef)`, `claimContinuation(eventId, taskId): Promise<ContinuationClaim>`, `acquireContinuationExecution(claimId): Promise<WaitingForCapacity | ContinuationExecution>`, `resumeContinuation(execution: ContinuationExecution)`. `ContinuationClaimState = pending | claimed_waiting_capacity | execution_reserved | session_allocated | ready | running | completed | failed | deadline_exceeded`; `ContinuationExecution` contains a newly allocated `ExecutionBinding` with the same canonical challenge/role/responsibility set as the logical task and a new attempt/lease/session/reservation. The old execution remains terminal.

**Depends on:** Tasks 5, 11 and 13.

- [ ] **Step 1: Write failing duplicate-delivery and lost-job tests**

```ts
it("grants exactly one runnable continuation for duplicate terminal events", async () => {
  expect(await deliverTerminalEventTwice()).toMatchObject({ runnableClaims: 1 });
});
it("waits for Worker capacity without losing or prematurely running the claim", async () => {
  expect(await completeAWhileBOwnsOnlyWorker()).toMatchObject({ aStateWhileBActive: "claimed_waiting_capacity", aModelTurnsWhileBActive: 0, aRunsAfterBTerminal: 1 });
});
it("rebinds continuation to a new attempt, lease, session and Worker reservation", async () => {
  expect(await resumeAfterWorkerRelease()).toMatchObject({ oldSessionDispatches: 0, oldReservationAccepted: false, newSessionDispatches: 1, cumulativeUsageReset: false });
});
it("cannot expand responsibility while reacquiring a continuation execution", async () => {
  expect(await resumeWithExpandedResponsibility()).toMatchObject({ bindingsWritten: 0, modelRequests: 0, code: "execution_identity_conflict" });
});
it.each(["after-claim", "after-reservation", "after-session-allocation", "after-bind-before-activation", "after-worker-activation-intent", "after-session-enable-before-occupancy", "after-ready", "during-running"])("recovers %s without dropping or duplicating next action", async (point) => {
  expect(await crashContinuationReacquire(point)).toMatchObject({ nextActions: 1, activeWorkerReservations: 1, duplicateModelTurns: 0 });
});
it("expires a capacity-waiting continuation without a model request", async () => {
  expect(await reachDeadlineWhileWaitingForWorker()).toMatchObject({ claimState: "deadline_exceeded", modelRequests: 0, nextActions: 0 });
});
```

- [ ] **Step 2: Run watch tests and confirm failure**

Run: `npm test -- packages/runtime/test/watch.test.ts packages/supervisor/test/continuations.test.ts`

- [ ] **Step 3: Implement the durable claim and execution-reacquisition state machine**

Persist job, waiting logical task with its immutable challenge/role/responsibility set, experiment, cursor, original `WorkerTerminalProof`, deadline and next-action key; a detached Job may remain active. All terminal job outcomes create one claim. Claiming waits durably for capacity. Call Task 11 with a claim-derived acquire key so crash retry returns the same new reservation carrying the task's unchanged identity. Ask Task 5 for one State-backed inert allocation from that reservation and persist its allocation ID; then call idempotent Task 11 bind and Task 5 activation. Only occupied proof permits `running`. Every bind/activation crash resumes the same allocation/record. Cancel a proved-never-activated attempt only with `WorkerActivationNonDispatchProof`; release occupied/unknown only after quiescence/terminal proof. During running, inspect canonical dispatch records and repeat only proved-undispatched actions. Reject old identity and preserve cumulative ledgers. Deadline applies the matching cancellation/release rule without a model request.

- [ ] **Step 4: Emit continuation timing and ownership events**

Emit blocker/wait-open, terminal, unique continuation-claim, capacity-wait/reserved/activation-intent/occupied and session-allocated/bound/activated events with producer, clock-domain and continuation correlation so waiting cost and wake latency are reconstructable without model polling. Wake-up/claim/capacity scheduling is `deterministic_control`; a later Solver tool action retains its own provenance.

- [ ] **Step 5: Verify without model polling**

Run: `npm test -- packages/runtime/test/watch.test.ts packages/supervisor/test/continuations.test.ts`

Expected: Worker can exit while job runs; duplicate outbox delivery cannot repeat the continuation; a full Worker pool leaves the claim durably waiting; only a Supervisor-bound, capacity-occupied and Bridge-activated new execution/session can run one next action; every allocation/bind/activation/occupancy/running crash substate resumes or blocks without a second slot/session/model turn; deadline branches release/cancel with the required proof and do not lose or duplicate work.

- [ ] **Step 6: Commit if authorized**

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
- Modify: `packages/contracts/src/candidate.ts`, `packages/contracts/src/verification.ts`
- Test: `packages/supervisor/test/candidate-flow.test.ts`, `verification.test.ts`, `submission.test.ts`

**Interfaces:**
- Consumes: published artifacts, independent task/session creation, Task 5 action provenance, Task 3 nominal `CandidateStatePort`, Task 2 `PlatformEffectIntentContext`/`ProtectedDispatchContext`, Task 7 sole protected-effect dispatch outlet, Task 9 Platform Service intent preparation/sealing and the managed mutation activity shared by network Job/Channel/HTTP/Listener/Browser owners.
- Produces: `registerCandidate(input): Promise<CandidateRevision>`, `publishSolution(candidateRevisionId, refs): Promise<EngineeredCandidate>`, `verifyCandidate(input, mode: replay|recompute|evidence_audit): Promise<VerificationRevision>`, `proposeSubmission(coordinator: ExecutionBinding, candidateRevisionId, verificationRevisionId): Promise<SubmissionIntent>`, `handleSubmissionResult(operationId, result)`. `proposeSubmission` delegates the exact trusted binding to `CandidateStatePort`; State validates current occupancy, same challenge, `role: "coordinator"`, and immutable `submitting` responsibility and persists that canonical proposer sequence atomically with the intent. No intent exists before this check. Verification creates a different Task 11 task/session for the same non-null challenge with `role: "verifier"` and immutable `responsibilitySet: ["verifying"]`; it cannot reuse/expand the Solver binding. Candidate diagnosis and post-result decisions preserve initiating provenance; deterministic Platform delivery is not model reasoning.
- Produces: exact continuation ownership: publish error -> Engineer/original Solver repair; `rejected` -> terminal candidate revision plus same Solver findings; `inconclusive` -> safe evidence-capture continuation or parked candidate; `stale` -> only affected Engineering/Verification revisions.

**Depends on:** Tasks 7, 9, 11, 13 and 15.

- [ ] **Step 1: Write failing independence, gap, stale and rejection tests**

```ts
it("rejects verification when the evidence range has a cursor gap", async () => {
  expect(await verify(gappedEvidence())).toMatchObject({ status: "inconclusive" });
});
it("continues after verified candidate is rejected by the platform", async () => {
  expect(await rejectVerifiedCandidate()).toMatchObject({ solved: false, nextStage: "solving" });
});
it.each(["replay", "recompute", "evidence_audit"])("enforces the %s verification contract", async (mode) => {
  expect(await runVerificationMode(mode)).toMatchObject({ mode, checkedCandidateBytes: true, immutableEvidenceOnly: true });
});
it("does not mutate a one-shot target for verification", async () => {
  expect(await auditOneShotCandidate()).toMatchObject({ newConnections: 0, resets: 0, extraQueries: 0 });
});
it("uses a distinct verifier task whose only responsibility is verifying", async () => {
  expect(await inspectVerifierBinding()).toMatchObject({ sameChallenge: true, distinctTask: true, role: "verifier", responsibilitySet: ["verifying"], solverCapabilitiesAccepted: 0 });
});
it.each(["solver", "verifier", "stale-coordinator", "coordinator-without-submitting"])("writes zero submission intents for %s authority", async (kind) => {
  expect(await proposeSubmissionWithInvalidAuthority(kind)).toMatchObject({ submissionIntents: 0, submissionEvents: 0, submissionOutboxRows: 0, platformCalls: 0 });
});
it("persists the current Coordinator binding sequence with the submission intent", async () => {
  expect(await proposeSubmissionWithCoordinator()).toMatchObject({ proposer: { role: "coordinator", responsibility: "submitting", bindingSequence: expectedCoordinatorBindingSequence }, submissionIntents: 1 });
});
it.each(["expired", "generation_changed", "related_unknown"])("rechecks %s at actual Submit dispatch", async (change) => {
  expect(await invalidateQueuedSubmission(change)).toMatchObject({ submitBytes: 0, submissionState: "failed_not_dispatched" });
});
it("deduplicates the same intent and rejects the same ID with different candidate bytes", async () => {
  expect(await exerciseSubmissionIdentity()).toMatchObject({ submitRequests: 1, payloadConflictRejected: true });
});
it("never overlaps a queued verified Submit when a same-resource generation mutation wins", async () => {
  expect(await raceSubmitWithResourceRestart("restart-first")).toMatchObject({ overlappingMutationOwners: 0, staleSubmitBytes: 0, newGenerationStarted: true });
});
it("waits to Submit while a same-resource network Job owns the managed mutation lease", async () => {
  expect(await raceSubmitWithMutationJob()).toMatchObject({ overlappingMutationOwners: 0, submitRequestsBeforeJobTerminal: 0, postTerminalDecision: "precondition_revalidated" });
});
it.each(["channel", "http_session", "listener"])("waits to Submit while a same-resource %s activity owns the lease", async (kind) => {
  expect(await raceSubmitWithManagedNetworkActivity(kind)).toMatchObject({ overlappingMutationOwners: 0, submitRequestsBeforeActivityTerminal: 0, postTerminalDecision: "precondition_revalidated" });
});
```

- [ ] **Step 2: Run candidate tests and confirm failure**

Run: `npm test -- packages/supervisor/test/candidate-flow.test.ts packages/supervisor/test/verification.test.ts packages/supervisor/test/submission.test.ts`

- [ ] **Step 3: Implement immutable candidate revisions, all verification modes and verifier capability restrictions**

Bind verification to candidate bytes/hash, solution, inputs, generation, evidence refs and `validUntil`. Create the verifier through Task 11 with the same challenge but a distinct task, role and exact verifying-only responsibility set; allocate/bind its session through Tasks 5/3 and validate that binding on every action. `replay` is allowed only when it consumes no one-shot/hard-limited state; `recompute` uses saved local inputs; `evidence_audit` requires complete ordered transcript and non-replay reason. Verifier has no Submit/Hint/instance/reset/new one-shot capability. Implement each branch owner/next action.

- [ ] **Step 4: Integrate stable submission identity and dispatch-time validation**

Pass the trusted current Coordinator `ExecutionBinding` into `CandidateStatePort.proposeSubmission`; persist one `SubmissionIntent` per exact candidate/verification revision only after State atomically validates and records its canonical proposer. Task 9 resolves that intent using the same still-current binding/proposer sequence, constructs an empty-ref `PlatformEffectIntentContext`, asks Task 8 only for pure wire mapping, computes actual wire identity, asks Task 7 to prepare the submission reservation, seals the returned refs into `ProtectedDispatchContext`, and dispatches without changing operation/payload/owner/scope/proposer identity. Task 7 alone acquires the embedded mutation context, atomically marks dispatching after the final check and invokes bound Platform transport. Expiry, generation change, released/replaced proposer binding, related unknown or a same-resource managed Job/Channel/HTTP/Listener/Browser owner prevents Submit bytes; retries with the same ID only read canonical state. Emit candidate/Engineer/Verifier/queue/dispatch/result events plus the exact `candidate.diagnosed` event on rejection, with stable stage, result refs and action provenance correlation.

- [ ] **Step 5: Verify candidate state and dispatch matrices**

Run: `npm test -- packages/supervisor/test/candidate-flow.test.ts packages/supervisor/test/verification.test.ts packages/supervisor/test/submission.test.ts`

Expected: only a current Coordinator binding with immutable `submitting` responsibility can create an intent, and Solver/Verifier/stale bindings write zero intent/event/outbox rows; only Platform Service executes it under the same recorded proposer sequence; Verifier always has a distinct same-challenge task/session and verifying-only responsibility; every mode/failure has a canonical owner/next action; stale/unknown candidates emit zero Submit bytes; partial acceptance preserves score/slot and continues.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: add independent candidate verification`.

### Task 17: Implement compaction and session reconstruction

**Files:**
- Create: `packages/supervisor/src/working-set.ts`, `session-recovery.ts`
- Modify: `packages/opencode-bridge/src/sessions.ts`
- Test: `packages/supervisor/test/compaction.test.ts`, `session-recovery.test.ts`

**Interfaces:**
- Consumes: checkpoints, artifact refs, OpenCode compaction hooks, work graph and the current Task 11 `ExecutionBinding`; reconstruction cannot revive a released attempt/session and uses Task 14's newly rebound execution after a continuation wait.
- Produces: `buildWorkingSet(snapshot)`, `compactAndCheckpoint(sessionId)`, `recreateSession(taskId, snapshotSequence)` plus canonical business records and metric events `compaction.started/completed`, `session.recreated`, `artifact.range_read`, `fingerprint.dispatched` and `next_action.completed` with task/snapshot/ref/fingerprint correlation. `recreateSession` asks Task 5 for an inert `UnboundSessionAllocation` using the exact current reservation plus task/snapshot allocation key, obtains `SessionHandoffProof` after old-session quiescence, calls Task 11 `replaceBoundSession(currentBinding, replacementAllocation, proof)`, then calls Task 5 `activateReplacementSession`. It cannot write State binding, first-activate capacity, change challenge/role/responsibility or alter reservation. Retry around the atomic swap returns the same allocation/proof and opens only the canonical current session. Business activity is committed at the State coverage sequence but is not metric-production proof.

**Depends on:** Tasks 13-16.

- [ ] **Step 1: Write failing raw-retrieval and no-repeat tests**

```ts
it("retrieves the cited raw range after compaction", async () => {
  expect(await compactThenInspect()).toMatchObject({ rawBytesRecovered: true });
});
it("executes the saved next action without rerunning a rejected fingerprint", async () => {
  expect((await rebuildSession()).executed).toEqual(["saved-next-action"]);
});
it("rejects session reconstruction against a released execution binding", async () => {
  expect(await reconstructWithReleasedBinding()).toMatchObject({ sessionsCreated: 0, code: "execution_binding_stale" });
});
it("rejects a replacement allocation that expands the current responsibility set", async () => {
  expect(await reconstructWithExpandedResponsibility()).toMatchObject({ sessionsCreated: 0, bindingsSwapped: 0, code: "session_allocation_identity_mismatch" });
});
it.each(["before-handoff-proof", "after-proof-before-swap", "after-swap-before-activation"])("recovers session handoff crash %s without overlap or capacity reactivation", async (point) => {
  expect(await recoverSessionHandoff(point)).toMatchObject({ workerReservations: 1, activationIntents: 1, occupancyProofs: 1, concurrentlyDispatchableSessions: 1, oldSessionDispatchesAfterProof: 0, replacementSessionIds: [expectedReplacementSessionId] });
});
```

- [ ] **Step 2: Run recovery tests and confirm failure**

Run: `npm test -- packages/supervisor/test/compaction.test.ts packages/supervisor/test/session-recovery.test.ts`

- [ ] **Step 3: Implement compact working sets as pointers, not evidence replacements**

Validate dependency versions, resource generation and the current execution attempt/lease/occupied Worker reservation before continuing; stale only the affected engineering/verification revision. Normal compaction allocates one inert replacement, asks Task 5 to close old ingress and prove zero model/tool calls, delegates the proof-bound atomic same-execution swap to Task 11, and asks Task 5 to open the replacement without a capacity activation/occupancy transition. Persist each handoff phase so a crash never reopens the old session or creates another replacement. A long-job continuation instead first consumes Task 14's newly acquired/first-activated binding and can never use this handoff protocol to revive its released predecessor.
Emit the exact Task 2 business and metric event names for compaction start/completion, raw-range retrieval, reconstructed session, fingerprint dispatch and next-action completion in one canonical transaction. Include producer, clock domain, snapshot sequence and relevant refs; `fingerprint.dispatched` records whether it was previously rejected. Do not self-report compaction completeness or N/A: at terminal projection Task 3 derives no-compaction `not_applicable` from canonical business absence, while retained compaction business records with deleted metric events must project as `missing`.

- [ ] **Step 4: Verify forced compaction and new-session paths**

Run: `npm test -- packages/supervisor/test/compaction.test.ts packages/supervisor/test/session-recovery.test.ts`

Expected: handoff waits for zero in-flight model/tool calls, preserves one occupied Worker reservation with no second activation/occupancy event, survives every pre/post-swap crash idempotently, and never permits old and replacement sessions to dispatch concurrently.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: recover solver work across compaction`.

### Task 18: Build domain fixtures and pass the six M1 model trajectories

**Files:**
- Create: `fixtures/solver/{repair,route-switch,long-job,compaction,rejected-submit,partial}/**`
- Create: `fixtures/domains/{web,misc,crypto}/**`
- Create: `packages/supervisor/src/domain-methods.ts`
- Create: `tests/gates/m1-domain-capability.test.ts`, `tests/gates/m1-model-trajectories.test.ts`, `tests/gates/m1-metrics.test.ts`, `tests/gates/trajectory-oracle.ts`, `tests/gates/model-runner.ts`
- Create: `docs/gates/m1-solver-loop.md`
- Modify: `config/release-profile.schema.json`, root npm scripts

**Interfaces:**
- Consumes: complete M1 solver stack, Task 12's shared `computeBuildIdentity`/included-path policy, read-only budget snapshots and `MetricProjectionInput` through Task 3's nominal `ReportingStatePort`, canonical metric producers from Tasks 3-7, 9-11 and 13-17, and fixed model/profile input.
- Produces: evidence-driven Web/Misc/Crypto method templates, functional domain capability fixtures, and `TrajectoryDefinition { input, injection, requiredEvents, forbiddenEvents, requiredModelActions, allowedDeterministicControls, terminalCondition, budgetProfile }` for each of the six named trajectories.
- Produces: `ModelRunAttestation { runKind: model_capability | oracle_fixture, runId, cleanStateRef, gatewayRequestIds, buildIdentity?: BuildIdentity }`, `validateTrajectoryContract(definition, canonicalEvents, artifacts, fixtureState): ContractVerdict`, `evaluateModelTrajectory(definition, canonicalEvents, artifacts, fixtureState, attestation): TrajectoryVerdict`, and `npm run gate:m1 -- --trajectory <name> --runs 3 [--build-identity <id>]`. The deterministic validator checks fixture injection, event/order, authority and terminal logic but always returns `eligibleForModelGate: false`; the model evaluator additionally validates response -> action -> tool result -> artifact/outcome lineage for every `requiredModelAction`. Only a runner-created `model_capability` attestation whose request IDs exist in Task 4 events is eligible for 2/3; oracle fixtures, deterministic runs and harness actions never count. If an identity is supplied, every per-run result embeds Task 12's full recomputation and mismatch fails before model dispatch.

**Depends on:** Tasks 3, 12 and 13-17 plus the M1 External Input Gate.

- [ ] **Step 1: Write failing event-plus-coverage assertions for all three domains, six trajectories and M1 metrics**

```ts
it.each(["repair", "route-switch", "long-job", "compaction", "rejected-submit", "partial"])("validates the deterministic %s contract without counting a model success", async (name) => {
  const trace = await runDeterministicTrajectory(name);
  expect(validateTrajectoryContract(definitions[name], trace.events, trace.artifacts, trace.fixtureState)).toMatchObject({ status: "valid", eligibleForModelGate: false });
});
it.each(["web", "misc", "crypto"])("executes a real bounded %s experiment", async (domain) => {
  const trace = await runDomainFixture(domain);
  expect(trace.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "experiment.dispatched" }), expect.objectContaining({ type: "observation.visible" }), expect.objectContaining({ type: "artifact.published" })]));
  expect(trace.authoritativeCandidateRef).toBeDefined();
});
it("recomputes latency and cost from fake-clock source events", async () => {
  expect(projectMetrics(rawFakeClockProjectionInput())).toMatchObject({ firstExperimentMs: { status: "measured", value: 80 }, observationVisibleMs: { status: "measured", value: 40 }, artifactPublishMs: { status: "measured", value: 15 }, recoveryMs: { status: "measured", value: 120 } });
});
it("accepts an oracle fixture only when the complete model response/action/result lineage is linked", async () => {
  expect(await evaluateAttestedModelFixture("repair")).toMatchObject({ status: "succeeded", provenanceValid: true, eligibleForModelGate: false });
});
it.each(["repair", "route-switch", "long-job", "compaction", "rejected-submit", "partial"])("rejects structural and provenance mutations for %s", async (name) => {
  expect(await evaluateNegativeControls(name)).toMatchObject({ deletedRequiredEvent: "failed", insertedForbiddenEvent: "failed", harnessSubstitution: "failed", brokenLineage: "failed" });
});
it("does not subtract monotonic ticks from different process domains", () => {
  expect(projectMetrics(crossDomainProjectionInputWithoutDuration())).toMatchObject({ recoveryMs: { status: "missing", reason: "incomparable_clock_domain" } });
});
it("uses canonical activity coverage to detect an entirely absent metric producer", () => {
  const events = noCompactionMetricEvents;
  expect(projectMetrics({ events, coverage: noCompactionCoverage() })).toMatchObject({ compactionMs: { status: "not_applicable" } });
  expect(projectMetrics({ events, coverage: completedCompactionCoverage() })).toMatchObject({ compactionMs: { status: "missing", reason: "producer_group_missing" } });
});
it("fails when a Browser-backed experiment loses every Browser metric event", () => {
  expect(projectMetrics(browserExperimentProjectionWithoutBrowserEvents())).toMatchObject({ browserActivityMs: { status: "missing", reason: "producer_group_missing" } });
});
it("rejects a supplied identity that differs from the shared recomputation before a model call", async () => {
  expect(await runM1WithStaleBuildIdentity()).toMatchObject({ modelRequests: 0, code: "build_identity_mismatch" });
});
it.each(["after-reservation", "after-session-allocation", "after-bind-before-activation", "after-worker-activation-intent", "after-session-enable-before-occupancy", "during-running"])("keeps the long-job oracle exactly-once across %s", async (point) => {
  expect(await validateLongJobCrashControl(point)).toMatchObject({ oldBindingDispatches: 0, activeWorkerReservations: 1, modelNextActions: 1, publishedResults: 1 });
});
```

Define each oracle before implementation:

| Trajectory | Injection/input | Required canonical events | Required model-origin action lineage | Forbidden events | Terminal condition |
| --- | --- | --- | --- | --- | --- |
| `repair` | First script has a deterministic syntax/parameter/parse failure | `job.terminal(error)` -> `workspace.patched` with the same Solver task ID -> `job.terminal(success)` -> `artifact.published` | model response consumes raw error ref -> patch tool call -> patched file/result -> rerun/result artifact | replacement Solver task, harness patch, or `strategy.fallback` before success | expected fixture output ref is published by that same task |
| `route-switch` | Primary mechanism premise is false and fixture exposes a concrete falsifier | `observation.visible(contradiction)` -> `hypothesis.rejected(fingerprint-a)` -> `experiment.dispatched(fingerprint-b)` | model response consumes contradiction ref -> rejects A/selects B -> B tool dispatch | another dispatch of `fingerprint-a` or harness-selected B | fingerprint-b reaches its authoritative fixture result |
| `long-job` | Job remains running after Worker release while another task occupies the only slot | `worker.quiesced(open model/tool = 0)` -> `execution.released` while Job remains active -> `job.terminal` -> exactly one `continuation.claimed` -> `continuation.waiting_capacity` -> `worker.capacity_reserved` -> `session.allocated` -> `session.bound(new attempt)` -> `worker.capacity_activation_started` -> `worker.capacity_occupied` -> `session.activated` -> `next_action.completed` | deterministic wake/claim/capacity/session wiring is allowed; resumed model response uses the new occupied binding, consumes terminal event/snapshot and executes the saved Solver next action | Worker release with an in-flight model/tool call, model polling before Job terminal/occupancy, old session/reservation dispatch, a second runnable claim, capacity/session duplication, overcommit, or harness execution of the Solver action | continuation publishes the expected result ref exactly once without resetting cumulative usage, including each injected allocation/bind/activation/occupancy/running crash |
| `compaction` | Force compaction before the saved next action | `compaction.completed` -> `session.recreated` -> cited `artifact.range_read` -> `next_action.completed` | recreated-session model response consumes working-set refs -> requests cited raw range -> executes saved action | dispatch of an already rejected fingerprint or harness raw retrieval/action | reconstructed session publishes the expected result ref |
| `rejected-submit` | Verified candidate receives authoritative `confirmed/rejected` | `verification.completed(verified)` -> `platform.result(rejected)` -> `candidate.diagnosed` -> new `experiment.dispatched` | model response consumes rejection/result refs -> records diagnosis -> dispatches the new experiment | `challenge.solved`, terminal challenge after rejection, or harness diagnosis/experiment | post-rejection experiment publishes its expected observation |
| `partial` | Two-slot fixture accepts the first candidate | `platform.result(accepted,slot-1)` -> `challenge.partial` -> remaining-slot experiment/verification/submit -> `platform.result(accepted,slot-2)` | model response consumes partial/slot snapshot -> chooses and executes remaining-slot experiment; deterministic verified-intent delivery is allowed | `challenge.solved` at first acceptance, score replay, or harness remaining-slot solve | `challenge.completed` matches both frozen required slots |

- [ ] **Step 2: Run deterministic fixtures before any model Gate**

Run: `npm run test:deterministic && npm test -- tests/gates/m1-domain-capability.test.ts tests/gates/m1-model-trajectories.test.ts tests/gates/m1-metrics.test.ts`

- [ ] **Step 3: Implement the Web method and fixture**

Establish a normal request/page/session baseline before controlled variants, require an input-to-effect hypothesis before exploitation, and preserve state-sensitive replay evidence.

- [ ] **Step 4: Implement the Misc method and fixture**

Record source identity and a bounded provenance DAG for published transformations; limit depth, artifact count and expanded bytes, and avoid expanding the same content twice.

- [ ] **Step 5: Implement the Crypto method and fixture**

Preserve bytes/integer/endianness/leading-zero/padding semantics, check cheap preconditions before expensive work, and verify candidates against original equations. All three methods emit hypotheses, falsifiers, stop conditions and evidence refs rather than treating a flag-shaped string as proof.

- [ ] **Step 6: Implement the canonical trajectory oracle and isolated model runner**

Implement one shared structural evaluator for required/forbidden event order, artifact identity, fixture-side authority and terminal condition. `validateTrajectoryContract` uses it for deterministic fixture correctness but cannot emit a model success. `evaluateModelTrajectory` adds every required model-action lineage and permits deterministic control only for the definition's explicit Scheduler/wakeup/capacity/transport allowlist; an identical action with `harness_injection`, absent consumed refs or mismatched response/tool result fails. The isolated runner alone emits a `model_capability` attestation after matching all gateway request IDs to the clean run and, when requested, recomputing identity with Task 12; test/oracle fixtures use `oracle_fixture` and remain ineligible even if their synthetic lineage is structurally valid. Compute token/tool/wall/recovery metrics from Task 3's event+coverage projection input; reject missing whole producer groups, unpaired correlations and incomparable clock domains rather than synthesizing zero. Treat a genuinely unexercised optional stage as `not_applicable` only when canonical coverage proves non-occurrence. Every model run receives a new run ID, empty state/artifact directories and a fresh ledger initialized from the identical fixed budget profile.

- [ ] **Step 7: Re-run deterministic domain, trajectory and metric fixtures**

Run: `npm run test:deterministic && npm test -- tests/gates/m1-domain-capability.test.ts tests/gates/m1-model-trajectories.test.ts tests/gates/m1-metrics.test.ts`

- [ ] **Step 8: Run each trajectory three times from clean state with identical fixed configuration**

Run: `npm run gate:m1 -- --all --runs 3`

Do not retry inside one conversation to manufacture an independent run; preserve all failures, reservations, unknown costs and source events.

- [ ] **Step 9: Evaluate M1 acceptance**

Acceptance: all three functional domain fixtures pass; every model trajectory's provenance-aware verdict succeeds at least 2/3; long-job continuation waits for/reacquires and occupies capacity while rejecting old bindings; harness-substitution, deleted/forbidden event and broken-lineage controls fail; deterministic fixture success is not counted; all 18 isolated model-run directories remain; identity-aware runs use the Task 12 recomputation; reports recompute token/tool/wall, managed-network/Browser observation, publication, blocker, compaction and recovery metrics from canonical event+coverage inputs with no missing producer group, invalid clock subtraction or summary-only success flag. Otherwise keep M1 incomplete.

- [ ] **Step 10: Commit if authorized**

Suggested message: `test: validate solver loop trajectories`.

## M2/M3 Live Readiness

### Task 20: Implement portfolio scheduling and freeze the complete live build

**Files:**
- Create: `packages/supervisor/src/scheduler.ts`, `portfolio.ts`, `instance-slots.ts`, `cleanup.ts`, `live-readiness.ts`, `live-build-manifest.ts`
- Test: `packages/supervisor/test/scheduler.test.ts`, `instance-slots.test.ts`, `cleanup.test.ts`, `live-readiness.test.ts`, `live-build-manifest.test.ts`
- Create: `tests/gates/m2-input-policy.test.ts`, `tests/gates/m2-live-single.ts`, `tests/gates/m2-m3-readiness.test.ts`, `tests/gates/m3-host-portfolio.ts`, `tests/gates/m3-host-recovery.test.ts`
- Create: `docs/gates/m2-tsecbench-live-single.md`, `docs/gates/m3-host-portfolio.md`
- Modify: `apps/cli/src/commands/doctor.ts`, `prepare.ts`, `start.ts`, root npm scripts

**Interfaces:**
- Consumes: challenge snapshots, strategy estimates, Task 3's Scheduler-owned capacity commands plus read-only `ReportingStatePort`, Task 9 Platform Service, Task 6 Launcher ownership, Task 11 recovery APIs, Task 12's canonical `computeBuildIdentity`/included-path policy, and Task 18's M1 runner/oracle/evidence schema. Any M1 pass obtained before Task 20 changes the final identity is diagnostic only and is not reused for sealing.
- Produces: `rankPortfolio(snapshot): ScheduleDecision[]`, `acquireInstanceSlot(authorizationBinding: RunLifecycleBinding | ExecutionBinding, challengeId: ChallengeId, operationId: OperationId): Promise<InstanceCapacityReservation>`, `abandonUndispatchedInstanceStart(expectedAuthorization, operationId, reservationId)`, `releaseInstanceSlot(reservationId, evidence: InstanceStoppedProof)`, `beginCleanup`, `finalizeCleanup`. State validates and snapshots the exact current authorization, resolves/persists the current same-incarnation `RunLifecycleBinding`, and derives `owner` only from that lifecycle binding. An execution authorization must match `challengeId`, be Coordinator and include immutable `intake`; no caller supplies run/incarnation/owner scalars. Start hands both the reservation and same authorization binding to Task 9/7, where preparation verifies authorization plus lifecycle-owner continuity and dispatch begins activation under the lifecycle owner. If scheduling/auth/mapping/policy/deadline fails before preparation, or recovery finds a reserved operation with no prepared/activation row, `abandonUndispatchedInstanceStart` delegates the expected historical authorization to Task 9 and Task 7's State-validated `cancelReservedStart`; Scheduler cannot construct proof or replace owner. If recovery finds a prepared no-byte row, Task 7 resumes the exact envelope or calls `cancelPrepared`. Coordinator release does not alter capacity ownership; Close requires the stored/current lifecycle owner plus occupied ID to begin teardown. Every nonterminal phase (`reserved|activating|activation_unknown|occupied|teardown_pending|teardown_unknown`) counts against the three-slot limit; active/stopped reconciliation restores or releases it without a new reservation/Worker.
- Cross-incarnation recovery delegates stop/fencing/succession to Task 11 and consumes only Task 3's latest projected `OccupiedInstanceCapacityRef`. `beginCleanup`/`finalizeCleanup` never trust checkpoint-cached owner fields or create a new reservation: after authoritative active reconciliation they use the current owner sequence for Close; after stopped evidence they release that same reservation.
- Produces: all executable M2/M3 entrypoints before freeze plus `sealLiveBuildManifest(input): Promise<LiveBuildManifest>` and `verifyLiveBuildManifest(manifest, currentIdentity): LiveBuildVerification`. Both call Task 12's helper and policy; this task does not define a second identity algorithm. `BuildIdentity` combines the included source digest, compiled executable artifact digest, lockfile digest and Node/OpenCode/toolchain identities. Mutable state directories and generated sanitized report exports remain excluded.
- Produces: `evaluateM2Checkpoint(runId, snapshotSequence): LiveGateVerdict` and `evaluateM3Terminal(runId, snapshotSequence): LiveGateVerdict`, both consuming one sequence-aligned `MetricProjectionInput`. M2 requires complete metric groups only for canonical activities performed by that checkpoint and does not label future optional stages N/A; terminal M3 applies full measured/N/A/missing semantics. A missing required producer group fails the relevant Gate even when challenge outcome evidence exists.
- Produces: `LiveBuildManifest { buildIdentity: BuildIdentity, m0EvidenceRef, m1RunEvidenceRefs, readinessEvidenceRef }` and `assertLivePortfolioReadiness(manifest): LivePortfolioReadiness`. Every evidence ref must name the same full identity; changing any included input or compiled artifact invalidates the manifest instead of carrying evidence forward.

**Depends on:** Tasks 3, 9, 12 and 18. This task must complete before Task 19 despite its stable task number.

- [ ] **Step 1: Write failing score/time, tie-break, shared-slot, cleanup and readiness tests**

```ts
it("ranks by expected remaining score per remaining wall time", () => {
  expect(rankPortfolio(portfolioFixture()).map((x) => x.challengeId)).toEqual(["fast-value", "slow-value"]);
});
it("never conflates worker, browser and instance capacity", () => {
  expect(resourceDecisionFixture()).toMatchObject({ instanceSlots: 3, browserSlots: 1 });
});
it("uses one shared capacity reservation when two challenges compete for the final instance slot", async () => {
  expect(await competeForFinalInstanceSlot()).toMatchObject({ acquired: 1, platformStartRequests: 1 });
});
it.each(["run_lifecycle", "coordinator_execution"])("derives a lifecycle instance owner from %s authorization", async (authorizationKind) => {
  expect(await acquireAndDispatchInstanceAs(authorizationKind)).toMatchObject({ reservations: 1, authorizationKind, coordinatorResponsibility: authorizationKind === "coordinator_execution" ? "intake" : undefined, ownerKind: "run_lifecycle", ownerDerivedByState: true, ownerContinuityAtPrepare: true, startRequests: 1 });
});
it.each(["fabricated", "stale", "cross-challenge", "solver-origin", "coordinator-without-intake", "owner-swapped-before-prepare"])("rejects %s instance authority", async (kind) => {
  expect(await attemptInstanceReservationAuthorityMismatch(kind)).toMatchObject({ startRequests: 0, ownerMismatchAccepted: false, strandedReservations: 0 });
});
it("allows close at full capacity and reuses the slot only after List reports stopped", async () => {
  expect(await closeAndReassignAtCapacity()).toMatchObject({ closeRequests: 1, acquiredBeforeStopped: 0, acquiredAfterStopped: 1 });
});
it("does not let an unknown instance operation stop unrelated local work", async () => {
  expect(await isolateUnknownInstanceScope()).toMatchObject({ affectedStarts: 0, unrelatedLocalExperiments: 1 });
});
it("does not free an activating instance slot after a Start dispatch crash", async () => {
  expect(await crashAfterStartActivationIntent()).toMatchObject({ capacityState: "activation_unknown", replacementStarts: 0, unrelatedLocalExperiments: 1 });
});
it.each(["after-slot-acquire", "during-platform-auth", "mapper-threw", "policy-rejected", "deadline-expired", "after-prepare-before-dispatch"])("leaves no stranded instance reservation when Start fails %s", async (point) => {
  expect(await failScheduledStartBoundary(point)).toMatchObject({ instanceReservations: 1, bytesSent: 0, strandedReservations: 0, reusableSlots: 1, cancellationIssuer: "protected_dispatcher" });
});
it.each(["active", "stopped"])("reconciles unknown cleanup Close as %s with no Worker", async (outcome) => {
  expect(await reconcileCleanupClose(outcome)).toMatchObject({ activeWorkerBindings: 0, capacityState: outcome === "active" ? "occupied" : "released", replacementStarts: outcome === "stopped" ? 1 : 0 });
});
it("retains lifecycle ownership from Coordinator Start through execution release and cleanup Close", async () => {
  expect(await coordinatorStartThenLifecycleCleanup()).toMatchObject({ startAuthorizationKind: "coordinator_execution", startOwnerKind: "run_lifecycle", coordinatorBindingReleased: true, activeWorkerBindingsAtClose: 0, closeOwnerMatchesStartOwner: true, closeRequests: 1, finalCapacityState: "released" });
});
it("keeps all three slots occupied across A-to-B succession and reuses one only after B Close is observed stopped", async () => {
  expect(await recoverAndCleanupAtThreeInstanceLimit()).toMatchObject({ occupiedBeforeStop: 3, occupiedAfterSuccession: 3, reservationsAfterSuccession: 3, acquiredBeforeStopped: 0, successorGrantRows: 1, successorGrantResolutions: 1, successorTargetProbeBytes: 1, closeOwnerIncarnation: incarnationB, occupiedAfterStopped: 2, acquiredAfterStopped: 1, resourceGenerationChangedBySuccession: false, authorizationHistoryChanged: false, occupancyProofReissued: false, consumableUsageRefunded: false });
});
it.each(["activation_unknown", "teardown_pending", "teardown_unknown"])("reconciles stopped-owner %s before Scheduler cleanup succession", async (phase) => {
  expect(await recoverUnknownInstanceAtCapacity(phase, "active")).toMatchObject({ listRequestsUnderSuccessor: 1, mutationBytesBeforeSuccession: 0, finalOwnerIncarnation: incarnationB, successionRows: 1, occupiedSlots: 3 });
  expect(await recoverUnknownInstanceAtCapacity(phase, "stopped")).toMatchObject({ listRequestsUnderSuccessor: 1, successionRows: 0, releasedSlots: 1, acquiredAfterStopped: 1 });
});
it.each(["stale-lifecycle", "different-run", "different-incarnation-without-state-succession", "released-coordinator-as-owner"])("rejects %s substitution during lifecycle instance cleanup", async (kind) => {
  expect(await cleanupWithSubstitutedInstanceOwner(kind)).toMatchObject({ closeRequests: 0, capacityReleased: false, ownerSubstitutionAccepted: false });
});
it("refuses readiness when portfolio recovery was not tested for this build", async () => {
  expect(await inspectIncompleteReadiness()).toMatchObject({ ready: false, missing: ["m3-host-recovery"] });
});
it.each(["apps/cli/src/commands/start.ts", "tests/gates/m3-host-portfolio.ts", "tests/contract/opencode-1.19.test.ts", "tests/integration/opencode-session-binding.test.ts", "scripts/live-build-identity.ts", "config/opencode/agents/ctf-worker.md", ".github/workflows/m0-host.yml"])("invalidates the live manifest when %s changes", async (path) => {
  expect(await changeIncludedInputAfterFreeze(path)).toMatchObject({ ready: false, code: "live_build_identity_changed" });
});
it("rejects changed executable bytes and old-build M1 evidence even when source paths are unchanged", async () => {
  expect(await sealWithMismatchedArtifactAndM1Evidence()).toMatchObject({ ready: false, mismatches: ["executableArtifactDigest", "m1RunEvidenceRefs"] });
});
it.each(["platform", "job", "browser", "recovery"])("fails live evaluation when canonical %s activity loses its whole metric producer group", async (group) => {
  expect(await evaluateLiveGateWithDroppedMetricGroup(group)).toMatchObject({ passed: false, metricStatus: "missing", reason: "producer_group_missing" });
});
it("does not mark future M3-only activity N/A at the M2 checkpoint", async () => {
  expect(await inspectM2MetricCoverage()).toMatchObject({ futureGroupsMarkedNotApplicable: 0, completedRequiredGroupsMissing: 0 });
});
```

- [ ] **Step 2: Run Scheduler/readiness tests and confirm failure**

Run: `npm test -- packages/supervisor/test/scheduler.test.ts packages/supervisor/test/instance-slots.test.ts packages/supervisor/test/cleanup.test.ts packages/supervisor/test/live-readiness.test.ts packages/supervisor/test/live-build-manifest.test.ts tests/gates/m2-input-policy.test.ts tests/gates/m2-m3-readiness.test.ts tests/gates/m3-host-recovery.test.ts`

- [ ] **Step 3: Implement evidence-backed ranking, shared-ledger slots and cleanup state machine**

Use remaining score only; consume Task 3's `instances` capacity rather than creating a second `budgets.ts`. Pass the exact current lifecycle/Coordinator authorization binding, target challenge and stable operation ID into acquisition; State stores that authorization separately, resolves the current lifecycle binding and derives the only long-lived owner from it. The identical authorization plus reservation travels through Platform Start, whose effect owner is the reservation's lifecycle owner. Lower layers adopt/begin activation/occupy it but never reserve a second unit or transfer it to the execution. Wrap every pre-dispatch return/throw in `abandonUndispatchedInstanceStart(expectedAuthorization, ...)`, and on restart scan each reserved operation: absence of a prepared/activation row goes through Task 7 historical-authorization `cancelReservedStart`, a prepared/no-byte row resumes exactly or goes through `cancelPrepared`, and any possible byte stays unavailable as `activation_unknown` until active/stopped List evidence. Neither Scheduler nor Task 9 synthesizes proof or owner. Releasing a Coordinator binding changes no instance record. Finalization authenticates the current lifecycle binding, compares it to the stored owner and uses the existing occupied reservation through Close; uncertain Close is `teardown_unknown`, active List restores occupied, stopped List releases. Full capacity blocks new Start, not Close or unrelated work. Retain all unreconciled phases and preserve accepted score even when cleanup fails. Every decision records evidence, estimate range, invalidation condition and canonical metric/capacity events.

After fail-stop, do not compare current B to a checkpoint's A-owned ref and declare mismatch. Invoke Task 11 recovery. For a stopped-owner unknown/pending phase, allow only B's retryable List and State observation reconciliation; stopped releases the row, while active restores occupied under A before succession. Read the State-succeeded B ref, preserve authorization/generation/occupancy history, issue/resolve a fresh B grant, perform one retained-target probe, acquire a fresh mutation lease, then Close. A retained quarantine blocks mutation without freeing the slot. The deterministic recovery harness injects crashes before/after each stop, fence, successor, observation, grant and succession commit boundary at full three-instance capacity.

- [ ] **Step 4: Complete every M2/M3 product policy, live harness and deterministic evaluator**

Implement the M2 input validator, CLI doctor/prepare/start wiring, M2 intermediate evaluator, M3 portfolio runner/evaluator, external-kill driver and documentation before any freeze. Both evaluators call Task 3's projector with event+coverage data from one canonical sequence and reject a missing group for activity already recorded; only terminal M3 may emit N/A for proven non-occurrence. Deterministic fixtures cover three active instances, pending/stop_pending, start limit, switching, deadline, cleanup unknown, external Supervisor/Runtime `SIGKILL` at every gated-spawn pre-activation window, independent PID/heartbeat orphan checks, Launcher-confirmed teardown and checkpoint resume. They also cover same-resource Job/Channel/HTTP/Listener/Browser/Platform mutation serialization, every capacity-activation crash state and whole-producer deletion controls at M2 checkpoint/M3 terminal. The live scripts may select external task/profile values at runtime but contain no code-generation or repair path.

- [ ] **Step 5: Implement identity-bound evidence and manifest sealing**

Call Task 12 `computeBuildIdentity` before running Gates and pass its complete identity into every M0/M1/readiness result. `sealLiveBuildManifest` rejects missing/failed evidence, fewer than all 18 M1 runs, any trajectory below 2/3, or a mismatched identity. `verifyLiveBuildManifest` calls the same helper immediately before prepare, First List and M3 resume. Generated runtime state and sanitized report exports may change, but no included source/config/fixture/harness input may change.

- [ ] **Step 6: Build the final candidate and compute its identity**

Run: `npm ci && npm run typecheck && npm run build && npm run live-build:identity -- --output <candidate-manifest>`

Acceptance: the candidate records source, compiled artifact, lockfile and toolchain identities after build. If any later Gate exposes a defect, fix it and restart from this step; do not attach new evidence to the old identity.

- [ ] **Step 7: Run final deterministic, M0 and M2/M3 readiness Gates against that identity**

Run: `npm run test:deterministic && npm run gate:m0 -- --build-identity <id> && npm run gate:m2-m3-readiness -- --build-identity <id>`

Acceptance: Scheduler, lifecycle-owned instances with separately recorded lifecycle/Coordinator authorization, historical-authorization cancellation, Coordinator-release-to-lifecycle-Close continuity, every dispatcher-entry disposition, capacity release/reuse, scoped unknown, M2/M3 CLI/harness, sequence-aligned metric completeness and external recovery are green; whole-producer deletion cannot pass, every result names the unchanged candidate identity and contains no live-platform claim.

Recovery acceptance includes one A-started occupied instance succeeded to B after verified stop/fencing, B observation and Close, stopped release of the same reservation, unchanged generation/authorization/occupancy proof and no temporary slot availability or stale-owner bytes.

- [ ] **Step 8: Re-run the final-version M1 model Gate and seal the manifest**

Run: `npm run gate:m1 -- --all --runs 3 --build-identity <id> && npm run live-build:seal -- --candidate <candidate-manifest>`

Acceptance: all 18 final-version M1 runs are retained and meet 2/3; M0, M1 and readiness evidence all name the candidate identity; sealing fails on any changed source/build/toolchain input or evidence mismatch.

- [ ] **Step 9: Commit if authorized**

Suggested message: `feat: prepare host portfolio before live gate`. Recompute the manifest after commit hooks; if any included source or artifact changed, discard the seal and restart at Step 6.

## M2 TSecBench Live Single

### Task 19: Execute the host live single-challenge Gate

**Files:**
- Runtime output: `<state-dir>/gate-results/m2-tsecbench-live-single.json`, immutable canonical run state/artifacts

**Interfaces:**
- Consumes: Task 20 sealed `LiveBuildManifest`/`LivePortfolioReadiness`, its pre-existing M2 validator/runner, task A secret refs, host VPN and M2-specific trusted time/baseline evidence.
- Produces: only runtime state plus the M2 checkpoint/result for one uninterrupted live run, with immutable first-List baseline and at least one new authoritative accepted transition; Task 21 consumes the same run/manifest without product, config, fixture or harness changes.

**Depends on:** Task 20 and M2 External Input Gate.

- [ ] **Step 1: Run the already-frozen dry-run validator before any Challenges API bytes**

Run: `npm run gate:m2 -- --phase validate --live-build <manifest> --config <task-a-profile>`

Acceptance: Task 20's existing tests have already proved missing Gate time evidence does not redefine generic live fallback; this invocation verifies external evidence and recomputes the complete Task 12 build identity, not only a source digest. A mismatch returns `live_build_identity_changed` with zero First List bytes rather than modifying code or resealing evidence.

- [ ] **Step 2: Verify sealed readiness and run `ctf-agent prepare` before First List**

Run: `npm run gate:m2-m3-readiness -- --verify-live-build <manifest> && npm run cli -- prepare --profile host-dev --run-mode live --config <task-a-profile> --live-build <manifest>`

Acceptance before start: the current identity equals the sealed Task 20 manifest and all M0/M1/readiness refs inside it; VPN probe is HTTP 200 with JSON `status == "ok"`; no Challenges API request occurred; preview names timing/quota effects. M2 intentionally requires trusted task-page time evidence even though generic dev/live supports a conservative fallback.

- [ ] **Step 3: Obtain explicit user approval, then run start once**

Run: `npm run cli -- start --prepared-run <run-id> --live-build <manifest>`

Do not reset task A, replace the run, change any manifest-covered source/config/fixture/harness input or introduce new product code after First List.

- [ ] **Step 4: Record the M2 intermediate Gate from the running lineage**

Run: `npm run gate:m2 -- --run <run-id>`

Acceptance: relative to revision-0 baseline, this run has at least one confirmed accepted Submit or clean/exclusive unambiguous accepted reconciliation; no false solved; every canonical activity completed by this checkpoint has a non-missing metric group from the same sequence-aligned coverage snapshot, without treating future M3-only stages as N/A; raw secrets are absent from report. Missing pre-start evidence is `blocked_external_input`; if task A expires after First List but before acceptance, record `failed` with `task_expired` and never extend the deadline or splice another run.

- [ ] **Step 5: Preserve the checkpoint and continue directly to Task 21**

Do not pause for development, deterministic retesting, report export or a commit inside task A's timed window. Defer any authorized sanitized result export until Task 21 reaches a terminal result.

## M3 Host Portfolio

### Task 21: Continue task A through the host portfolio and fail-stop Gate

**Files:**
- Runtime output: `<state-dir>/gate-results/m3-host-portfolio.json`, immutable canonical run state/artifacts
- Optional sanitized exports after terminal: `docs/gates/results/<run-id>-m2-tsecbench-live-single.md`, `docs/gates/results/<run-id>-m3-host-portfolio.md` (excluded from `LiveBuildManifest`; no executable source or harness edits)

**Interfaces:**
- Consumes: the same non-reset task A/run lineage and sealed `LiveBuildManifest` from Task 19, plus Task 20's already-frozen M3 runner and tested Scheduler/recovery capabilities.
- Produces: complete supported-challenge manifest, cross-challenge scheduling evidence, cleanup report and externally induced fail-stop recovery result.

**Depends on:** Tasks 19-20 and the still-valid task A.

- [ ] **Step 1: Verify lineage/build identity and continue the existing run**

Run: `npm run cli -- start --prepared-run <existing-run-id> --resume --live-build <manifest>`

Acceptance before mutation: run ID, first-List anchor, deadline, task reference and recomputed build identity exactly match Task 19 and the sealed manifest. If an included input changed or task A is no longer valid, preserve the failure and do not reseal, create a replacement baseline or edit the harness.

- [ ] **Step 2: Exercise portfolio scheduling and one externally controlled host fail-stop**

First retain at least one authoritatively active instance occupied under lifecycle owner A. Kill Supervisor from outside its process group; verify the CLI/Launcher stops every pending and active managed process/browser/channel, and use fixture-owned PID/heartbeat observation to prove no unregistered/pre-activation payload survived. Handles become lost, deadline/budgets do not reset, accepted progress remains, and unaffected challenges resume only after Launcher issues an opaque proof covering the full registry/independent observations and State records the matching `StateStopBinding`. The canonical trace must then show A authority/grants/leases fenced, current B issued, the same occupied reservation succeeded once to B, a B List observation confirming active, a newly issued/resolved B-incarnation target grant with one bounded target probe and zero A-route bytes, B Close, List stopped and release of that reservation. Do not add or edit harness code after freeze.

- [ ] **Step 3: Evaluate M3 acceptance from the uninterrupted canonical trace**

Run: `npm run gate:m3 -- --run <run-id>`

Acceptance: all visible supported challenges remain in the report, cross-challenge decisions are evidence-backed, no more than three active instances occur, at least one challenge is authoritatively accepted in the uninterrupted task A trajectory using the Task 20-ready build, and terminal sequence-aligned metric projection has no missing required group while N/A is backed by canonical non-occurrence.

The fail-stop trace additionally has one reservation, one occupancy proof, one unchanged resource generation and immutable authorization origin, one lifecycle-owner succession event, distinct A/B grant records with A unresolvable and B successfully resolved, zero old-owner bytes, and no capacity reuse before the successor's stopped observation.

- [ ] **Step 4: Finalize cleanup and immutable M2/M3 reports**

Confirm cleanup through List where possible, including the A-started/B-closed instance above; unknown cleanup remains explicit and does not erase accepted results. Both Gate reports reference one run ID, one first-List anchor, one deadline and one build identity.

- [ ] **Step 5: Export and commit only sanitized generated M2/M3 result documents if authorized**

Do not modify the frozen harness while exporting. Suggested message: `test: record uninterrupted host live gates`.

## M4 ARM64 Package

### Task 22: Build the fixed Core image and capability manifest

**Files:**
- Create: `docker/core/Dockerfile`, `docker/core/entrypoint.sh`, `docker/core/healthcheck.sh`, `docker/core/tool-manifest.json`
- Create: `scripts/build-core-image.sh`, `scripts/generate-sbom.sh`, `scripts/core-image-candidate.ts`
- Create: `packages/runtime/src/capability-matrix.ts`
- Test: `tests/gates/core-build.test.ts`, `tests/gates/core-tools.test.ts`, `tests/gates/core-image-identity.test.ts`

**Interfaces:**
- Consumes: the Task 20 `LiveBuildManifest` and terminal M3 evidence as immutable parent lineage, plus the current package lock and versioned Reference manifest. Because this task creates files inside `LIVE_BUILD_INCLUDED_PATHS`, the parent host identity is not reused as current identity; generated sanitized M2/M3 report exports remain excluded.
- Produces: noninteractive `scripts/build-core-image.sh --parent-live-build <manifest> --output <candidate-manifest>`, a convenience local tag `ctf-agent:core-arm64` that is never evidence authority, SBOM, version report, capability manifest, and `CoreImageCandidateManifest { buildIdentity: BuildIdentity, imageDigest, platform: "linux/arm64", baseImageDigests, sbomDigest, capabilityManifestDigest, parentLiveBuildManifestRef, parentM3EvidenceRef }`. The script imports Task 12's helper, computes identity after the image/SBOM/capability outputs are final, resolves every base image and the result to immutable digests, and rejects a mutable/unresolved base. This candidate is diagnostic until rebuilt after Task 23 and sealed by Task 24; no Task 22 evidence may be attached to later source bytes.

**Depends on:** Task 21.

- [ ] **Step 1: Write failing reproducibility, no-secret and offline-start tests**

```ts
it("contains no configured provider, platform or VPN secret", async () => {
  expect(await scanImageForFixtureSecrets()).toEqual([]);
});
it("starts cold without registry or dependency downloads", async () => {
  expect((await coldStartWithRegistryBlocked()).downloadAttempts).toBe(0);
});
it("records immutable source, image, base, SBOM and capability identities", async () => {
  expect(await inspectCoreImageCandidate()).toMatchObject({ sourceIdentityRecomputed: true, imageReferenceKind: "digest", platform: "linux/arm64", unresolvedBaseTags: 0, sbomDigestMatched: true, capabilityDigestMatched: true, parentHostManifestMatched: true });
});
it("rejects a candidate after an included source change or mutable-tag retarget", async () => {
  expect(await invalidateCoreCandidate()).toMatchObject({ sourceChangeAccepted: false, retargetedTagAccepted: false, staleEvidenceAccepted: false });
});
```

- [ ] **Step 2: Run Core build tests and confirm missing image**

Run: `npm test -- tests/gates/core-build.test.ts tests/gates/core-tools.test.ts`

- [ ] **Step 3: Implement digest-pinned multi-stage build and functional tool recipes**

Package OpenCode 1.19.0, services, Chromium and only tested Web/Misc/Crypto tools. Worker runs non-root; system/site packages are read-only; `/data` is persistent; no Docker socket. Pin every `FROM` by digest, emit the final image digest/platform plus base-image/SBOM/capability digests, and call only Task 12's build-identity helper rather than hashing a second path set.

- [ ] **Step 4: Build and run fixture contracts in the image**

Run: `scripts/build-core-image.sh --parent-live-build <manifest> --output <task22-candidate> && docker run --rm <image-digest-from-task22-candidate> npm run gate:m0 -- --build-identity <candidate-build-id>`

Acceptance: SBOM/version/capability files exist and match the candidate manifest, fixture suite passes against that exact digest/identity, and missing tools are `unavailable`, never inferred from binary presence alone. The result is explicitly superseded by any Task 23 source change and is not M4 evidence.

- [ ] **Step 5: Commit if authorized**

Suggested message: `build: package arm64 ctf agent core`.

### Task 23: Enforce Core egress and whole-container fail-stop

**Files:**
- Create: `packages/core-egress/package.json`
- Create: `packages/core-egress/src/egressd.ts`, `namespaces.ts`, `grants.ts`
- Create: `docker/core/egress/nftables.conf`, `docker/core/egress/users.conf`
- Create: `scripts/run-core.sh`, `scripts/recover-core.sh`
- Test: `tests/gates/core-egress.test.ts`, `tests/gates/core-metered-egress.test.ts`, `tests/gates/core-fail-stop.test.ts`
- Modify: root npm scripts

**Interfaces:**
- Consumes: `GrantSetId` only over Task 4's authenticated `NetworkGrantResolver` control IPC, broker-only managed transport identity from Task 7, and Task 22's Core build recipe/candidate contract; it never accepts a serialized grant body as authority. Task 22's pre-egress candidate is lineage/diagnostic input only and becomes stale as soon as this task adds included source.
- Produces: per-service/per-challenge network namespaces; narrow root-owned `egressd` API `createNamespace`, `applyGrantSet(grantSetId, expectedContext)`, `launchInNamespace`, `destroyNamespace`. `applyGrantSet` authenticates the egress caller and resolves the ID through Task 4 for exact run/incarnation/challenge/service/generation/managed-transport identity before installing routes; it stores the returned validation/revocation sequence, subscribes to invalidation, and closes routes on revoke/expiry/generation/incarnation change. Core incarnation recovery invalidates all prior grant IDs. No API accepts endpoints, mode or identity directly from its caller. This task emits no final Core identity: Task 24 must rebuild after all files here are complete.

**Depends on:** Tasks 7 and 22.

- [ ] **Step 1: Write failing raw bypass and stale-container tests**

```ts
it.each(["curl", "python-socket", "browser"])("blocks public, provider, platform and other-challenge targets via %s", async (client) => {
  expect(await runBypassMatrix(client)).toMatchObject({ bypasses: 0 });
});
it("does not start a new core until Docker confirms the old core stopped", async () => {
  expect(await recoverWhileOldCoreAlive()).toMatchObject({ newCoreStarted: false });
});
it.each(["curl", "python-socket", "browser"])("blocks raw %s to the current challenge's broker-only endpoint", async (client) => {
  expect(await accessCurrentMeteredEndpoint(client)).toMatchObject({ rawBytes: 0, logicalCtfToolCalls: 1, runtimeProtectedCalls: 1, managedTransportReachable: true });
});
it.each(["revoked", "generation_changed", "core_restarted"])("invalidates the old broker route when %s", async (change) => {
  expect(await useStaleMeteredGrant(change)).toMatchObject({ bytesSent: 0, oldGrantAccepted: false });
});
it.each(["forged-id", "structural-body", "expired", "wrong-service", "wrong-challenge", "wrong-generation", "wrong-managed-transport"])("installs no egress route for %s grant authority", async (kind) => {
  expect(await applyInvalidGrantToEgress(kind)).toMatchObject({ resolverAccepted: false, routesInstalled: 0, bytesSent: 0 });
});
```

- [ ] **Step 2: Run egress/fail-stop tests and confirm failure**

Run: `npm test -- tests/gates/core-egress.test.ts tests/gates/core-metered-egress.test.ts tests/gates/core-fail-stop.test.ts`

- [ ] **Step 3: Implement namespace/UID enforcement and container-level recovery**

Only Model Gateway reaches provider, only Platform Service reaches platform control API, and each Tool job/Browser reaches currently resolved direct grants. A `broker_only` endpoint is absent from ordinary job/Browser/generic Channel/HTTP namespaces and reachable only by its named managed transport service; the positive path must originate at authenticated `ctf_channel`/`ctf_http_session`, traverse Runtime's protected ledger/framing/remote-unit/mutation-lease path and then egressd. Resolve IDs at installation, retain the canonical validation/revocation sequence, and tear down routes when Task 4 invalidates them. Forged IDs/bodies, expired, revoked, wrong-service/challenge/transport, old-generation and prior-incarnation grants fail closed. Public search, registry and cross-challenge targets remain unreachable.

- [ ] **Step 4: Verify positive and negative paths on Linux ARM64**

Run: `scripts/build-core-image.sh --parent-live-build <manifest> --output <post-egress-candidate> && npm run gate:core-egress -- --core-candidate <post-egress-candidate> && npm test -- tests/gates/core-metered-egress.test.ts tests/gates/core-fail-stop.test.ts`

Acceptance: the gate first recomputes candidate source/image identity and runs only the digest named by that candidate; approved direct endpoints work; the logical Solver tool reaches its broker-only endpoint through exactly one Runtime protected call/lease while raw and generic clients to that same challenge endpoint fail; over-limit bytes are zero; unknown retains units and cannot open a replacement connection; recovery/revocation/generation change invalidates old routes, marks connections lost and keeps the original deadline. This candidate still requires Task 24 native evidence and sealing.

- [ ] **Step 5: Commit if authorized**

Suggested message: `feat: enforce core egress and fail-stop`.

### Task 24: Pass native ARM64 parity and task B live Gate

**Files:**
- Create: `scripts/seal-core-build.ts`, `scripts/derive-final-profile.ts`
- Create: `tests/gates/m4-arm64-parity.ts`, `tests/gates/m4-live-core.ts`, `tests/gates/m4-build-identity.test.ts`, `tests/gates/m5-build-identity.test.ts`
- Create: `docs/gates/m4-arm64-package.md`
- Modify: root npm scripts

**Interfaces:**
- Consumes: native Ubuntu ARM64 host, task B, host VPN, Task 20's parent `LiveBuildManifest`, terminal M3 evidence, and the complete current source after Tasks 22-23. It does not accept Task 22's tag or pre-egress candidate as execution authority.
- Produces: `CoreBuildManifest { buildIdentity: BuildIdentity, imageDigest, platform: "linux/arm64", baseImageDigests, sbomDigest, capabilityManifestDigest, parentLiveBuildManifestRef, parentM3EvidenceRef, m4EvidenceRefs: { deterministicParity, egress, coldStart, liveTaskB } }`, plus `sealCoreBuildManifest(candidate, evidenceRefs)` and `verifyCoreBuildManifest(manifest)`. Sealing recomputes source/artifact/toolchain identity, inspects the immutable image/config/platform/base digests, rehashes SBOM/capability files, and requires every M4 evidence ref to name that exact identity and image digest. It also produces `FinalProfileManifest { buildIdentity: BuildIdentity, imageDigest, platform: "linux/arm64", baseImageDigests, sbomDigest, capabilityManifestDigest, parentManifestRef, selectedCapabilities, profileConfigDigest, baseEvidenceRefs, trackEvidenceRefs }` and `deriveFinalProfileManifest(parent: CoreBuildManifest | FinalProfileManifest, selectedCapabilities, profileConfig, evidenceRefs): FinalProfileManifest`. Derivation records the parent only as lineage and accepts only evidence naming all repeated current identity fields. Root commands are `npm run core-build:seal -- --candidate <candidate> --m4-evidence <bundle> --output <manifest>`, `npm run profile-build:gate -- --parent <manifest> --selected <set> --track <track> --profile <config> --output <manifest>`, and `npm run final-profile:verify -- --manifest <manifest>`; each delegates to these shared functions and Task 12's helper. Neither API carries old evidence forward as proof of changed bytes.
- Produces: M0-M3 parity report, egress report, cold-start report and one new task B accepted result, each bound to the final Task 24 candidate identity/digest. All Core invocations consume `CoreBuildManifest` or its `imageDigest`; the mutable tag is never a CLI authority.

**Depends on:** Tasks 22-23 and M4 External Input Gate.

- [ ] **Step 1: Write identity-chain failures and verify host prerequisites**

```ts
it.each(["source", "image", "base-image", "sbom", "capability-manifest", "m4-evidence"])("refuses to seal Core with mismatched %s identity", async (kind) => {
  expect(await sealCoreWithMismatch(kind)).toMatchObject({ sealed: false, staleEvidenceAccepted: false });
});
it("does not trust a mutable tag that moved after evidence", async () => {
  expect(await verifyRetargetedCoreTag()).toMatchObject({ manifestValid: true, tagDigestMatches: false, retargetedImageExecuted: false });
});
it.each(["included-source", "image-digest", "profile-config", "base-evidence", "track-evidence"])("rejects a derived profile with mismatched %s", async (kind) => {
  expect(await deriveProfileWithMismatch(kind)).toMatchObject({ manifestIssued: false, oldEvidenceCarriedForward: false });
});
```

Run: `npm test -- tests/gates/m4-build-identity.test.ts tests/gates/m5-build-identity.test.ts && uname -m && docker info && scripts/build-core-image.sh --parent-live-build <manifest> --output <final-core-candidate>`

Acceptance: architecture is native `aarch64/arm64`; QEMU alone cannot satisfy this step; the candidate is recomputed after all Task 23 files and names one immutable ARM64 digest plus complete source/base/SBOM/capability lineage.

- [ ] **Step 2: Run deterministic parity and raw egress matrix**

Run: `npm run gate:m4 -- --phase deterministic --core-candidate <final-core-candidate>`

Acceptance: the runner recomputes candidate identity immediately before launch, invokes only its image digest, and the matrix includes the same current-challenge broker-only endpoint, proving ordinary job/Browser denial and managed-transport success in addition to public/provider/platform/cross-challenge denials. Parity, egress and cold-start evidence embed the exact candidate identity/digest.

- [ ] **Step 3: Prepare task B, obtain explicit approval and run the Core live trajectory once**

Run: `npm run gate:m4 -- --phase live --config <task-b-profile> --core-candidate <final-core-candidate>`

- [ ] **Step 4: Seal the same-identity Core manifest and evaluate M4 acceptance**

Run: `npm run core-build:seal -- --candidate <final-core-candidate> --m4-evidence <evidence-bundle> --output <core-build-manifest>`

Acceptance: M0-M3 contracts pass in Core, all negative egress tests including raw same-challenge metered access fail closed, the positive managed transport works, cold start downloads nothing, host VPN reaches platform/target through Tool Runtime, and task B gains at least one new authoritative accepted result. `CoreBuildManifest` seals only when its recomputed current source/build identity, immutable image/platform/base digests, SBOM/capability digests and all four M4 evidence refs match; any post-evidence included change requires rebuilding and rerunning this task.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: validate native arm64 core`. Recompute verification after hooks; if any included source/artifact changed, discard the Core manifest and repeat Steps 1-4.

## M5 Conditional Delivery Hardening

Every selected M5 task follows one identity rule. Its input is the latest sealed `CoreBuildManifest | FinalProfileManifest`; skipped tracks create no source and leave that parent unchanged. After a selected track's implementation and tests are complete, run `npm run profile-build:gate -- --parent <parent-manifest> --selected <canonical-selected-capability-set> --track <track> --profile <profile-config> --output <next-profile-manifest>`. That command uses Task 12's helper, rebuilds the complete current Core, resolves one immutable ARM64 image digest and all base-image digests, regenerates/re-hashes SBOM and capability manifests, then runs `test:deterministic`, M0, Core egress/fail-stop, M4 deterministic parity and the named track Gate against only that digest. It finally calls Task 24 `deriveFinalProfileManifest` with those same-identity evidence refs. Parent M4/live or prior-track evidence is retained only as lineage; it is not relabeled as proof of changed bytes. A source/config/image/evidence mismatch emits no manifest. If several tracks are selected, apply them in task order and feed each output to the next; every execution uses the final digest, never `ctf-agent:core-arm64`. After an authorized commit, rerun manifest verification; if a hook changed any included byte/artifact, discard the manifest and repeat this command.

### Task 25: Add a container VPN capability track when required

**Files:**
- Create: `docker/profiles/container-vpn/**`, `packages/core-egress/src/vpn-profile.ts`
- Test: `tests/gates/m5-container-vpn.test.ts`
- Create: `docs/gates/m5-container-vpn.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, M4 egress namespaces and an approved VPN profile.
- Produces: explicit `container_vpn` capability with route/DNS/credential lifecycle and positive/negative tests, plus the next `FinalProfileManifest` whose selected-capability/config digest and same-identity base/track evidence include this track.

**Depends on:** Task 24. Conditional: skip unless a target formal profile requires container VPN.

- [ ] Write failing route, DNS leak, credential leak and reconnect attribution tests.
- [ ] Run `npm test -- tests/gates/m5-container-vpn.test.ts` and confirm failure.
- [ ] Implement TUN lifecycle without exposing VPN credential to model/jobs and preserve formal intervention rules.
- [ ] Run `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track container-vpn --profile <profile-config> --output <next-profile-manifest>`; accept only if approved targets work, all other egress remains blocked, base checks run against the rebuilt digest and the output manifest verifies.
- [ ] Commit if authorized with suggested message `feat: add container vpn profile`.

### Task 26A: Add the multi-Challenge-Browser track when required

**Files:**
- Create: `packages/browser/src/pool.ts`, `browser-slots.ts`
- Create: `docker/profiles/multi-browser/**`
- Test: `tests/gates/m5-multi-browser.test.ts`
- Create: `docs/gates/m5-multi-browser.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, M4 namespace grants, the single Browser Service and Browser-owned capacity commands from Task 3's nominal `BrowserStatePort`.
- Produces: `multi_browser` capability, `acquireBrowserSlot(challengeId, operationId): Promise<CapacityReservation>`, `releaseBrowserSlot(reservationId, BrowserTeardownProof)`, independent process/UID/profile/proxy ownership per slot, and the next same-identity `FinalProfileManifest`.

**Depends on:** Task 24. Conditional on a profile that needs simultaneous Challenge Browsers.

- [ ] Write failing tests asserting two challenge browsers cannot read each other's profile, cookies, downloads or network grants, and an unknown teardown does not free capacity while confirmed teardown does without refunding consumables.
- [ ] Run `npm test -- tests/gates/m5-multi-browser.test.ts` and confirm failure.
- [ ] Implement the pool using the shared ledger's `browser_slots` capacity state machine and terminal teardown proof; do not create a second budget store, refund consumables or conflate Worker, Browser and instance slots.
- [ ] Run `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track multi-browser --profile <profile-config> --output <next-profile-manifest>`; accept only if isolation/teardown plus all base checks pass on the rebuilt digest while the original single-browser profile remains unchanged.
- [ ] Commit if authorized with suggested message `feat: add multi challenge browser profile`.

### Task 26B: Add the Platform Browser and noVNC handoff tracks when required

**Files:**
- Create: `packages/browser/src/platform-browser.ts`, `display.ts`, `novnc.ts`, `handoff-attribution.ts`
- Create: `docker/profiles/platform-browser/**`
- Test: `tests/gates/m5-platform-browser.test.ts`, `m5-novnc.test.ts`
- Create: `docs/gates/m5-platform-browser.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, M4 egress service identity, Task 11's baseline `beginIntervention`/`completeIntervention` lifecycle and Task 9's platform evidence capture/comparison.
- Produces: separately declared `platform_browser` and `novnc_handoff` capabilities plus a UI adapter `recordHumanHandoff(input): Promise<InterventionRecord>`; this track does not redefine integrity policy or own formal-invalid transitions. Each selected capability produces its own next same-identity `FinalProfileManifest`; when both are selected, the second derives from the first.

**Depends on:** Task 24. Conditional on a platform or live profile that cannot use its approved API alone.

- [ ] Write failing tests proving Challenge Browser cannot inherit Platform Browser credentials and every noVNC interaction enters the baseline intervention lifecycle, pauses effects and makes a formal run invalid when policy requires it.
- [ ] Run `npm test -- tests/gates/m5-platform-browser.test.ts tests/gates/m5-novnc.test.ts` and confirm failure.
- [ ] Implement separate process/UID/profile/display and feed explicit human-handoff attribution into Task 11's canonical lifecycle without giving platform credentials to Solver sessions.
- [ ] For each selected capability run `npm run profile-build:gate -- --parent <latest-manifest> --selected <capability-set> --track <platform-browser|novnc> --profile <profile-config> --output <next-profile-manifest>`; accept each independently only with rebuilt-digest base checks and its own track evidence.
- [ ] Commit each authorized track separately.

### Task 26C: Add management/data network separation and callback track when required

**Files:**
- Create: `packages/core-egress/src/network-identities.ts`, `packages/runtime/src/callback.ts`
- Create: `docker/profiles/callback/**`
- Test: `tests/gates/m5-network-identities.test.ts`, `m5-callback.test.ts`
- Create: `docs/gates/m5-callback-network.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, M4 namespaces and Task 7 managed Runtime listener lifecycle with Task 13-derived `RemoteActivityContext`.
- Produces: `callback_listener` capability, `publishListenerGrant(listenerId, scope)`, distinct management/data identities and the next same-identity `FinalProfileManifest`; a network callback listener retains its original canonical mutation owner/lease until every accepted connection is terminal and listener stop proof is durable. Publication transfers only a revocable network grant to the callback route, never Listener activity or mutation-lease ownership; Task 2's transfer union remains Job/Channel-only.

**Depends on:** Task 24. Conditional on a challenge requiring inbound callback/listener behavior.

- [ ] Write failing tests proving callback routes are unavailable before publication, cannot reach provider/platform/other-challenge networks, cannot overlap a same-resource Platform/Job/Browser mutator before listener terminal proof, and cannot transfer Listener activity/lease ownership to a publisher or accepting Worker.
- [ ] Run `npm test -- tests/gates/m5-network-identities.test.ts tests/gates/m5-callback.test.ts` and confirm failure.
- [ ] Implement narrow listener grant publication, expiry/revocation and teardown through the approved data path; keep the creating canonical owner through stop and expose no Listener ownership-transfer API.
- [ ] Run `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track callback --profile <profile-config> --output <next-profile-manifest>`; accept only if positive callback, all negative cross-boundary tests and rebuilt-digest base checks pass.
- [ ] Commit if authorized with suggested message `feat: add scoped callback network profile`.

### Task 27: Add the CTFd adapter track when required

**Files:**
- Create: `packages/platform/src/ctfd/client.ts`, `mapper.ts`, `reconcile.ts`
- Create: `fixtures/ctfd/**`
- Test: `packages/platform/test/ctfd-contract.test.ts`
- Create: `docs/gates/m5-ctfd.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, Task 2 contextual `PlatformAdapter` pure-mapping contract plus Task 9's capability-bound observation dispatcher; it never receives Task 7's protected dispatcher/raw transport or creates operation/reservation identity.
- Produces: only capabilities proven by the selected CTFd version plus an immutable version-pinned `CTFdWireCapabilityPolicy` installed by Platform Service, and the next same-identity `FinalProfileManifest`; unsupported operations remain explicit, retryable observations use the bound observation capability, and each protected intent maps to bytes returned to Platform Service for wire-identity sealing and Task 7 dispatch.

**Depends on:** Tasks 9 and 24. Conditional on a CTFd target.

- [ ] Capture approved CTFd version/auth/API evidence and write failing wire-contract tests.
- [ ] Run `npm test -- packages/platform/test/ctfd-contract.test.ts`.
- [ ] Implement list/get/download/instance/hint/submit/score/history only where authoritative endpoints exist, using contextual pure protected mapping and capability-bound observation methods.
- [ ] Run the fixture, then `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track ctfd --profile <version-pinned-profile> --output <next-profile-manifest>` with one authorized integration; verify intent context is unchanged, actual wire identity is sealed/rechecked, protected wire shapes fail through observation, stale preconditions emit zero server bytes, no browser/raw transport fallback expands capability, and all evidence names the rebuilt digest.
- [ ] Commit if authorized with suggested message `feat: add ctfd platform adapter`.

### Task 28: Add the rCTF adapter track when required

**Files:**
- Create: `packages/platform/src/rctf/client.ts`, `mapper.ts`, `reconcile.ts`
- Create: `fixtures/rctf/**`
- Test: `packages/platform/test/rctf-contract.test.ts`
- Create: `docs/gates/m5-rctf.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, Task 2 contextual `PlatformAdapter` pure-mapping contract plus Task 9's capability-bound observation dispatcher; it never receives Task 7's protected dispatcher/raw transport or creates operation/reservation identity.
- Produces: version-pinned rCTF capabilities, immutable `RCTFWireCapabilityPolicy` and the next same-identity `FinalProfileManifest` without inventing TSecBench semantics; Platform Service installs the policy, while protected intents preserve caller context through pure mapping, Service wire sealing and Task 7 dispatch.

**Depends on:** Tasks 9 and 24. Conditional on an rCTF target.

- [ ] Capture approved rCTF version/auth/API evidence and write failing contract tests.
- [ ] Run `npm test -- packages/platform/test/rctf-contract.test.ts`.
- [ ] Implement only observed capabilities, effect classes and reconciliation rules through contextual pure mapping plus the bound observation capability.
- [ ] Run the fixture, then `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track rctf --profile <version-pinned-profile> --output <next-profile-manifest>` with one authorized integration, including unchanged intent/mutation owner, recomputed wire identity, observation-path protected-shape rejection, stale-before-transport zero bytes, partial/error/unknown outcomes and rebuilt-digest evidence.
- [ ] Commit if authorized with suggested message `feat: add rctf platform adapter`.

### Task 29: Add an approved unknown-platform exploration track when required

**Files:**
- Create: `packages/platform/src/exploration/inspector.ts`, `proposal.ts`, `approval.ts`
- Test: `packages/platform/test/exploration-approval.test.ts`
- Create: `docs/gates/m5-unknown-platform.md`

**Interfaces:**
- Consumes: the latest sealed Core/profile manifest, Platform Browser capability from Task 26B plus Task 2's pure adapter/wire-policy contracts and Task 9's service composition; exploration never receives a credential transport or dispatcher.
- Produces: read-only capability proposal, explicit human approval record, generated one-run mapper/policy profile installed by Platform Service and the next same-identity `FinalProfileManifest`; unknown wire shapes remain protected/denied and no unapproved mutation gains an observation route.

**Depends on:** Tasks 24 and 26B. Conditional on an unknown platform.

- [ ] Write failing tests proving page content cannot approve capability, reveal credentials or trigger submit/Hint/instance effects.
- [ ] Run `npm test -- packages/platform/test/exploration-approval.test.ts`.
- [ ] Implement read-only inspection, typed mapper plus wire-policy diff and explicit out-of-band approval; generated code cannot contain a sender or caller-asserted wire identity.
- [ ] Run `npm run profile-build:gate -- --parent <parent-manifest> --selected <capability-set> --track unknown-platform --profile <approved-generated-profile> --output <next-profile-manifest>` against an authorized fixture before any live use; the approved mapper/policy/config digest and rebuilt image evidence must be sealed together.
- [ ] Commit if authorized with suggested message `feat: gate unknown platform exploration`.

## M6 Formal Acceptance

### Task 30: Implement formal evaluation, metric aggregation and reporting

**Files:**
- Create: `packages/reporting/package.json`
- Create: `packages/reporting/src/evaluator.ts`, `denominators.ts`, `integrity.ts`, `aggregate-metrics.ts`, `export.ts`, `redaction.ts`
- Create: `apps/cli/src/commands/report.ts`
- Test: `packages/reporting/test/evaluator.test.ts`, `denominators.test.ts`, `integrity.test.ts`, `aggregate-metrics.test.ts`, `redaction.test.ts`

**Interfaces:**
- Consumes: the latest sealed `CoreBuildManifest | FinalProfileManifest` as parent lineage, canonical run/challenge/task/effect/budget/integrity snapshots through Task 3's read-only `ReportingStatePort`, its pure `projectMetrics`, and immutable artifacts only; it never receives a writer facade, accepts events without their same-sequence `MetricCoverageSnapshot`, or reruns a live task to fill missing data. Creating this task's included package/CLI/tests invalidates that parent as execution evidence; Task 31 must rebuild and derive the actual final profile after this task is complete.
- Produces: `aggregateMetrics(input: MetricProjectionInput): RunMetrics` by validating and mapping the shared `MetricProjection`, plus `evaluateFormalRun(snapshot): FormalResult`, `exportRunReport(runId, destination)`, exact `passed|failed|insufficient_gate_coverage|infrastructure_invalid` Gate status.
- Produces: product `run_state: invalid` -> Gate `failed` with immutable `integrityReasons: string[]`; independently proven external platform failure -> `infrastructure_invalid`; scoped unknown effects preserve unrelated authoritative accepts and unknown cost remains unknown, never zero.

**Depends on:** Tasks 3 and 24 plus any M5 tracks required by the selected profile.

- [ ] **Step 1: Write failing denominator, integrity, metric-source, attribution and redaction tests**

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
it("fails an otherwise passing score when formal integrity is invalid", () => {
  expect(evaluateFormalRun(passingScoreWithHumanSubmit())).toMatchObject({ status: "failed", integrityReasons: ["human_submit"] });
});
it.each([
  ["easy", 5, 3],
  ["medium", 4, 2],
  ["unknown", 3, 2],
])("applies the exact %s threshold", (group, total, required) => {
  expect(requiredSolved(group, total)).toBe(required);
});
it("does not turn unknown effect cost into zero or erase unrelated accepts", () => {
  expect(evaluateFormalRun(scopedUnknownFixture())).toMatchObject({ solvedCount: 2, unknownCostScopes: 1, reportedUnknownCost: true });
});
it("aggregates required metrics without executing product work", () => {
  expect(aggregateMetrics(canonicalMetricProjectionInput())).toMatchObject({ reruns: 0, missingProducers: [], firstExperimentMs: { status: "measured", value: 80 } });
});
it("distinguishes an unexercised optional stage from a missing required producer", () => {
  expect(aggregateMetrics(runWithoutCompactionProjectionInput())).toMatchObject({ compactionMs: { status: "not_applicable" } });
  expect(aggregateMetrics(experimentWithoutStartAnchorProjectionInput())).toMatchObject({ firstExperimentMs: { status: "missing", reason: "start_anchor_missing" } });
});
it("uses producer duration instead of subtracting different clock domains", () => {
  expect(aggregateMetrics(recoveryAcrossIncarnationsProjectionInput())).toMatchObject({ recoveryMs: { status: "measured", value: 120 } });
});
it("distinguishes N/A from an entirely missing producer with identical metric events", () => {
  const events = [];
  expect(aggregateMetrics({ events, coverage: noCompactionCoverage() })).toMatchObject({ compactionMs: { status: "not_applicable" } });
  expect(aggregateMetrics({ events, coverage: completedCompactionCoverage() })).toMatchObject({ compactionMs: { status: "missing", reason: "producer_group_missing" } });
});
it("cannot pass formal evaluation after deleting a required metric group", () => {
  expect(evaluateFormalRun(runWithCompactionBusinessStateButNoCompactionMetrics())).toMatchObject({ status: "failed", missingMetricGroups: ["compaction"] });
});
it("cannot pass after deleting Browser metrics from a Browser-backed experiment", () => {
  expect(evaluateFormalRun(runWithBrowserBusinessStateButNoBrowserMetrics())).toMatchObject({ status: "failed", missingMetricGroups: ["browser_activity"] });
});
```

- [ ] **Step 2: Run reporting tests and confirm failure**

Run: `npm test -- packages/reporting/test`

- [ ] **Step 3: Implement integrity-first evaluation and exact threshold boundaries**

Evaluate canonical corruption, old-execution proof, exclusivity and intervention attribution before score thresholds. Map product invalid to `failed` plus reasons without discarding its report. Then use `ceil(easy*60%)`, `ceil(medium*30%)`, `ceil(unknown*45%)`, or `ceil(all-in-scope*45%)` when no trusted difficulty exists. Hard remains reported but outside the version threshold; hard-only and empty sets are `insufficient_gate_coverage`.

- [ ] **Step 4: Implement event-plus-coverage metric aggregation and immutable export**

Read Task 3's event+coverage input at one snapshot sequence and call `projectMetrics` over model usage, start/experiment, Job/managed-network/Browser observation, artifact, blocker, candidate-stage, compaction/session and fail-stop/recovery data already in State. Map measured/N/A/missing without reimplementing pairing or applicability rules. Missing required producers, an entire absent producer group despite canonical activity, broken correlations or incomparable domains without producer duration remain explicit and prevent formal pass; only terminal canonical coverage proving a stage did not occur yields N/A. Do not read mutable logs, trust a summary completeness flag or rerun a task.

- [ ] **Step 5: Verify evaluation, metrics and immutable export**

Run: `npm test -- packages/reporting/test && npm run typecheck`

Acceptance: exact `easy=5 -> 3`, `medium=4 -> 2`, `unknown=3 -> 2` boundaries pass only with authoritative solves; empty/hard-only denominators cannot pass; multi-flag needs challenge complete/all frozen slots; product invalid maps to failed with reasons; external failure yields `infrastructure_invalid`; local unknown preserves other accepted and unknown cost; reports reconstruct every required wall/token/tool/observation/artifact/blocker/compaction/recovery metric from sequence-aligned event+coverage inputs, detect deletion of a complete producer group, preserve measured/N/A/missing semantics, never subtract unrelated clocks, and contain no secrets. These tests prove code behavior but do not preserve the parent image identity; no formal run starts until Task 31 seals the rebuilt final profile.

- [ ] **Step 6: Commit if authorized**

Suggested message: `feat: evaluate and report formal runs`.

### Task 31: Execute one registered formal acceptance run

**Files:**
- Create: `tests/gates/m6-formal.ts`, `tests/gates/m6-integrity.test.ts`
- Create: `docs/gates/m6-formal-acceptance.md`
- Modify: root npm scripts

**Interfaces:**
- Consumes: the latest sealed `CoreBuildManifest | FinalProfileManifest` as parent lineage, the canonical selected capability set, clean formal target, frozen model/reference/tool/budget profile and human-intervention policy. Parent evidence is not current execution authority after Tasks 30-31 add included source/harness.
- Produces: `npm run profile-build:finalize -- --parent <parent-manifest> --selected <capability-set> --profile <formal-profile> --output <m6-final-profile-manifest>`. It uses Task 12/24 helpers to rebuild current source to an immutable ARM64 digest, regenerate base/SBOM/capability/profile identities, run deterministic/M0/Core-egress/M4-deterministic, every selected M5 fixture Gate, Task 30 reporting tests and M6 integrity tests against that exact build, then emits a `FinalProfileManifest` only when all evidence matches. Also produces one immutable formal run and final sanitized report; diagnostic reruns always use a new run ID and never merge results. A product-invalid run remains preserved and is reported as Gate `failed` with integrity reasons.

**Depends on:** Task 30 and M6 External Input Gate.

- [ ] **Step 1: Seal the final current profile and run pre-start admission without touching the platform Challenges API**

```ts
it.each(["included-source", "lockfile", "toolchain", "image", "base-image", "sbom", "capability-manifest", "profile-config", "selected-track-evidence"])("sends no formal bytes when final profile %s changed", async (kind) => {
  expect(await preStartWithStaleFinalProfile(kind)).toMatchObject({ manifestVerified: false, challengeApiRequests: 0, modelRequests: 0, coreProcessesStarted: 0 });
});
```

Run: `npm run profile-build:finalize -- --parent <latest-parent-manifest> --selected <capability-set> --profile <formal-profile> --output <m6-final-profile-manifest> && npm run gate:m6 -- --phase pre-start --config <formal-profile> --final-profile <m6-final-profile-manifest>`

Acceptance: finalization occurs after every Task 30/31 source, script, test and lockfile change; current source/build/toolchain, immutable image/platform/base digests, SBOM/capability/profile digests and all required current evidence match the final manifest. Deterministic negative fixtures prove achieved thresholds still fail for human solving/submission/instance/Challenge Browser action, lost exclusivity, canonical corruption or unproved old execution; scoped unknown does not erase unrelated accepts. The real run's clean/exclusive account/task evidence, score/Hint/resource baseline, duration/elapsed/deadline source, model/reference/tool budgets and intervention policy are frozen. Pre-start makes no Challenges API request and never accepts parent evidence as current.

- [ ] **Step 2: Obtain explicit user approval for the timed one-shot run**

Record approval reference outside model-visible challenge content.

- [ ] **Step 3: Start once and complete post-start admission before any solving effect**

Run: `npm run final-profile:verify -- --manifest <m6-final-profile-manifest> && npm run gate:m6 -- --phase run --prepared-run <run-id> --final-profile <m6-final-profile-manifest> --image <immutable-image-digest>`

Acceptance before solving: verification immediately before process start recomputes the Task 12 identity, inspects the immutable image/platform/base/SBOM/capability/profile identities and rejects any included change since Step 1 with zero Core/model/platform bytes. The run invokes only the manifest image digest; manifest/progress revision 0 is immutable; every visible item is classified; no locked/ambiguous/discovery-incomplete item exists; a non-empty calculable denominator exists.

- [ ] **Step 4: Evaluate without deleting failures or merging reruns**

Run: `npm run gate:m6 -- --phase evaluate --run <run-id> --final-profile <m6-final-profile-manifest>`

Acceptance: result/run metadata names the exact verified final profile and image digest; section 12.5 thresholds pass, zero false success, every supported challenge has a real experiment or verified blocker, all required metrics have sequence-aligned canonical coverage plus source events, secret/VPN recovery has pause plus before/after evidence of no challenge side effect, and cleanup/reporting does not rewrite accepted outcomes. Any missing whole producer group, prohibited intervention, build/profile mismatch or lost integrity produces preserved Gate `failed` with reason rather than pass; independent external platform invalidity maps separately to `infrastructure_invalid`.

- [ ] **Step 5: Commit only sanitized harness/docs if authorized**

Suggested message: `test: record formal ctf agent acceptance`.

## Plan Completion Checklist

- [ ] M0 deterministic host Gate passes on supported macOS and Linux, including two-phase Worker/Browser/instance capacity activation races and release evidence, scoped dispatch decisions, Job/Channel/HTTP/Listener/Browser/Platform mutation-lease interleavings plus Browser background-network quiescence, pure adapter mapping with server-side wire classification/identity, trusted OpenCode config/tool provenance, broker fixture, canonical managed-runtime/Browser metric event/coverage projection, all gated-spawn crash windows and external Launcher fail-stop.
- [ ] M1 all six trajectories pass event/provenance-derived required/forbidden/terminal conditions under the fixed 2/3 rule; long-job continuation uses keyed execution/session allocation, reacquires capacity/new binding exactly once through every crash substate, rejects old bindings, fails harness substitution/broken lineage, and retains all 18 isolated model results/source metrics.
- [ ] Task 12's single build-identity implementation covers every evidence-producing product/test/script/config input and is used by M0/M1/Task 20; Task 20 creates every M2/M3 executable input, then one `LiveBuildManifest` identity passes final M0/M1/readiness before First List; M2 and M3 pass on one uninterrupted task A lineage with no missing required metric group or covered source/config/fixture/harness changes.
- [ ] After Tasks 22-23 source is complete, M4 passes on native Ubuntu ARM64 with independent task B and raw egress bypass tests, including raw denial/managed success for the same broker-only challenge endpoint; one `CoreBuildManifest` binds recomputed source/build identity, immutable ARM64 image/base digests, SBOM/capability digests, parent host lineage and all M4 evidence.
- [ ] Only required M5 capability tracks are implemented; each rebuilds after its source change, reruns base plus independent track Gates against the new digest, and derives the next `FinalProfileManifest` without relabeling parent evidence.
- [ ] After Tasks 30-31 source/harness is complete, M6 reseals and immediately verifies the final profile/image digest before start; the one-shot formal run names that manifest and meets exact denominator/threshold rules with zero false success, complete sequence-aligned event+coverage metrics (including whole-producer deletion controls) and integrity-first invalid/failed handling.
- [ ] No report claims a live, ARM64, network-isolation or formal result that was only proven by fixture/mock/QEMU.
