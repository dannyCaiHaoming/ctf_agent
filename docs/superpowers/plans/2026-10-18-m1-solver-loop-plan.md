# M1 Solver Loop —— Detailed Plan（证明 agent 会「解题」，不只是「跑一次」）

> **Status (2026-10-18)：未开始。** 上游 [M0](2026-10-17-m0-host-foundation-plan.md) 已 COMPLETE（模型 `deepseek-v4-flash`，T0a 探针 25/25 通过）。

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。任务用候选框（`- [ ]`）跟踪：**每个实现步骤**和**每条验收能力**都是一个可勾选项。
>
> 🟢 当前里程碑计划 · 上级路线图见 [`2026-10-16-ctf-agent-mvp-roadmap.md`](2026-10-16-ctf-agent-mvp-roadmap.md) 的「M1」节；权威设计见 [`../specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)；文档索引见 [`../README.md`](../README.md)。

**Goal：** 让 agent 具备**可重复的解题韧性**——在 M0 的脊梁上引入自适应职责、假设/试验/局部修复、长作业恢复、compaction 续跑、独立候选验证和多 flag 处理，并以 spec §12.2 的**六条 loop 轨迹各跑 3 次、至少成功 2 次**作为统计门槛。

**与 M0 的本质差别：** M0 证明「能跑通一次」（1 次冒烟，不作能力门槛）；M1 证明「**反复跑都能正确应对失败**」。因此 M1 的验收是统计性的，且每条轨迹考的是**失败后的行为**，不是解题本身。

**范围提醒：** M1 仍是 host-dev + `local_oracle`，**不碰真实 TSecBench / VPN / 计时**（M2）、**不做多题调度**（M3）、**不做 Docker**（M4）。Reference 只做最小形态；完整 namespace / 版本过滤 / 候选知识审核留 M5。

**固定配置（spec §12.1 要求）：** M1 开始前冻结 model ID、temperature/参数、prompt/template 版本、工具版本和每条轨迹预算；**三次运行必须用同一配置**，且不以同一 conversation 内的重试冒充三个独立 run。

**状态与结果词表：** 一律沿用 spec §7.1 的五组枚举与 outcome 列表（M0 T2 已落地），不自创。

**规模估算（单人投入，非承诺）：** M1 合计约 **20–31 人天**。

| 任务 | 人天 | 备注 |
| --- | --- | --- |
| T1 职责与会话模型 | 1.5–2 | |
| T2 假设/试验/route | 1–2 | |
| T3 Solver 循环（轨迹①②） | 2–3 | |
| T4 Reference 最小形态 | 1–2 | |
| T5 Skills + 三领域方法 | 2–3 | 含三类代表题 |
| T6 长作业与交互式工具面 | 2–3 | 含 broker fixture（可后移） |
| T7 durable watch（轨迹③） | 2–3 | |
| T8 compaction/续跑（轨迹④） | 2–3 | |
| T9 Engineering + Verification（轨迹⑤） | 2–3 | 三模式是本里程碑第二难 |
| T10 多 flag / partial（轨迹⑥） | 1–2 | |
| T11 能力与成本度量 | 1–2 | |
| **T12 六轨迹 harness + 2/3 Gate** | **2–3** | **头号风险：统计门槛受模型能力支配** |

**提交粒度：** 每个任务至少一个提交；契约测试与实现同提交，保证任何提交点上 `gate:m0` 与已完成的 `gate:m1` 子集都是绿的。未经用户授权不自动 commit。

---

## Dependency Order

- **编排骨架先行：** T1 → T2 → T3（T3 产出轨迹①②）。
- **能力补齐（可并行）：** T4（Reference）、T5（Skills/领域方法）、T6（工具面扩展）互不依赖，均只依赖 T1/T2。
- **韧性四条（各自依赖其能力前置）：** T7（依赖 T6）、T8（依赖 T1/T3）、T9（依赖 T3/T5）、T10（依赖 T9）。
- **收口：** T11（依赖 T3–T10 产生事件）→ T12（依赖全部）——组装 harness、跑 2/3 Gate、定稿预算上限。

TDD 同 M0：先写失败测试 → 实现到绿 → 自检 → （授权后）提交。`gate:m0` 全程保持绿。

---

## Task 1：职责与自适应会话模型

**Files：** `packages/contracts/src/**`（handoff envelope）、`packages/supervisor/src/**`、`tests/contract/responsibility-*.test.ts`

**实现步骤**
- [ ] 按 spec §6.1 定义职责枚举：`coordination / intake_triage / target_recon / reference / strategy / domain_solver / solution_engineering / verification / recovery_critic`。
- [ ] `responsibility_set`：task 建立时取得**有界**集合（例如同一 Solver task 可含 `recon + strategy + solving`）；session 可在集合内带责任标签提交，**不可**切 challenge、冒充 Verifier 或运行中扩大集合。
- [ ] 固定的是**责任与提交权限**，不是「每题七次独立模型调用」；同一 session 可完成 Triage/Recon/Strategy 的简单部分，但其 observation / assumption / decision 必须结构化区分。
- [ ] 实现 spec §6.2 的 handoff envelope：`task_id / attempt_id / responsibility / revision / consumed_snapshot_sequence / input_refs / dependency_versions / status / outputs / observation_refs / evidence_refs / assumptions / rejected_assumptions / unresolved_questions / next_action / failure_code / actual_cost`。
- [ ] 身份由 Supervisor 注入；immutable artifact ref 已含内容身份，**不要求模型搬运 hash 清单**。
- [ ] revision 失效规则：只有实际采用的新发布产物或其依赖改变才失效下游；工作区临时日志/注释/未发布修改**不**自动失效旧候选。

**验收能力**
- [ ] session 在 `responsibility_set` 外提交输出被拒绝；运行中扩大集合被拒绝。
- [ ] 切 challenge 或冒充 Verifier 身份被拒绝；task/challenge 改变时必须建新 session。
- [ ] handoff envelope 的每个字段有 schema 校验；缺 `next_action` 或 `status` 的交接被拒。
- [ ] 无关的工作区改动不触发下游 revision 失效（反向测试）。
- [ ] Verifier 职责**不能**与产生该候选的 Solver 共用推理上下文（契约层强制）。

---

## Task 2：Hypothesis / Experiment / Repair 与 route 管理

**Files：** `packages/contracts/src/**`、`packages/supervisor/src/**`、`tests/contract/hypothesis-*.test.ts`

**实现步骤**
- [ ] 按 spec §7.3 定义 hypothesis 结构：`id / claim / preconditions / missing_preconditions / supporting_refs / contradicting_refs / alternative_explanations / falsifier / minimal_experiment / expected_observation / state_dependencies / required_capabilities / route_status / next_action / cost`。
- [ ] 状态机 `proposed → testing → supported | rejected | inconclusive | stale`。
- [ ] **超时、403、429、工具报错、格式错误本身不自动反证题目机制**（必须显式区分工具故障与机制反证）。
- [ ] Experiment 结构：objective、输入/状态依赖、procedure、预期支持/反证、wall/token/remote budget、stop condition、产物；允许多个有序工具步骤完成同一判别问题。
- [ ] Route 管理（§7.4）：同时**一条 primary route + 最多一个低成本 counterprobe**；不建立两条等额完整解法。
- [ ] Semantic progress 判定（§7.3）：只有「新 evidence 支持/否定具体假设」「搜索空间可量化缩小」「得到可验证中间值/partial flag/可重放 PoC/新 capability 判定」「发现并修正分类/generation/session/工具前提错误」四类才算进展；重复错误、轮询、无新信息输出**不算**。
- [ ] 相同 input/state/procedure/parameter fingerprint 无新原因时不重派。

**验收能力**
- [ ] 工具错误/超时/429 不会把 hypothesis 置为 `rejected`（反向测试）。
- [ ] 同时存在两条 primary route 被拒绝；counterprobe 必须声明「不同结果如何改变决策」。
- [ ] 重复 fingerprint 的试验被去重拒绝。
- [ ] 修正、等待、transient retry **不刷新** semantic progress 计数。
- [ ] 连续两个有真实 experiment 但无 semantic progress 的窗口 → 触发 Strategy 重规划（再按需一次 Recovery Critic）。

---

## Task 3：同一 Solver 的执行循环（轨迹①②）

**Files：** `packages/supervisor/src/**`、`fixtures/trajectories/t1-script-error/**`、`fixtures/trajectories/t2-falsified/**`、`tests/integration/solver-loop-*.test.ts`

**实现步骤**
- [ ] 按 spec §6.3 实现循环：取 ready challenge/材料/snapshot → 选可执行 hypothesis → 读改 workspace 脚本 → 执行并即时消费 observation → **工具/语法/参数/解析错误在 repair budget 内局部修正并继续** → 前提被有效反证则保存反证、交 Strategy 改路。
- [ ] **普通文件读取、搜索、局部 patch 和一次脚本修错不重新派 Strategy**（spec §3.4 反目标：每改一行都重派完整角色流水线 = 设计失败）。
- [ ] 失败分类（§8.7）落地：`hypothesis_falsified / tool_invocation_error / output_parse_error / model_transient / model_rate_limited / blocked_data / scope_denied / resource_exhausted` 各有确定处置。
- [ ] **轨迹① fixture**：一道本地题，其自然解法脚本含**确定的**语法/参数/解析错误，真实 stderr 足以定位。
- [ ] **轨迹② fixture**：一道本地题，初始存在**有吸引力但错误**的机制信号，且存在能明确反证它的廉价观察。

**验收能力**
- [ ] **轨迹①**：同一 Solver 读 raw error、局部修正并成功执行（不整段重写、不换 task）。
- [ ] **轨迹②**：前提被有效反证后保存反证并切换 route，**不因沉没成本原样重试**。
- [ ] raw error 完整回灌到 Solver（不是只给摘要）——否则按 spec §3.4 属设计失败。
- [ ] repair budget 耗尽才升级到 Strategy；未耗尽时不升级。
- [ ] `scope_denied` / `blocked_data` 不被当作题目机制的反证。

---

## Task 4：Reference Service（最小形态）

**Files：** `packages/reference/src/**`、`fixtures/reference-snapshot/**`、`tests/contract/reference-*.test.ts`

**实现步骤**
- [ ] 固定、完整、**已人工批准、完全离线**的 snapshot；`approved` namespace（官方规范、工具手册、合法教学、自建 recipe、已审核通用模式）。
- [ ] SQLite FTS5 / BM25 检索；返回**少量高相关 chunk + 来源 + 版本 + 适用条件 + 原文引用**。
- [ ] `reference.search` / `reference.get` 工具面接入（M0 明确推迟的部分）。
- [ ] **同一 run 不热更新**共享知识。
- [ ] 完整 namespace（`run/<run>/<challenge>`、`candidate_knowledge/<run>`）、版本过滤、run 终态后的人工审核发布 → **留 M5，本任务不做**。

**验收能力**
- [ ] 检索返回来源/版本/适用条件齐全；无来源的 chunk 不返回。
- [ ] **Reference 是数据，不授予工具权限**——Reference 内容不能扩大 scope、不能触发工具调用（反向测试）。
- [ ] 同一 run 内 snapshot 不可变（热更新尝试被拒）。
- [ ] 离线：检索过程零网络出站。

---

## Task 5：Skills 与 Web/Misc/Crypto 方法

**Files：** `packages/supervisor/src/skills/**`、`fixtures/challenges/{web,misc,crypto}/**`、`tests/integration/domain-*.test.ts`

**实现步骤**
- [ ] 按需加载的 Skills，每份含**适用线索、最小试验、失败分支、验证方法**；主提示词保留通用闭环，平台细节不混入。
- [ ] **Web**（§7.6）：建立正常 request/page/session 基线（排除登录页/统一错误页/client 重写）→ 源码+DOM+API 形成 input-to-effect 假设 → 一次改一个可解释变量并保存正常值与受控变体 → 机制有支持后才构建利用链。**单次 500/反射/延迟差不自动等于漏洞。**
- [ ] **Misc**（§7.6）：ingestion 保存内容身份/magic/大小/结构/metadata → 以 evidence 选容器/媒体/流量/编码假设 → **只有被保存或后续消费的转换产物才发布为 immutable artifact**，转换节点引用 parent refs/recipe/参数 → 同内容不重复展开，分支受深度/产物数/bytes 限制。
- [ ] **Crypto**（§7.6）：保存 bytes/hex/整数转换、leading zeros、端序、域、位长、padding 与来源 → 先核对便宜的必要条件再启动昂贵算法 → 按 capability matrix 选 SymPy/gmpy2/Z3 等已验证 backend 并声明输入范围/timeout/验算。
- [ ] 补齐工具：数学计算（Python；SageMath 可选且缺失时按 `needs_capability` 降级）、结果登记（候选 flag 登记 / 格式与长度检查 / 证据引用）。
- [ ] 建 Web / Misc / Crypto 各至少一道本地代表题（含 oracle）。

**验收能力**
- [ ] 每份 Skill 的四要素齐全（适用线索/最小试验/失败分支/验证方法）。
- [ ] Web：对统一错误页/登录页的基线排除生效，不把它们误判为漏洞信号。
- [ ] Misc：未被消费的中间转换产物**不**发布为 artifact；同内容重复展开被拒。
- [ ] Crypto：缺 SageMath 时返回具体 `needs_capability` 而非「缺所有格能力」，并尝试已验证 backend。
- [ ] **（次要验收，非统计门槛）** Web/Misc/Crypto 各至少一道本地代表题被解出并经 oracle 接受——用于证明三类 solver 真实可用，但 M1 的正式门槛仍是 T12 的六条轨迹。

---

## Task 6：长作业与交互式工具面扩展

> 补齐 M0 明确推迟的工具面（spec §8.1）。**这是 T7 轨迹③的前置。**

**Files：** `packages/runtime/src/**`、`fixtures/broker/**`、`tests/contract/runtime-interactive-*.test.ts`

**实现步骤**
- [ ] `job.write`（向运行中作业写入）、`job.list(task_snapshot)`、`job.transfer(job_id, new_task_lease)`。
- [ ] `mode: pty | tcp_session`（M0 只有 `batch`）；二进制内容明确 bytes/base64，流式读取仍用单调 cursor。
- [ ] `channel.open / status / read / write / transfer / close`（Crypto 交互 oracle 需要）。
- [ ] **硬限额与一次性 oracle**（§8.4，补 M0 遗漏）：capability 发布 `unit_definition / hard_limit / budget_scope / counting_point / reset_rule / managed_transport / confirmation_condition / quarantine_scope`；每次可能计数前预留 units；自动 retry/redirect/batch 按平台语义计数或禁用。
- [ ] **broker fixture**：让 raw endpoint 对普通 Tool job 不可达、只有受管 transport 可达，用于测试限额记账与拒绝。
- [ ] 无可强制 framing/counting 的能力标 `metering_unavailable`；host-dev **不得声称**一般宿主的 raw socket 非绕过性。
- [ ] `listener.*` 与 callback 发布路径 → **留 M5，本任务不做**（spec §3.2：首个闭环不需要）。

> ⚠️ 硬限额 broker 部分不在六轨迹关键路径上，**时间紧可后移 M2/M3**；但 `pty/tcp_session`、`channel.*`、`job.write/list` 是 T7 与 Crypto 交互题的必需项，不可后移。

**验收能力**
- [ ] PTY 与 TCP session 的交互往返可用，输出仍以单调 cursor 读取、支持 gap 报告。
- [ ] 硬限额 capability 在**发送前**预留 units；超额在发送前被受管 transport 拒绝。
- [ ] 结果不明时**不释放 units、不重开连线、不重发 bytes**；可读既有 endpoint / 查 status / 对账 / force close。
- [ ] 普通 PTY 程序**不**因 transcript 可见就被当成可强制的限次 transport。
- [ ] 缺可强制计数能力时标 `metering_unavailable`，其他 hypothesis 仍可继续（不整题阻塞）。

---

## Task 7：长作业 durable watch 与 continuation（轨迹③）

**Files：** `packages/runtime/src/**`、`packages/state/src/**`、`fixtures/trajectories/t3-long-job/**`、`tests/integration/long-job-*.test.ts`

**实现步骤**
- [ ] `job.watch(job_id, cursor, continuation_ref)`：watch 绑定 job、等待中的 task/experiment、最后 cursor 和 continuation ref。
- [ ] Job 转 `completed | error | cancelled | lost` 时，**State Service 与 outbox 原子提交 terminal event**。
- [ ] **重复 delivery 只能让同一 canonical continuation 取得一次 runnable claim**（幂等）。
- [ ] Worker **无须以模型轮询保持存活**；deadline/cancel 仍可先终止 job 并唤醒错误分支。
- [ ] 已批准的长作业在原期限内等待 completion event，**不消耗失败窗口**（§7.3）。
- [ ] **轨迹③ fixture**：一道需要长时间运行作业（如有界暴力搜索）的本地题，作业时长明显超过一次 Worker 占用。

**验收能力**
- [ ] **轨迹③**：长作业在 Worker 释放后完成；completion event 以保存的 handle/cursor/next action 唤醒并正确恢复后续步骤。
- [ ] 重复投递 terminal event 只产生一次 runnable claim（幂等测试）。
- [ ] 等待期间不以模型轮询续命（无多余模型调用）。
- [ ] 长作业等待**不**计入「连续无进展」窗口。
- [ ] deadline/cancel 能终止 job 并唤醒错误分支。

---

## Task 8：Compaction、snapshot 与本地续跑（轨迹④）

**Files：** `packages/supervisor/src/**`、`packages/opencode-bridge/src/**`、`fixtures/trajectories/t4-compaction/**`、`tests/integration/compaction-*.test.ts`

**实现步骤**
- [ ] 按 spec §6.5 定义可恢复 snapshot：challenge/resource generation/当前目标/**明确下一动作**、最新已发布脚本与输入 refs、已支持与已否定假设与**失败 fingerprint**、关键中间值与原始 observation refs 及必要 byte ranges、活跃 job/channel/cursor/deadline/completion subscription/owner task、已用与剩余预算。
- [ ] Compaction 产生**短工作集，不取代原始资料**；新 session 必须能按 ref 回取原输出。
- [ ] **摘要互相引用而没有原始 observation 的链，不能作为 verification evidence。**
- [ ] 本地 checkpoint 续跑：杀进程后从 checkpoint 接上（平台感知恢复属 M2/M3，本任务不做）。
- [ ] **轨迹④ fixture**：一道解到中途会触发强制 compaction 的本地题，且正确的下一步依赖某段较早的原始输出。

**验收能力**
- [ ] **轨迹④**：强制 compaction / 新 session 后，agent 取回必要原始输出并执行正确下一动作，**不重跑已否定 fingerprint**。
- [ ] 仅由摘要构成、无原始 observation 的链被 Verification 拒收。
- [ ] 杀进程后 `ctf-agent` 能从本地 checkpoint 续跑，不丢 next action。
- [ ] snapshot 的每个必需字段缺失时续跑失败并明确报错（不静默继续）。

---

## Task 9：Solution Engineering 与独立 Verification（轨迹⑤）

> **本里程碑第二难。** spec §6.4 的三模式必须按候选性质选择「可行的最强模式」，不能一律 replay。

**Files：** `packages/supervisor/src/**`、`packages/contracts/src/**`、`fixtures/trajectories/t5-rejected/**`、`tests/contract/verification-*.test.ts`

**实现步骤**
- [ ] Solution Engineering：候选注册后发布脚本/命令/依赖/候选提取；**无候选时不要求建立 Engineer/Verifier session**（§7.2）。
- [ ] Verifier 使用**新 task/session**，**不持有** platform submit / Hint / instance mutation capability。
- [ ] 三模式（§6.4）：
  - `replay`（可安全重跑、不消耗一次性/硬限额资源、不需 reset 远端）：检查 published script/输入/环境/实际产物与 candidate bytes 的关系。
  - `recompute`（可由已保存输入本地重算）：检查原方程、提取链、编码/格式约束与最终 bytes，**不只是重述 Solver 结论**。
  - `evidence_audit`（一次性/限次/原连线随机状态/不可安全 replay）：检查完整 transcript、顺序、当时前置状态、candidate byte range、提取过程与不可 replay 原因。
- [ ] **Verifier 不得为形式上的 replay 重置 instance、建立新随机连线或再消耗 oracle。**
- [ ] Verification result 绑定：candidate value ref/hash、solution artifact、input/dependency versions、instance/connection generation、mode、check results、evidence refs、`valid_until`；来源/candidate bytes/有效条件改变即 `stale`。
- [ ] 转移规则：Engineer 发布失败 → candidate 保持 `unverified`，错误回 Engineer/原 Solver 在 repair budget 内修正；`rejected` → 该 candidate revision terminal，findings 回同一 Solver，**只失效依赖它的结论**；`inconclusive` → 可安全取得缺失 evidence 则建 evidence-capture continuation，否则停放候选并恢复其他 route；`stale` → 只重做受影响的 Engineering/Verification revision。
- [ ] Coordinator 只有在「当下仍有 current `verified` result + 无受影响 unknown effect + generation 有效」时才可提出一次 submit。
- [ ] **轨迹⑤ fixture**：一道本地题，其候选能通过本地 Verifier（例如格式/长度/结构都对）但被 `local_oracle` 明确 `rejected`（例如编码或 slot 选错）。

**验收能力**
- [ ] **轨迹⑤**：Verifier 通过但 oracle 明确 rejected 后，系统**检查提取/编码/slot/generation/假设后继续**，而**不是**标 solved 或终止整题。
- [ ] 证据不完整、关键 range 被截断、只有模型自述、或只是「看起来像 flag」→ 只能 `inconclusive`/`rejected`。
- [ ] Verifier 试图 reset instance / 新建随机连线 / 再消耗 oracle 被拒绝。
- [ ] candidate bytes 或依赖版本改变后，旧 verification 自动 `stale`，不能沿用旧签署。
- [ ] candidate 不会卡在 `engineering`/`verifying`，也不会绕过 current verification 直接提交。
- [ ] 无候选的题目**不**因缺 Engineer/Verifier session 而判失败。

---

## Task 10：多 flag 与 partial（轨迹⑥）

**Files：** `packages/local-oracle/src/**`、`fixtures/trajectories/t6-multiflag/**`、`tests/integration/multiflag-*.test.ts`

**实现步骤**
- [ ] `local_oracle` 支持多 required slots：返回 `correct_flag_count / total_flag_count / matched slot` 与完成状态。
- [ ] 每获得一个可靠候选**立即验证并提交**，再继续寻找剩余 flag（不攒到最后）。
- [ ] 按 `(challenge, matched_flag_index)` 保存已确认结果；`progress_state` 正确落在 `partial`；重复提交同一已接受 flag 被识别为 duplicate 且不重复计分。
- [ ] 多 flag 题只有**全部 required slots 被接受**（或 oracle 报 challenge-complete）才算 `completed`/`solved`。
- [ ] **轨迹⑥ fixture**：一道含 2 个 flag 的本地题，两个 flag 可分别独立取得。

**验收能力**
- [ ] **轨迹⑥**：得到 partial 后保存 accepted slot 与权威得分，**继续求解剩余 slot**（不提前收工、不标 solved）。
- [ ] 重复提交已接受的 flag 不重复计分。
- [ ] 只接受其中一个 slot 时 `progress_state = partial`，outcome 不得为 `solved`。
- [ ] 全部 slot 接受后才转 `completed`。

---

## Task 11：能力与成本度量（spec §12.6）

**Files：** `packages/reporting/src/**`、`tests/contract/metrics-*.test.ts`

**实现步骤**
- [ ] 每个 run 至少记录：从 start 到第一个有效 experiment 的墙钟时间；Solver 连续工具回合数、工具错误数、局部修复成功率、Strategy 回退次数；candidate 产生→Engineer 发布→Verifier 完成→oracle accepted 各段时间；各职责的模型 token/调用数/工具等待/切换成本；observation 可见延迟、artifact 发布等待、hash/IO bytes；各 blocker code 与持续时间；compaction 后重做的失败 fingerprint 数、回取原始输出次数、next-action 成功率。
- [ ] 度量从 canonical events 聚合，**不在此首次采集**运行事件（采集在各拥有边界的任务里）。
- [ ] 不信任 Solver 自报的布尔值或模型自述用量。

**验收能力**
- [ ] 上述每类指标都能从 canonical events 重算得出（删掉聚合层也不丢数据）。
- [ ] 模型自报用量与 OpenCode 可观测 usage 冲突时以后者为准。
- [ ] 指标缺失与「确实未发生」可区分（不是都报 0）。

---

## Task 12：六条轨迹 harness + 2/3 Gate（里程碑验收）

**Files：** `tests/gates/m1.gate.ts`、`docs/gates/m1-inputs.md`、`docs/gates/m1-results.md`

**实现步骤**
- [ ] **冻结 M1 运行配置**：model ID、temperature/参数、prompt/template 版本、工具版本、每条轨迹预算，写入 `docs/gates/m1-inputs.md`。
- [ ] 为六条轨迹各建独立 harness，**每条以干净状态独立运行 3 次**；禁止用同一 conversation 内的重试冒充独立 run。
- [ ] **三次结果全部保存**（含失败的那次），不得只展示最佳 run。
- [ ] 判定必须从 **canonical events / artifacts / oracle 权威状态**重算，不信 Solver 或 summary 的布尔值。
- [ ] 回归：`gate:m0` 仍全绿。
- [ ] 用 T11 的真实用量**定稿预算上限**并写进 release profile（M0 T0b 明确推迟到此）。

**验收能力（= M1 里程碑门槛，spec §12.2）**
- [ ] **轨迹①** 脚本语法/参数/解析错误 → 同一 Solver 读 raw error、局部修正并成功执行 —— **≥2/3**
- [ ] **轨迹②** 机制前提被有效反证 → 保存反证后改路，不因沉没成本原样重试 —— **≥2/3**
- [ ] **轨迹③** 长作业在 Worker 释放后完成 → 以保存的 handle/cursor/next action 恢复后续步骤 —— **≥2/3**
- [ ] **轨迹④** 强制 compaction/新 session 后 → 取回必要原始输出、执行正确下一动作、不重跑已否定 fingerprint —— **≥2/3**
- [ ] **轨迹⑤** Verifier 通过但 oracle 明确 rejected → 诊断提取/编码/slot/generation/假设后继续，而非标 solved 或终止 —— **≥2/3**
- [ ] **轨迹⑥** 多 flag 得到 partial → 保存 accepted slot 与权威得分，继续求解剩余 slot —— **≥2/3**
- [ ] 六条轨迹的 18 次运行结果全部留存并可审计。
- [ ] `gate:m0` 回归全绿。
- [ ] 预算上限已定稿并写入 release profile。

---

## M1 完成检查单

- [ ] T1–T12 全部任务的实现步骤勾完（T6 的硬限额 broker 若后移，须在本文件与 roadmap 同时注明）。
- [ ] 六条轨迹各 ≥2/3 通过，18 次结果全部留存（含失败）。
- [ ] 次要验收：Web/Misc/Crypto 各至少一道本地代表题解出并经 oracle 接受。
- [ ] `gate:m0` 与 `gate:m1` 均全绿，并设为后续里程碑的常设 gate。
- [ ] 预算上限用真实用量定稿，写入 release profile。
- [ ] 范围未越界：未引入真实 TSecBench/VPN/计时、多题调度、Docker、`listener.*`、完整 Reference namespace（留 M2+）。
- [ ] 代码与验证完成；未经用户授权不自动 commit。
