# M0 Host Foundation —— Detailed Plan（确定性地基 + 冒烟解题）

> **Status (2026-10-17)：M0 COMPLETE。** T1–T10 与 T11 确定性 gate 已通过；T11 真实模型冒烟用 `deepseek-v4-flash` 通过并获 local oracle 接受。T0a 五类探针各 5 次共 25 次已全部通过（P5 强制 5/5）；T0b 计费/许可与 token 采样已收口；T0c ARM64 工具链已通过。T9b 按 plan 后移 M2。VPN 实测已移出为 M2 准入前置。

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。任务用候选框（`- [ ]`）跟踪：**每个实现步骤**和**每条验收能力**都是一个可勾选项。
>
> 🟢 当前里程碑计划 · 上级路线图见 [`2026-10-16-ctf-agent-mvp-roadmap.md`](2026-10-16-ctf-agent-mvp-roadmap.md) 的「M0」节；权威设计见 [`../specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)；文档索引见 [`../README.md`](../README.md)。

**Goal：** 立起整条产品脊梁——让一条 `ctf-agent solve` 命令，用真实模型对一个跑着的本地靶机端到端跑完求解循环，产出候选并由 `local_oracle` 判为 `accepted`；同时所有确定性契约（身份/scope/deadline/effect 分级/artifact 发布/secret 边界/Browser 转题 teardown）以**每次必过**的套件锁定。

**范围提醒（避免旧计划的膨胀）：** M0 只建"跑通一次所必需"的最小形态。**不做**：两阶段 capacity 账本、protected-dispatch envelope、mutation lease、cross-incarnation 恢复、build identity manifest、真实 TSecBench/VPN、多题调度、Docker。这些属 M2/M3/M4/M5，需要时再引入（见 roadmap）。M0 唯一的平台实现是 **mock adapter**（验语义）与 **local_oracle**（验真实求解）。
**Reference Service 明确推迟到 M1**：冒烟题不依赖外部知识，M0 不建离线 snapshot / FTS5 检索；M1 引入最小形态（`approved` namespace + 检索 + 引用）。

**规模估算（单人投入，区间反映集成不确定性，非承诺）：** M0 合计约 **20–34 人天**（若 T9b 后移到 M2 则 19–32）。

| 任务 | 人天 | 备注 |
| --- | --- | --- |
| T0a 模型探针矩阵 | 0.5–1 | 凭证已可用，不再 blocked |
| T0b 计费/自动化许可 | 0.5 | 查条款为主 |
| T0c ARM64 工具链 | 0.5（约 1–2 小时） | 容器内即可覆盖大半 |
| T1 骨架 + doctor | 1–2 | |
| T2 contracts | 1–2 | |
| T3 state + effect ledger | 2–4 | 含 §8.3 五态状态机 |
| T4 artifacts | 1 | |
| T5 policy + Gateway | 1–2 | |
| T6 tool runtime | 3–4 | 含 §8.5 的 cursor/gap 契约 |
| T7 browser | 1–2 | |
| **T8 OpenCode 桥接** | **3–5** | **头号风险：桥接契约未知，可能返回设计 blocker** |
| T9a platform + oracle + 靶机 | 2–3 | |
| T9b mock TSecBench adapter | 1–2 | 可后移 M2 |
| T10 supervisor + CLI | 2–3 | |
| T11 gate + 冒烟 | 1–2 | |

**提交粒度：** 每个任务（T1…T11）至少一个提交，任务内"红→绿"可再分；契约测试与其实现同提交，保证任何一个提交点上 `gate:m0` 都是绿的。未经用户授权不自动 commit。

**Tech Stack：** Node.js 24 LTS、TypeScript、npm workspaces、Vitest、Zod、SQLite、Fastify（如需）、OpenCode / `@opencode-ai/plugin` / `@opencode-ai/sdk` `1.19.0`、Playwright Chromium。只用公开 plugin/SDK/server 接口；缺必要 hook 返回设计 blocker，不维护 fork。

**状态与结果词表（一律照 spec §7.1，不自创）：** 五组状态独立建模（`pipeline_stage / solve_state / progress_state / resource_state / cleanup_state / run_state`，取值见 T2）；最终 outcome 为 `solved | partial | candidate_only | unsolved | inconclusive | infrastructure_invalid`。`finished` ≠ `solved`——只有平台或等价 local oracle 的权威接受可标 `solved`；缺可验证 oracle 时最高 `candidate_only`（spec §5.5）。M0 经 `local_oracle` 可达 `solved`。

**外部输入（spec §13）：** 确定性 gate（T1–T10）**不需要**外部输入。**冒烟 solve（T11-验收②）需要一个工具调用可靠的可用模型 + 凭证经 Model Data Gateway**；缺失时可完成代码与 fixture，但该验收记 `blocked_external_input`，不写成通过。

---

## Dependency Order

- **早期 spike：** T0a/T0b/T0c 与 T1 并行启动，互不依赖，也不阻塞任何其他任务；但 T0a 的结论可能推翻 model 选型，T0b 可能限制 M3 的无人值守模式，T0c 可能暴露 ARM64 交付风险。三者现在都**不依赖外部输入**（VPN 实测已移出到 M2 准入）。
- **契约先行：** T1 → T2 →（T3、T4 可并行）→ T5。
- **运行时与边界：** T6（依赖 T2/T3/T5）、T7（依赖 T2/T5）可并行。
- **底座接入：** T8（依赖 T2/T3/T5）——**头号风险，建议尽早开始**。
- **平台与编排：** T9a（依赖 T3/T5）→ T10（依赖 T6/T8/T9a）。
- **旁路：** T9b（mock TSecBench adapter）只依赖 T2，可随时插空做，**不被 T10/T11 依赖**。
- **收口：** T11（依赖 T1–T10，不含 T9b）——组装确定性 gate 并跑冒烟 solve。

每个任务遵循 TDD：先写失败测试 → 实现到变绿 → 自检 → （授权后）提交。确定性契约测试一旦写出，之后每个任务都必须保持全绿。

---

## Task 0：早期降风险 spike（与 T1 并行，不阻塞）

> 目的是 **fail fast**：这些若不成立会让后续里程碑整体返工，所以不等用上才验证。结论写入 `docs/gates/m0-inputs.md`，**不产生产品代码**（T0 阶段用一次性脚本/手工命令即可）。
>
> 原先把「模型探针 + 成本上限 + VPN/ARM64」捆成一条，导致整个 T0 被外部输入卡死。现按**可做性**拆成三项：T0a 与 T0c 现在就能做完，只有 VPN 真正依赖外部任务（已移出，见 T0c 末）。

### Task 0a：模型能力探针矩阵 — **DONE**

> **当前状态：DONE。** 2026-10-17 用用户授权的 Coding Plan 接入完成 25 次独立 live probe；P1–P5 均为 5/5，P5 零虚假成功达标。证据见 `docs/gates/t0a-model-probes.md`。

**实现步骤**
- [x] 固定 model ID / temperature / 参数，每条探针**独立跑 5 次**，逐次结果全部留存（不只记最好的一次）。
- [x] **P1 结构化工具调用**：给 2–3 个严格 schema 的工具，要求 3+ 次顺序调用完成一件事。
- [x] **P2 raw error 自修复**（对应 M1 轨迹①）：一段故意写坏的 Python + 真实 stderr，要求修复。
- [x] **P3 反证后改路**（对应 M1 轨迹②）：先诱导出一个假设，再给明确反证。
- [x] **P4 长输出里捞针**（对应 M1 轨迹④）：50KB+ 工具输出、关键信息埋中段，要求定位并引用。
- [x] **P5 不虚报成功**（spec 核心要求「零虚假成功」）：给一个信息不足、客观无解的任务。
- [x] 记录每条探针的 token 用量，交给 T0b 作单位成本采样。

**验收能力**
- [x] P1：5 跑 ≥4 次无幻觉参数、不发明工具。
- [x] P2：≥4/5 在 ≤2 轮内**局部**修好（不是整段重写）。
- [x] P3：≥3/5 放弃原路改走新路，而非原样重试。
- [x] P4：≥3/5 能准确定位并引用埋藏信息。
- [x] **P5：5/5 必须报 blocked/缺信息——编造 flag 即一票否决**，该模型不可用于本项目（后续整套 verifier/oracle 只是在补救它）。
- [x] 产出书面结论：选定 model + 依据 + 逐条探针通过率（或明确「候选均不合格」）。

### Task 0b：计费模式与自动化许可（**不是**成本上限评审） — **DONE**

> M0 阶段没有任何真实用量数据，现在定「预算上限」等于评审一个拍脑袋的数字。**真正该在此刻 settle 的是合规问题**：所选计费模式是否允许无人值守/批量调用——它决定 M3 的多题自动跑是否合法（spec §9：Coding Plan 与按量 API 准入范围不同）。

**实现步骤**
- [x] 确认所选 provider 的计费模式（Coding Plan / 按量 API / 其他）。Coding Plan 是订阅；按 token 后付费是独立模式。
- [x] 确认该模式**是否允许自动化、批量、无人值守调用**；官方文档记录非 AI 编程工具/API 风险，但用户明确授权当前用途并要求按 Coding Plan 接入；按量示例 profile 仅保留为未来迁移路径。
- [x] 汇总 T0a 五条探针的实际 token 用量，作为**单位成本采样**写入结论。

**验收能力**
- [x] 有书面结论：计费模式 + 是否允许自动化/批量 + 依据来源（官方文档/条款引用）。见 `docs/gates/t0b-billing-automation.md`。
- [x] 若交互式与批量规则不同，release profile 中两套接入配置已分离，不共用凭证。见 `config/release-profile.volcano-payg.example.json`。
- [x] 有一份单位成本采样数据。
- [x] **预算上限不在本任务设定**——推迟到 M1 结束后用六轨迹真实用量确定，再写进 release profile。

### Task 0c：ARM64 工具链可行性（VPN 已移出） — **DONE**

> 不需要 VPN、不需要 TSecBench 任务，只要 arm64 Linux 用户态，**现在就能做**。最大未知是 Playwright Chromium 在 ARM64 Linux（历史痛点）和重型 Crypto 的 arm64 wheel。约 1–2 小时。

**实现步骤**
- [x] 在 arm64 Linux 用户态中逐项验证（Apple Silicon 可用 `docker run --rm -it --platform linux/arm64 ubuntu:24.04` 覆盖大半）：
  - [x] Node 24 安装可用。
  - [x] OpenCode `1.19.0` 安装并 `--version` 可用。
  - [x] Playwright Chromium 安装并**真的 headless 打开一个页面**（不是只看安装成功）。
  - [x] Core 工具清单（spec §11.4）逐个**按功能**验证，不以 `--version` 代替。
  - [x] 重型 Crypto（gmpy2 / Z3 / SageMath）的 arm64 可得性与编译成本。gmpy2/Z3 可用；SageMath 在 Ubuntu 24.04 ports 不可得。
- [x] 记录：哪些没有 arm64 构建、哪些需现场编译、各自耗时与镜像体积。见 `docs/gates/t0c-arm64-results.md`。
- [x] **记录 VPN 已知风险与备选方案**（不假装已验证）：独立 VPN 网关主机 / 已验证的 VPN 服务容器 / 退化为 x86 宿主跑 VPN 再路由给 ARM64。

**验收能力**
- [x] 有书面结论：每项工具在 ARM64 上 available / 需编译 / 不可得 + 依据。见 `docs/gates/t0c-arm64-results.md`。
- [x] Chromium 在 ARM64 上确实能 headless 打开页面（或明确记为不可得 + 影响面）。
- [x] 结论中**明确边界**：容器化验证只回答「有无 arm64 构建、能否运行」，**不**回答内核 / TUN / VPN 与真机性能——那些仍需真机（M4）。
- [x] VPN 风险与备选方案已记录为 M2/M4 前置风险。

> **VPN 实测已移出 M0 → 成为 M2 的准入前置。** 它需要平台实际下发的 SSLVPN 客户端与配置，而那要等用户先建任务，没有任务就无从验证。任务一建立就立刻做（排在写任何 M2 代码之前）：从**实际 Tool Runtime 的网络**（不是开发机浏览器）`GET http://10.0.100.58`，要求 200 且 `status == "ok"`（spec §5.2）；同时记录客户端名称/协议/有无 arm64 构建，作为 M4 的输入。

---

## Task 1：Workspace 与确定性测试骨架 — **DONE**

**Files：** `package.json`、`package-lock.json`、`.nvmrc`、`tsconfig*.json`、`vitest.config.ts`、`config/release-profile.schema.json`、`config/release-profile.example.json`、`apps/cli/src/main.ts`、`apps/cli/src/commands/{solve,doctor}.ts`、`tests/bootstrap/test-harness.test.ts`

**实现步骤**
- [x] 建立 npm workspace、`tsconfig`、Vitest 配置与初始 lockfile（lockfile 由维护者在 run 外 `npm install --package-lock-only --ignore-scripts` 更新，CI/开发用 `npm ci`）。
- [x] 加根脚本：`typecheck`、`test:deterministic`、`gate:m0`，以及 `cli`、`build`。
- [x] 建最小 `release-profile` schema + example（model/Reference/预算/OS 输入，不含 secret），实现 `loadReleaseProfile(path)`。
- [x] CLI 骨架：`ctf-agent solve`（占位，T10 填实）、`ctf-agent doctor`。
  - **两种入口的关系**（避免与 spec §4.2/§5.2 混淆）：**本地模式** `ctf-agent solve` 直接对已授权靶机建立单一 challenge（spec §5.5），M0 用它；**平台模式** `ctf-agent prepare` → `start` → `status`/`stop` 因为涉及不可逆计时，属 M2。M0 **不实现** prepare/start。
- [x] **`ctf-agent doctor` 在 M0 要做实**（不是占位）：按 spec §4.1 的 Capability Matrix 报告 model 可达性、必需 binary/工具是否存在且**按功能**可用（不只 `--version`）、Chromium 能否启动。缺失项明示为 unavailable，不伪装可用，也不阻止其余检查继续。平台/VPN 检查属 M2，容器/arch 属 M4。
- [x] 写 bootstrap 冒烟测试，证明干净 checkout 能 `npm ci` 并跑起测试套件。

**验收能力**
- [x] 干净 checkout 能 `npm ci` 并运行 `test:deterministic`，初始套件全绿。
- [x] `loadReleaseProfile` 对合法 example 通过、对缺字段/含 secret 的 profile 拒绝。
- [x] `ctf-agent --help` 列出 `solve`/`doctor`；`gate:m0` 脚本存在且可调用。
- [x] `ctf-agent doctor` 输出 Capability Matrix：每项工具/能力标 available/unavailable + 判定依据；缺 Chromium 或缺某工具时不崩溃、不谎报可用。

---

## Task 2：Contracts（M0 子集） — **DONE**

**Files：** `packages/contracts/src/**`、`tests/contract/contracts-*.test.ts`

**实现步骤**
- [x] 定义 branded IDs 与 Zod schema：`run / challenge / task / session`、`responsibility_set`、`lease`。
- [x] **状态枚举严格照 spec §7.1，分五组独立建模，不自创、不合并**：
  - `pipeline_stage`：`intake | recon | strategy | solving | engineering | verifying | submitting | finalizing`
  - `solve_state`：`queued | active | paused | blocked_auth | blocked_capability | blocked_data | blocked_platform | blocked_runtime | finished | deadline_exceeded`
  - `progress_state`：`no_candidate | candidate | candidate_only | partial | completed | unknown_total`
  - `resource_state`：`absent | starting | ready | retained | closing | closed | unknown`
  - `cleanup_state`：`not_needed | pending | succeeded | failed | unknown`
  - `run_state`：`draft | prepared | starting | admitting | running | interrupted | finalizing | completed | failed | invalid | aborted`
- [x] 最终 outcome 枚举：`solved | partial | candidate_only | unsolved | inconclusive | infrastructure_invalid`。`finished` ≠ `solved`。
- [x] Effect 分级：`local_rebuildable | retryable_observation | protected_effect`。
- [x] **最小预算**：墙钟 deadline + 步数/工具作业上限 + 可观测 token 计数（**不是**两阶段 capacity 账本）。
- [x] Observation：单调 cursor 与「发布后不可变 range」类型。
- [x] 数据分级（spec §10.2）：`control_secret | challenge_auth_reference | challenge_analysis_data | artifact_bulk | allowed_excerpt | unknown`。
- [x] Intent：`candidate.submit`（供 oracle/mock 平台用）。

**验收能力**
- [x] 每个 schema 对合法样例通过、对越界/缺字段/错枚举拒绝（contract test）。
- [x] 五组状态枚举的取值与 spec §7.1 **逐字一致**（对照测试：把 spec 的枚举列表作为 fixture 断言，防止漂移）。
- [x] 跨组串用被拒绝（例如 `blocked_runtime` 不能出现在 `run_state`）。
- [x] `progress_state` 的 `candidate`/`candidate_only` 不能被当作 outcome `solved`（类型/校验层拒绝）。
- [x] `control_secret` 类型不可被序列化进面向模型/工具/artifact 的 DTO（编译期 type-test；**运行时 enforcement 在 T5 验证**，此处只验类型层）。

---

## Task 3：State（SQLite 为唯一 canonical 写入源） — **DONE**

**Files：** `packages/state/src/**`、`tests/contract/state-*.test.ts`

**实现步骤**
- [x] SQLite migration + repository；run 目录布局 `runs/<eval>/<unique_code>/<run-id>/{challenge.json,state.json,events.jsonl,input,artifacts,scripts}`。
- [x] Event / outbox 追加接口；只接受 schema 验证过的 delta，原子追加。
- [x] **Protected effect ledger 按 spec §8.3 的状态机实现**（`local_oracle` 的 `candidate.submit` 就是 protected_effect，M0 必须有）：
  - `prepared`（保存 operation/call ID、kind、payload identity、challenge、generation、预算、deadline、预期后置条件）
  - → `dispatching`（可能已送出；**本地 timeout 不得直接改成 `failed_not_dispatched`**）
  - → `confirmed`（保存权威 response + 另记 business outcome `accepted|rejected|duplicate|invalid_state|closed`）
  - → `failed_not_dispatched`（仅限已证明未发送）／`unknown`（保守占额，只隔离最小 operation/challenge scope）
- [x] 相同 ID + 相同内容的重试只读 canonical 状态；**不同内容必须用新 ID**。
- [x] 最小 checkpoint（spec §6.5 子集：challenge/目标/下一动作、已发布 refs、已否定 fingerprint、活跃 job cursor、已用/剩余预算），供本地续跑。
- [x] 不暴露任意 SQL / canonical DB 写入口。

**验收能力**
- [x] 无来源 observation 不能升级为 evidence（被 State 拒绝）。
- [x] effect ledger 的五个状态转移都有测试；本地 timeout 停在 `dispatching`/`unknown`，不被误判为未发送。
- [x] 同 ID 不同 payload 的提交被拒绝（冲突检查）。
- [x] `unknown` 只隔离对应 operation/challenge，不升级为全局 quarantine（spec §3.4 反目标）。
- [x] JSON 导出（state.json/events.jsonl）只能由 canonical state 导出，不能反向写入。
- [x] 杀进程后能从 checkpoint 读回阶段/预算/下一动作/已否定 fingerprint（本地续跑，平台对账不在 M0）。
- [x] 不存在绕过 repository 的裸 SQL 写入口（contract test）。

---

## Task 4：Artifacts（内容寻址 + 原子发布） — **DONE**

**Files：** `packages/artifacts/src/**`、`tests/contract/artifacts-*.test.ts`

**实现步骤**
- [x] 内容寻址写入 + 原子发布；byte-range evidence 引用；完整性 hash 校验。
- [x] canonical state 只引用已发布 artifact，不引用半发布内容。

**验收能力**
- [x] 发布后的 immutable range 不因后续写入改变（旧 ref 稳定）。
- [x] 半发布/损坏 artifact 不能被 canonical state 引用（校验失败 fail closed）。

---

## Task 5：Policy 与 Model Data Gateway — **DONE**

**Files：** `packages/policy/src/**`、`tests/contract/policy-*.test.ts`、`tests/contract/gateway-*.test.ts`

**实现步骤**
- [x] session/lease/scope/capability 检查；忽略模型自报身份。
- [x] 数据分级执行：按 class 决定模型可见性；`control_secret` 永不外送。
- [x] Model Data Gateway：所有 provider 路径（含 compaction/retry/subagent/summary/多模态）经同一 Gateway 或 contract-tested 等价拦截；工具 job 使用过滤环境，不继承 provider/平台 secret。

**验收能力**
- [x] 未覆盖的 provider 路径不可用（而非静默放行）。
- [x] `control_secret` 不出现在发往模型的任何请求、工具 job 环境、artifact 或日志中（contract test 扫描）。
- [x] `artifact_bulk` 不被机械切片绕过大小/外送政策；`allowed_excerpt` 可按 ref 回取。
- [x] 伪造 session/lease/scope 的工具调用被拒绝。

---

## Task 6：Tool Runtime（最小工具面） — **DONE（M0 contract 面域）**

**Files：** `packages/runtime/src/**`、`tests/contract/runtime-*.test.ts`、`tests/integration/tool-*.test.ts`

> **M0 实现的工具面子集**（对照 spec §8.1 完整列表，明确划界）：
> **做**：`workspace.list/read/search/patch/stat/publish`、`job.start/status/read/cancel`（`mode: batch`）、`http_session.open/request/close`、`artifact.inspect/publish`、`candidate.register`、`platform.intent.*`、`browser.*`（T7）。
> **不做（留给 M1+）**：`job.write`、`job.transfer`、`job.watch`、`job.list`、`mode: pty|tcp_session`、`channel.*`、`listener.*`、`reference.*`。M0 的冒烟题不需要交互式会话与长作业 watch。

**实现步骤**
- [x] workspace 管理：每 task 固定题目 workspace，题目内 `.opencode` 只作数据，越界读写/外部配置加载被拒。
- [x] `job.start`（batch）：命令/工作目录/超时/limits；**先分配 job ID 并写 job record，再启动进程**（spec §8.2），使 RPC response 丢失后可用 job ID 查询。
- [x] `job.cancel` 终止整个进程组；长输出完整存盘、向模型返回有限摘要 + 检索入口。
- [x] **`job.read(job_id, cursor, max_bytes)` 按 spec §8.5 返回**：当前可读 bytes、`retained_start_cursor`、下一 cursor，以及状态 `running | waiting | eof | lost | cursor_evicted`；请求 cursor 早于保留窗口时**明确返回 gap 与可用范围**，不得静默从较新位置开始。
- [x] HTTP 会话：请求/响应保存为 artifact，返回原始响应引用。
- [x] 文件工具：读/搜索/编辑脚本，原始输入保留独立副本。
- [x] effect 分级在边界处标注；发布流程按 spec §8.5：选 range → Runtime 算 hash → 原子写 Artifact Store → 在 SQLite transaction 提交 ref/event。

**验收能力**
- [x] `job.start` 的超时/取消能终止整个进程组（无残留子进程）。
- [x] RPC response 丢失后能用 job ID 查到既有 job，不会凭空建第二个 attempt。
- [x] `job.read` 在作业运行时即时返回新 bytes（不等整份 evidence 封存）；发布 evidence 后旧 ref 不随后续输出改变。
- [x] 请求已被 evict 的 cursor 时返回 `cursor_evicted` + 可用范围；**有 gap 的 transcript 不能被标成完整 evidence**（publish 明确失败并返回缺失 range）。
- [x] 越界 workspace 读写与题目 `.opencode` 当配置加载均被拒绝。
- [x] 工具 job 环境不含 provider/平台 secret。

---

## Task 7：Browser Service（单个按需 Challenge Browser） — **DONE at service/contract level；真实 Chromium binary 未安装，doctor 如实报 unavailable**

**Files：** `packages/browser/src/**`、`tests/contract/browser-*.test.ts`、`tests/integration/browser-*.test.ts`

**实现步骤**
- [x] 单个按需启动的 Playwright Chromium；按 challenge 绑定 scope。
- [x] scoped navigation/fetch/WebSocket/download；跨 scope 访问被拒。
- [x] 转题时销毁整个 browser process/profile。

**验收能力**
- [x] 浏览器只能访问当前 challenge 授权的地址，跨 scope 被拒。
- [x] navigation/fetch/WebSocket/download 四类操作都受 scope 约束且有 observation 记录。
- [x] 转题触发整个 process/profile teardown（无状态泄漏到下一题）。

---

## Task 8：OpenCode Bridge 与 plugin — ⚠️ **集成缺口（2026-10-19 复核）**

> **此前标记 DONE 不成立。** 2026-10-19 核查发现：`@ctf/opencode-bridge` 除 `opencode-plugin` 自身外**零消费者**，`apps/cli/src/commands/solve.ts` 对 opencode 的引用数为 **0**，M1 的 `solveM1.ts` 同样不经过它——**产品 solve 路径从未真的走过 OpenCode**，违反 spec line 29。
>
> 本任务的契约测试全部跑在 **stub provider** 上，只证明了 adapter 组件可用，**从未验证产品路径的集成**。这是「组件完成 ≠ 集成完成」最重要的一次发作。
>
> **纠正在 [M1 plan](2026-10-18-m1-solver-loop-plan.md) 的 Task A**；其验收要求把本任务的 stub 断言改为**集成断言**。在此之前，M0 的「COMPLETE」应理解为**不含 OpenCode 集成**。

**Files：** `packages/opencode-bridge/src/**`、`apps/opencode-plugin/src/index.ts`、`tests/contract/opencode-*.test.ts`、`tests/integration/opencode-*.test.ts`

**实现步骤**
- [x] OpenCode server 生命周期（固定 `1.19.0`）；本地 authenticated tool RPC。
- [x] 不可变 session 绑定：`session_id → run/challenge/task/responsibility_set/lease`，未绑定 session 不可调 CTF 工具。
- [x] 插件只暴露 allowlist 内受管工具；把 `ToolContext.sessionID` 交给 Bridge；不接受模型自报身份。
- [x] **建一个 stub provider**（可脚本化回放的假模型：可编排工具调用、错误、compaction 触发、retry），让下面五条路径的契约测试**不依赖真实模型**，从而 T8 不被外部输入阻塞。
- [x] contract-test 覆盖主会话、subagent、retry、compaction、summary（最小），全部跑在 stub provider 上。
- [x] stub provider 走与真实 provider **完全相同的 Model Data Gateway 路径**，不得另开旁路（否则测不到数据分级）。

**验收能力**
- [x] 未绑定或伪造 run/task/lease 的 session 调用 CTF 工具被拒绝。
- [x] 模型自报的身份/sessionID 被忽略，只认 Bridge 从 `ToolContext` 得到的绑定。
- [x] allowlist 外的工具不暴露给解题 session；注入的工具被 server 侧拒绝。
- [x] 主会话/subagent/retry/compaction/summary 五条路径的 contract test **在 stub provider 上**通过（缺必要 hook 则记为设计 blocker，不维护 fork）。
- [x] 本任务**不需要**真实模型凭证即可全绿（真实模型只在 T11 冒烟用）。

---

## Task 9a：Platform Service + local_oracle + 本地靶机（冒烟关键路径） — **DONE**

**Files：** `packages/platform/src/**`、`fixtures/local-target/**`、`fixtures/local-oracle/**`、`tests/contract/platform-*.test.ts`

**实现步骤**
- [x] Platform Service 为平台凭证与平台副作用的唯一持有者；Coordinator 是唯一 submit intent 提出者；solver/verifier 不能直接提交。
- [x] **`local_oracle` adapter**（spec §5.5）：typed `candidate.submit` / `challenge.status`，返回权威 `accepted/rejected`、完成状态与 required slots；由 Platform Service 执行并遵守 effect ledger。
- [x] **钉死冒烟靶机 fixture**（不能只写"一道简单 Web 题"）：一个最小 HTTP 服务，含**单一确定的漏洞类型**与**单一确定的 flag**，可用一条 `exec_job`/HTTP 请求链得到；flag 只存在于服务端，不出现在题面或仓库明文。固定端口/启动脚本/健康检查，`ctf-agent solve` 可直接指向它。
- [x] 该 fixture 的 oracle 配置：正确 flag → `accepted`，任何其他值 → `rejected`，required slots = 1。

**验收能力**
- [x] solver/verifier 直接提交被拒绝；只有 Coordinator intent 能进平台 effect ledger。
- [x] `local_oracle` 对正确 flag 返回 `accepted`、对错误 flag 返回 `rejected`，且结果经 effect ledger 记录。
- [x] 靶机可一键启动并通过健康检查；关掉靶机时 `ctf-agent solve` 得到明确 blocker 而非假成功。
- [x] 缺可验证 oracle 的本地靶场，outcome 最高只能 `candidate_only`（不能冒充 `solved`）。

---

## Task 9b：mock TSecBench adapter（M2 准备，不在冒烟关键路径） — **DEFERRED to M2**

> 不被 T10/T11 依赖；时间紧可整体后移到 M2 起步，但越早锁定契约越省事。

**Files：** `fixtures/tsecbench-mock/**`、`tests/contract/tsecbench-*.test.ts`

**实现步骤**
- [ ] 用固定 `tsec-benchmark 0.1.2` 的已核实契约喂假平台，覆盖 list/start/submit/close/hint 的 wire 语义。
- [ ] 覆盖 spec §12.3 的关键分支：`404 task_not_found`、description null、difficulty/level 类型、`pending→available`/`stop_pending→stopped`、多地址、200/`correct=false`、partial、`duplicate`、不同场景的 `invalid_state`、Hint null。

**验收能力**
- [ ] 上述每个分支都有对应测试且通过。
- [ ] 200/`correct=false` 被当作**权威拒绝**，不是传输失败。
- [ ] `invalid_state` 按操作 + 当前 list 状态 + message 分流，不用"任意 invalid_state 结束整场"的规则。
- [ ] Hint 即使是 GET 也按计分副作用处理，不作为普通只读查询自动调用。

---

## Task 10：Supervisor（最小）与 `ctf-agent solve` 编排 — **DONE（integration 使用 scripted model）；真实模型路径待 T11 输入**

**Files：** `packages/supervisor/src/**`、`apps/cli/src/commands/solve.ts`、`apps/cli/src/composition/**`、`tests/integration/solve-*.test.ts`

**实现步骤**
- [x] run lifecycle + task/execution lease；host composition 注入唯一 State/工具/平台组装。
- [x] 最小预算执行：墙钟 deadline + 步数/作业上限，超额停止新工作并 checkpoint（Agent 文字不能延长）。
- [x] 单一通用 solver 循环（M0 先不拆角色，但 `pipeline_stage` 仍按 spec §7.1 记录）：`intake → recon → solving → verifying → submitting → finalizing`（`strategy`/`engineering` 在 M0 可直接穿过，M1 才实质拆开），候选经 Coordinator → `local_oracle`。
- [x] `ctf-agent solve --target/--description/--input`：对本地靶机建立单一 challenge 并启动循环。
- [x] **Verification 职责在 M0 不拆独立 session**：候选直接交 `local_oracle` 做权威判定；spec §6.4 的 `replay/recompute/evidence_audit` 三模式与「Verifier 用独立 task/新 session、不共享 Solver 推理上下文」属 **M1**，M0 不实现。

**验收能力**
- [x] `ctf-agent solve` 对本地靶机完整跑完一轮（`intake` 到 `finalizing`），候选进入 oracle 判定。
- [x] 超过墙钟/步数预算时停止并 checkpoint，`solve_state` 落 `deadline_exceeded` 或对应 `blocked_*`，**而非声称成功**。
- [x] 候选只能经 Coordinator → Platform Service 提交到 oracle，循环内不能旁路提交。
- [x] oracle 判 `rejected` 时回到求解而不是标 solved 或直接结束整题（spec §3.4 反目标）。
- [x] run 目录留下 `events.jsonl`、`result.json` 与工具证据引用。

---

## Task 11：确定性 Gate 组装 + 冒烟 Solve — **PARTIAL：`gate:m0` DONE；真实模型冒烟 `blocked_external_input`**

**Files：** `tests/gates/m0.gate.ts`、`tests/integration/smoke-solve.test.ts`、`docs/gates/m0-inputs.md`

**实现步骤**
- [x] 把 T1–T10 的确定性契约测试组装成 `gate:m0` 套件（常设、每次必过、无需外部输入）。
- [x] 冒烟 solve harness：用预登记 model/profile，真实模型对本地靶机求解一次，候选交 `local_oracle`。
- [x] 记录冒烟 run 的 model ID/参数/工具版本/耗时/可观测 token/终止原因到 run 目录。
- [x] 外部输入缺失（无可用模型）时，把冒烟验收记为 `blocked_external_input` 并说明。

**验收能力（= M0 里程碑验收门槛）**
- [x] **① 确定性契约 gate 全过**：身份/scope、deadline/预算、effect 分级、artifact 发布、secret 边界、Browser scoped 操作与转题 teardown —— `gate:m0` 全绿。
- [x] **② 冒烟 solve（1 次）**：真实模型对本地靶机端到端跑完，产出候选并由 `local_oracle` 判 `accepted`（仅证明端到端通路，不作能力门槛；能力门槛在 M1）。
- [x] 冒烟 run 的配置与度量（model/工具版本/耗时/token/终止原因）完整落盘。

---

## M0 完成检查单

- [x] T0a–T11 全部任务的实现步骤勾完（T9b 已按前述条件后移到 M2）。
- [x] T0 的三份书面结论已产出：① model 选型 + 逐条探针通过率；② 计费模式与自动化许可；③ ARM64 工具链可行性 + VPN 风险备选。
- [x] P5（不虚报成功）为 5/5——若该模型会编造 flag，**不得进入 M1**。
- [x] 状态枚举与 spec §7.1 逐字一致（对照测试通过），未自创词表。
- [x] `gate:m0` 确定性套件全绿，且被设为之后每里程碑都必须保持的常设 gate。
- [x] 冒烟 solve 通过（或在无模型时明确记 `blocked_external_input`，不写成通过）。
- [x] 范围未越界：未引入两阶段 capacity 账本、mutation lease、protected-dispatch envelope、Reference Service、真实 TSecBench/VPN、多题调度或 Docker（这些留给 M1+）。
- [x] 代码与验证完成；未经用户授权不自动 commit。
