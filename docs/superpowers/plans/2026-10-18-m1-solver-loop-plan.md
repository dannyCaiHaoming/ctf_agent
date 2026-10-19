# M1 Solver Loop —— Detailed Plan（证明 agent 会「解题」，不只是「跑一次」）

> ## ⚠️ 门槛完成度：**0 / 6 条轨迹**（正式真实模型 run 0 次；轨迹①开发校准 8 次，均未跑通）
>
> 组件候选框 **不代表 M1 进度**。八次真实校准全部在 fixture 脚本执行**之前**失败：runs 1–4 暴露路径与动作/调度簿记契约问题；v7-1/v7-2 分别暴露 provider 非 JSON 输出与静态 candidate；v7-3 暴露 host 只接受绝对 Node executable 而模型写常见 `node` alias；v7-4 暴露模型在 representation repair 后转向未执行的 HTTP 实验，随后重复同一 experiment fingerprint。模型仍未读到 `solve.mjs` 的 raw stderr，轨迹①要测的行为尚未被触及。
>
> ## 下一步任务队列（按序，前一项未完成不做下一项）
>
> 1. [x] **先提交现有工作**（10 个改动文件已悬空两轮，确定性测试全绿，具备提交条件）。已由 `0b1d1cb fix: stabilize M1 solver action contract` 提交。
> 2. [x] **按 [动作契约重设计](#动作契约重设计第三轮结论2026-10-18) 改契约**：模型只写 6 个必填语义字段，ID/hash/ref/预算/步骤号全部由 host 注入。v7 已接入 provider driver；未运行正式模型 run。
> 3. [x] **修 `scope_denied`/`blocked_data`**：回灌为 observation 并允许改路，不再终止 run（恢复 spec §8.7）。策略拒绝仍 fail closed，且不计为机制反证。
> 4. [x] **建离线动作契约探针并达标**（≥90% 合法动作，且 run 1–4 的四个历史失败状态全部不复现）。2026-10-19 扩展离线探针 9/9 合法、9/9 期望动作类型匹配、0 个历史失败，并覆盖 `candidate_before_actual_experiment`；报告 `runs/m1-contract-probe-v7-20261019-expanded/report.json`。
> 5. [x] **提交当前 13 个悬空改动**（第三次悬空；确定性测试全绿，具备提交条件）。已由 `dbca2cd fix: stabilize M1 solver contract and record calibration` 提交。
> 6. [x] **写黄金路径确定性测试**（决策⑫，最高价值）：脚本化一个**完美模型**端到端走完轨迹①——直到脚本执行、stderr 产生、修复成功。`tests/gates/m1.gate.ts` 2/2 通过，`gate:m1` 已接入 package scripts。
> 7. [x] **反转「拒绝即终止」默认**（决策⑬）：第 3 项只修了 `scope_denied`，于是 runs 7/8 换成 alias denied 和 duplicate fingerprint 又死两次。run-level catch 现在只把 `resource_exhausted` 作为终止白名单；其余 host 拒绝都回灌 observation 并进入有界 representation repair。
> 8. [x] **为校准 run 预置起跑点**（决策⑭）：harness 预置到「脚本第一次执行失败」为止，其后读 stderr／定位／修复／重跑**全部由模型完成**。已实现 `SolverLoopOptions.preset`，gate 测试证明 driver 只收到修复后的决策请求。
> 9. [ ] **达标后**才重启轨迹①校准 → 3 次正式 run → 落盘 → 提交 → 下一条轨迹。
>
> ⚠️ **第 6 项通过前，不要再发起任何完整真实模型 run。** 已烧 8 次 run / 134k tokens / 6 个 prompt 版本，每次只换来一个新关卡，脚本一次都没执行过。
> ⚠️ **停止规则：** 再有 3 次 run 仍未使脚本实际执行，或轨迹①累计超 12 次仍未达 2/3 → **停止调参，升级重评**（见[第四轮结论](#第四轮结论反转方法而非继续修关卡2026-10-19)）。
>
> 历史复盘见 [复盘与决策台账](#复盘与决策台账)。

> **状态（2026-10-19）：** 本计划用三列分别记录 **确定性组件、产品入口集成、真实模型验收**；一个组件或 fixture 完成不代表产品入口或模型轨迹完成。T1–T4 的确定性组件完成；T5 有限能力部分完成；T6 交互工具组件完成、硬限额 broker 延至 M2/M3；T7 durable watch 已接 SolverLoop；T8 快照/单步恢复组件完成但完整续跑未完成；T9 PARTIAL；T10 多 flag resolver 已接 SolverLoop；T11 纯事件投影 PARTIAL；T12 未完成。T3b 产品入口已部分集成：有限 HTTP literal progress 与 local HTTP 的 Engineer→独立 replay Verifier→受保护提交确定性闭环已通过；通用语义裁决、完整 T9/T9a、T6 全工具组合及真实模型验收仍未完成。v7 已把模型输出契约压缩为语义内核，并把 ID/hash/ref/预算/step id 注入 host；`scope_denied`/`blocked_data` 回灌 observation；离线契约探针 9/9 通过；v7 已进行 4 次开发校准，分别暴露 provider JSON 解析、candidate-before-actual-experiment、`node` alias 与绝对 executable 的 host 契约裂缝、duplicate experiment fingerprint。轨迹①仍未触及脚本 raw stderr。正式真实模型轨迹仍为 0 次。上游 [M0](2026-10-17-m0-host-foundation-plan.md) 已 COMPLETE（模型 `deepseek-v4-flash`，T0a 探针 25/25 通过）。


| 任务 | 确定性组件 | 产品入口集成 | 真实模型验收 |
| --- | --- | --- | --- |
| T1–T4 | COMPLETE | 未由此单独证明 | T12 |
| T3b | 基础组件 COMPLETE | PARTIAL（M1 CLI 有限 HTTP literal progress 与受保护 local HTTP resolver 闭环；通用语义、T6/T9全范围组合未完成） | T12 |
| T5 | PARTIAL（限定范围见 T5） | 待 T3b | T12 |
| T6 | 交互面 COMPLETE；broker 延期 | PARTIAL（M1 CLI/SolverLoop 已暴露受限 PTY/TCP/channel 操作） | T12 |
| T7 | COMPLETE，已接 SolverLoop | 待 T3b 正常 CLI 证明 | T12 |
| T8 | 快照/单步恢复 COMPLETE | 完整 driver 续跑未完成 | T12 |
| T9 | PARTIAL | resolver 路径存在，可信回执/完整闭环未完成 | T12 |
| T10 | resolver 集成 COMPLETE | 待 T3b 正常 CLI 证明 | T12 |
| T11 | 纯投影 PARTIAL | 缺原始事件源 | T12 使用 |
| T12 | harness 未完成 | 同一 CLI 路径 harness 待建 | 未运行 |

组件测试、fixture 或 scripted driver 只证明确定性行为；不能替代真实产品入口或真实模型轨迹。

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。任务用候选框（`- [ ]`）跟踪：**每个实现步骤**和**每条验收能力**都是一个可勾选项。
>
> 🟢 当前里程碑计划 · 上级路线图见 [`2026-10-16-ctf-agent-mvp-roadmap.md`](2026-10-16-ctf-agent-mvp-roadmap.md) 的「M1」节；权威设计见 [`../specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)；文档索引见 [`../README.md`](../README.md)。

> **本轮范围（2026-10-18）：** 按 2026-10-18 复盘顺序推进轨迹①。既有 M1 基础实现已提交并完成 4 次独立开发校准；四次分别暴露 workspace 路径、job.run action schema、dispatch schema 与 hypothesis/experiment 身份契约问题。当前补齐有限 CLI 材料暂存和入口校验；最新 v6 修正尚未由真实模型验证。六轨迹 18 次正式运行、正式配置冻结及预算定稿另行验收。

**Goal：** 让 agent 具备**可重复的解题韧性**——在 M0 的脊梁上引入自适应职责、假设/试验/局部修复、长作业恢复、compaction 续跑、独立候选验证和多 flag 处理，并以 spec §12.2 的**六条 loop 轨迹各跑 3 次、至少成功 2 次**作为统计门槛。

**与 M0 的本质差别：** M0 证明「能跑通一次」（1 次冒烟，不作能力门槛）；M1 证明「**反复跑都能正确应对失败**」。因此 M1 的验收是统计性的，且每条轨迹考的是**失败后的行为**，不是解题本身。

**范围提醒：** M1 仍是 host-dev + `local_oracle`，**不碰真实 TSecBench / VPN / 计时**（M2）、**不做多题调度**（M3）、**不做 Docker**（M4）。Reference 只做最小形态；完整 namespace / 版本过滤 / 候选知识审核留 M5。

**固定配置（spec §12.1 要求）：** 在开发校准后、正式 18 次运行前，冻结 model ID、temperature/参数、prompt/template、tool manifest/version、Reference snapshot/version、fixtures 和每条轨迹预算；三次独立 run 使用同一冻结配置。变更配置即建立新批次，不与原批次合并。当前 profile/run binding 已支持记录 temperature/参数、prompt/template、tool manifest/version 与 Reference snapshot identity；正式批次的完整冻结清单、fixtures/version 记录及 18 次运行仍留在 T12。

**状态与结果词表：** 一律沿用 spec §7.1 的五组枚举与 outcome 列表（M0 T2 已落地），不自创。

**原始规模估算（单人投入，非承诺）：** 初版估算为 20–31 人天；原估算尚未按本次任务拆分及剩余工作复核，不能作为剩余工作量。剩余投入待按本计划有限子任务重新估算。

| 任务 | 人天 | 备注 |
| --- | --- | --- |
| T1 职责与会话模型 | 1.5–2 | COMPLETE（2026-10-18，独立工作区；待整合） |
| T2 假设/试验/route | 1–2 | COMPLETE（2026-10-18，独立工作区） |
| T3 Solver 循环组件（轨迹①②） | 2–3 | 确定性组件已完成；产品 driver/入口在 T3b |
| T3b 产品入口、真实 driver 与共享 run 预算 | 待重估 | 单一 CLI 路径；遵循 OpenCode 现有架构 |
| T4 Reference 最小形态 | 1–2 | |
| T5 Skills + 三领域方法 | 2–3 | 含三类代表题 |
| T6 长作业与交互式工具面 | 2–3 | broker 延至 M2/M3，不计 M1 完成条件 |
| T7 durable watch（轨迹③） | 2–3 | |
| T8 compaction/续跑（轨迹④） | 2–3 | |
| T9 Engineering + Verification（轨迹⑤） | 2–3 | 三模式是本里程碑第二难 |
| T10 多 flag / partial（轨迹⑥） | 1–2 | |
| T11 能力与成本度量 | 1–2 | |
| **T12 六轨迹 harness + 2/3 Gate** | **2–3** | 拆为确定性 harness、校准冻结、正式模型验收；原估算待重估 |

**提交粒度（现行）：** 既有 M1 实现已提交并合入 `main`；之后每条垂直轨迹完成真实验收和记录后单独提交。契约测试与实现同提交。

---

## 复盘与决策台账

三轮复盘压缩如下。**唯一的行动来源是顶部任务队列**；本表只记录每轮的发现与仍然有效的决策，不再重复叙述。

| 轮次 | 核心发现 | 产生的决策 | 状态 |
| --- | --- | --- | --- |
| **第一轮** | 93 个文件未提交、真实模型 run 0 次；122 个候选框全绿但门槛 0/6 | ① 先提交建立棘轮 ② 立刻跑真实校准 ③ 给 T3b 有界 done ④ 改轨迹垂直切片 ⑤ 进度口径改为「通过 2/3 的轨迹数」 | ①②③④⑤ **已采纳**；①②已执行 |
| **第二轮** | 4 次校准全在脚本执行前失败，全是契约簿记错误（路径/`step_id`/嵌套结构/裸 hash） | ⑥ 簿记移回 host（恢复 spec §6.2） ⑦ `scope_denied` 回灌改路而非终止（spec §8.7） ⑧ 建离线契约探针 | ⑥ **已执行**（v7 契约）；⑧ **已执行**（9/9）；⑦ **仅部分执行——同类问题换个错误码又复发，见第四轮** |
| **第三轮** | 契约被当成固定需求，执行方只会把它改得更严 | ⑨ 明文授权契约是设计变量 ⑩ 两层设计 + 字段归属表 ⑪ 契约类任务 DoD 加「真实模型可满足性」 | ⑨⑩⑪ **已采纳**，⑩已实现为 v7 |
| **第四轮** | 8 次 run / 134k tokens / 6 个 prompt 版本 / 8,550 行插入，**fixture 脚本仍一次未执行**；每次 run 只暴露一个新关卡 | 见下方[第四轮结论](#第四轮结论反转方法而非继续修关卡2026-10-19) | 待执行 |

**贯穿三轮未解的根问题：** 「组件完成」被反复当作「门槛达成」。决策⑪（契约类任务必须经真实模型验证才算 COMPLETE）是对它的正面回应，**适用于所有任务，不止契约类**。

---

## 第四轮结论：反转方法，而非继续修关卡（2026-10-19）

### 诊断

8 次校准的死因依次是：绝对路径 → `cwd`/`step_id` → 嵌套结构 → 裸 hash → markdown 围栏 JSON → 无 experiment 的编造候选 → `node` 别名被拒 → duplicate fingerprint。**其中约 6 个是 host 侧在拒绝本来无害的东西**，真正的模型行为问题只有两个（编造 flag、策略漂移）。

**方法错在：用最贵的反馈回路（完整真实模型 run）去调试一条约 10 道串行关卡的流水线，每跑一次只暴露一个关卡。** 每道关卡都是「失败即终止」，即使每道 90% 通过，10 道串联也只有约 35%。而真正要测的能力（读 stderr → 局部修复）被一堆与它无关的东西挡在后面。

实质方向并没有错——契约重设计确实推进了前沿（run 7/8 已能合法 dispatch 并发出 `job.run`）。错的是**反馈回路的设计**。

### 决策（按序，构成顶部任务队列第 2–4 项）

- [x] **⑫ 黄金路径确定性测试（最高价值，本该在任何真实 run 之前存在）。** 已新增 `tests/gates/m1.gate.ts`：完美模型走完首次失败执行、raw stderr、bounded repair、成功重跑；`gate:m1` 2/2 通过。
- [x] **⑬ 反转「拒绝即终止」的默认。** 已把 run-level 终止白名单收窄为 `resource_exhausted`；`scope_denied` / `blocked_data` 等默认回灌 observation 并受 representation repair 预算约束，不再直接终止 run。
- [x] **⑭ 为校准 run 预置起跑点。** 已新增 `SolverLoopOptions.preset`：host 写好 dispatch 与首次失败 `job.run`；gate 测试确认修复与重跑完全由 driver/model 决策。
      **边界（必须严格遵守）：** 预置**止于第一次失败执行**；其后的读 stderr、定位、修复、重跑**必须 100% 由模型完成**，harness 不得提示错误位置、不得给出修复内容、不得代为重跑。这不违反 spec §12.2「harness 不得代模型修脚本」——修脚本仍是模型的事；省掉的只是与轨迹①无关的 dispatch 仪式。
      **正式 2/3 验收**可使用预置起跑点，但必须在 `m1-inputs.md` 中明确记录预置范围，且**三次运行使用同一预置**。

### 停止规则（此前完全缺失，是 8 次 run 无人叫停的原因）

- [ ] 若**再有 3 次**完整校准 run 仍未使 fixture 脚本实际执行，**停止调参**，升级为重新评估：该 harness/模型组合能否支撑 M1；备选包括换模型、进一步简化契约、或降低 M1 门槛定义。
- [ ] 若轨迹①累计真实 run 超过 **12 次**仍未达 2/3，同样升级重评，不得继续无限迭代 prompt 版本。

### 需要记录的风险：模型会编造 flag

Run 6 中模型在**没有任何成功 experiment** 的情况下直接提交了 `flag{local_repair}`（host 正确拒绝）。这**与 T0a 探针 P5「不虚报成功 5/5 通过」的结论相矛盾**，说明 T0a 的 P5 场景过于简单、高估了模型在真实 harness 下的表现。

- [ ] 把「无 experiment 支持的候选提交」加入离线契约探针的必检项（已部分覆盖 `candidate_before_actual_experiment`，需确认其严格度）。
- [ ] 在 M6「零虚假成功」要求下重评 T0a P5 的充分性——**这条风险要带到 M2/M6，不止 M1**。

---

## 动作契约重设计（第三轮结论，2026-10-18）

### 授权：动作契约是**设计变量**，不是固定需求

前两轮执行方面对「模型填不对表格」的应对，都是**把表格改得更严**（`hypothesis` 由 optional 改必填、再加 `hypothesis.id === experiment.hypothesis_id` 的 superRefine）。这在局部合理（让错误更早暴露），但方向相反——在拧那颗正在卡死的螺丝。

根本原因是**本计划此前从未授权修改契约**：T2 写的是「按 spec §7.3 定义 hypothesis 结构：`id / claim / preconditions / ...`」，把 spec 的**系统数据模型**原样当成了**模型输出契约**，且从未说明哪些字段由谁产出。

**现予明确：**
- spec §7.3 的完整 hypothesis/experiment 是**系统要维护的数据模型**，spec 从未要求模型在一个动作里把它整个写出来。
- spec §6.2 明确反向要求：*「身份由 Supervisor 注入。Immutable artifact ref 已包含內容身份，handoff 不要求模型反覆搬運整份 hash 清單。」*
- 因此**当前契约是违反 spec §6.2 的**，改它是**恢复合规**，不是偏离设计。spec §16 本就把这类取舍列为 builder 可决定项。
- 后续任务**有权也有义务**在发现模型反复卡在某字段时重新划分该字段的归属。

### 两层设计

| 层 | 内容 | 归属 |
| --- | --- | --- |
| **系统数据模型** | spec §7.3 的完整 `Hypothesis`(16 字段) / `Experiment`(12 字段)，写入 canonical state，现有契约测试不变 | **host 维护** |
| **模型输出契约** | 模型在一个动作里实际要写的**最小语义内核** | **模型产出** |

**host 由内核物化出完整数据模型**，再按原 schema 校验落库。对 canonical state、证据链、判分的要求**一点不降低**。

### 模型侧最小语义内核（dispatch）

模型只需产出 **6 个必填 + 4 个可选**字段：

```json
{
  "kind": "dispatch",
  "claim": "solve.mjs 解码 payload.txt 失败是脚本自身的参数/解析缺陷",
  "falsifier": "修正脚本后仍以相同方式失败，则不是脚本缺陷",
  "expected_observation": "执行后 stderr 给出可定位的解析错误行",
  "expected_support": "修正后脚本输出解码结果",
  "expected_refutation": "脚本正常退出但无输出，说明假设错误",
  "procedure": [ { "tool": "job.run", "input": { "command": ["node", "solve.mjs"] } } ],

  "objective":                 "（可选）",
  "preconditions":             ["（可选）"],
  "alternative_explanations":  ["（可选）"],
  "uses":                      ["solve.mjs", "payload.txt"]
}
```

`uses` 用 **workspace 短名或相对路径**，由 host 解析成 `input_refs`。**模型永远不书写 hash。**

### 字段归属对照（谁写哪一个）

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `hypothesis.claim` / `falsifier` / `expected_observation` | **模型必填** | spec 的实质要求：假设必须可反证 |
| `experiment.expected_support` / `expected_refutation` | **模型必填** | 对应 spec「区分工具故障与机制反证」 |
| `experiment.procedure[].tool` / `.input` | **模型必填** | 模型只说「跑什么」 |
| `hypothesis.preconditions` / `alternative_explanations`、`experiment.objective` / `parameters` / `stop_condition` | 模型可选 | host 有默认值 |
| `hypothesis.id`、`experiment.id`、`experiment.hypothesis_id`、`procedure[].id`（step_id） | **host 注入** | 消除 run 2/4 的 `step_id` 缺失与 ID 不一致——**host 分配就不可能不一致，superRefine 也就不再需要** |
| `supporting_refs` / `contradicting_refs` / `input_refs` | **host 解析** | 模型给短名，host 展开成 `{hash,size,path}`——消除 run 1 的绝对路径与 run 4 的裸 hash |
| `state_dependencies`、`required_capabilities`、`expected_artifacts` | **host 推导** | 从当前状态与 `procedure` 的 tool 列表推导 |
| `route_status`、`state` | **host 管理** | dispatch 时恒为 `queued` / `proposed` |
| `cost`、`budget`、`repair_budget` | **host 注入** | host 才知道剩余预算 |

**约 27 个必填字段 → 6 个。** 四次历史失败各自被消除：run 1（短名替代路径）、run 2（host 分配 step_id）、run 3（结构面大幅缩小）、run 4（模型根本不写 ref）。

### 工具动作同样简化

```json
{ "kind": "tool", "tool": "workspace.read", "input": { "path": "solve.mjs" } }
```

**不再要求模型提供 `step_id`**：host 自动匹配当前已 dispatch 的 procedure 步骤，匹配不上则分配一个 ad-hoc 步骤。

### 契约类任务的 Definition of Done（新增，追溯适用于 T1/T2/T3b）

> **一个必须由模型产出的契约，在真实模型能以足够比例产出合法实例之前，不得标记为 COMPLETE。** schema 写完 + 确定性契约测试全绿**只算组件完成**。

这正是前两轮失控的根源：T1/T2 凭「schema 存在 + 测试全绿」被标 COMPLETE，但对其唯一使用者（模型）不可用，122 个候选框因此全绿而门槛仍是 0/6。

- [ ] 把「真实模型可满足性 ≥90%」加入 T1/T2/T3b 的完成条件，并相应下调它们当前的 COMPLETE 标记为 **组件 COMPLETE / 契约未验证**。

### 契约设计原则（后续任务遵守）

**模型只应被要求产出它能独立推理出来的内容；凡 host 已知或可推导的（ID、hash、ref 展开、预算数字、步骤编号、能力清单）一律由 host 注入。**
每当发现模型反复在某字段出错，先问「这个字段 host 是不是本来就知道？」——若是，那是契约设计问题，不是模型能力问题，**应当改契约而不是改 prompt**。

---

## 执行顺序

**一次一条轨迹**：`组件 → 产品入口 → 真实模型 ×3 → 记录落盘 → 提交`，走完一条再开下一条。
建议次序 **①（路径最通，先拿信号）→ ⑥ → ⑤ → ③ → ④ → ②**。

- 能力缺口（T5 / T8 / T9 / T11 的 PARTIAL 部分）**按当前轨迹的需要拉取，不独立推进、不独立验收**。
- 延期项不构成 M1 完成条件：T6 硬限额 broker、`listener.*`、完整 Reference namespace。
- TDD 同 M0：先写失败测试 → 实现到绿 → 自检 → 提交。`gate:m0` 全程保持绿。

> 原按能力横向分层的依赖顺序已于第一轮复盘作废（它正是停滞的结构性原因），不再保留正文。

---

## Task 1：职责与自适应会话模型 — 组件 COMPLETE / **契约未经模型验证**（2026-10-18）

**Files：** `packages/contracts/src/**`（handoff envelope）、`packages/supervisor/src/**`、`tests/contract/responsibility-*.test.ts`

> **完成与验证记录（2026-10-18）：** 新增 54 项契约测试、M0 gate 92 项、完整套件 95 项通过；typecheck、build、差异检查与独立审查均通过。完成的是 Supervisor API 与确定性契约；CLI/provider 调度接入及持久化属后续任务，未运行真实模型或六轨迹统计 Gate。
>
> **代码位置：** 实现和上述验证均在独立工作区 `/Users/caihaoming/.codex/worktrees/m1-task1-responsibilities/pentest-agent`、分支 `codex/m1-task1-responsibilities` 完成，尚未提交或整合到本仓库 `main`。本次仅回填计划进度，不能据此认为当前 `main` 已包含 Task 1 实现。
>
> **详细证据：** [M1 Task 1 验证报告](../../gates/m1-task1-results.md)。

**实现步骤**
- [x] 按 spec §6.1 定义职责枚举：`coordination / intake_triage / target_recon / reference / strategy / domain_solver / solution_engineering / verification / recovery_critic`。
- [x] `responsibility_set`：task 建立时取得**有界**集合（例如同一 Solver task 可含 `recon + strategy + solving`）；session 可在集合内带责任标签提交，**不可**切 challenge、冒充 Verifier 或运行中扩大集合。
- [x] 固定的是**责任与提交权限**，不是「每题七次独立模型调用」；同一 session 可完成 Triage/Recon/Strategy 的简单部分，但其 observation / assumption / decision 必须结构化区分。
- [x] 实现 spec §6.2 的 handoff envelope：`task_id / attempt_id / responsibility / revision / consumed_snapshot_sequence / input_refs / dependency_versions / status / outputs / observation_refs / evidence_refs / assumptions / rejected_assumptions / unresolved_questions / next_action / failure_code / actual_cost`。
- [x] 身份由 Supervisor 注入；immutable artifact ref 已含内容身份，**不要求模型搬运 hash 清单**。
- [x] revision 失效规则：只有实际采用的新发布产物或其依赖改变才失效下游；工作区临时日志/注释/未发布修改**不**自动失效旧候选。

**验收能力**
- [x] session 在 `responsibility_set` 外提交输出被拒绝；运行中扩大集合被拒绝。
- [x] 切 challenge 或冒充 Verifier 身份被拒绝；task/challenge 改变时必须建新 session。
- [x] handoff envelope 的每个字段有 schema 校验；缺 `next_action` 或 `status` 的交接被拒。
- [x] 无关的工作区改动不触发下游 revision 失效（反向测试）。
- [x] Verifier 职责**不能**与产生该候选的 Solver 共用推理上下文（契约层强制）。

---

## Task 2：Hypothesis / Experiment / Repair 与 route 管理 — 组件 COMPLETE / **契约未经模型验证，待按第三轮重设计**（2026-10-18）

**Files：** `packages/contracts/src/**`、`packages/supervisor/src/**`、`tests/contract/hypothesis-*.test.ts`

> 验证记录：[M1 Task 2 results](../../gates/m1-task2-results.md)。新增 33 项专项测试、最终完整套件 128 项通过，typecheck 与独立审查复核通过。实现及验证位于独立工作区，尚未整合到 main；真实模型验收另做。

**实现步骤**
- [x] 按 spec §7.3 定义 hypothesis 结构：`id / claim / preconditions / missing_preconditions / supporting_refs / contradicting_refs / alternative_explanations / falsifier / minimal_experiment / expected_observation / state_dependencies / required_capabilities / route_status / next_action / cost`。
- [x] 状态机 `proposed → testing → supported | rejected | inconclusive | stale`。
- [x] **超时、403、429、工具报错、格式错误本身不自动反证题目机制**（必须显式区分工具故障与机制反证）。
- [x] Experiment 结构：objective、输入/状态依赖、procedure、预期支持/反证、wall/token/remote budget、stop condition、产物；允许多个有序工具步骤完成同一判别问题。
- [x] Route 管理（§7.4）：同时**一条 primary route + 最多一个低成本 counterprobe**；不建立两条等额完整解法。
- [x] Semantic progress 判定（§7.3）：只有「新 evidence 支持/否定具体假设」「搜索空间可量化缩小」「得到可验证中间值/partial flag/可重放 PoC/新 capability 判定」「发现并修正分类/generation/session/工具前提错误」四类才算进展；重复错误、轮询、无新信息输出**不算**。
- [x] 相同 input/state/procedure/parameter fingerprint 无新原因时不重派。

**验收能力**
- [x] 工具错误/超时/429 不会把 hypothesis 置为 `rejected`（反向测试）。
- [x] 同时存在两条 primary route 被拒绝；counterprobe 必须声明「不同结果如何改变决策」。
- [x] 重复 fingerprint 的试验被去重拒绝。
- [x] 修正、等待、transient retry **不刷新** semantic progress 计数。
- [x] 连续两个有真实 experiment 但无 semantic progress 的窗口 → 触发 Strategy 重规划（再按需一次 Recovery Critic）。

---

## Task 3：同一 Solver 的确定性执行循环（轨迹①②） — 组件 COMPLETE；产品入口见 T3b

**Files：** `packages/supervisor/src/**`、`fixtures/trajectories/t1-script-error/**`、`fixtures/trajectories/t2-falsified/**`、`tests/integration/solver-loop-*.test.ts`

> 验证记录：[M1 Task 3 results](../../gates/m1-task3-results.md)。28 项初始集成测试及 14 项审查回归通过；最终相关专项 78 项、M0 gate 133 项、typecheck 与独立复审通过。实现和验证在独立工作区，尚未整合到 main；真实模型验收另做。

**实现步骤**
- [x] 按 spec §6.3 实现循环：取 ready challenge/材料/snapshot → 选可执行 hypothesis → 读改 workspace 脚本 → 执行并即时消费 observation → **工具/语法/参数/解析错误在 repair budget 内局部修正并继续** → 前提被有效反证则保存反证、交 Strategy 改路。
- [x] **普通文件读取、搜索、局部 patch 和一次脚本修错不重新派 Strategy**（spec §3.4 反目标：每改一行都重派完整角色流水线 = 设计失败）。
- [x] 失败分类（§8.7）落地：`hypothesis_falsified / tool_invocation_error / output_parse_error / model_transient / model_rate_limited / blocked_data / scope_denied / resource_exhausted` 各有确定处置。
- [x] **轨迹① fixture**：一道本地题，其自然解法脚本含**确定的**语法/参数/解析错误，真实 stderr 足以定位。
- [x] **轨迹② fixture**：一道本地题，初始存在**有吸引力但错误**的机制信号，且存在能明确反证它的廉价观察。

**轨迹①的可操作判分口径**（此前只写「局部修正并成功执行」，无法判定；8 次 run 从未到达这一步，一旦到达立刻需要它）

| 项 | 判据 |
| --- | --- |
| 成功 | 修复后 `job.run` 退出码 `0`，且 stdout 产出 fixture 预期 flag（与 oracle 比对，不看模型自述） |
| 「局部」 | patch **只改动导致报错的那处**，diff **≤ 5 行**且**不替换整个文件**；从 canonical artifact 的 patch diff 重算，不采信模型声明 |
| 必经证据 | canonical events 中必须存在：一次**失败**的 `job.run`（非零退出 + stderr artifact）→ 模型读取该 stderr → `workspace.patch` → 再次 `job.run` 成功。缺任一环即不通过 |
| 不通过 | 整段重写文件、换 task、绕开 stderr 直接改写、或未经失败执行就修复 |

**验收能力**
- [x] **轨迹①**：同一 Solver 读 raw error、局部修正并成功执行（不整段重写、不换 task）。
- [x] **轨迹②**：前提被有效反证后保存反证并切换 route，**不因沉没成本原样重试**。
- [x] raw error 完整回灌到 Solver（不是只给摘要）——否则按 spec §3.4 属设计失败。
- [x] repair budget 耗尽才升级到 Strategy；未耗尽时不升级。
- [x] `scope_denied` / `blocked_data` 不被当作题目机制的反证。

---

## Task 3b：宿主编排、真实模型 driver 与共享 run 预算 — PARTIAL（基础 CLI 接线、有限 HTTP progress/resolver 闭环与确定性期限边界已验证；更广产品组合未完成）

**目的：** 把已完成的确定性组件接入唯一产品 CLI 解题入口，形成与现有 OpenCode/provider 架构一致的模型调用链。`solve --profile ...m1` 已进入 M1 SolverLoop，并可用确定性 provider stub 验证接线；当前已在严格限定的 local HTTP literal 命题和 HTTP GET candidate replay 范围完成正常 CLI 组合闭环（详见 [增量验证记录](../../gates/m1-task3b-results.md)）。T6 的全部模式、通用语义裁决和完整 T9/T9a 仍未闭合。不得以 fixture 组装或直接调用组件服务宣称整体产品完成，也不得另起一套替代 OpenCode 的架构。

**实现步骤**
- [x] 单一 CLI solve 入口创建 run/session/task 身份与受限责任/工具权限；challenge、generation、Reference snapshot、profile 和预算在 run 内绑定。正常 `solve` 路由已有 deterministic stub CLI integration test。
- [ ] 按项目现有 OpenCode/provider 架构实现真实 `SolverDriver`，把 Reference、Skills 和 M1 工具登记进模型实际可用的路由；profile 明确 model ID、temperature/参数、prompt/template、tool manifest/version、Reference 版本。
  - [x] provider adapter 基础：OpenAI-compatible 与 Anthropic-compatible 调用都返回单一结构化 SolverAction；转发取消信号、只接纳 provider 可观测 usage，非法 JSON/缺 usage 失败关闭（专项测试 4 项通过）。详见 [T3b 验证记录](../../gates/m1-task3b-results.md)。
  - [x] 正常 M1 CLI 调用 provider driver；profile/run snapshot 绑定 model ID、temperature、prompt/template、tool manifest、Reference snapshot identity；Reference search/get、Skill load、workspace 与受限 HTTP GET/local job 路径可由 SolverLoop 调用。确定性 CLI stub test 覆盖入口和 Reference/Skill 调用。
  - [x] 通过当前 session lease 的工具路由暴露 PTY/TCP session start、job status/read/write/list/cancel，以及 channel open/status/read/write/close；TCP/channel 必须由 host 授权 endpoint，CLI 只允许 challenge origin 的精确 host/port。交互字节以显式 bytes/base64 和 cursor 传输，write 不自动重试。`solver-loop-interactive-tools.test.ts` 与 CLI stub test 验证正反路径。
  - [ ] `job.transfer`/`channel.transfer` 保持 host-owned：模型不能选择或创建新 task lease；尚未有由 Coordinator handoff 触发的 CLI 组合路径。
- [ ] 将 T1–T7 与 Reference/Skills 等基础组件通过该入口接入，并提供 T8/T9/T10 后续接入点；Coordinator/Strategy/Solver/Engineer/Verifier 权限不越界，Verifier 保持独立上下文；候选只经 T9 resolver 与受保护 submit。已验证 local HTTP 子集；T8/T9/T10 全范围产品组合仍待验收。
- [ ] trusted progress 只由 canonical observation、状态/产物变化及权威 oracle 状态派生；模型自述不作为进展或结果依据。
  - [x] 对预声明的精确 HTTP body literal contains/absent 命题接入有界 adjudicator；绑定 hypothesis claim、experiment/hypothesis IDs、canonical successful HTTP result 及完整同 run/challenge/task/session raw artifact。未知语义、伪造/不完整/跨题证据 inconclusive，工具错误不构成反证；详见 `http-progress-adjudicator.test.ts`。不代表通用机制推理。
  - [x] 正常 CLI local HTTP 目标组装候选提取、独立 task/session/workspace/lease 的固定 GET replay 验证、VerifiedCoordinator 与 host-only LocalFlagOracle；正例 authoritative accepted/solved，错候选负例无 submit dispatch。此范围在 [T3b增量验证记录](../../gates/m1-task3b-results.md)，T9/T9a 仍 PARTIAL。
  - [ ] 其他模式和任意语义主张继续 fail closed；没有通用语义裁决器。
- [ ] 一个 run deadline 与预算对象覆盖 Engineer、Verifier、Runtime 操作和 submit；`CandidateResolverInput/resolveCandidate` 必须接收取消信号、deadline 与 remaining budget。调用前预留预算并受控派工；取消阻止尚未派发的工作并传播给可取消的 driver/Runtime/Resolver 请求，但不暗示可撤回已派发的 submit 或其副作用。resolver 等待返回后完整复核 deadline、remaining budget、candidate revision/bytes、verification freshness、generation、effect ledger 和 submit eligibility，再决定状态与下一动作。
  - [x] Resolver control 接收 AbortSignal、deadline、动态 remaining 与分阶段 admission；Engineer/Verifier/submit 调用前预留共享 step/tool budget，Runtime/driver 请求传递取消信号。覆盖组件、resolver 集成测试及 local HTTP 正常 CLI 子集；完整 T9 操作范围仍未验收。
- [x] 区分期限前已派发且有 canonical submit dispatch 证据的请求与期限后新 submit：匹配权威 oracle 回执才保留 accepted/partial 事实，并标记 late reconcile、停止后续动作；无匹配 dispatch/receipt 的迟回调不能令 run solved；期限后新工作在 dispatch 前拒绝。`solver-loop-deadline-reconciliation.test.ts` 覆盖正反边界。
- [x] CLI 输出基于 SolverLoop result、canonical State events/checkpoint 和 artifact refs，包含状态、预算用量、provider usage 可用性及 Reference identity。结果由正常 M1 CLI stub integration test 覆盖。
- [x] 校准后入口修正：可重复 `--material` 将材料按 basename 暂存到 task workspace；request 显式包含 host 枚举的 `workspace_files`；provider prompt v6 明确 artifact ref 路径与 workspace 相对路径、`job.run` procedure/`step_id` 及 dispatch/hypothesis 字段；`DispatchSchema` 要求完整 hypothesis 且校验 hypothesis/experiment identity。provider prompt/schema 与正常 CLI staging deterministic regressions 通过。真实模型 v6 校准仍待运行。

**验收能力**
- [x] 从正常 CLI 命令启动后，以 deterministic provider stub 验证 run identity、冻结 profile/reference 绑定、受限职责与当前已接入工具路由；local HTTP resolver 子集正反例通过，stub 只验证接线，不算真实模型验收。T6全量及T9完整范围未完成。
- [ ] 伪造责任、跨 challenge/generation、超出 tool scope、模型自报 progress/成功均被拒绝。
- [ ] Engineer、Verifier、Runtime、submit 在产品 CLI 组合中共享 deadline/budget；取消传播及各调用前预留、结果返回后的剩余期限/预算校验均有正反测试。
- [x] 确定性边界回归：覆盖 resolver 晚于 `budget.wallClockMs=2000` 返回 accepted/verified、期限前 canonical submit dispatch 与权威 oracle 回执匹配后仅 reconcile、缺失匹配 receipt 时不 solved，以及期限后新 submit 被拒绝。此项验证本地确定性回呼边界，不声称 provider/oracle 验收。
- [x] CLI 输出可从本地 canonical State events/checkpoint/artifact refs 重建；provider usage 仅采 provider 可观测 usage，缺失时报告 unavailable。正常 CLI 仍只以 deterministic stub 验证，没有真实模型用量。

---

## Task 4：Reference Service（最小形态） — COMPLETE（2026-10-18）

**Files：** `packages/reference/src/**`、`fixtures/reference-snapshot/**`、`tests/contract/reference-*.test.ts`

> 验证记录：[M1 Task 4 results](../../gates/m1-task4-results.md)。8 项专项通过；用户已批准固定完整摘要，实际生产模式读取及只读检索通过，独立审查通过。实现和验证在独立工作区，尚未整合到 main；真实模型验收另做。

**实现步骤**
- [x] 固定、完整、**已人工批准、完全离线**的 snapshot；`approved` namespace（官方规范、工具手册、合法教学、自建 recipe、已审核通用模式）。
- [x] SQLite FTS5 / BM25 检索；返回**少量高相关 chunk + 来源 + 版本 + 适用条件 + 原文引用**。
- [x] `reference.search` / `reference.get` 工具面接入（M0 明确推迟的部分）。
- [x] **同一 run 不热更新**共享知识。
- [x] 完整 namespace（`run/<run>/<challenge>`、`candidate_knowledge/<run>`）、版本过滤、run 终态后的人工审核发布 → **留 M5，本任务不做**。

**验收能力**
- [x] 检索返回来源/版本/适用条件齐全；无来源的 chunk 不返回。
- [x] **Reference 是数据，不授予工具权限**——Reference 内容不能扩大 scope、不能触发工具调用（反向测试）。
- [x] 同一 run 内 snapshot 不可变（热更新尝试被拒）。
- [x] 离线：检索过程零网络出站。

---

## Task 5：Skills 与 Web/Misc/Crypto 方法 — PARTIAL（2026-10-18）

**Files：** `packages/supervisor/src/skills/**`、`fixtures/challenges/{web,misc,crypto}/**`、`tests/integration/domain-*.test.ts`

> **部分完成：** [Task 5 验证记录](../../gates/m1-task5-results.md)。原有本地合成数据子集 22 项测试曾通过并获独立复审 APPROVED；本轮新增 Web input-effect hypothesis、有界 gzip/ZIP 展开与 PNG/PCAP 结构检查、Misc evidence-backed hypothesis selection，以及 Crypto 字节整数转换的不可变 provenance，T5 相关测试共 28 项通过，typecheck/build 通过。Web 方法将不可变 source/DOM/request/response 和受控变量组成 `supported` 或 `inconclusive` 假设，明确不作漏洞结论；容器展开受总字节上限约束、不会写出归档路径、校验完整性并保留转换来源；Crypto 增加隔离环境对 SymPy/gmpy2/Z3 的功能性探测和精确能力报告。本地代表题通过确定性方法和分离的 equality oracle；这不代表真实模型验收或完整领域求解能力。未完成项限于下方标出的现有接口接线与正反验收；不增加新的协议族、容器/解析器或密码算法清单。

**实现步骤**
- [x] 按需加载的 Skills，每份含**适用线索、最小试验、失败分支、验证方法**；主提示词保留通用闭环，平台细节不混入。
- [ ] **Web（有限完成条件，§7.6）：** 将现有 source/DOM/request/response evidence 接入 Skill 的基线与 input-effect 假设路径；支持范围仅限当前已有能力，不新增漏洞类型、协议或解析器。一次只改一个可解释变量并保存正常值与受控变体；单次 500/反射/延迟差不自动等于漏洞。仅在机制获得证据支持后构建利用链；每一跳记录前提与失效条件，并按候选是否可 replay 及状态敏感 transcript 的不可 replay 原因交接。
  - [x] 已提供 source/DOM/request/response 不可变证据关联，可产出支持或不确定的受控 input-effect 假设，不把它直接标成漏洞。
- [ ] **Misc（有限完成条件，§7.6）：** 把现有 ingestion/转换结果接入 evidence-backed hypothesis 路径；支持面止于当前实现的格式和转换能力，不扩充格式清单。保持 parent/recipe/参数 provenance、去重/资源上限和只有被保存或消费才发布的规则；发现数学或 Web 问题时建立同题子任务并保留 provenance 交接。
  - [x] ingestion 持久化内容 hash、magic、size、来源 metadata 和有界结构摘要；PNG/PCAP/ZIP 畸形结构在 provenance 中标记失败，不伪装为可解析内容。
  - [x] 支持受总展开字节限额约束的 gzip 和受限 ZIP 单项展开；校验路径、大小、CRC，且不会写出归档路径；输出暂存并在保存/消费时连同 parent、recipe 发布。
  - [x] 对 PNG chunk/CRC 与 classic PCAP 包边界/时间戳做有界结构解析，失败时拒绝畸形输入。
  - [x] 新增 evidence-backed hypothesis selection：按 magic、结构校验或 canonical encoding 输出下一步候选并引用原件证据；签名仅标为 candidate，不展开或发布新字节；暂存产物须先保存/消费才可作为假设证据。
- [ ] **Crypto（有限完成条件，§7.6）：** 将现有 bytes/hex/integer provenance 与 Python backend probe 接入 Skill/tool 的能力选择路径；支持面止于现有转换和经 probe 的 backend capability，不新增算法。接线后覆盖输入范围、timeout、便宜必要条件和结果独立验算；每个交互 oracle query 先记录其判别用途，硬上限只允许走受管 transport。遇到 `metering_unavailable` 时退出该 query 路线并保留其他 hypothesis，不把延期的 M2/M3 broker 加入 M1。
  - [x] 增加隔离 Python backend probe：对 SymPy/gmpy2/Z3 做实际操作自检，按 evidence 区分可用后端与精确缺失能力，并缓存同一次探测结果。
  - [x] 字节整数转换记录保存 bytes/hex/整数、leading/trailing zero、bit/width、端序、domain、padding 和 source ref；先校验源 artifact，再发布不可变 provenance record。
- [x] 补齐工具：数学计算（Python；SageMath 可选且缺失时按 `needs_capability` 降级）、结果登记（候选 flag 登记 / 格式与长度检查 / 证据引用）。
- [x] 建 Web / Misc / Crypto 各至少一道本地代表题（含 oracle）。

> ⏸ **不独立验收（2026-10-19 审计）：** 按现行执行顺序，T5 的缺口**按当前轨迹的需要拉取**，不独立推进、不独立验收。下表仅作能力边界参考，**不构成一个需要单独完成的任务**。

**M1 有限支援矩阵与退出条件（参考）**

| 类别 | 本轮支援范围 | M1 完成所需验算 | 缺能力时退出 |
| --- | --- | --- | --- |
| Web | 保存 source/DOM/request/response 原始引用；受控变量的 input-effect 假设；不自动宣称漏洞 | 基线排除、支持/不确定判定、失败/无差异分支、引用可回取 | 未支持协议/浏览器能力返回 `needs_capability` 或 `inconclusive`，不扩建解析器 |
| Misc | ingestion 身份与有界结构摘要；gzip/受限 ZIP、PNG/classic PCAP、已验证的编码/转换 provenance | 正常、畸形、超限、重复内容、未消费暂存物不发布等正反例 | 未支持容器/格式/后端明确记录缺能力与 provenance，不递归堆叠解析器 |
| Crypto | bytes/hex/integer 精确转换 provenance；有限 Python backend probe；已验证 backend 的明确输入范围/timeout/验算 | 正常、leading zero/端序/域/位长错误、backend 缺失/超时；方法结果可确定验算 | 不支持算法/输入范围返回 `needs_capability`，不以“完整 Crypto”作目标 |

基线方法、provenance 和失败分支仍须满足 spec §7.6；本矩阵限制 M1 的实现面，不降低权威 spec。完成条件是三个原始未完成条目中的有限接口接线与正反验收全部完成，未支持输入明确给出 `needs_capability`/`inconclusive` 并保留 provenance；不要求新增算法或解析器，也不要求覆盖三领域全部方法。

**验收能力**
- [x] 每份 Skill 的四要素齐全（适用线索/最小试验/失败分支/验证方法）。
- [x] Web：对统一错误页/登录页的基线排除生效，不把它们误判为漏洞信号。
- [x] Misc：未被消费的中间转换产物**不**发布为 artifact；同内容重复展开被拒。
- [x] Crypto：缺 SageMath 时返回具体 `needs_capability` 而非「缺所有格能力」，并尝试已验证 backend。
- [x] **方法冒烟（非完整 Solver 证明、非统计门槛）：** 三类合成题由确定性方法与分离 oracle 通过；这不证明三类真实 Solver 完整可用，也不替代 T12。

---

## Task 6：长作业与交互式工具面扩展

— 交互工具 COMPLETE（2026-10-18）；硬限额 broker PARTIAL，明确后移 M2/M3。

> 补齐 M0 明确推迟的工具面（spec §8.1）。**交互工具是 T7 轨迹③的前置；硬限额 broker 后移 M2/M3，不计入 M1 必须勾完范围。**

**Files：** `packages/runtime/src/**`、`fixtures/broker/**`、`tests/contract/runtime-interactive-*.test.ts`

**实现步骤**
- [x] `job.write`（向运行中作业写入）、`job.list(task_snapshot)`、`job.transfer(job_id, new_task_lease)`。
- [x] `mode: pty | tcp_session`（M0 只有 `batch`）；二进制内容明确 bytes/base64，流式读取仍用单调 cursor。
- [x] `channel.open / status / read / write / transfer / close`（Crypto 交互 oracle 需要）。
- [ ] **硬限额与一次性 oracle**（§8.4，补 M0 遗漏）：capability 发布 `unit_definition / hard_limit / budget_scope / counting_point / reset_rule / managed_transport / confirmation_condition / quarantine_scope`；每次可能计数前预留 units；自动 retry/redirect/batch 按平台语义计数或禁用。
- [ ] **broker fixture**：让 raw endpoint 对普通 Tool job 不可达、只有受管 transport 可达，用于测试限额记账与拒绝。**明确后移 M2/M3**；host-dev 当前无此隔离能力，详见 `fixtures/broker/README.md`。
- [x] 无可强制 framing/counting 的能力标 `metering_unavailable`；host-dev **不得声称**一般宿主的 raw socket 非绕过性。
- [x] `listener.*` 与 callback 发布路径 → **留 M5，本任务不做**（spec §3.2：首个闭环不需要）。

> **确定性验证：** `runtime-interactive-sessions.test.ts` 10 项通过，覆盖真实 PTY/TCP 字节往返、cursor gap、job/channel 所有权转移、生命周期、清理和 hard-limit fail-closed。硬限额 broker 的发送前持久 reservation、raw endpoint 隔离、未知结果 quarantine/reconciliation 未实现，保留未勾选并转 M2/M3。

> ⚠️ 硬限额 broker 部分不在六轨迹关键路径上，**时间紧可后移 M2/M3**；但 `pty/tcp_session`、`channel.*`、`job.write/list` 是 T7 与 Crypto 交互题的必需项，不可后移。

**M1 仅要求交互工具能力；硬限额 broker 与 raw endpoint 隔离均为延期项，不得作为 M1 gate 或依赖。**

**验收能力**
- [x] PTY 与 TCP session 的交互往返可用，输出仍以单调 cursor 读取、支持 gap 报告。
- [ ] 硬限额 capability 在**发送前**预留 units；超额在发送前被受管 transport 拒绝。
- [ ] 结果不明时**不释放 units、不重开连线、不重发 bytes**；可读既有 endpoint / 查 status / 对账 / force close。
- [x] 普通 PTY 程序**不**因 transcript 可见就被当成可强制的限次 transport。
- [x] 缺可强制计数能力时标 `metering_unavailable`，其他 hypothesis 仍可继续（不整题阻塞）。

---

## Task 7：长作业 durable watch 与 continuation（轨迹③） — COMPLETE（确定性实现，2026-10-18）

**Files：** `packages/runtime/src/**`、`packages/state/src/**`、`fixtures/trajectories/t3-long-job/**`、`tests/integration/long-job-*.test.ts`

**实现步骤**
- [x] `job.watch(job_id, cursor, continuation_ref)`：watch 绑定 job、等待中的 task/experiment、最后 cursor 和 continuation ref。
- [x] Job 转 `completed | error | cancelled | lost` 时，**State Service 与 outbox 原子提交 terminal event**。
- [x] **重复 delivery 只能让同一 canonical continuation 取得一次 runnable claim**（幂等）。
- [x] Worker **无须以模型轮询保持存活**；deadline/cancel 仍可先终止 job 并唤醒错误分支。
- [x] 已批准的长作业在原期限内等待 completion event，**不消耗失败窗口**（§7.3）；SolverLoop 等待 host terminal event 时不调用模型，也不推进 semantic progress/failure window。
- [x] **轨迹③ fixture**：本地长作业跨过初始 Worker turn，由 host terminal event 唤醒 continuation；见分支中的 `fixtures/trajectories/t3-long-job/README.md`。

> **实现与验证：** 分支新增 `DurableJobWatchService`、SQLite `long_job_watches` 与 `outbox`，并已接入 SolverLoop：长作业登记不可变 continuation、等待 host terminal event、唯一 claim 后恢复原 transcript/cursor 并继续同一 experiment。新增 `solver-loop-long-job.test.ts` 验证等待期间没有模型调用或 failure window；`long-job-continuation.test.ts` 3 项覆盖终态/outbox 幂等、deadline 取消和 immutable 绑定。完整 `npm test` 为 43 files / 257 tests，`npm run typecheck`、`npm run build`、`git diff --check` 通过。六轨迹真实模型重复运行仍留在 T12。

**验收能力**
- [x] **轨迹③（确定性 fixture）**：长作业在模型 Worker 释放后完成；completion event 以保存的 handle/cursor/next action 唤醒并正确恢复同一 experiment 的后续步骤。
- [x] 重复投递 terminal event 只产生一次 runnable claim（幂等测试）。
- [x] 等待期间不以模型轮询续命（无多余模型调用）。
- [x] 长作业等待**不**计入「连续无进展」窗口（SolverLoop 回归测试覆盖等待期间无模型调用或 progress window）。
- [x] deadline/cancel 能终止 job 并唤醒错误分支。

---

## Task 8：Compaction、snapshot 与本地续跑（轨迹④） — 快照/单步恢复组件 COMPLETE；Solver/模型续跑未完成

**Files：** `packages/supervisor/src/**`、`packages/opencode-bridge/src/**`、`fixtures/trajectories/t4-compaction/**`、`tests/integration/compaction-*.test.ts`

**实现步骤**
- [x] 按 spec §6.5 定义可恢复 snapshot：challenge/resource generation/当前目标/**明确下一动作**、最新已发布脚本与输入 refs、已支持与已否定假设与**失败 fingerprint**、关键中间值与原始 observation refs 及必要 byte ranges、活跃 job/channel/cursor/deadline/completion subscription/owner task、已用与剩余预算。
- [x] Compaction 产生**短工作集，不取代原始资料**；新 session 必须能按 ref 回取原输出。
- [x] **摘要互相引用而没有原始 observation 的链，不能作为 verification evidence。**
- [x] 本地 snapshot/checkpoint 的保存、校验与单步恢复组件。
- [ ] 正常 CLI/Solver 运行中，在获准的 compaction 或可恢复中断点保存 recoverable snapshot/compaction checkpoint 与待执行 `next_action`；不依赖 run 正常完成。当前 `finish` 仍保存旧 checkpoint schema，未自行生成这两类快照。
- [ ] 恢复后回到 driver 循环继续模型求解与验证；当前 `resumeLocalCheckpoint` 只执行保存的本地 next action 并返回（model calls=0），新语义判定禁用，不构成完整续跑。
- [x] **轨迹④ fixture**：中途强制 compaction 后，正确下一步依赖已保存的早期原始输出；已否定 fingerprint 不会重跑。

> **验证记录：** `compaction-*.test.ts` 覆盖紧凑工作集、原始字节/range 回取、不同 session/context、summary-only 拒绝、完整 schema 必填字段、generation/deadline/lease、篡改防护、进程终止后 exact next-action 恢复与幂等 dispatch。以上只证明组件和单步恢复。正常 CLI run 自动生成快照、终止后新 session 回取 raw evidence 并继续 driver 求解/验证的闭环仍未完成；本地模型 compaction 可用确定性测试验收，真实模型轨迹留 T12。

**验收能力**
- [x] **组件轨迹④**：确定性 fixture 已覆盖快照恢复及正确 next action；不等同产品续跑。
- [ ] **产品续跑闭环：** 正常 CLI/Solver run 在获准 compaction 或可恢复中断点保存 checkpoint 与待执行 next action → 新 session/context 按 ref 回取原始输出 → 返回完整 driver loop 继续后续求解/验证，并且不重跑已否定 fingerprint。
- [x] 仅由摘要构成、无原始 observation 的链被 Verification 拒收。
- [ ] 真实产品 CLI 在获准 compaction/中断点保存并在新 session 恢复到 driver 后续求解/验证，不只执行本地 next action。
- [x] snapshot 的每个必需字段缺失时续跑失败并明确报错（不静默继续）。

---

## Task 9：Solution Engineering 与独立 Verification（轨迹⑤） — PARTIAL（2026-10-18）

> **本里程碑第二难。** spec §6.4 的三模式必须按候选性质选择「可行的最强模式」，不能一律 replay。
>
> ⏸ **暂缓展开（2026-10-19 审计）：** T9 只服务**轨迹⑤**（现行次序第 3 位），但已被拆成 T9a–T9d 四个未完成子项。在轨迹①尚未跑通时深化尚未开始的轨迹，正是「改动越来越多、进展很慢」的来源之一。**T9a–T9d 等轨迹⑤启动时再展开，现在不推进**；当前只保留已完成的组件部分。

**Files：** `packages/supervisor/src/**`、`packages/contracts/src/**`、`fixtures/trajectories/t5-rejected/**`、`tests/contract/verification-*.test.ts`

**实现步骤**
- [x] Solution Engineering：候选注册后发布脚本/命令/依赖/候选提取清单；**无候选时不要求建立 Engineer/Verifier session**（§7.2）。
- [x] Verifier 使用**新 task/session**，绑定独占 `verification` responsibility；该服务不接收 platform submit / Hint / instance mutation adapters。
- [ ] 三模式（§6.4）：
  - `replay`（可安全重跑、不消耗一次性/硬限额资源、不需 reset 远端）：检查 published script/输入/环境/实际产物与 candidate bytes 的关系。
  - `recompute`（可由已保存输入本地重算）：检查原方程、提取链、编码/格式约束与最终 bytes，**不只是重述 Solver 结论**。
  - `evidence_audit`（一次性/限次/原连线随机状态/不可安全 replay）：检查完整 transcript、顺序、当时前置状态、candidate byte range、提取过程与不可 replay 原因。
  - [ ] **T9a 可信回执与执行内容绑定：** 由受信宿主的 canonical dispatch/execution/publish 链发行回执，绑定实际执行内容、输入、环境 fingerprint、Runtime 成功终态、stdout artifact 和 candidate byte range；Verifier 从该宿主链核验来源及绑定。有效执行通过；篡改脚本/输入/环境或伪造 artifact ref 拒收。现有 Runtime receipt 绑定 command、refs、dependency versions、generation 与 stdout/candidate bytes，但 workspace 内容与环境未绑定。不可将 immutable hash 自身当作来源可信证明。
- [ ] **T9b 支持范围内真正 recompute：** 至少一个声明可本地重算的候选由 Verifier 独立重算原方程/提取链/编码约束/最终 bytes；改动方程输入或编码后应拒绝候选，精确匹配的重算通过；对不支持的方法明确 `inconclusive/needs_capability`。
- [ ] **T9c evidence_audit 完整性：** 为受信宿主捕获的 transcript 建立顺序、完整性、前置状态、候选 byte range、提取链和不可 replay 原因的核验；删改/重排/截断 transcript、缺前置状态或缺 range 时拒绝或 inconclusive；完整有效链通过。`transcriptComplete` 布尔字段不能证明完整。
- [ ] **T9d 持久状态与修复预算：** rejected/inconclusive/stale、Engineer publish failure 均形成持久且可恢复的状态转移；只失效受影响 revision，按有限 repair/evidence-capture budget 回同一 Solver 或恢复其他 route。正例：每种状态重启后有唯一合法 next action；反例：无安全补证路径被停放、重复 revision 不无限派发、旧 accepted/evidence 不被误删。
- [x] **Verifier 不得为形式上的 replay 重置 instance、建立新随机连线或再消耗 oracle。**当前验证服务没有 Runtime/Platform 接口，只读取已发布 artifact。
- [x] Verification result 绑定：candidate value ref/hash、solution artifact、dependency versions、instance/connection generation、mode、check results、evidence refs、`valid_until`；来源/candidate bytes/有效条件改变即 `stale`。
- [x] SolverLoop 提供宿主候选解析接口；权威 rejected/inconclusive 结果成为同一 Solver 可读取的 observation，并写入 canonical activity；未配置宿主解析器时只返回 `candidate_only`。
- [ ] 转移规则按 T9d：每种终态和失败都有持久状态/next action；同一 candidate revision 不无限重试，budget 耗尽后停放或返回上层。
- [x] Coordinator 只有在「当下仍有 current `verified` result + 无受影响 unknown effect + generation 有效」时才可提出一次 submit（`VerifiedCoordinator` 及 resolver 集成测试覆盖）。
- [x] **轨迹⑤ fixture**：本地 candidate `puzzle{slot_b}` 通过确定性 Verification，但被分离的 `local_oracle` 明确 `rejected`；响应要求检查 slot/提取/编码/generation/假设后继续。

> **实现与验证范围：** `SolutionEngineeringService`、`IndependentVerificationService`、`VerifiedCoordinator` 和 `VerifiedMultiFlagCandidateResolver` 已实现，resolver 已接 SolverLoop；确定性集成覆盖 partial 继续、oracle rejection 后由同一 Solver 继续，以及当前候选的验证/提交控制。此结果只证明 resolver 组件的确定性路径。当前 `publishHostExecutionReceipt` 读取 Runtime 成功终态/command，但 script/input refs 来自 Engineering，未绑定实际 workspace 内容；Verifier 只读 receipt artifact，没有核验宿主发行/执行 canonical 记录。`tests/integration/candidate-verification.test.ts` 的 `executionEvidence` 仍是手工 JSON 且验证通过。故不可据此宣称 T9a/T9b/T9c/T9d 已完成；immutable hash 不等于可信来源，`transcriptComplete` 也不是完整性证据。

**验收能力**
- [x] **组件轨迹⑤：** resolver 集成测试覆盖 oracle rejected 结果交回同一 Solver 并继续。
- [ ] **完整诊断与产品轨迹：** 提取/编码/slot/generation/假设诊断必须由有效证据支持；产品入口与真实模型行为另验。
- [ ] 证据不完整、关键 range 被截断、只有模型自述、可信宿主来源/执行绑定缺失或只是「看起来像 flag」→ 只能 `inconclusive`/`rejected`。
- [x] Verifier 试图 reset instance / 新建随机连线 / 再消耗 oracle 被拒绝（当前 verification service 没有这些 capability）。
- [ ] candidate bytes、可信来源、执行内容、环境或依赖版本改变后，旧 verification 自动 `stale`，不能沿用旧结果。
- [x] candidate 不会卡在 `engineering`/`verifying`，也不会绕过 current verification 直接提交（缺失/失败上下文回到 Solver 的 inconclusive observation；提交只经 `VerifiedCoordinator`）。
- [x] 无候选的题目**不**因缺 Engineer/Verifier session 而判失败。

---

## Task 10：多 flag 与 partial（轨迹⑥） — COMPLETE（确定性实现，2026-10-18）

**Files：** `packages/local-oracle/src/**`、`fixtures/trajectories/t6-multiflag/**`、`tests/integration/multiflag-*.test.ts`

**实现步骤**
- [x] `local_oracle` 支持多 required slots：返回 `correctFlagCount / totalFlagCount / matchedSlot` 与完成状态。
- [x] 每获得一个可靠候选**立即验证并提交**，再继续寻找剩余 flag（不攒到最后）；SolverLoop 的 host resolver 已组合 `IndependentVerificationService`、`VerifiedCoordinator` 与 `MultiFlagContinuation`，并覆盖 partial 后继续。
- [x] 按 `(challenge, matched_flag_index)` 保存已确认结果；`progress_state` 正确落在 `partial`；重复提交同一已接受 flag 不重复计分。
- [x] 多 flag 题只有**全部 required slots 被接受**（或 oracle 报 challenge-complete）才算 `completed`/`solved`。
- [x] **轨迹⑥ fixture**：一道含 2 个 flag 的本地题，两个 flag 可分别独立取得。

> **实现与验证：** 分支新增 authoritative multi-slot `LocalFlagOracle`、SQLite `accepted_flags/flag_progress/submission_generations` 与 `MultiFlagContinuation`，并由 `VerifiedMultiFlagCandidateResolver` 接入 SolverLoop。4 项 `multiflag-continuation.test.ts` 与 3 项 `verified-multiflag-candidate.test.ts` 覆盖逐候选验证/提交、partial 持久化后继续、全 slot 才 completed、duplicate 不重复计分和拒绝后回 Solver。真实模型轨迹⑥仍由 T12 验收。

**验收能力**
- [x] **轨迹⑥ fixture**：得到 partial 后保存 accepted slot 与权威得分，**继续求解剩余 slot**（不提前收工、不标 solved）。
- [x] 重复提交已接受的 flag 不重复计分。
- [x] 只接受其中一个 slot 时 `progress_state = partial`，outcome 不得为 `solved`。
- [x] 全部 slot 接受后才转 `completed`。

---

## Task 11：能力与成本度量（spec §12.6）— PARTIAL（2026-10-18）

**Files：** `packages/reporting/src/**`、`tests/contract/metrics-*.test.ts`

**实现步骤**
- [x] **T11b 纯聚合：** 从 canonical events 重算现有来源：start→first experiment、工具回合/错误、repair 尝试数、Strategy 回退与切换耗时、按 solver/strategy phase 的 host usage、工具等待、observation 到下次 driver call 的延迟、candidate→Engineer→Verifier→oracle 的阶段耗时、blocker code 与耗时。
- [ ] **T11a 原始事件源：** 在各 owner 边界提前记录 repair success/failure、全部责任角色 usage、artifact publish/hash/IO、compaction fingerprint/raw-output retrieval/next-action 与恢复结果；没有来源时保持 `unavailable`，不得伪装为 0。
- [x] 指标聚合是 canonical `EventDelta` 的纯投影，**不在 reporting 中首次采集**运行事件。
- [x] 不读取 Solver 自报布尔值；只聚合 canonical driver usage，并保留 provider/deterministic provenance。

**验收能力**
- [ ] T11a 的每类原始事件在 owner 边界落入 canonical events；移除聚合层后原始数据仍在。
- [x] T11b 对当前已采集 canonical events 作纯投影，区分 `unavailable`/`not_observed`/0。
- [ ] T11a 新增所有责任 usage、repair success、artifact IO 和 compaction 指标事件源后，扩展投影并逐项重算。
- [ ] 模型自报用量与 OpenCode 可观测 usage 冲突时以后者为准。
- [x] 对当前已覆盖指标，缺失与「确实未发生」可区分：分别返回 `unavailable` 与 `not_observed`，不是都报 0。

> **部分实现与验证：** 新增 `packages/reporting/src/index.ts`，只从经 schema 校验的 canonical events 重算可观察指标；`candidate.stage` 由 host 在各 pipeline 边界记录。未采集的阶段明确返回 `unavailable`，已完成且确实未发生返回 `not_observed`。`metrics.test.ts` 2 项与多 flag pipeline 集成用例覆盖聚合和候选阶段计时。完整 `npm test` 为 43 files / 257 tests，类型检查、build 与 `git diff --check` 通过。repair 成功率、artifact IO、完整责任角色成本与 compaction recovery 仍缺生产事件源，T11 保持 PARTIAL。

---

## Task 12：六条轨迹 harness、开发校准与正式 2/3 Gate

### T12a：确定性六轨迹 harness — 未完成，可在本轮确定性范围内实现

**Files：** `tests/gates/m1.gate.ts`、`docs/gates/m1-inputs.md`、`docs/gates/m1-results.md`

- [ ] 六轨迹 harness 走 T3b 同一真实 CLI 编排/工具路径，以 provider/oracle/runtime 故障注入和确定性局部模型回呼验证边界；不得由 harness 代模型选 route、修脚本或生成答案。
- [ ] 六轨迹各有可重复干净状态、故障注入点、canonical event/artifact/oracle 判分规则；所有 run 产物包括失败结果均落盘。
- [ ] 覆盖 M0 gate 与本计划中确定性组件的正反案例；fixture 或 scripted driver 的结果只标为 deterministic harness，不标为真实模型验收。
- [ ] 对 T3b 期限边界、T8 产品续跑、T9 状态/回执闭环和 T11 事件源有对应集成验证。

### T12b：开发校准与配置冻结 — 未完成

- [ ] 可确定性完成 `m1-inputs.md`/results 记录模板、版本字段与冻结清单结构；实际 model/参数/预算值在开发校准后、正式 18 次前冻结。
- [ ] 先用独立开发校准 runs 调整 prompt/tool/reference/fixtures，不计入正式 18 次。
- [ ] 正式运行前冻结 model ID、temperature/参数、prompt/template、tool manifest/version、Reference snapshot/version、fixture 与每条轨迹预算，写入 `docs/gates/m1-inputs.md`。
- [ ] 冻结配置变更即建立新验收批次，旧批次不混并；真实用量数据用于正式验收后定稿发布预算。

### T12c：正式六轨迹 18 次验收与预算发布 — 未运行

- [ ] 冻结配置下六条轨迹各以干净状态独立运行 3 次，禁止同一 conversation 内重试冒充独立 run。
- [ ] 三次结果全部保存（包括失败）；判分从 canonical events/artifacts/oracle 权威状态重算。
- [ ] 各轨迹至少 2/3 成功，且 `gate:m0` 回归全绿。
- [ ] 用实际可观测用量定稿每条轨迹和 run 预算，写入 release profile；预算指标缺失时保留 unavailable，不从估算伪造。

**验收能力（spec §12.2；仅 T12c 计真实模型门槛）**
- [ ] **轨迹①** 脚本存在语法/参数/解析错误；同一 Solver 读 raw error、局部修正并成功执行 —— **≥2/3**
- [ ] **轨迹②** 一项机制前提被有效反证；保存反证后切换到不同 route，不因沉没成本原样重试 —— **≥2/3**
- [ ] **轨迹③** Worker 释放后长作业由保存的 handle/cursor/next action 续跑 —— **≥2/3**
- [ ] **轨迹④** compaction/新 session 后取回 raw output，继续求解/验证且不重跑已否定 fingerprint —— **≥2/3**
- [ ] **轨迹⑤** Verifier 通过但 oracle 明确 rejected；系统诊断提取/编码/slot/generation/假设后继续，而非标 solved 或终止 —— **≥2/3**
- [ ] **轨迹⑥** partial 后保存 accepted slot/权威得分并继续剩余 slot —— **≥2/3**
- [ ] 六条轨迹的 18 次结果完整留存可审计；`gate:m0` 全绿；预算发布。

---

## M1 完成检查单

- [ ] T1–T12 中 M1 范围内实现步骤勾完；T6 硬限额 broker 已明确延期至 M2/M3，不是 M1 gate。
- [ ] 六条轨迹各 ≥2/3 通过，18 次结果全部留存（含失败）。
- [x] 方法冒烟：Web/Misc/Crypto 合成题经确定性方法与分离 oracle 接受；不代表三类真实 Solver 完整可用。
- [ ] `gate:m0` 与 `gate:m1` 均全绿，并设为后续里程碑的常设 gate。
- [ ] 预算上限用真实用量定稿，写入 release profile。
- [ ] 范围未越界：未引入真实 TSecBench/VPN/计时、多题调度、Docker、`listener.*`、完整 Reference namespace（留 M2+）。
- [ ] 三个状态维度各自满足范围：确定性组件、产品入口集成、真实模型验收均有独立证据，不以 fixture 成果替代产品或模型门槛。
- [ ] 代码与验证完成；按上方复盘决策在每条轨迹结果落盘后提交。
