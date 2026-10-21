> 🟢 **当前路线图（current）** · 权威设计见 [`../specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)，文档索引见 [`../README.md`](../README.md)。

# 通用 CTF 解题 Agent — MVP 交付 Roadmap

创建日期：2026-10-16；本轮修订：2026-10-21（完成 S3 原始附件受管解包、目标/oracle 说明修正与复盘；记录修复后的真实 run）。
状态：现行路线图；M0 的历史完成记录为 2026-10-17（T9b 后移 M2），不代表当前通用 Web 能力完成；MFW 已在隔离工作树取得单题成功，main 尚未合并相关能力。本文定义里程碑边界与验收门槛，不是实现计划；每个里程碑在启动时单独产出一份 detailed plan。

**Spec：** [`docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)（含 [原始 brainstorm](../specs/archive/2026-10-13-ctf-solving-agent-design.md)）
**归档：** 旧的单体实施计划见 [`plans/archive/2026-10-15-general-ctf-agent-system-implementation.md`](archive/2026-10-15-general-ctf-agent-system-implementation.md)，仅作参考，不再执行。

---

## 为什么重写

旧计划把整份 spec 一次性展开成 31 个任务，并按**水平分层**组织依赖：`M0(Task 1-12) → M1 → … → M4`，要求先把 contracts / state / policy / runtime / platform / supervisor 全部"地基"建完，任何东西才允许跑起来——光 M0 就 1700 行。随后每条 review 发现（capacity 两阶段账本、protected-dispatch envelope、mutation lease、build-identity manifest 等加固性约束）又被反折回去堆进早期任务，计划越审越厚（"累加累加"），且在 M2 之前**没有任何一个能真正解一道题的产品**。既看不到进展，又容易反复推翻地基——这是死循环的根因。

## 本 Roadmap 的原则

1. **垂直切片，不是水平分层。** 每个里程碑是一条能端到端跑、可演示验收的最薄路径，后一个在前一个上加厚，而不是先造完所有零件。
2. **每个里程碑 = 一个可验收的 MVP。** 验收产物永远是"能跑的东西 + 一条通过的门槛"，不是"一批不可运行的脚手架"。
3. **回归保护、单题闭环与统计能力分开。** 既有确定性 gate 保持可用，修改后按仓库要求执行必要的定向检查与相关回归，不新增 gate 或对未改代码反复跑全套。当前 M1 以一次无解法提示、无人工解题介入的真实整题完成证明该题自主闭环；这不证明泛化通过率。统计能力验收的题集、配置、样本数与门槛另行确定和授权，不把旧轨迹 2/3 门槛重新设为首题前置。
4. **加固性关注点按需后置，并给硬边界。** capacity 账本、protected dispatch、mutation lease、build identity 等不前置进地基；只有当某个里程碑出现真实的并发/安全/可复现失败场景时才引入，且遵守「每个 profile 同时只允许一个 active run」(spec §4.5) 这一简化不变式——旧计划大量 cross-incarnation/多 owner 机制因此根本不需要。
5. **状态与结果词表一律用 spec §7.1 的枚举，不自创。** 五组状态分开：`pipeline_stage`（`intake|recon|strategy|solving|engineering|verifying|submitting|finalizing`）、`solve_state`、`progress_state`（`no_candidate|candidate|candidate_only|partial|completed|unknown_total`）、`resource_state`、`cleanup_state`、`run_state`；最终 outcome 固定为 `solved|partial|candidate_only|unsolved|inconclusive|infrastructure_invalid`。`finished` ≠ solved；**只有平台或等价 local oracle 的权威接受可标 `solved`**，缺可验证 oracle 时最高 `candidate_only`。
6. **plan 不累加。** 实施细节与 review 发现折回当前里程碑 plan；只有用户确认目标或里程碑边界调整时才同步 roadmap，保留历史成绩。本轮按已确认的新目标同步，不把历史未完成清单恢复为待办。
7. **技术栈照 spec。** OpenCode 底座 + TypeScript CLI/控制层；TSecBench 桥接用 Python 官方 SDK（固定 `tsec-benchmark 0.1.2`）；目标 `linux/arm64` / Ubuntu 24.04。dev 阶段先在 macOS/Linux 开发机跑，Docker 推到 M4。

**术语**（三者门槛独立，不互相冒充，spec §11/§12.3）：**mock 平台** = 用固定 SDK 契约喂的假平台，验生命周期语义；**本地靶机 + `local_oracle`** = 跑着的受控题目 + spec §5.5 的 oracle adapter，验真实求解；**真实 TSecBench** = 用户预登记任务的小范围实测，验真实契约与计时。

---

## 当前主线（2026-10-21，M1 真实 Web 解题闭环与方法固化）

**MFW 自主首题已成功；Throwback、Seizure-Cipher 未解出。** 下一阶段以这两题的真实失败为依据，补齐必要的运行、工具、方法和验证路径，使有效方法能被下一次 Solver 使用。不是恢复全部设计建设，也不是只增加 token 继续盲跑。

唯一当前计划为 [M1 真实 Web 解题闭环与方法固化](2026-10-20-m1-autonomous-first-challenge-plan.md)，保留原文件名与里程碑编号。S1 已完成本地无模型验证；S2 的 HTTP session、诊断方法及候选→oracle 接线已完成定向验证。Throwback 前三次运行均未解出；第三次的前一批末次响应结算后累计超额 85,285。Web Skill v2 已补两项通用方法，输入接线与旧 trace 离线对照通过，草案待用户审核。第四次 run 使用新的单批 10M observable-token 限制，在 8,746,368 tokens、25 分 13.5 秒后因 OpenCode APIError 停止；无候选或 oracle 提交。run 超过 300 秒；provider usage 汇总不可用；2026-10-22 原始会话库复核确认底层原因为 429 / AccountQuotaExceeded（5 小时额度耗尽）。结果、canonical 与 profile 已保存。后续真实模型批次需新 token 授权；不提交，保留现有未提交改动。

**当前停点：** Web Skill v2 草案待用户审核。第四次 run 在 10M observable-token 限制前因 OpenCode APIError 停止，无候选或解题成功；本批已结束，roadmap 不自动触发新 run。详见现行 plan 的“S3 方法固化”。

### 当前证据与能力边界

早期 MFW/两题结果来自隔离工作树；最新 S3 修复与重试在 main 的未提交基线上运行。不同批次不可混称同一版本；详细证据与归属见现行 plan。

| 项目 | 已完成/已确认 | 当前缺口 |
| --- | --- | --- |
| MFW | 真实候选、独立重放、权威 accepted/completed，最终 solved | 一次单题成功，不证明 Skills、多 Agent、浏览器或泛化能力 |
| Throwback | 四次运行均未解出；第三次调用受管解包；第四次因 OpenCode APIError 停止 | Skill v2 已固化两项方法；第四次在 8,746,368 observable tokens 时停止，低于 10M 阈值；provider usage 汇总与方法效果仍未证明 |
| Seizure-Cipher | 部署、附件/客户端线索分析；无候选、未解出 | Web 无脚本编写执行/浏览器观察；尚未完成画面或坐标实验 |
| 长会话 | 已切换 `promptAsync` + OpenCode 状态/消息短轮询；本地 OpenCode 集成通过 | 旧 trace 未保留 Undici cause/code；S3 重试已超过 300 秒；不代表全部网络故障消失 |
| 候选验证 | 子串候选保存与无 Cookie GET 验证/local oracle 已有无模型接线验证 | 本次没有候选，未触发该路径；会话/POST/多步验证仍待真实证据，不作为本轮未解出的已证实原因 |
| Strategy / Solver | 同一个 OpenCode Solver 承担两项职责 | 标签不等于独立策略 Agent；实际实验和反馈方法需接入 |
| Skills / Reference | 新增通用 `web-session-diagnosis` 并在 Web run 输入记录版本/hash；本地 provider 确认实际输入 | 真实 Solver 是否使用该方法及其效果尚未验证；Reference 检索仍未接入 |
| Cloudb | 部署失败已记录，未进模型 | 不恢复该题部署，不计模型失败 |

### 与 design 的对应及取舍

沿用 spec §6：职责固定、会话自适应；读题、Recon、Strategy、执行修正可在同一 Solver 完成。候选必须独立验证，平台副作用仍由控制层执行。现有程序服务的独立重放不能描述成多个 LLM 协同。只有工具/方法可用后仍持续停滞，才提出有界独立 Strategy/Critic。

沿用 spec §10：通用方法在 run 前审核并固定版本；run 后从证据提炼、去除题目专属答案信息，经自然人审核后进入下一版。先显式加载少量项目 Skill，不建设完整知识库，不打开任意外部 skill 自动发现。工具决定可执行动作，Skill 提供方法，Agent 职责决定决策/复核归属，三者不能互相替代。

首题收缩是为尽早跑真题；新增题型暴露必要能力后，应补实际产品路径，不能把首题窄实现长期当作通用能力边界。旧 M1／M1B 轨迹、测试矩阵和框架仍冻结；本计划只明确选取真实失败所需的新切片，不恢复旧整批任务。

### 下一步切片

| 顺序 | 对应设计与交付 | 完成条件摘要 |
| --- | --- | --- |
| S1 运行可靠性（已完成） | 可靠 OpenCode 会话与 deadline | 本地确定性 OpenCode 路径通过；未调用真实模型 |
| S2 Throwback 会话路径（部分完成） | §6.3 的可执行实验和反馈、§6.4 验证 | Cookie 延续/隔离及脱敏诊断通过定向测试；候选独立验证语义仍未明确 |
| S3 方法接入及 Throwback 运行 | Strategy/Solver 与方法固化 | Skill v2 接线及旧 trace 离线对照通过；第四次在 8,746,368 observable tokens 时因 APIError 停止，方法效果和解题未证实 |
| S3 后续修复及真实验证 | 原始附件→受管解包/读查；解题目标/oracle 语义；可读复盘 | 第三次 run 调用受管解包并继续读取/搜索；第四次使用 Skill v2，但无候选/无 oracle 接受；Skill 草案待用户审核 |
| S4 Seizure-Cipher 必要执行/观察 | 实验→模型可消费观察→匹配来源的验证 | 选一条脚本或浏览器路径，模型自主实验；图片确实传入才算观察；解题仍看 oracle |
| S5 run 后方法审核发布 | §10 的知识生命周期，随 run 收尾 | 草案、审核发布、后续实际加载/使用分别记录；无后续 run 不冒充复用 |
| S6 独立策略复核 | §6 的按需 Recovery Critic | 工具/方法完整仍持续停滞才另行提案与授权，不作所有题前置 |

具体任务目的、修改档案、实施步骤、完成条件与停止点仅在现行 plan 维护。一次一个切片；每批运行结束后汇报停止，不自动进入下一项。M2 单题 API live 仍是后续方向，但不因首题成功自动启动，也不新增“所有设计能力必须齐备”作为其前置。

## 里程碑总览

| 里程碑 | MVP 产物（能演示的东西） | 验收门槛 |
| --- | --- | --- |
| **M0 确定性地基 + 冒烟解题（历史阶段，不重开）** | OpenCode 桥接/插件/工具运行时打通 + 单个按需 Challenge Browser + state/effect ledger + `local_oracle` + 一个跑着的本地靶机（mock TSecBench adapter 一并锁定契约，但不在冒烟关键路径，时间紧可后移 M2） | ① 确定性契约测试全过（身份/scope/deadline/effect 分级/artifact 发布/secret 边界/Browser scoped 操作与转题 teardown）；② 一次冒烟 run：真实模型对本地靶机产出候选、`local_oracle` 判 `accepted`（仅证明端到端通路，**1 次即可，不作能力门槛**） |
| **M1 真实 Web 解题闭环与方法固化（当前）** | MFW 首题已成功；在现有失败题上补工具、显式 Skill、实验反馈及必要验证路径 | 工具可用、方法实际使用、题目权威接受分别取证；新增题目未解出时不得标闭环全部完成；不声明泛化率 |
| **M2 TSecBench 单题 API live（后续，未启动）** | `prepare`/`start` 两阶段 + VPN 预检 + 单题 list/start/ready/solve/submit/close + 平台感知 resume 起步 | 相对 first-List baseline，本 run 取得**至少一道新完成的题**：单 flag accepted 或全部 slots／整题 completed；首次 live 切片与完整 M2 分开验收 |
| **M3 多题 portfolio + 韧性** | 完整列表 + 最多三活跃 instance + 多题 Scheduler + 切题/close + 预算 + fail-stop 完整恢复 | Fixture 覆盖三 instance 与错误分支；真实任务枚举全部支持题、跨题调度、至少一题 `accepted`；恢复不延长 deadline、不重复计分 |
| **M4 ARM64 镜像交付** | `ctf-agent:core-arm64` 一键构建 + 锁定依赖 + host VPN + 最小 formal egress | 原生 Ubuntu ARM64 重跑 M0–M3 契约、冷启动无下载、raw curl/socket/browser 旁路失败，用**独立 task B** 取得至少一个 `accepted` |
| **M5 条件式硬化** | 按目标 profile 实际需要的 capability tracks（容器 VPN、多 browser/noVNC、多身份网络、callback/listener、CTFd/rCTF…） | 每个被声称支持的 profile 只需通过**其依赖的 track**；未使用的 track 不阻塞解题（spec §11.3/§12.1） |
| **M6 正式验收** | 用户靶场**一次性**登记 run + 完整报告 + 资源度量 | pre-start/post-start 两阶段 admission 通过；按 spec §12.5 判定（门槛见下方「校准」说明）；零虚假成功、全部支持题留在分母 |


## 历史证据与冻结记录（不构成待办）

以下保留旧阶段的目标、结果与失败，不从本节恢复开发或验收。旧 M1 的轨迹①与 M1B 轨迹②属于历史成果；MFW 首题成功是另一条真实证据，均不能覆盖当前两题的未完成能力。

- M0／M1 与轨迹②的历史结果保留，①②各 3/3 只证明指定行为；不等于陌生真题自主完成。
- §0.1／0.2 的 DVGA 探索均预算停止、无候选。§0.3 host cursor 与测量接线已单独提交，自主探索上下文测量仍未完成；该测量不阻塞首题。
- §0.4 已有 [真实 run 记录](../../gates/m1b-dvga-private-paste-20261020/run-1/result.md)：3 次 provider 调用、7,278 observable tokens，候选登记和独立重放 verified，最终 candidate_only。实现与证据尚未提交；任务给定精确查询，不属于自主发现或整题 solved。

| 历史阶段 / 切片 | 当时目标 / 工作 | 历史证据与边界 |
| --- | --- | --- |
| **旧 M1 轨迹①（历史完成，工作冻结）** | 在 **OpenCode 底座**上跑通轨迹①：脚本报错 → 读 raw stderr → 局部修复 → 重跑成功 → oracle accepted | 原门槛为独立 3 次、≥2 次通过；历史结果 3/3。只证明指定行为，不继续验收 |
| **旧 M1B 轨迹②（历史完成，工作冻结）** | 前提反证后切换路线的指定行为 | 历史结果 3/3；保留成绩，不继续开发或验收，不等于自主真题完成 |
| **侦察切片（2026-10-20，已跑 1 次）** | 解冻 `--target`，对真实 DVGA 跑通 | ✅ 集成链通、模型做真实渗透动作；🔴 input token 被观察淹没（6 调用 97k input）、未成候选 |
| **observation 分页切片（2026-10-20，已跑）** | 按 §8.5 大响应改摘要+片段回取 | ✅ input 降 55.8%，但仍单调上升越过预算、未成候选 |
| **cursor 修复 + 上下文量化切片（本地实现完成）** | 修 observation.read 的 ref/cursor 簿记（host 管游标）+ 量化会话上下文"工作集 vs 历史重发"占比 | host cursor 与测量接线本地验证通过；自主探索测量未完成，随真题按需取证，不单独复跑、不阻塞首题、不碰 compaction |
| **旧 M1B 轨迹③–⑥（冻结）** | 轨迹⑤⑥③④ 及其配套 | 保留失败：T5 b2 0/3，问题出在 fixture 设计；相关能力未完成。不恢复开发、fixture 或轨迹验收 |

> **Full 工具镜像**（SageMath、重型 Crypto/隐写）：M0 只**核验 ARM64 构建可行性**与资源成本，主求解闭环不等它；实际构建在 M4。
> **doctor 增量成长**：M0 查 model/tools/browser → M2 加 platform/VPN 预检 → M4 加 container/arch。
> **Reference Service（历史规划，非当前任务）**：原规划将最小离线 snapshot + FTS5/BM25 检索放在旧 M1，完整 namespace/版本过滤/候选知识审核放在 M5。保留已有资产；自主首题不追加此项工作，也不以它为前置。

### 早期降风险 spike（M0 历史规划，不重开）

当时为降低早期风险按**可做性**拆成三项；下列次数、版本和阶段安排是历史规划，不是当前执行清单（逐条做法见 [M0 plan](2026-10-17-m0-host-foundation-plan.md) 的 T0a/T0b/T0c）：

- **模型能力探针矩阵**：五条探针 P1–P5（结构化工具调用 / raw error 自修复 / 反证后改路 / 长输出捞针 / **不虚报成功**），各独立跑 5 次。当时计划以此进入六条轨迹；该后续工作现已冻结。**P5 是一票否决**——会编造 flag 的模型不可用于本项目。
- **计费模式与自动化许可**（不是成本上限评审）：M0 没有真实用量数据，定上限是拍脑袋；真正要 settle 的是「所选计费模式**是否允许无人值守/批量调用**」（spec §9：Coding Plan 与按量 API 准入范围不同），它决定 M3 的多题自动跑是否合法。当时把预算定稿后移旧 M1；当前首题按独立 plan 的逐批 token 授权执行。
- **ARM64 工具链可行性**：Node 24 / OpenCode 1.19.0 / **Playwright Chromium 真的 headless 开页面** / core 工具按功能验证 / 重型 Crypto 的 arm64 可得性。容器内即可覆盖大半，但只回答「有无 arm64 构建、能否运行」，**不**回答内核/TUN/VPN 与真机性能。

> **VPN 实测不在 M0**：它需要平台实际下发的 SSLVPN 客户端，而那要等用户先建任务——没有任务就无从验证。因此它是 **M2 的准入前置**（见下），M0 只记录风险与备选方案。

### 原规划规模估算（历史快照，不是当前排期）

保留原估算以便追溯，不作为恢复旧 M1/M1B 的依据，也不套用于新 M1 自主首题。首题 A–E 已按 MFW 结果收口；后续按现行 plan S1–S6 的顺序/触发条件推进，不另造人天承诺。下列后续阶段估算也不代表启动授权。

| 里程碑 | 估算 | 主要风险 |
| --- | --- | --- |
| M0 | 20–34 人天 | OpenCode 桥接/插件契约是头号未知；模型探针结果可能推翻选型。逐任务拆解见 [M0 plan](2026-10-17-m0-host-foundation-plan.md) |
| 旧 M1（轨迹①，冻结） | 8–14 人天 | 模型能力已由 v8-3 校准证明；剩余风险是底座集成。逐任务拆解见 [M1 plan](2026-10-18-m1-solver-loop-plan.md) |
| 旧 M1B（轨迹②–⑥，冻结） | 14–22 人天 | 依赖 M1 的 OpenCode 底座；每条轨迹只补自己暴露的缺口 |
| M2 | 6–12 人天 | 受 VPN 与真实 task A 可用性制约；计时不可逆，准备不足会浪费任务 |
| M3 | 8–15 人天 | 多题恢复与名额守恒的边界情况多 |
| M4 | 8–15 人天 | ARM64 工具链与 VPN 真机路由是主要不确定性 |
| M5 | 按 track 计，每 track 3–8 人天 | 只做目标 profile 实际需要的 track |
| M6 | 2–4 人天（+一次性 run 时长） | 一次性、不可重来，准备成本高于执行成本 |

### 关于 M6 通过率门槛的校准

spec §12.5 给出 `easy 60% / medium 30% / unknown 45%` 的通过率公式。**在拿到真实题库基线前，这些数值应视为「待校准的目标」而不是写死的通过/失败线**——目前没有任何证据表明 LLM agent 在 TSecBench 上能达到该水平，先写死有自设不可达门槛的风险。建议：M2/M3 的真实任务跑完后先产出一份基线解出率，再与用户确认 M6 的最终门槛；调整门槛必须在正式 run **之前**定好并记录，不得在 run 后放宽。

---

## 各里程碑边界

> M0 与旧 M1／M1B 的展开仅保留历史范围；旧轨迹工作全部冻结。当前主线仅为下列 M1 真实 Web 解题闭环与方法固化，未来 M2–M6 均不是自动执行清单。本轮只修订文件，不授予实施或模型预算。

以下是目标产物与验收定义，不是当前代码功能清单；历史完成记录不得覆盖上方当前能力核对。

### M1 真实 Web 解题闭环与方法固化 —— 唯一当前主线

**产物：** 在原始题面、入口与公开附件上，由 OpenCode Solver 使用经审核的通用方法进行真实实验、修正/换路；必要工具和候选来源匹配；独立验证后由 local oracle 确认整题结果。方法可以固定版本进入后续运行。

**范围：** [当前实施计划](2026-10-20-m1-autonomous-first-challenge-plan.md) 的 S1–S4，S5 随对应 run 收尾，S6 仅条件触发。原 A–E 首题计划保留历史快照，不能重新作为选题待办或全部勾选。

**完成判据：** 分别报告工具可用、方法实际使用、真实题目解出。整题成功必须由同一 run 的实际候选、独立验证、权威 accepted/completed 支持；没有新成功则保留未完成，不以接线/截图/Skill 加载/测试通过代替。一次同题修复后的成功不证明陌生题泛化。

**不包括：** 恢复旧 M1/M1B 轨迹、通用 fixture/gate、完整 Reference、多题或全角色流水线、平台网页 Agent、TSecBench/API 全流程。未触发的 Critic、未用的设计能力不阻塞交付；不自动进入 M2。

---

### M0 历史范围 —— 确定性地基 + 冒烟解题（不重开）

> ⚠️ 这是全项目**最重、风险最高**的里程碑，不是"轻量骨架"。第一条垂直切片必须把整条脊梁立起来，OpenCode 桥接是头号集成风险。先做完内部的确定性 gate（②之前必过），再做冒烟 solve，避免随机模型掩盖地基缺陷。

**做什么**
- **OpenCode 集成**（头号风险）：server 生命周期、session 身份绑定（`session_id → run/challenge/task/responsibility_set/lease`，未绑定 session 不可调 CTF 工具）、插件只暴露 allowlist 工具、把 `ToolContext.sessionID` 交给 Bridge、不接受模型自报身份（spec §4.4）。只用公开 plugin/SDK/server 接口，缺 hook 返回设计 blocker，不维护 fork。
- **Model Data Gateway**：所有 provider 路径经 Gateway，`control_secret` 永不外送，数据分级最小必要（spec §10.2）。**M0 必须有一个工具调用可靠的可用模型 + 凭证**（见外部输入），否则跑不起来。
- **最小工具运行时**：`exec_job`（超时/取消/进程组）、HTTP 会话、文件读写；effect 分级 `local_rebuildable`/`retryable_observation`/`protected_effect`；即时 observation 的单调 cursor 与发布 evidence。
- **mock TSecBench adapter**：用固定 SDK 契约喂假平台，验生命周期语义（先不碰真实平台）。
- **单个按需 Challenge Browser**（Playwright/Chromium）：scoped navigation/fetch/WebSocket/download，转题整个 process/profile teardown。
- **state**：SQLite 为唯一 canonical 写入源，run 目录 + artifact store；schema 可演进。
- **`local_oracle` adapter**（spec §5.5）：一个**跑着的**本地靶机（首选一道简单 Web 题）+ typed `candidate.submit`/`challenge.status`，返回权威 accepted/rejected，由 Platform Service 执行并遵守 effect ledger。
- **run 级停止条件**：墙钟 deadline + 步数/预算上限，防止 agent 无限 loop 烧 token（Agent 文字不能延长，spec §4.4）。

**明确后置**
- 三 solver 角色、verifier 独立复核、六条韧性轨迹 → M1。
- 真实 TSecBench、VPN、prepare/start 计时、平台感知 resume → M2。
- 多题调度、≤3 instance、mutation lease/capacity 记账 → M3（且有硬边界）。
- Docker、build identity → M4。

**验收**：① 确定性契约测试套件全过（常设，之后每里程碑都必过）；② 一次冒烟 run：真实模型对本地靶机端到端跑完，产出候选并由 `local_oracle` 判 `accepted`。②只跑 1 次、只证明通路，不作能力门槛。

---

### 旧 M1／M1B 历史范围 —— Solver 循环韧性（全部冻结）

> 下文保留原任务与 2/3 验收定义用于解释历史证据，均不构成当前待办或首题前置；①②不继续，③–⑥不恢复。

> **2026-10-19 边界调整：** M1 收敛为**仅轨迹①，且必须跑在 OpenCode 底座上**；轨迹②–⑥ 移至 **M1b**。
> 原因有二：① 核查发现 M0/M1 两条 solve 路径都绕过了 OpenCode，违反 [spec line 29](../specs/2026-10-14-general-ctf-agent-system-design.md)「不另造通用 Agent framework」，必须先纠正；② 原 M1（六条轨迹、20–31 人天）本身不是小 MVP，先把一条路走通再复制。
> 下方「门槛倒推出的四项能力」中除轨迹①外的部分**随对应轨迹移至 M1b**。详见 [M1 plan](2026-10-18-m1-solver-loop-plan.md)。

**做什么**
- 引入 spec §6 的自适应职责：`ctf-coordinator` + `web-solver`/`misc-solver`/`crypto-solver` + `ctf-verifier`；session 在有界 `responsibility_set` 内带标签提交，不切 challenge、不冒充 verifier；candidate 验证一律用不同 task + 新 session。
- 按需加载 Skills（Web 会话/源码、编码链、RSA/对称/数学约束、流量/隐写…），各含适用线索、最小试验、失败分支、验证方法。
- 补齐工具：数学计算（Python，SageMath 可选）、结果登记工具（候选 flag 登记/格式检查/证据引用）。
- 假设记录结构（假设 ID/证据/验证动作/预期与实际观察/状态/失败类别/下一步）。
- **Reference Service（最小形态）**：spec §6.1/§10.1 的离线 snapshot——`approved` namespace + SQLite FTS5/BM25 检索 + 返回来源/版本/适用条件/原文引用。Reference 是**数据，不授予工具权限**；同一 run 不热更新。完整 namespace（`run/<run>/<challenge>`、`candidate_knowledge`）、版本过滤与候选知识人工审核留到 M5。
- **门槛倒推出的四项能力**（六条轨迹各自的前置，缺一则对应轨迹无法验收）：
  - **长作业与交互式工具面**：`job.write/watch/list/transfer`、`mode: pty|tcp_session`、`channel.*`（M0 明确推迟的部分）+ durable watch 与幂等 continuation claim → 轨迹③。PTY/TCP、字节/cursor 和 job/channel 生命周期在 M1 实现；**一次性/硬限额 oracle 的受管 broker、raw endpoint 隔离与发送前持久额度预留因 host-dev 无法证明强制计量，明确后移 M2/M3**。在此之前只报告 `metering_unavailable`，不得把普通 PTY/TCP transcript 当作硬限额保证。
  - **Compaction / snapshot 续跑**（spec §6.5）：短工作集 + 按 ref 回取原始输出 + 不重跑已否定 fingerprint → 轨迹④。
  - **Solution Engineering + 独立 Verification**（spec §6.4）：`replay / recompute / evidence_audit` 三模式、verification binding 与 `stale`、rejected/inconclusive 的确定转移 → 轨迹⑤。
  - **多 flag / partial**：`local_oracle` 多 required slots、每得一个候选立即验证提交、按 slot 去重 → 轨迹⑥。
- **仅本地 checkpoint 续跑**：杀进程后能从本地 checkpoint 接上。平台感知的恢复（deadline/进度对账）不在此，属 M2/M3。
- **能力与成本度量**（spec §12.6）：首次成体系采集，并用真实用量在 M1 结束时**定稿预算上限**（M0 T0b 推迟至此）。

**验收**（spec §12.2，`2/3` 规则，不以同一 conversation 的重试冒充独立 run）——六条 loop 轨迹各独立跑 3 次、至少 2 次成功，三次结果全保留：
1. 脚本语法/参数/解析错误 → 同一 solver 读 raw error 局部修正并成功执行。
2. 某机制前提被有效反证 → 保存反证后切换 route，不因沉没成本原样重试。
3. 长作业在 Worker 释放后完成 → 用保存的 handle/cursor 恢复后续步骤。
4. 强制 compaction/新 session 后 → 取回必要原始输出、执行正确下一步，不重跑已否定 fingerprint。
5. Verifier 通过但平台（此处用 `local_oracle`）明确 rejected → 检查提取/编码/slot/假设后继续，而非标 solved 或终止。
6. 多 flag 题得到 partial → 保存 accepted slot 与权威得分，继续求解剩余 slot。

---

### M2 TSecBench 单题 API live —— 后续单题平台闭环（未启动）

> MFW 首题已有成功证据；当前优先完成已选真实 Web 切片，之后另行决定是否启动 M2。平台任务、实施与逐批 token 预算须明确授权；本地首题成功不会自动触发任何 TSecBench/API 调用。

> 核心约束：TSecBench 任务**限时**，首次 List 调用会**启动平台计时且不可重置**（spec §5.2）。因此命令分两阶段，没准备好绝不起时钟。

**M2 执行拆分（计划边界，尚未启动）：**

1. **首次单题 live 切片**：API List → 固定一题 → Start／ready → OpenCode 自主求解 → 独立验证 → API Submit → 整题完成 → Close。优先单 flag；不等待⑤⑥③④全套取证、通用 Reference、多题调度或平台网页操作。
2. **M2 完整交付**：保留下方既定平台契约、恢复与异常分支要求，另按实际缺口分切片收口。首次探索只运行已验证的必要路径；未实现恢复时故障即停，不能以首次成功宣称完整 M2 或 formal gate 完成。

首次 live 前仍须验证凭据／scope 隔离、题目与提交绑定、ready、预算／deadline、首次 List 保守计时、响应未知不盲重试及可用清理路径。所用路径的必要正反向测试不能省；完整 crash／恢复矩阵不全部前置于首次探索。M2／M3 沿用预登记同一 task 的原则不变，不为分切片重置计时或混并不同 run。

**做什么**
- **第 0 步：VPN 实测（准入前置，排在写任何 M2 代码之前）。** 任务一建立就做：从**实际 Tool Runtime 的网络**（不是开发机浏览器）`GET http://10.0.100.58`，要求 200 且 `status == "ok"`（spec §5.2）。同时记录 SSLVPN 客户端名称/协议/有无 arm64 构建——这是 M4 的必要输入。不通过则 M2 记 `blocked_external_input`，并评估备选（独立 VPN 网关主机 / 已验证的 VPN 容器 / x86 宿主跑 VPN 再路由）。
- **Python TSecBench SDK 桥接**，固定 `0.1.2`，以源码 + API 文档 + 契约测试为准（不照抄过时 README）：list/start/hint/submit/close，wire contract 按 spec §5.3（多 `container_addr`、nullable description、整数 level、容器状态等待 `available`、`invalid_state` 按操作+列表状态+message 分流、Hint 即使 GET 也按计分副作用）。
- **`ctf-agent prepare`（pre-start admission，不调 Challenges API）**：验本地 state/模型/工具/adapter fixture；验用户已连 VPN；**从实际 Tool Runtime 网络**做 VPN 预检（`GET http://10.0.100.58`，200 且 `status=="ok"`）；验 Token/Base URL 已配为 secret reference 并建不含 secret 的 `task_ref`；冻结 model/scope/预算/介入政策；显示会触发真实计时的 start 预览。
- **`ctf-agent start`（启动计时，一次性 effect）**：发出任何 API bytes 前先持久提交不可改写的 `run_start_intent` + 单调钟 `first_list_started_at` + deadline 计算输入；首次调 List 即视为计时起点；只有本地 anchor 时用保守 deadline 并把 run 限为 dev/live（不产正式计时声明）；dispatch/response/commit 各窗口崩溃都不重写 anchor、不延后 deadline、admission 前不派 solver。
- **权限边界**（结构性、便宜，早定早省）：Platform Service 是平台凭证与副作用唯一持有者；Coordinator 是唯一 submit 发起者；solver/verifier 不能直接提交。
- **平台感知 resume 起步**（spec §9.4 核心）：恢复不延长原 deadline、不重置 Token/instance/Hint 消耗；按平台 List 对账可见进度；旧 job/会话标 lost；`dispatching` protected effect 转 unknown。
- **多 flag 提交编排**：每得到一个可靠候选立即提交并处理结果，再继续找剩余 slot。

**验收**：用户网页创建任务下发 token/base-url/VPN 后，相对 first-List baseline，本 run 的 confirmed Submit（或 clean/exclusive 下无歧义对账）取得**至少一道新完成的题**（单 flag accepted，或全部 required slots／平台确认 completed）；一枚 flag 的 partial 不算整题。进度、提交记录、工具证据完整保存。首次 live 成果单独记录；完整 M2 仍须完成 spec §12.3 契约测试和本节恢复要求，不把首次成功或 stub 全绿标为完整交付。
> ⚠️ 外部依赖风险：VPN 客户端的 macOS/ARM64 可用性尚未验证（spec §15）。若开发机连不上 VPN，M2 的真实提交可能要在能连 VPN 的机器上跑，或 Gate 记 `blocked_external_input` 直到 M4 真机验证网络路径。

---

### M3 多题 portfolio + 韧性 —— 稳定地连续刷题

**做什么**
- **Scheduler**：识别支持能力，标 `unsupported`/`needs_capability`（允许用户覆写）；默认只占一个名额，平台上限 3 活跃 instance；按 spec §7.5 的 `expected_remaining_score_gain / expected_remaining_wall_time` 排序。
  - ⚠️ **输入降级**：TSecBench 的 List **不返回当前 earned score**（spec §5.4），所以 gain 只能用 `total_score`（最高可得分）减去本地已确认的 accepted 推算，缺本地提交历史时标 unknown。必须写明这个近似，不得把 `total_score` 当 earned score。
  - 「一个 profile 同时只一个 active run」(spec §4.5) 与「最多三个活跃 instance」(spec §7.5) 不冲突：**一个 run 内最多持有三个平台 instance**。二者是不同维度，不要混成同一资源（旧计划的复杂度部分源于混淆这两者）。
- **名额/实例守恒**：start/close 对账，切题释放 slot，`cleanup_pending`/`cleanup_failed` 单独记账、不覆盖已获分结论，只清理本 run 拥有的实例。
- **预算**：单题墙钟 + 作业超时 + 可观测 token 用量（来自 OpenCode events，不信模型自报）；硬 deadline 后不再求解/提交，只允许授权 cleanup。
- **fail-stop 完整恢复**（spec §9.4/§12.4）：Supervisor crash 后证明旧 process 树已停才续跑；job response loss 查既有 job；durable watch 只让一个 canonical continuation 续跑（重复 outbox 不重复续）；恢复按 `(evaluation-id, unique-code, matched_flag_index)` 去重，不重复累加 `cumulative_score`。
- **此里程碑才按真实并发需求引入加固，并守硬边界**：因「一个 profile 同时只一个 active run」，**不需要** cross-incarnation/多 owner 机制；mutation 串行**只针对"改同一远端题目状态"的 mutator**（可访问 challenge 网络的 job/channel/http/listener/browser 默认视为 mutation-capable，除非 server 侧证明只读）；capacity/预算**只记 TSecBench 实际需要的维度**（worker/browser/instance slot + submissions/hints），不建通用两阶段账本。

**验收**：多题串行完成；名额不泄漏；预算耗尽/网络故障/进程中断各落正确终态（`budget_exhausted`/`blocked`/`cancelled`/`failed` + 恢复建议）并正确清理；恢复不重复计分、不延长平台时限；真实任务跨题调度、至少一题 `accepted`。

---

### M4 ARM64 镜像交付 —— 在目标机器原生跑

**做什么**
- `ctf-agent:core-arm64` 一键构建（`scripts/build-core-image.sh`）：只用 repository lockfile + 固定 base image digest + 版本化 Reference manifest，打包 OpenCode/plugin/Supervisor/services/Chromium 和通过 ARM64 实测的工具；生成 SBOM/capability manifest；凭证不写 image layer；构建后跑同一套 fixture 契约。
- **网络真机实测**：Ubuntu 宿主 SSLVPN + 容器 host network，doctor 从 Core 实际 Tool Runtime 验 VPN/平台/target 可达（不以"宿主机能开网页"为准）。
- **最小 formal egress**（spec §11.2）：Model Gateway 才连 provider、Platform Service 才连平台控制 API、tool job 只连当前 challenge grants、Challenge Browser 只连自己 grants；公共搜索/registry/其他题/未批准地址对任意 raw curl/socket 不可达。`--init` 回收子进程、浏览器共享内存、非 root 运行、冷启动不下载。
- **此里程碑才按可复现需求引入** build identity / 镜像 digest 记录——只做封装与冷启动冒烟所必需的最小形态。
- Full 镜像的 ARM64 实际构建在此确认；不满足则明确 Core 边界与重型计算替代。

**验收**：原生 Ubuntu ARM64 重跑 M0–M3 契约通过；raw curl/socket/browser 的公共/跨题/平台控制旁路失败；用**独立预登记 task B**（不复用 host 已接受状态）取得至少一个 `accepted`；冷启动无下载；资源需求明确。

---

### M5 条件式硬化 —— 按需实施，不全有或全无

**做什么**（spec §11.3/§12.1：M5 不是 M6 的统一前置，只做目标 profile 实际用到的 track）
- 按目标 formal profile 实际使用的 capability tracks 逐项实施：容器内 VPN/TUN、多 Challenge Browser（独立 UID/profile/slot 预算）、Platform Browser + noVNC handoff、management/data 网络分离与 callback/listener、CTFd/rCTF/未知平台 adapter。
- Reference 完整化：`run/<run>/<challenge>` 与 `candidate_knowledge` namespace、版本过滤、run 终态后的人工审核发布流程。
- 自动评测（spec §4.2 后续）：OpenCode SDK + API 模型接入 + 队列 + 总截止 + 收益优先调度。

**验收**：每个 selected track 有独立的正向/拒绝测试并通过；**未使用的 track 不阻塞解题**（例如 TSecBench + 宿主 VPN + 单 Browser 的 profile 不等 CTFd/noVNC/容器 VPN）。硬化不得改变 Platform Service 唯一凭证/submit、模型数据政策、硬限额 fail-closed 等产品边界。

---

### M6 正式验收 —— 一次性，不可重来

> ⚠️ 与其他里程碑不同：M6 是**一次性登记 run**，不能"跑坏了再来一次"。准备成本高于执行成本，所有门槛和政策必须在 start 之前定好。

**做什么**（spec §12.5）
- **Pre-start admission**（首次 List / 正式计时前）：取得新建或可核实 reset、且本 run 独占的 task/account 证据；保存非 secret task ref、平台时间来源、duration/elapsed/deadline 与来源引用；冻结 model/Reference/工具/预算与人工介入政策。无法证明 clean 则不 dispatch first List。
- **Post-start admission**（first List 后、任何求解 effect 前）：固定 manifest/progress revision 0；完整分类全部可见项目并冻结 evaluation category（只有平台可信 difficulty 可进 easy/medium/hard，模型估计只供 Scheduler）；确认可计算分母非空，否则 `insufficient_gate_coverage`。
- **判定**：只计本 run confirmed Submit 或无歧义对账造成的 accepted transition；`partial`/`candidate_only`/verified 但未被接受都不进 numerator；多 flag 题须平台 challenge-complete 或全部 required slots 被接受才算 solved。
- **门槛**：有可信难度时 `ceil(easy*60%)` 且 `ceil(medium*30%)`，unknown 子集 `ceil(unknown*45%)`，无可信难度时全部支持题 `ceil(in_scope*45%)`。⚠️ **这些数值须先按「关于 M6 通过率门槛的校准」用 M2/M3 的真实基线确认，并在 start 前定稿；run 后不得放宽。**
- 计时后只允许可证明无题目副作用的 secret refresh / VPN 重连；任何人工解题、提交、instance 操作或 Challenge Browser 控制使 run `invalid`。

**验收**：在可信 identity/计时下产出结果；零虚假成功；`needs_capability`、超时、未解题目全部保留在分母（不得删题提高结果）；系统自身故障计未解，独立确认的外部平台故障标 `infrastructure_invalid` 并保留在报告。

---

## 怎么用这份 Roadmap

- **当前只围绕 M1 真实 Web 解题闭环与方法固化推进。** 按现行 plan 处理一个必要切片，真实运行后记录并停止；模型复跑、下一切片与提交按明确授权执行，不自动合并或启动下一阶段。既有 gate 只作回归保护。
- **实施 review 折回当前 plan；已确认的目标/阶段调整才同步 roadmap。** 历史记录保留，历史“下一步”与冻结任务不构成执行授权。
- 旧单体计划里那些加固细节不是错的，是**错位**——它们是 M3/M4/M5 的内容，需要时去 [archive](archive/2026-10-15-general-ctf-agent-system-implementation.md) 取对应片段。
- **外部输入**（spec §13）缺失时可完成对应代码与 fixture，但 Gate 状态记 `blocked_external_input`，不写成通过：M0 需可用 model/provider 凭证 + host 工具清单；M2/M3 需用户预登记 **task A**（不中断的 host 轨迹）+ Token/Base URL/VPN + 时间基线证据；M4 需**独立 task B** + 原生 ARM64 host；M6 需一次性正式靶场 + 干净账号 + 正式 deadline/budget。缺真实任务不能声称 M2/M3/M4 通过，mock 不能替代正式验收。
