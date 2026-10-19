# M1 复盘历史（2026-10-18 ~ 10-19）

> 从 M1 plan 中移出的四轮复盘记录。**这里只是历史，不是行动来源**；当前范围与下一步见 [M1 plan](../2026-10-18-m1-solver-loop-plan.md)。
>
> ⚠️ 下列第三轮的「动作契约重设计」已被 **2026-10-19 的 OpenCode 恢复决定**大部分取代：自建 JSON 动作协议将退役，模型改为经 OpenCode 直接调用工具。但它的教训仍然有效——**凡 host 已知或可推导的东西（ID、hash、ref、预算、步骤号）不要压给模型**。

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
- [x] **⑭ 为校准 run 预置起跑点。** 已新增 `SolverLoopOptions.preset` 与 CLI `--preset-trajectory1`：host 写好 dispatch 与首次失败 `job.run`；gate 测试确认修复与重跑完全由 driver/model 决策。
      **边界（必须严格遵守）：** 预置**止于第一次失败执行**；其后的读 stderr、定位、修复、重跑**必须 100% 由模型完成**，harness 不得提示错误位置、不得给出修复内容、不得代为重跑。这不违反 spec §12.2「harness 不得代模型修脚本」——修脚本仍是模型的事；省掉的只是与轨迹①无关的 dispatch 仪式。
      **正式 2/3 验收**可使用预置起跑点，但必须在 `m1-inputs.md` 中明确记录预置范围，且**三次运行使用同一预置**。

### 停止规则（此前完全缺失，是 8 次 run 无人叫停的原因）

- [x] 已核对“再有 3 次仍未执行”规则：v8-1 即已执行脚本，v8-3 完成开发闭环，此项未触发。
- [x] 累计真实 run 上限 **12 次**已触发：11 次开发校准 + 1 次正式 attempt。正式 run 1 在 provider 回应前失败仍占用 attempt；已实测第 13 次会在 provider call 前被 `STOP_RULE` 拒绝。

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
