# M1 Solver Loop —— Detailed Plan（重定范围：在 OpenCode 上跑通轨迹①）

> ## 范围已于 2026-10-19 调整
>
> **M1 = 在 OpenCode 底座上，让轨迹①（脚本报错 → 读 raw stderr → 局部修复 → 重跑成功 → oracle accepted）端到端通过 2/3。**
> 轨迹②–⑥ 及其配套能力移至 **M1b**。这是一次**明确的里程碑边界调整**——六条轨迹、2/3、checkpoint、partial、独立验证本来就是原始 M1 范围（原估 20–31 人天），不是后加的。
>
> ## 当前状态（2026-10-19）
>
> | 项 | 状态 |
> | --- | --- |
> | **轨迹①模型能力** | ✅ **已证明**。v8-3 完整走通：模型读 raw stderr → 局部修复 → 重跑成功 → 独立 replay → oracle accepted |
> | **轨迹①正式验收** | ✅ **新 OpenCode + 百炼 b2 批次 3/3**；三次均独立 replay + oracle accepted。旧批次正式 1 次失败/累计 12 次原样保留、不混并 |
> | 停止规则 | ✅ 旧批次第 13 次仍被拒绝；2026-10-19 用户明确恢复百炼标准 API 验收，新 OpenCode 批次 b2 独立冻结、上限 12，本次仅授权 3 次 |
> | 黄金路径 gate | ✅ 已迁移到**实际 OpenCode session + 本机确定性 provider**，`gate:m1` 3/3；另有两种合法修法及缺证据链反向判分 |
> | **底座** | ✅ **产品 solve 已接回 OpenCode**；T-A 工程与真实模型集成均已验证，三次 canonical session 证据见 T-D |
> | 回归 | ✅ `gate:m0` 171 项、完整测试 299 项、typecheck/build 全过；实际 TCP/PTY 环境下复跑通过 |
>
> ## 执行清单（按序）
>
> 1. [x] **T-A 恢复 OpenCode 底座** —— 工程接线、实际 OpenCode 确定性集成及 T-D 三次真实模型验收均通过。
> 2. [x] **T-B 收敛到最小面**，并修正过度特化的判分器。
> 3. [x] **T-C 黄金路径测试迁移到 OpenCode 路径**上重新通过。
> 4. [x] **T-D 在 OpenCode 路径上重跑轨迹①正式验收，3 次 ≥2 次。** 新 b2 批次 3/3，全部结果留存；本次三次授权已用完，停止外部调用。
>
> **当前交付状态：M1 轨迹①功能验收通过。** 预算保持正式验收配置并定稿；证据见 [T-D results](../../gates/m1-opencode-t1-bailian-20261019-b2/results.md)。代码提交仍待明确授权，不自动 commit/push，不启动 M1b。
>
> **本轮复核：** 冻结文件身份、三次 canonical 行为与预算/材料绑定、证据包完整性均重新核对通过；未发现超出本 M1 切片的新增能力。完成项已勾选；当前唯一未完成的 M1 交付动作是将删除与替代一起提交，需明确 commit 授权。下方后续里程碑风险不是本 M1 待办。
>
> 历史复盘（四轮）已移出至 [`history/2026-10-19-m1-retrospectives.md`](history/2026-10-19-m1-retrospectives.md)。本文件只保留**范围、下一步、完成条件**。

**2026-10-19 推进证据：** [OpenCode integration results](../../gates/m1-opencode-integration-results.md) 与 [T-D 正式结果](../../gates/m1-opencode-t1-bailian-20261019-b2/results.md)。执行顺序为 T-A 工程接线 → T-B/T-C → T-D 真模型验收，不把确定性 provider 当作模型能力验收。旧批次 12 次记录不变；用户恢复授权后，新 b2 百炼标准 API 批次 3/3 通过，精确余额不可查询。配置/预算、完整证据均落盘，见 [当前输入](../../gates/m1-inputs.md) 和 [manifest](../../gates/m1-opencode-t1-bailian-20261019-b2/manifest.json)。

**上游：** [M0](2026-10-17-m0-host-foundation-plan.md)（历史 T8 产品集成缺口已由本 M1 T-A/T-D 补证；不改写原 M0 冒烟记录）· **路线图：** [roadmap](2026-10-16-ctf-agent-mvp-roadmap.md) · **权威设计：** [spec](../specs/2026-10-14-general-ctf-agent-system-design.md) · **结果记录：** [m1-results.md](../../gates/m1-results.md)

---

## 为什么先恢复 OpenCode（切换前诊断）

spec line 29：*「系統復用 OpenCode 的模型、會話、工具調用和 Agent 內循環，**不另造通用 Agent framework**。本專案增加薄的產品控制層。」*

2026-10-19 切换前核查发现 **M0 与 M1 两条 solve 路径都绕过了 OpenCode**：

```
apps/cli/src/commands/solveM1.ts  → 不 import @ctf/opencode-bridge
ProviderSolverDriver              → 直接 fetch provider 的 v1/messages
@ctf/opencode-bridge              → 除 opencode-plugin 自身外零消费者
apps/cli/src/commands/solve.ts    → 对 opencode 的引用数 0
```

M0 T8 的契约测试全部跑在 **stub provider** 上，**从未验证产品 solve 路径真的经过 OpenCode**，却据此标了 DONE/COMPLETE——这是「组件完成 ≠ 集成完成」在本项目最重要的一次发作。

**连带后果：** 自建循环就必须自建「模型每轮回一个 JSON 动作」的协议，于是产生 dispatch / hypothesis / experiment / step 配对 / fingerprint 这整套**解题流程仪式**；前八次校准约六次死在这套仪式上。**恢复 OpenCode 后这套协议大部分可退役**——模型直接调工具，host 从工具调用流**推导**假设/实验记录，而不是要求模型**声明**。

### 这次切换会丢什么、留什么

| | |
| --- | --- |
| **留下（最有价值的部分）** | **v8-3 已经证明模型有能力完成轨迹①行为**。这是能力证据，与底座无关，**完整保留**——它把 T-D 的风险从「模型行不行」降为「集成对不对」 |
| **留下** | fixture、oracle、黄金路径判分逻辑、预置起跑点思路、停止规则、冻结/留存纪律 |
| **要重做** | solve 路径的模型调用与工具循环接线；自建 SolverAction 协议退役；轨迹①须在新路径上**重新**取得正式 2/3 |

> **attempt 计数：** 底座切换属于**冻结配置变更**，按既有规则「冻结配置变更即建立新验收批次，旧批次不混并」——T-D 在 OpenCode 路径上**开新批次重新计数**。这是规则允许的，不是静默重置；旧批次 12 次 attempt 的记录与证据**原样保留**在 results 中。

---

## 代码退役清单（Task A 的一部分，必须先做）

**工程状态：** 下述旧生产文件已删除；旧 loop/driver 的冻结快照仅保留于 `tests/legacy/`，不导出、不进入 build、不供 CLI 选择。共享候选控制类型已抽到 `candidate-control.ts`，当前薄控制在 `openCodeTask.ts`。生产目录检索两个退役符号为零。尚未获 commit 授权，因此下方含「同一提交」的条目不提前勾选。

> ⚠️ **这是防止「跟着错误代码继续写」的关键。** 目前仓库里最大、测试最全、看起来最像「参照实现」的那几个文件，恰恰是要被废弃的那条路。不先标死，后续执行者（人或 agent）会自然地去扩展它们。

### 🔴 退役——不要扩展、不要参照、Task A 完成后删除

| 文件 | 行数 | 为什么 |
| --- | --- | --- |
| `packages/supervisor/src/provider-solver-driver.ts` | 287 | 直连 provider 的 `v1/messages`，**就是绕过 OpenCode 的元凶** |
| `packages/supervisor/src/solver-loop.ts` 的**模型循环与协议部分** | 834 中的大部分 | 自建的 Agent 内循环 + `SolverActionSchema`（L65）/`DispatchSchema`/Tool/Conclude/Candidate/Stop 动作协议。违反 spec line 29 |
| `apps/cli/src/commands/m1ContractProbe.ts` | 127 | 只为上面那套自建 JSON 动作契约服务；契约退役后无意义 |
| `docs/gates/m1-t1-acceptance.py` | 264 | 过度特化（见 Task B），必须按行为结果判定**重写**，不要在它上面改 |

- [x] 已确认旧生产路径的当前所需功能由 OpenCode 路径覆盖：T-A/T-B/T-C 组件/集成验证与 T-D 三次真实模型证据齐全；其余旧能力明确冻结，不继续接入。
- [ ] 删除与替代在**同一个提交**里完成，避免中间态被当成参照。当前删除、替代与证据都仍在同一工作区，提交待用户明确授权。
- [x] 删除后 `grep -r "SolverActionSchema\|ProviderSolverDriver"` 应无生产代码命中。

### 🟡 保留但改造

| 文件 | 处置 |
| --- | --- |
| `packages/supervisor/src/solver-loop.ts` 的**薄控制层部分**（约 61 行涉及 deadline / budget / AbortSignal / checkpoint） | **抽出来保留**。这些是 spec 允许的薄控制层职责，不随循环一起废弃 |
| `apps/cli/src/commands/solveM1.ts`（239） | 入口保留，内部改为经 OpenCode；去掉自建循环的装配 |
| `apps/cli/src/commands/localJobCandidateResolver.ts` | **轨迹①在用**，保留并做可靠 |
| `apps/cli/src/commands/localHttpCandidateResolver.ts`（118） | 只服务受限 HTTP literal 路径，轨迹①不用。**冻结**，不扩展 |

### 🟢 已接入（切换前零消费者，当前产品实际消费）

- [x] `packages/opencode-bridge/**` —— 产品 solve 已实际消费；由真实 OpenCode session、插件、loopback RPC 与 Runtime 集成测试证明。

### ⚪ 冻结不动（见下节）

`domain-web/misc/crypto`、`candidate-verification.ts`、`hypotheses.ts` 的「要求模型声明」部分、T11 度量等——**不删除、不扩展**。
`hypotheses.ts` 的**数据模型**在新架构下仍有用（host 从工具调用流推导后写入），但**不得再要求模型声明**这些结构。

---

## 现有资产：保留，但暂停扩充

以下已实现且测试通过，**不删除、不继续加功能**，等真实题目暴露需求时再按需接入：

| 资产 | 处置 |
| --- | --- |
| T5 领域方法库（gzip/ZIP 展开、PNG/PCAP 结构检查、转换来源图、Crypto provenance、数学后端探测） | **冻结**。轨迹①只需修一条本地 Node 脚本 |
| T9 通用验证框架（三模式、可信回执、generation、持久修复状态） | **冻结**。只把**正在用的那条 local replay** 做可靠即可 |
| T11 度量投影 | **冻结**。轨迹①所需的最小用量/耗时随 T-D 产出即可 |
| T6 交互工具面、T7 durable watch、T8 快照、T10 多 flag | **保留待用**，M1b 对应轨迹启动时再接线验收 |
| T4 Reference Service | 保留；轨迹①不依赖 |

> **原则：** 每条轨迹**只补它自己暴露的缺口**。不再「先建通用元件、再补模型可用的接线」。

---

## Task A：恢复 OpenCode 作为模型/会话/工具循环底座

**Files：** `apps/cli/src/commands/solve*.ts`、`packages/opencode-bridge/src/**`、`apps/opencode-plugin/src/index.ts`、`packages/supervisor/src/**`

**实现步骤**
- [x] 产品 solve 路径改为经 OpenCode：模型调用、消息循环、session、Agent 内循环由 OpenCode 负责；本项目只保留**薄控制层**（run/challenge/task 绑定、scope、deadline/预算、canonical state、候选与结果）。
- [x] 插件只暴露 allowlist 内受管工具，把 `ToolContext.sessionID` 交给 Bridge；**不接受模型自报身份**（spec §4.4）。
- [x] 不可变 session 绑定 `session_id → run/challenge/task/responsibility_set/lease`；未绑定 session 不可调 CTF 工具。
- [x] **退役自建 JSON 动作协议**：`ProviderSolverDriver` 的逐步 SolverAction 路径停用；dispatch / hypothesis / experiment / step / fingerprint 不再要求模型声明，改由 host 从**工具调用流**推导后写入 canonical state。
- [x] 模型配置（provider、model ID、参数）统一来自 OpenCode 配置。
- [x] 已用公开 plugin/SDK/server 接口完成当前切片；未维护 fork，缺 hook 必须返回设计 blocker（spec §4.4）。

**验收能力（必须证明是集成，不是组件）**
- [x] 产品 CLI 的一次真实 solve，canonical 证据链显示模型调用**经过 OpenCode session**（非直连 provider）；b2 三次真实百炼 solve 均通过，`@ctf/opencode-bridge` 为实际消费者。
- [x] 在 OpenCode 侧更换模型配置后，**无需改本仓库代码**，该 solve 路径即使用新模型。（实际 OpenCode 请求切换到另一 fixture model ID；不证明外部模型可用性。）
- [x] 未绑定 / 伪造 run/task/lease 的 session 调 CTF 工具被拒绝；allowlist 外工具不暴露。（不可变绑定/Bridge 拒绝测试 + 实际 OpenCode unmanaged shell 拒绝。）
- [x] 模型无需在动作里书写任何 ID、hash、ref、预算或步骤号；canonical state 的假设/实验记录由 host 推导生成。
- [x] `gate:m0` 保持全绿，且 T8 的产品路由断言已加入**实际 OpenCode 二进制集成测试**；旧 StubProvider/空 server factory 的通过声明已移除。

---

## Task B：收敛到最小面，并修正判分器

**实现步骤**
- [x] 保留并确保可靠：workspace 读/搜/patch、`job.run`（batch）与**完整 raw stderr 回灌**、基础 deadline/预算、候选登记与本地 oracle 判定、canonical state 与 artifact 落盘。
- [x] 维持已实现的「拒绝即回灌、不终止 run」默认（终止白名单仅 `resource_exhausted` 等少数项）。
- [x] **修正过度特化的判分器**（见下）。
- [x] 其余 Runtime/领域/验证资产及回归保持可用，但不接入当前 OpenCode 工具 manifest；旧 HTTP direct-provider CLI 路线明确冻结。

### 判分口径：**按行为结果判定，不规定怎么改**

> 以下是**已退役旧判分器**的问题；新判分器已按上方工程证据重写。旧 `docs/gates/m1-t1-acceptance.py` 要求**恰好一次 patch、修复后刚好多一个 byte、且必须是指定的括号替换**：
> ```python
> len(patches) == 1 and len(after) == len(before) + 1
> and after == before.replace(b".toString('utf8');", b".toString('utf8'));")
> ```
> 这是在判「是否产出指定字节串」，会**拒绝同样正确的其他修法**。必须改掉。

| 项 | 判据 |
| --- | --- |
| **成功** | 修复后 `job.run` 退出码 `0`，且 stdout 产出 **oracle 认可**的 flag |
| **必经证据链** | canonical events 存在：失败 `job.run`（非零 + stderr artifact）→ 模型**读取该 stderr** → `workspace.patch` → 再次 `job.run` 成功 |
| **「局部」** | 不替换整个文件、不换 task、不绕开 stderr 直接改写。**不限定 patch 次数、不限定字节增减、不限定具体改法** |
| **不通过** | 缺证据链任一环；整段重写；未经失败执行就修复；凭空提交候选 |

**验收能力**
- [x] 一次失败的 `job.run` 产生**完整 stderr artifact** 并原样回灌模型（不是摘要）。
- [x] 判分器对「同样正确但改法不同」的修复**判通过**（至少 2 种合法修法，含两次 patch）。
- [x] 判分器对缺证据链、整段重写、凭空候选**判失败**（反向测试）。

---

## Task C：黄金路径测试迁移到 OpenCode 路径

**实现步骤**
- [x] 现有 `gate:m1` 黄金路径（确定性完美 provider 端到端走完轨迹①）**在实际 OpenCode 路径上重新实现并通过**。
- [x] 保留并测试预置起跑点能力：harness 预置**止于第一次失败执行**；其后读 stderr／定位／修复／重跑由 provider 经 OpenCode 完成，产品 harness 不提示错误位置或给出修复内容。T-D 使用预置前仍须在新批次 `m1-inputs.md` 记录范围，三次运行保持一致。

**验收能力**
- [x] 确定性完美 provider 经实际 OpenCode 可走完全程并被判通过；不充当真实模型能力证据。
- [x] 故意破坏任一环节（跳过失败执行、不读 stderr、整段重写）时判分**拒绝**。
- [x] **T-C 不通过就不得发起真实模型 run。** 当前已通过；2026-10-19 用户已明确恢复百炼标准 API 外部验收。

---

## Task D：轨迹① 正式验收（OpenCode 路径，新批次）

**实现步骤**
- [x] 冻结新批次配置写入 `docs/gates/m1-inputs.md`：OpenCode 配置版本、model ID、参数、工具 manifest、Reference snapshot、fixture SHA-256、每次预算、预置范围。新批次 `m1-opencode-t1-bailian-20261019-b2`，158 个执行文件及 runtime hash；旧批次记录不变。
- [x] **独立运行 3 次**：三份全新 workspace、run/challenge/session，固定 dirty 源码以 hash 为身份；不以同 conversation 重试冒充独立 run。三次全部留存，包括原始 stderr/SQLite/artifacts 和 docs/gates 证据包。
- [x] 判分从 canonical events / artifacts / oracle 权威状态重算，不采信模型自述；三次 11 项行为检查及冻结绑定均通过。
- [x] **先确认执行环境网络可达**：百炼 models 认证 HTTP 200；实际 OpenCode 小额推理返回 417 输入 + 256 思考 tokens。探针未回标记（输出上限），原结果与可用性 assessment 全保留；精确剩余额度 unavailable。

**停止规则（沿用，已证明有效）**
- [x] 新批次绝对上限 **12 次**，超过则停止、升级重评，不静默重试/重置/扩限。当前 3/12，已达 3/3；本次仅三次授权，实际第四次入口已拒绝且未创建 attempt。12/13 拒绝另有确定性测试；旧批次入口仍拒绝。

**验收能力**
- [x] 轨迹① **3 次中 ≥2 次**通过判分口径：b2 实测 **3/3**。
- [x] 3 次结果完整留存可审计；正式均有 observed provider usage，合计 57,632 tokens；另有标记未通过的小额预检 673 tokens 单列。剩余额度 unavailable，不以 0 冒充实际用量/费用。
- [x] `gate:m0` 171 tests 与 `gate:m1` 3/3 全绿；完整测试 299 全过。
- [x] 用真实用量定稿轨迹①预算：沿用已验收 release profile `config/release-profile.m1-td-bailian-20261019.json` 的 600,000ms / 40 steps / 20 jobs / 100,000 observable tokens，不倒改冻结配置。实测最大 21 steps / 4 jobs / 21,227 tokens；不是全局预算或收费保证。

---

## 已知风险（带入 M1b / M2 / M6）

以下不是尚未完成的 M1 功能项，不据此扩展本轮范围：

- [ ] **后续重评 P5 充分性（M1b/M6）。** 校准 run 6 在**无任何成功 experiment** 的情况下提交了 `flag{local_repair}`（host 正确拒绝）。这与 T0a 探针 P5「不虚报成功 5/5」矛盾，说明 P5 场景过于简单。当前 M1 已有真实成功输出绑定和凭空候选拒绝测试；不宣称消除了模型编造风险。
- [x] **本 M1 的基础设施预检已执行。** 新批次前已完成网络、凭证、实际模型可用性及确定性 gate 检查；先前基础设施失败的 attempt 不回收。残留风险是运行中额度/网络仍可能变化，精确余额 unavailable；后续里程碑仍须自行预检。

---

## M1 完成检查单

- [x] T-A：产品 solve 路径确实经过 OpenCode；在 OpenCode 改模型即生效；M0 T8 的 stub 断言已改为集成断言；T-D 三次真实模型 solve 已补证。
- [x] T-B：raw stderr 完整回灌；判分器已改为行为结果判定，对不同的合法改法都判通过。
- [x] T-C：黄金路径在实际 OpenCode 路径上进 `gate:m1` 并全绿。
- [x] T-D：轨迹① 新批次 **3/3** 通过，结果及 canonical 证据全留存，预算保持已验收配置并定稿。
- [x] 冻结资产未被继续扩充（T5 领域库、T9 通用验证、T11 度量）；共享类型引用仅作退役路径的机械迁移。
- [x] 范围未越界：轨迹②–⑥、真实 TSecBench/VPN、多题调度、Docker 均属 M1b/M2+。
- [x] 当前 M1 代码、范围及验收证据复核完成；M0/M1 gate、完整测试、typecheck/build 通过，结果与完整证据落盘。
- [ ] 将本 M1 的删除、替代、验证与证据一起提交，不长期悬空。**尚未获明确 commit 授权，不自动 commit/push**；不能因功能验收通过而提前勾选。
