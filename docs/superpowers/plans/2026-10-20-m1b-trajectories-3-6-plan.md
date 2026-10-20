# M1b 最小实施计划：轨迹③–⑥

> 状态：**轨迹⑤ A/B（含 fixture 重做与捷径反向测试）确定性集成已完成并复验；C 仍未完成。**旧 b2 的 0/3 是 fixture 设计失败；修复 fixture 后，b3 新批次独立冻结并正式运行 3 次，结果仍为 0/3，失败轨迹累计 6/12，b3 批次额度已用完。b1/b2/b3 清单与证据均独立保留。轨迹⑥ A/B 确定性集成完成（2026-10-20），但**未做捷径反向测试，须补做后才可进入 T6-C**。轨迹①（M1，3/3）与轨迹②（M1b，3/3）已完成，六条轨迹正式进度仍为 **2/6**。③④未启动。
>
> ⛔ **2026-10-20：⑤⑥③④ fixture 工作仍暂停，见第 0 节。** 侦察切片 0.1 的通用 HTTP 接线与一次真实练习题 run 已完成；run 在探索阶段因 token budget 耗尽而 inconclusive，未解出题目，也未观察到③–⑥特征行为。证据见 [`真实 Web 侦察记录`](../../gates/m1b-real-web-scout-20261020/scout-record.md)。
>
> **2026-10-20 根因更新：T5 b2 的 0/3 是 fixture 不合格（材料直接泄露答案），不是模型能力。**据此新增第 2 节「捷径不可达」为 **fixture 设计要求**，并给⑤⑥③④各补了捷径反向测试。T5 fixture 已按「结构性强制拒绝」重做并通过捷径反向测试；修复后的 b3 正式验收结果见 T5-C 记录。
> 基线：`main@c23f0c0`，2026-10-20。
> 依据：[权威 spec §12.2](../specs/2026-10-14-general-ctf-agent-system-design.md)、[roadmap](2026-10-16-ctf-agent-mvp-roadmap.md)、[M1 plan](2026-10-18-m1-solver-loop-plan.md)、[轨迹②计划与验收](2026-10-19-m1b-trajectory-2-plan.md)。
> 本文沿用轨迹②已验证的 **A（定判据写失败测试）→ B（只补薄接线）→ C（冻结真实验收）** 三步模板，共用规则抽到第 2 节，不在每条轨迹里重复。

---

## 0. ⛔ 本计划已暂停（2026-10-20 决定 A）

**⑤⑥③④ 的 fixture 工作全部暂停。** 已用一道**真实题目**取得有限产品信号；本 run 未产生足以判断③–⑥的状态事件，故维持暂停与现有取证设计。

### 为什么停

- 投入：生产 6,117 行 + 测试 4,067 行 + 271 个测试全绿 + 128 份 gate 证据。产出：轨迹 **2/6**。
- **这个产品从未解过一道真实 CTF 题**，而这是唯一真正要紧的未知。
- 造 fixture 比被测行为本身更难（T5 b2 即死于此）；**方差来自 fixture 质量，不是 agent 能力**。
- 真实题目**可能自然产生**③④⑤⑥的情形，不必预先手工制造；本次 DVGA run 在探索阶段耗尽 token，未产生可判断这些轨迹的候选或 oracle 事件。

### 核查发现：产品已被特化成自己测试用例的运行器

```js
// apps/cli/src/commands/solveM1.ts:29
if (options.startLocalTarget || options.target === 'auto')
  throw new Error('blocked_configuration: ... HTTP trajectories are frozen');
// :31  只允许 t1 / t2 / t5 / t6 四个硬编码轨迹
```

`packages/local-target/` **已被删除**，题目描述与工具集按轨迹写死。刷新计划时 CLI 无法指向真实题目；0.1 已恢复只接地址的同源 HTTP 路径（实现记录见下文）。

---

## 0.1 侦察切片：解一道真实题（已完成 1 次，按授权停止）

> **本切片的产物是「信息」，不是「门槛」。** 不新增 fixture、不新增验收框架、不新增轨迹。

**做什么**
- [x] 解冻通用目标路径：恢复 `solve --target <addr> --description <text> --input <dir>`，使 CLI 可指向任意已授权 HTTP(S) 题目。不恢复已退役的自建循环。
- [x] 选 **1 道真实 Web 练习题**（公开练习题或本地 Docker 靶场皆可；**不碰 TSecBench**，不烧限时任务）：用户提供本机 DVGA `http://localhost:5013/`。
- [x] 跑 **1–2 次**，如实记录：解出与否、卡在哪一步、③④⑤⑥ 中哪些行为**自然出现**了。本次授权并只发起 1 个 solve run；OpenCode 内循环实际发出 6 次 provider 模型请求。run 因 100,000 observable-token budget 用尽而 `resource_exhausted / inconclusive / paused`，无候选、无权威验证、无最终答复；③–⑥均未自然出现。详见侦察记录。
- [x] 据此决定剩余四条轨迹的取证方式，再回到本计划：本 run 未产生③–⑥的候选/状态事件，不能用于判断模型能力或更改其取证设计；维持⑤⑥③④ fixture 工作暂停。再次侦察需新的逐次授权。

**硬约束（防止再次过度设计）**
- 只写"不解冻就跑不起来"所必需的代码；**不重建 `local-target` 这类基础设施**，题目由用户在宿主启动、CLI 只接地址。
- **不为本切片新增验收 gate、不新增 fixture、不新增轨迹枚举**；现有 `gate:m0`/`gate:m1` 保持绿即可。
- 新增测试仅限"通用目标路径能被调用"的最小接线测试，**不追求覆盖率**。
- 这**不是**正式验收批次，不计入任何轨迹的 12 次上限；但真实模型调用仍需你逐次授权。
- 跑完就停下来汇报，**不要顺手开始修 ⑤ 的 fixture**。

**0.1 接线与本地验证（2026-10-20）：** 未指定 `--trajectory` 时，CLI 进入通用 Web 侦察路径；`--target` 绑定 HTTP(S) origin，OpenCode 只获得同源 `http.request`（GET/POST）及 workspace 读取工具。请求有 64 KiB 响应上限、跟随重定向关闭、携带 run deadline signal；输入文件或目录会复制到 workspace，目录限制 100 个文件／10 MiB，并拒绝隐藏路径和符号链接。没有 authoritative oracle 时，结果不可能记为 solved；CLI 保留模型最终答复供侦察记录。未新增 challenge fixture、gate 或轨迹。真实 run 已按授权执行一次，结果与边界见下方侦察记录。

- [x] 最小接线测试：本地 OpenCode fixture 将输入目录和同源 HTTP 页面经产品 CLI 传给模型，canonical event 保存响应 artifact，且不产生 solved；见 `tests/integration/cli-m1-http-solve.test.ts`。
- [x] 验证：`gate:m0` 29 文件／167 测试通过；`gate:m1` 3/3 通过；全量 52 文件／298 测试通过；typecheck、build、`git diff --check` 通过。之后只改了 prompt 的描述文本，再次通过最小接线测试、typecheck 和 diff check。
- [x] 真实练习目标和单次调用授权：用户提供 `http://localhost:5013/` 并授权 1 次真实模型 run（OpenCode 内循环实际产生 6 次 provider 请求）；执行证据见侦察记录。当前最小路径不带浏览器执行、Cookie 会话或跨源重定向；若后续目标要求这些能力，先记录设计 blocker，不扩建本切片。

### 侦察结论（决定下一步）

证据：[scout-record](../../gates/m1b-real-web-scout-20261020/scout-record.md)。

- ✅ **集成链是通的**：产品 CLI → OpenCode → 真实模型 → 受管工具 → 真实 DVGA GraphQL，端到端跑通，模型做了真实渗透动作（introspection、枚举 users、systemHealth/systemUpdate、paste 查询、试登录）。这是此前从未有过的产品信号。
- 🔴 **卡点具体且非能力问题**：6 次调用 **97,111 input vs 4,542 output**（≈21:1），102 秒耗尽 100k 预算，**在探索阶段就烧光、没走到形成候选**。模型不是想不出来，是被自己的观察淹没——每次 GraphQL 响应全量回灌 context。
- 📌 **这命中 spec 早已设计、但实现跳过的两处**：§8.5「即时 observation 与发布 evidence 分离」（工具输出按 cursor 读、只发布必要片段）、§10.2「大资料保留本地、按需回取片段」。当前是整个响应灌进模型。
- 📌 **授权口径要改**：token 预算才是真正的硬约束（这次就是它触发终止），run 次数是松口径。**后续按 token 预算授权，不按 run 次数。**

**所以下一步不是 ⑤⑥③④ 的 fixture，而是补 observation/预算管理（见 0.2）。** ⑤⑥③④ 维持暂停。

---

## 0.2 observation 分页与预算（真实复跑已执行，未达成功判据，等待下一步）

> **假设：卡住模型的是 context/预算管理，不是能力。** 本切片只验这一条，不开新建设战线。范围与 0.1 一样窄。

**做什么**
- [x] 按 spec §8.5 接上本次侦察实际暴露的大 HTTP 响应 **observation 分页**：通用 Web 路径的 `http.request` 大文本 body 返回有界预览和 run-bound observation ref；`observation.read` 按精确单调 cursor 返回有界片段。完整 body 保留为本地 immutable artifact；binary bulk 不拆片外送。复用 M0 Artifact Store/range 与 cursor 语义，不新建框架。实现和本地验证见[observation 分页记录](../../gates/m1b-observation-pagination-20261020.md)。
- [x] 用**同一道 DVGA、同样 100k 预算**再跑（用户本轮授权 100k observable-token budget），对比 input-token 增长曲线。第 6 次模型调用累计 input 为 42,936，前次第 6 次为 97,111（下降 55.8%）；本次跑到第 9 次调用时累计 input 104,573、总 observable 107,774，因共享预算停止。
- [x] 如实记录结果与下一个真实卡点：[分页后 DVGA 复跑记录](../../gates/m1b-real-web-pagination-20261020/run-2-record.md)。模型比前次多运行 3 次调用并开展更多定向查询，但仍未进入候选阶段；最后一次工具调用传入的 observation ref/cursor 不匹配（期望 cursor 2048，实际传入 6144），预算耗尽后没有恢复机会。复跑与预算均如实记录；**本切片成功判据未达到**。

**0.2 结果（2026-10-20）：** 确定性接线与 M0/M1 gate、全量测试、typecheck、build 均通过；真实复跑证实分页明显压低前 6 次调用的累计 input（97,111 → 42,936），并让模型继续到第 9 次调用，但累计上下文仍增长并触发预算停止，尚未到候选阶段。最后一项 observation.read 因 ref/cursor 错配失败，模型未能在预算内恢复。具体 token 曲线、工具事件和 canonical DB 见[真实复跑记录](../../gates/m1b-real-web-pagination-20261020/run-2-record.md)。这说明分页降低了大响应回灌，却尚未满足「探索之后继续推进」的成功判据；按要求在此停下，等待下一步指令。

**硬约束（同 0.1）**
- 只做 §8.5 分页这一件事；**不新增 fixture、不新增 gate、不新增轨迹枚举**。
- 不重建基础设施；优先复用 M0 的 observation cursor 与 artifact store。
- 新增测试仅限"大响应被分页、片段可按 ref 回取"的最小接线测试，不追求覆盖率。
- 不是正式验收批次；真实模型调用按 **token 预算**逐次授权。
- 跑完停下汇报，**不要顺手去动 ⑤⑥③④**。

**判成功的口径**：不看最终是否解出 DVGA（那是 bonus），看**同样预算下模型是否不再被观察淹没、能推进到探索之后的阶段**。若假设被证伪（分页后仍卡），记录真实的下一卡点，再回来重定方向。

### 复跑结论（run-2，2026-10-20）

证据：[run-2-record](../../gates/m1b-real-web-pagination-20261020/run-2-record.md)。

- ✅ **分页有效但不充分**：前 6 次调用 input 降 **55.8%**（97,111 → 42,936），斜率被压平，但 input **仍单调上升**，第 9 次累计 104,573 越过预算而停。成功判据（推进到探索之后）**未达到**，仍在侦察阶段。
- 🔴 **卡点 A（根本）：会话上下文只增不减。** 分页只治了"单次大响应"，但 OpenCode 每轮请求携带**增长中的会话历史**（preview、observation.read、模型自述累积），每轮重付。这是 spec **§6.5「短工作集」/ §10.2「按需回取」** 要解决的**会话级上下文预算**，不是 §8.5 单次 observation。
- 🔴 **卡点 B（次要）：observation.read 的 ref/cursor 对不上。** 模型请求 `cursor=6144` 但该 ref 当前预期 `2048`，canonical 正确拒绝，之后无预算恢复。按硬规矩 2「host 已知的别压给模型」，续读游标应由 **host 维护**，模型只说"继续读这个 ref"。

**不直接跳 compaction：** 卡点 A 指向 compaction，但那是轨迹④核心、风险最高（会动①②③现有行为）。为"让 DVGA 往前走"提前拖进来 = 回到横向建设。先做下面 0.3。

---

## 0.3 下一切片：修 cursor 簿记 + 量化上下文构成（不碰 compaction）

> **先修便宜的 B，再把 A 量化清楚，用数据决定要不要动 compaction。** 范围同样窄。

**做什么**
- [ ] **修卡点 B**：observation.read 的续读游标改由 **host 维护**——模型只给 ref（可选"从头/继续"），host 记住每个 ref 的当前 cursor 并推进；模型不再手报 cursor 数字。复用 M0 的 observation cursor 机制，不新建。
- [ ] **量化卡点 A**：在同一条 DVGA run 里打点，把每轮 input 拆成**必要工作集**（当前目标、未决问题、最近若干步）与**可丢弃历史**（旧 preview、已消费的 observation、过期自述），得出"若只保留工作集，input 会压到多少"。**只测量、只出数据，不实现裁剪。**
- [ ] 记录：B 修好后模型是否不再因 ref/cursor 读错而卡死；A 的量化结论——有界工作集能否把 input 压进预算，还是确实需要 compaction。

**硬约束（同 0.1/0.2）**
- 只做 B 的修复 + A 的**测量**；**不实现上下文裁剪、不开 compaction、不新增 fixture/gate/轨迹**。
- 复用 M0 机制，不重建基础设施。不碰 ⑤⑥③④、不碰 TSecBench。
- 新增测试仅限"host 维护 cursor、模型不报数字也能续读"的最小接线测试。
- 真实模型调用按 **token 预算**逐次授权；跑完停下汇报，**不要顺手去实现裁剪或 compaction**。

**判成功**：B——模型不再因手报 cursor 出错而卡死；A——拿到一份可信的"工作集 vs 历史重发"占比数据，足以判断下一步是"轻量上下文窗口裁剪"还是"必须上 §6.5 compaction"。**这一步本身不要求 DVGA 往前走更多**，它的产物是"把 A 的决策建立在数据上"。

---

## 1. 执行顺序与理由

**一次一条，走完 A→B→C 并复核后才开下一条。** 建议顺序：

| 序 | 轨迹 | 为什么排这个位置 |
| --- | --- | --- |
| 1 | **⑤ 验证通过但 oracle rejected** | 与②结构最像（收到权威否定 → 说明 → 改做法），可直接复用②刚建好的语义登记、原始证据送达与语义复核机制，边际成本最低 |
| 2 | **⑥ partial 后继续剩余 slot** | 同属 oracle 侧行为扩展，不需要新工具面；`multiflag.ts` 已有续跑组件 |
| 3 | **③ 长作业释放后续跑** | **需要新增异步工具面**（当前 plugin 只有同步 `job.run`），surface 增量最大 |
| 4 | **④ compaction/新 session 后续跑** | 风险最高：要真正开启 OpenCode compaction/新 session 生命周期，且必须证明"按 ref 回取原始输出 + 不重跑已否定 fingerprint" |

顺序是建议，不是依赖——四条互不前置。但**不得并行建设**，也不得为后面的轨迹提前建框架。

---

## 2. 四条共用的规则（不在各轨迹重复）

### A/B/C 三步的固定含义

- **A — 先固定判据，写失败测试。** 定义隔离材料、题目说明、host-only oracle 与**判分所需的事件顺序**；写正向 + 负向确定性测试，**新测试必须先失败**；保留①②既有断言，不删除、不降低覆盖。
- **B — 只补薄控制层接线，使确定性测试变绿。** 优先原样复用现有 supervisor 组件，不复制实现；把证据与状态写入 canonical state/checkpoint；跑 `gate:m0`、`gate:m1`、全量测试、typecheck、build，并用**无外部模型**的 OpenCode 接口 fixture 验证接线。此步只能标「确定性集成完成」，**不得标轨迹完成**。
- **C — 冻结并真实验收。** 用户授权后做可用性预检（不含题目材料，单独计，不算 solver attempt）；冻结 source/config/material/grader hash、模型与 OpenCode 版本、prompt/tool manifest、preset/介入政策、逐 run 预算与 attempt 台账；**3 次独立正式 run，≥2/3 通过**；无自动重试；完成语义复核。

### 判分通则

- **判行为证据链，不判最终 flag。** 每条轨迹都必须看到其特征行为的完整顺序证据；**模型绕过该行为直接解出题，不算该轨迹通过**。
- **harness 不得代模型**：不得提示下一步、不得替模型生成结论、不得把答案或攻略放进 prompt，fixture 的 README/预期答案不进入模型输入。
- 只凭命令名、退出码、出现新 ID/fingerprint 或最终 accepted，**都不得判通过**。
- 负向必测（四条共有）：伪造/跨 run/challenge/task/session 的 receipt、缺原始证据送达、先行动后补登记、仅换 ID 重复原动作、工具故障冒充语义结论。

### ⚠️ 捷径不可达：fixture 的设计要求，不是判分规则（2026-10-20 新增，T5 b2 教训）

T5 b2 批次 0/3 的根因**不是模型**，而是 fixture 把答案给了模型：`record.json` 的 `encoding` 字段直接写明 "base64 body inside puzzle envelope"，称职的模型解码后一次就被接受，**权威拒绝从未发生**，⑤要测的行为根本无从观察。而 fixture 的 README 明知材料泄露线索，却把"模型走正确捷径"定义成失败——**这是设计倒置：不能靠指望一个有能力的模型犯可避免的错误来测试它从错误中恢复，再因为它没犯错而判它失败。**

因此，以下要求从「判分规则」升级为 **fixture 设计要求**：

> **每条轨迹的特征行为必须被 fixture 结构性地强制，而不是寄望模型出错。** A 阶段必须包含一条**「称职捷径」反向测试**，确定性地证明：在该 fixture 下，**不表现出该轨迹行为就无法到达 `accepted`**。该测试通过后，A 阶段才算完成。

- 「绕过行为不算通过」只是事后判分，意味着要**烧掉真实 run 才发现 fixture 坏了**（T5 已为此花掉 3 次 attempt、11 万 input token）。捷径反向测试把这个发现成本从真实 run 降到确定性测试。
- A 阶段的确定性测试若只用「脚本化模型按预期剧本走」，**只验证了剧本的 happy path，没有验证轨迹在称职模型下的可达性**——T5-A 当初正是这样通过的。
- 判断标准：假设一个**完全称职、不犯错**的模型来做这道题，它是否**必然**经过该轨迹的特征行为？若存在任何一条不经过就能 accepted 的路径，fixture 不合格，必须改 fixture，**不得改成扣模型的分**。

### 预算与停止规则

- 冻结预算沿用①②已验证上限：每 run 600,000 ms、`maxSteps=40`、`maxToolJobs=20`、100,000 observable tokens。`maxSteps` 不是模型调用次数。
- **每条轨迹各自累计 12 次为绝对停止上限**（校准 + 正式合计）。达到即停止并请用户重评，**不得换批次、换模型或换配置来静默绕过**；换模型/配置必须保留批次关联与该轨迹累计次数。
- 每批次的授权次数由用户单独给出；本计划**不是对任何次数的授权**。
- 余额/额度不可查询时记 `unavailable`，**token 数不等于金额**，`engine_cost=0` 不作为免费证据。

### 范围红线

- **不扩充冻结资产**：Reference 检索、领域解析库与 skills、通用验证框架、度量扩展——原样保留，不是任何轨迹的准入前置。
- **不恢复退役框架**：`ProviderSolverDriver`、`SolverLoop`、自建 JSON action 协议、旧 agent 自动加载，一律不得重新导入生产（见 `archive/pre-opencode-20261019/`）。
- **不建通用框架**：每条轨迹只补它自己暴露的缺口；不为后续轨迹预建抽象。
- 公共 plugin/SDK/server 接口若无法提供必要 hook 或证据，**报告设计 blocker**；不维护 fork、不绕过 OpenCode。
- 不碰 M2+ 范围：真实 TSecBench/VPN/计时、多题调度、Docker。

---

## 3. 轨迹⑤：验证通过但 oracle 明确 rejected

**spec §12.2-5：** Verifier 通过但平台明确 rejected；系统检查提取/编码/slot/generation/假设后继续，而非标 solved 或终止。

### 最小闭环

模型产出候选 → 独立验证通过 → **权威 oracle 返回 rejected** → rejected 的原始结果实际进入模型输入 → 模型说明诊断方向（提取/编码/slot/假设哪一项） → 选择并执行**不同的**提取或求解做法 → 新候选经独立 replay 与 oracle accepted。

### 真实缺口

| 缺口 | 说明 |
| --- | --- |
| rejected 回灌 | 当前 `candidate.register` 只接 `value`；需要把权威 rejected 结果作为**真实 tool result** 送回模型输入，并绑定同 run/challenge/task/session 的 receipt |
| 诊断登记 | 需要模型在再次提交前登记诊断结论与改动方向（可复用 `hypothesis.conclude` 式的语义登记，不新增每轮 JSON 协议） |
| **题材（b2 后判定为不合格，须重做）** | 现 `fixtures/trajectories/t5-rejected/` **把答案给了模型**，详见下方根因 |

**可复用：** `candidate-verification.ts`(398)、`localJobCandidateResolver.ts`、LocalFlagOracle、②的语义登记与证据送达机制。

### ⛔ b2 批次 0/3 的历史根因：fixture 不合格，不是模型不行

```json
// fixtures/trajectories/t5-rejected/record.json
{"transport":"puzzle{c2xvdF9h}","encoding":"base64 body inside puzzle envelope"}
```

`c2xvdF9h` base64 解码即 `slot_a`，而 oracle 恰好只接受 `puzzle{slot_a}`。**`encoding` 字段直接写明了编码方式**，称职的模型读完材料就解码、一次提交即被接受——**权威拒绝从未发生**，⑤要测的行为无从观察（Run 1/3 的 `reached solved by a direct route` 即此）。

次要问题：
- Run 2 有 `candidate.diagnose` 却无「已验证的权威拒绝」。⑤要求的状态是**本地验证通过 → oracle 拒绝**；若那个"错误候选"连本地 recompute 都过不了，它根本到不了 oracle，产生不了该状态。
- README 提到 `puzzle{slot_b}`，但 `record.json` 只能产出 `slot_a`——fixture 改动后遗留的不一致。

**历史结论：** 按第 2 节「捷径不可达」要求，b2 当时使用的 fixture 不合格，必须重做、不得改成扣模型的分；在修复并通过捷径反向测试之前，剩余 attempt 不得使用。修复现已完成，当前证据见下方记录。

**修正记录（2026-10-20）：** fixture 已按下述设计重做。`record.json` 提供两个本地可复现 slot；`extract.mjs` 的两个选择都能通过本地 independent replay。controller-only `T5CurrentGenerationOracle` 对任一首个有效 slot 都返回 `rejected`，响应说明 `slot mismatch for current generation`，不返回 `matchedSlot`；不同 slot 才能完成。T5 专用 resolver 注入该 oracle，通用轨迹仍使用 `LocalFlagOracle`。

捷径反向测试分别将 lane-17 / lane-29 作为首个本地验证候选，确认两者都会被 authoritative rejected；在拒绝后未完成送达/诊断就执行另一路径时，host 拒绝执行且没有 accepted。完整正向链仍要求 rejected tool result 实际送达、诊断登记、另一条命令成功执行、新候选独立 replay 并 accepted。测试与哈希记录见 [T5 fixture 重做验证记录](../../gates/m1b-t5-fixture-redesign-20261020.md)。

### 重做后的 fixture 设计要求：结构性强制拒绝

核心原则与轨迹①的「预置起跑点」一致：**⑤要测的是「对拒绝的反应」，不是「模型会犯错」。所以首次拒绝必须被结构性保证。**

推荐用 **slot／generation 做确定性拒绝**——spec §12.2-5 原文列举的就是「提取／编码／**slot**／**generation**／假设」，正好对口：

- 题目含**两个 slot**，二者**都能通过本地 recompute 验证**（这是⑤「验证通过却被拒」的前提，缺它则 Run 2 式失败会重演）。
- 材料**不披露**当前 generation 要哪个 slot（**移除 `encoding` 之类的答案提示**）。
- oracle 的接受条件绑定 current generation，**首次提交必被拒绝**，拒绝原文含可诊断信息（如 `slot mismatch for current generation`），但**不直接给出正确 slot**。
- 模型须读拒绝 → 诊断 slot／generation 假设 → 提交另一个 → accepted。

这样拒绝是**确定的、权威的、真实的**，而诊断与改正 100% 由模型完成，harness 未代劳。

### T5-A：固定判据，写失败测试（fixture 重做与捷径反测已验证）
- [x] 按上述要求重做 fixture：两个本地可验证 slot、移除答案提示、oracle 绑定 current generation 且首个有效候选必拒、修正 README/record.json 一致性。
- [x] 捷径反向测试：分别尝试两个 slot 作为首个有效候选，证明不经过「拒绝→送达→诊断→不同执行」就不能 accepted。
- [x] 定义 t5 隔离材料、题目说明与 host-only oracle（两个首选 slot 都必被 rejected，后续不同 slot 可 accepted）。
- [x] 冻结判分事件顺序：候选注册 → 独立验证通过 → oracle rejected → **rejected 原文送达模型** → 诊断登记 → 不同做法执行 → 新候选 accepted。
- [x] 正向：上述顺序完整且新候选由**不同提取/编码路径**得出。
- [x] 负向：收到 rejected 后原样重交同一候选；未读 rejected 就换值；把 rejected 当作题目机制反证；标 solved 或直接终止；仅改一个字符凑新值而无诊断登记。
- [x] 保留①②既有正反断言不变。

### T5-B：薄接线使确定性测试变绿
- [x] 让 oracle 的 rejected 结果以真实 tool result 回到模型输入，并写入 canonical state（含 candidate ref、verification 结果、rejected 原因）。
- [x] 接通诊断登记；诊断与"下一次候选"在 canonical state 中可关联。
- [x] rejected **不得**使 run 终止、**不得**计为 hypothesis 的机制反证（spec §8.7）。
- [x] 跑 M0/M1 gate、全量、typecheck、build，并用无外部模型的 OpenCode fixture 验证接线。

原 OpenCode 接线验证见 [T5-A/B 验证记录](../../gates/m1b-t5-deterministic-20261020.md)；fixture 重做与本轮完整回归见 [T5 fixture 重做验证记录](../../gates/m1b-t5-fixture-redesign-20261020.md)。仅勾选 A/B，不将本地固定 provider 计作模型能力验收。

### T5-C：冻结并真实验收
- [ ] 按第 2 节通则冻结并执行 **3 次独立正式 run，≥2/3**。
- [ ] 语义复核：三次均实际收到 rejected、作出可核实的诊断、改用不同做法，而非穷举值。

执行记录：用户明确授权将两份 T5 隔离材料与执行上下文发送到 Bailian/OpenCode，最多 3 次正式 run。b1 原清单及原始可用性预检保留；b2 清单重新冻结当前源码/config/material/grader/runtime 哈希，并通过关联字段记录 b1 manifest 与预检 SHA-256。额度查询 `unavailable`，不含题材的可用性预检通过；预检不计 solver attempt。

- 批次：`m1b-opencode-t5-bailian-20261020-b2`；模型 `bailian/deepseek-v4-flash-0731`，OpenCode `1.19.3`。
- Run 1：执行成功并完成 accepted，但没有权威 rejected 候选、拒绝原文送达或诊断后不同做法；轨迹判分失败。
- Run 2：`resource_exhausted / inconclusive`；出现 `candidate.register` / `candidate.diagnose` 调用，但没有 canonical rejected candidate、诊断绑定的新候选或完整独立 replay；判分失败。provider usage 实测 13 calls、100306 input tokens、15883 output tokens。
- Run 3：执行成功并完成 accepted，但同样直接 accepted，没有权威 rejected 链；轨迹判分失败。
- 结果：**0/3 通过**。逐次报告、证据压缩包、manifest、停止核验与语义复核见 [`b2 证据目录`](../../gates/m1b-opencode-t5-bailian-20261020-b2/)；三次证据均保留且无 harness retry。批次授权额度耗尽，runner 的 `next_attempt_blocked=true`；未达到轨迹 12 次绝对上限。T5-C 两项完成条件保持未勾选。
- 上述三次使用旧的不合格 fixture；结果与失败原因完整保留、attempt 计数不回滚。fixture 重做后尚未进行新的正式 run；旧 b2 manifest 不绑定当前 fixture，未以新源码重用旧冻结。新的正式批次须单独授权并重新冻结。T5-C 两项完成条件仍未勾选。

#### 2026-10-20 更新：修复 fixture 后的 b3 正式验收

用户授权一次无题材可用性预检及最多 3 次正式 run。新批次 b3 独立冻结当前修复后的 fixture、源码、配置、判分器和运行时（167 个文件哈希）；不含题材的预检通过，模型余额仍为 `unavailable`。b3 与 b2 manifest 建立 SHA-256 关联，旧批次保持不变。

- 批次：`m1b-opencode-t5-bailian-20261020-b3`；OpenCode `1.19.3`，模型 `bailian/deepseek-v4-flash-0731`。
- Run 1（trajectory attempt 4）：权威拒绝已送达，但之后没有诊断或替代候选；判分失败，冻结绑定通过。
- Run 2（attempt 5）：权威拒绝已送达，之后没有诊断或替代候选；判分失败，冻结绑定通过。
- Run 3（attempt 6）：权威拒绝已送达，之后出现诊断调用，但没有接受的替代候选；判分失败。最终可观察 token 110538 超过冻结预算 100000，冻结绑定失败。
- 结果 **0/3**；事件语义复核、报告及证据包见 [`b3 证据目录`](../../gates/m1b-opencode-t5-bailian-20261020-b3/)。停止核验为 `next_attempt_blocked=true`，批次三次额度已用完，轨迹累计 6/12。未再重试。T5-C 两项完成条件继续未勾选。

---

## 4. 轨迹⑥：partial 后保存已接受 slot 并继续剩余

**spec §12.2-6：** 多 flag 题得到 partial；保存 accepted slot 与权威得分，继续求解剩余 slot。

### 最小闭环

模型提交第一个候选 → oracle 返回 **partial（已接受 slot i，总 slot n）** → partial 结果实际进入模型输入 → host 持久化已接受 slot 与进度 → 模型继续求解**剩余** slot（不重复已接受的） → 第二个候选 accepted → `progress_state` 由 `partial` 转 `completed`。

### 真实缺口

| 缺口 | 说明 |
| --- | --- |
| 多 slot oracle | LocalFlagOracle 需返回 `correct_flag_count / total_flag_count / matched_slot` 与完成状态 |
| partial 回灌与续跑 | partial 作为真实 tool result 回到模型输入；host 按 `(challenge, matched_slot)` 持久化，重复提交已接受 slot 识别为 duplicate 且不重复计分 |
| 终态语义 | 只有全部 required slot 被接受（或 oracle 报 challenge-complete）才可 `completed`；只接受其一时 `progress_state=partial`，outcome **不得** `solved` |

**可复用：** `multiflag.ts`(49)、LocalFlagOracle、verified candidate resolver、`fixtures/trajectories/t6-multiflag/`（含 2 个可独立取得的 flag）。

### T6-A：固定判据，写失败测试
- [ ] **捷径反向测试（新增，A 阶段完成的前提）**：证明不经过「partial → 读取 → 针对剩余 slot 继续」就无法 `completed`。⑥的典型捷径是**模型一次性把两个 flag 都算出来、连续提交**，这样 partial 虽然出现过，却没有「读 partial 后据此决定下一步」的行为。fixture 必须让第二个 slot **只能在获得 partial 之后才可求解**（例如第二 slot 的输入依赖 partial 返回的已接受 slot 信息），否则⑥不可观察。⑥的 A/B 已在 2026-10-20 标记完成，但当时未做此项，**须补做后才可进入 T6-C**。
- [x] 定义 t6 隔离材料与多 slot oracle（2 个 slot，可分别独立取得）。
- [x] 冻结判分事件顺序：候选1 → partial（slot 记录） → partial 送达 → 继续求解剩余 → 候选2 → completed。
- [x] 正向：两个 slot 分别被接受，终态 `completed`，且第二次求解确实针对**剩余** slot。
- [x] 负向：partial 后提前收工／标 solved；重复提交已接受 slot 而不重复计分；只接受一个却报 `completed`；partial 未送达前继续执行被 host 拒绝。
- [x] 保留①②⑤既有断言不变。

### T6-B：薄接线使确定性测试变绿
- [x] oracle 返回多 slot 进度并以真实 tool result 回灌；host 按 slot 持久化已确认结果与权威得分。
- [x] duplicate 识别与不重复计分；`progress_state` 与 outcome 转换按 spec §7.1 枚举。
- [x] 跑 M0/M1 gate、全量、typecheck、build，并用无外部模型的 OpenCode fixture 验证接线。证据见 [T6 A/B 确定性验证记录](../../gates/m1b-t6-deterministic-20261020.md)。

### T6-C：冻结并真实验收
- [ ] 按通则冻结并执行 **3 次独立正式 run，≥2/3**。
- [ ] 语义复核：三次均在 partial 后针对剩余 slot 继续，而非重试或穷举。

---

## 5. 轨迹③：长作业在 Worker 释放后完成并续跑

**spec §12.2-3：** 长作业在 Worker 释放后完成；completion event 以保存的 handle/cursor/next action 恢复后续步骤。

### 最小闭环

模型启动一个**异步长作业** → 得到 handle → Worker 让出（不以模型轮询续命） → 作业完成产生 terminal event → 以保存的 handle/cursor/next action **恢复**并读取结果 → 基于结果完成后续步骤 → 候选 accepted。

### 真实缺口（本组 surface 增量最大）

| 缺口 | 说明 |
| --- | --- |
| **异步工具面** | 当前 plugin 仅 `job.run`（同步、带 `timeout_ms`）。需新增 `job.start` / `job.status` / `job.read`（单调 cursor）/ 必要时 `job.watch`。**仅此四项，不一并引入 PTY/TCP/channel** |
| OpenCode 侧让出与恢复 | 必须证明 Worker 释放后、由 completion event 恢复，而非模型空转轮询；等待期间不计入"连续无进展"窗口 |
| 幂等 | 重复投递 terminal event 只产生**一次** runnable claim |

**可复用：** `long-job-watch.ts`(71)、Runtime job 基础设施、State outbox 与幂等 claim、`fixtures/trajectories/t3-long-job/`（作业时长明显超过一次 Worker 占用）。

### T3-A：固定判据，写失败测试
- [ ] **捷径反向测试（新增，A 阶段完成的前提）**：证明不经过「异步启动 → Worker 释放 → completion 恢复」就无法 accepted。③的典型捷径是**用同步 `job.run` 等完**或把作业缩短到一次占用内完成；fixture 必须让作业时长确定性地超过单次 Worker 占用上限，且同步路径会因超时失败而非悄悄成功。
- [ ] 定义 t3 隔离材料与 oracle；作业时长确保跨越一次 Worker 释放。
- [ ] 冻结判分事件顺序：`job.start` → handle 持久化 → Worker 释放 → terminal event → 以 handle/cursor 恢复 → 读取结果 → 后续步骤 → accepted。
- [ ] 正向：上述顺序完整，且**恢复后读到的内容确实来自该作业**（绑定 job id 与 cursor range）。
- [ ] 负向：模型轮询空转保活；重复投递 terminal event 产生两次 claim；未经 completion 直接宣称结果；cursor gap 被当作完整输出；用同步 `job.run` 绕过（应判不通过）。
- [ ] 保留①②⑤⑥既有断言不变。

### T3-B：薄接线使确定性测试变绿
- [ ] 在 plugin 新增 `job.start/status/read`（必要时 `job.watch`）；**不引入 PTY/TCP/channel/listener**。
- [ ] 接通 `long-job-watch.ts` 的 durable watch 与 State outbox；terminal event 与 claim 原子提交且幂等。
- [ ] `job.read` 按 cursor 返回并在越界时明确报告 gap；**有 gap 的输出不得作为完整证据**。
- [ ] 等待期间不消耗失败窗口；deadline/cancel 仍可终止作业并唤醒错误分支。
- [ ] 跑 M0/M1 gate、全量、typecheck、build，并用无外部模型的 OpenCode fixture 验证接线。

### T3-C：冻结并真实验收
- [ ] 按通则冻结并执行 **3 次独立正式 run，≥2/3**。
- [ ] 语义复核：三次均真正经过释放—恢复，而非把长作业压成同步等待。

---

## 6. 轨迹④：compaction／新 session 后续跑

**spec §12.2-4：** 强制 compaction／新 session 后，取回必要原始输出并执行正确下一动作，不重跑已否定 fingerprint。

### 最小闭环

模型在求解中产生若干原始输出与**已否定的 fingerprint** → 触发强制 compaction／新 session → 新 session 中**按 ref 回取**必要原始输出 → 执行 snapshot 记录的正确下一动作 → **不重跑已否定路线** → 候选 accepted。

### 真实缺口（风险最高）

| 缺口 | 说明 |
| --- | --- |
| compaction 当前被禁用 | `solveM1.ts` 显式 `compaction: { auto: false, prune: false }` 且 `compaction: { disable: true }`。④必须真正开启 |
| 真实新 session 证据 | `LocalCompactionAdapter` 是 host 侧恢复封装，**不能**证明真实 OpenCode 新 session；必须有新 session id 与跨 session 的 ref 回取证据 |
| 不重跑已否定 | ②已把否定 fingerprint 写入 canonical state；④需证明新 session **读到并遵守**它 |

**可复用：** `compaction.ts`(131)、`local-resume.ts`(148)、hypothesis snapshot 与否定 fingerprint（②已落地）、原始 artifact 与 ref、`fixtures/trajectories/t4-compaction/`。

> ⚠️ **开启 compaction 会影响①②③的现有行为**。T4-B 必须在开启后重跑①②（及已完成的⑤⑥③）的确定性回归，确认未破坏既有轨迹；若冲突，优先保证既有轨迹不回归，并把冲突记为设计 blocker 交用户决定。

### T4-A：固定判据，写失败测试
- [ ] **捷径反向测试（新增，A 阶段完成的前提）**：证明不经过「新 session → 按 ref 回取原始输出」就无法 accepted。④的典型捷径是**模型在 compaction 前就把所需信息全部读进上下文**，于是新 session 无需回取即可继续；fixture 必须让正确的下一步**确定性地依赖一段不可能被摘要保留的原始输出**（体量或形态上必须按 ref 回取）。
- [ ] 定义 t4 隔离材料与 oracle；确保正确下一步**依赖某段较早的原始输出**（必须回取才能完成）。
- [ ] 冻结判分事件顺序：产生原始输出与否定 fingerprint → compaction／新 session（新 session id 可见） → 按 ref 回取原始输出 → 执行 snapshot 的下一动作 → accepted。
- [ ] 正向：跨 session 回取成功且下一动作正确；**已否定 fingerprint 未被重跑**。
- [ ] 负向：仅凭摘要而无原始 observation 的链被当作证据；新 session 重跑已否定路线；snapshot 缺必需字段却静默继续；用 host 侧恢复封装冒充真实新 session。
- [ ] 保留①②③⑤⑥既有断言不变。

### T4-B：薄接线使确定性测试变绿
- [ ] 开启真实 OpenCode compaction／新 session；snapshot 至少含 spec §6.5 子集（目标与**明确下一动作**、已发布 refs、已否定 fingerprint、活跃 job/cursor、已用与剩余预算）。
- [ ] 新 session 可按 ref 回取原始输出；**摘要互引而无原始 observation 的链不得作为 verification evidence**。
- [ ] **重跑①②（及彼时已完成的轨迹）全部确定性回归**，确认开启 compaction 未破坏既有行为。
- [ ] 跑 M0/M1 gate、全量、typecheck、build，并用无外部模型的 OpenCode fixture 验证接线。

### T4-C：冻结并真实验收
- [ ] 按通则冻结并执行 **3 次独立正式 run，≥2/3**。
- [ ] 语义复核：三次均真实经过新 session 并回取原始输出，而非在同一上下文内连续完成。

---

## 7. 明确不做

- 不在本计划内推进真实 TSecBench／VPN／计时、多题调度、Docker（属 M2+）。
- 不新增 `listener.*`、callback 发布路径、多 Challenge Browser、noVNC（属 M5）。
- ③ 只加 `job.start/status/read(/watch)`，**不一并引入 PTY/TCP/channel**。
- 不扩充冻结资产（Reference、领域库、通用验证框架、度量）。
- 不为"六条轨迹通用化"预建抽象层；四条各自独立接线。
- 不重跑或改写①②已完成批次的成绩与身份。

---

## 8. M1b 完成条件（四条全部走完后）

- [ ] ⑤⑥③④ 各自 **3 次独立正式 run、≥2/3**，共新增 12 次正式结果。
- [ ] 连同①（3 次）与②（3 次），六条轨迹合计 **18 次**正式结果，历史批次各自保留、不混并。
- [ ] 每条轨迹的冻结清单、逐 run 证据包与语义复核记录完整落盘于 `docs/gates/`。
- [ ] `gate:m0`、`gate:m1`、全量测试、typecheck、build 全绿。
- [ ] 冻结资产未被扩充；退役框架未被重新导入。
- [ ] 遗留项移交：M1 的 **P5 充分性重评**（模型编造 flag 风险）随 M1b 收尾一并复核，或明确延至 M6。
