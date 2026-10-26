# design v1 C／E／H 详细 design：结果完整性与交接可见性

记录日期：2026-10-25（Asia/Tokyo）。

**状态：本文限定的工程修复已实作、独立 review 通过并接入主区；Root／后台来源、父上下文展示、同步关联和多通知消费已有无模型验收。原调试中报告缺失／截断与 Critic 决策问题尚未解决；七次恢复并非均无效，不能将工程方案定稿写成原问题全部修复。** 本文是[核心设计 v1](2026-10-22-ctf-agent-design-v1.md) C／E／H 的子文件。文件路径保留以兼容既有引用。

**当前进度补充（2026-10-26）：** 本文工程修复已随 `ee78e017` 提交，后续漏参补齐随 `b1afa29a` 收口。r4 已有真实运行观察：Root 最终消息完整并正常结束，但子角色仍出现 length／空正文，不能把本次 Root 完整外推为子任务恢复或 Critic 判断已解决。证据与尚未选定的生成／恢复策略见《空正文恢复子设计》（工作區未提交草案 `2026-10-26-design-v1-c-empty-result-recovery.md`）；该后续设计仅设计，本文原始目标及验收标准不变。

## 1. 目标与范围

这份设计来自 Throwback 调试中的空交接、截断报告及 Root 无正文却正常结束。当前工程目标是：可靠关联每轮结果，将缺失／截断事实交给正确父会话，并让用户区分运行结束、报告完整与解题成功。

| 范围 | 状态 |
| --- | --- |
| Root 最终报告关联、完整性与 host 摘要 | 已实现，见 §4.1 |
| 后台任务本轮来源与结果事实 | 已实现，见 §4.2 |
| 后台／同步结果事实进入父上下文 | 已实现并无模型验收，见 §5.2、§6 |
| 同步逐 call 关联、多条通知消费 | 已实现并无模型验收，见 §5.3、§6 |

**原始用户目标仍有缺口：** 子任务在截断前留下有效交接、Coordinator 区分补交失败与有进展的恢复、Root 产出有用的最终报告，以及 Critic 在语义停滞时作出适当判断。这些不能由“显示 incomplete”或确定性 provider 通过推导成立；本设计没有确定新的生成／恢复策略，也不把它们另排成验证计划。后续须根据实际行为证据判断，真实模型验证需另有明确预算授权。

本次不增加角色、Skill、result-ref 工具、自动补报告、output 上限调整或自动 Critic 调度，不改变 solved 标准。readiness 只保留原诊断纠正（§5.1），不建设新准入机制；压缩当前禁用，不列入本次实施与验证目标。

### 1.1 推进与验收边界

沿用用户确认的流程：先将本设计范围内的未知接口验证并回补，再统一编写剩余工程实作 plan；不再逐项验证后立即实作。已有 Root／后台实现保留，不重复开发。原型通过不能代替正式实现的同源验收；完成后回补本文及 README，已转入的验证 plan 删除，原始证据保留。

当前工程实作已覆盖原始空／截断样例和必要错误边界，无需继续拆 readiness、压缩或重复关联验证 plan。无模型验证只证明来源关联、事实可见及生命周期行为，不证明模型理解或解题效果；本轮没有真实模型、commit 或 push。

## 2. 问题依据与已知边界

来源为调试 run `throwback-debug-20261024-r2-1`（R），对话 `01a16d38-6063-7532-aeab-a9521de9d066`。R 使用 OpenCode 1.19.3，基线 `cfa950fd` 且 `productDirty=true`；完整配置、消耗与消息索引见[证据入口](../../gates/g-solver-verification-20261023/run-completeness-20261025/README.md)，不能只凭 HEAD 复原输入。

| 已核对的观察 | 支持的判断 |
| --- | --- |
| run completed，可信产物／验证／完成结果为空；Root 最后 assistant 为 length、无 text | 生命周期结束不等于报告完整或 solved；不能据历史 completed 消息判断最终报告 |
| 四个后台任务 completed／delivered，三个空交接、一个部分文字；对应子 assistant 均 finish=length | 已确认生成不完整，未证明完整报告在传输中丢失；增加结果引用或分段读取不能恢复未生成的正文 |
| 通知已出现在父消息，随后存在多次恢复；没有 progress.read 或 Critic 调用 | 原问题包含恢复效果，但不能写成父完全没收到通知 |
| 重建记录未达到既定“三次相同工具参数”阈值 | 只能排除这一条触发依据；角色还列了连续两次交接无新产物、交接缺口需换路等条件，不能据此解释 Critic 完全未介入 |
| 后续固定上游与镜像初始数据库同样包含空业务表 | 反证“空表即缺 seed”；不据新实例倒推历史 R 的全部状态或可解性 |

## 3. 方案取舍

- **使用 host 已知事实。** 身份与完整性由程序关联，保留原通知／同步输出；不要求模型手填来源，也不代写模型结论。
- **沿现有原生路径展示。** 仅依赖 progress.read 无法覆盖不调用它的父 Agent；另发 prompt 或新增读取工具会增加交付与调度契约，因此选随原生结果追加事实。
- **保留同步恢复的准确归属。** 原调试实际使用同步恢复，不能只修后台后宣称交接链路完整；但正确归属不保证恢复有效。
- **修复已复现的多通知漏消费。** 后续探针发现同轮两条通知只消费最后一条、其余 queued 导致 deadline。这是相关工程缺陷，不是已证实的原始 R 根因。
- **不继续围绕被反证的原因建设。** 历史配置 hash 已确认模型 output=8000，host 剩余额度远高于此值；固定版本接线符合配置与准入上界，不据此直接调整上限；不因空表新增 readiness gate，也不叠加重复提示；Critic 条件的必要澄清见 §5.4。

## 4. 已定契约与实现

报告完整性独立于生命周期。`complete` 只表示正常结束且有文字，不保证内容正确或 solved；`incomplete` 表示已知不完整；`unknown` 表示来源、终态或读取证据不足。textChars 使用 JavaScript 字符串 length，只统计 text，不包含 reasoning。未知情况下的默认计数不能单独解释为实测空报告，应结合 completeness／reason。

### 4.1 Root：关联最终报告后再收束

**来源与停止条件。** 按可信创建时间选唯一最新 user／assistant，并核对 parentID；相同毫秒但身份唯一可成立，多个候选或缺身份／时间则 unknown，不按数组顺序回退旧报告。连续两次 idle 的来源与终态事实必须一致；最新未完成、tool-calls 或关联不明时不自然收束，沿用预算／deadline。原 pending、execution 和 resource 防护保持有效。

**完整性与生命周期。** length／空白 stop 为 incomplete；已完成 stop、非空 text 且无 error 才 complete。未知 finish 在来源可靠且消息已完成时可结束生命周期，但报告为 unknown。真实 APIError 仍为 failed，历史真实 abort 不被后一个正常报告掩盖，因此 failed 与报告 complete 可以同时存在。CLI completed 仍返回0，其余沿用既有退出码。

**保存与展示。** `state/run.json.rootResult` 保存以下事实，progress 最终摘要复用同一计算结果：

- 来源：userMessageID、assistantMessageID、userCreated、assistantCreated、assistantCompleted。
- 结果：finish、completed、textChars、hasError、completeness、reason。
- 观测与证据：observedAt、exportedSourceMatches、evidence。

无法确定的引用／时间／finish 为 null。host 只展示生命周期、完整性、可信产物状态及证据位置，不代写模型结论。

**清理与导出边界。** 仅当停止前没有真实 error，且导出的清理 abort 属于同一冻结 assistant 时，才保留清理前结论；原始审计与错误记录不改写。预算已开始清理时只用先前观测，没有先前观测则 unknown/snapshot_unavailable；证据导出失败为 unknown/export_unavailable，不给不存在的证据链接。

SDK 读取和导出非原子，exportedSourceMatches 只说明导出是否匹配冻结观测，不能证明没有更晚消息。既有“progress 先写、后续证据保存失败再改变 run 状态”的时序限制仍在，本片未重构整个证据系统。

实现位于 `apps/launcher/src/root-result.ts`、`launch.ts`、`progress-ledger.ts`，回归位于 `tests/contract/launch-evidence.test.ts`。提交 `7f0ad97b` 包含经明确授权的 progress-ledger 底座及控制服务审计字段／回调依赖，不包含 progress 工具、插件或角色改动。

### 4.2 后台子任务：冻结该次执行的来源

**可信绑定。** 先由现有 SDK parent/role 与原生 task call→child metadata 完成 binding，再在串行状态边界选择唯一未 delivered 的 starting/running 后台 execution，核对 parent／role，冻结 chat.message 的 user ID。model.call 中的 ID 在验证样本中也是 user，只作交叉佐证。resume 的 binding.dispatchCallID 仍可能是首轮值，必须使用当前 execution 的 callID/ref。

**冲突与幂等。** 同一 user ID 重复 hook 幂等；不同 user、多个活动候选或绑定身份矛盾进入持久 conflict，后续重复 hook 不恢复旧有效映射。无活动后台 execution 的同步恢复不认领旧 ref，不新增同步记录。执行快照深拷贝新增嵌套事实，避免调用者改写内部状态。

**通知与读取。** 按原 ref／parent／child 校验并接收一次包络，标记 delivered 后在串行锁外读取该 child 的公开 SDK messages 一次。返回后串行重查来源、停止、撤销与有效期；停止／撤销／过期则 suppressed，并拒绝本次父 hook 放行。普通 task.stop 对自然完成任务的既有语义不变。重复／过期 notice 不重复读取或交付，晚到旧 ref 只属于旧轮。

**结果归属。** 只选冻结 user 及 parentID 对应的 assistant；对相关 ID 回查 SDK 全部返回记录，同 ID 跨 parent／role／session 或事实矛盾为 unknown，完全相同重复可幂等。缺来源、多个 assistant、未完成、未知 finish、SDK 失败／缺失均为 unknown；已完成 length、空白 stop 或含 error 为 incomplete；已完成 stop、非空 text 且无 error 才 complete。无轮询、补叫、后轮覆盖或重复外部副作用。

**保存位置。** `evidence/task-executions.json` 增加以下字段，并通过 `task.source`／`task.result` 审计记录同一份事实：

| 字段 | 内容 |
| --- | --- |
| source | status（unknown／associated／conflict）、userMessageID、observedAt、reason |
| resultFacts | 处理前为 null；处理后为 userMessageID、assistantMessageID、finish、completed、textChars、hasError、completeness、reason、observedAt |

新元数据不保存正文、reasoning 或 error payload；既有原始通知包络仍保留，不能称整个 execution 导出都没有正文。state／delivered／delivery 的原语义不变。身份冻结不等于原子最终结果快照，也不等于新增事实已送入父上下文。

实现位于 `apps/launcher/src/control-service.ts`、`child-result.ts`，回归位于 `tests/contract/g-async-lifecycle.test.ts`，提交 `a6d9390b`。未修改 plugin、角色、Skill、Root 或 progress 展示。

## 5. 当前契约与适用边界

### 5.1 Readiness：原诊断纠正，不新增产品机制

固定 NYU CTF Bench 提交 `4c5744f55a31a58e03d6118c9dbb1c18e5bbdfa9` 的 Throwback 自带初始数据库，其 challenges／keys／files／solves 为空；本地材料和指定镜像中的直接运行文件与初始 DB 已核对一致。上游默认准备方式不要求 `populate.py`，两次隔离默认启动及一次重启的应用检查通过。此前“缺少额外 seed”的推断不再作为修复依据。

这些证据只支持固定版本的部署与初始状态一致，不证明历史 R 可解、judge 可用或 solved。当前 `prepareRun` 仍只有 TCP／材料检查；不新增 readiness schema、registry、自动 guard 或专门验收流程。未来实际调试仍应检查当次目标与应用状态，不能将旧准备记录当作当前就绪证明。版本、hash、检查过程及失败保留在[准备核对证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/design-finalization/throwback-readiness/README.md)，不再作为本设计的产品接口展开。

### 5.2 父上下文展示与 Critic 边界

后台 source/resultFacts 现随原生完成通知追加到父上下文，并保留执行记录与审计。ControlService 仅返回本次接受的 notice refs 的白名单事实，末次串行检查 parent、noticeMessageID、queued、child 有效性及停止状态。plugin 在同一消息追加完整 synthetic text Part，程序生成 part ID 并绑定 sessionID/messageID，保留原包络与正文。普通消息不能凭 messageID 读取历史 facts。

展示字段为 `ref`、`role`、`completeness`、`reason`、`finish`、`textChars`、`source`；unknown 的 textChars 为 null，不从默认 0 推断空报告。同步结果沿本次原生 tool.after 输出追加相同语义事实，以 callID 取代 ref，保留原输出与等待语义。每个 notice/call 只追加一次，后续上下文自然保留历史不算重复注入。

事实说明“执行结束不代表报告完整，complete 不代表正确或 solved”，不自动要求续跑或调用 Critic。复核纠正：既有 Critic 触发规则不只有“三次相同参数”，还包括“连续两次交接没有新 artifact／package／verification”及“交接缺口需要换路”。此前仅重建重复参数计数不足以排除其他触发条件。无新产物不等于无新知识，尤其 Strategy／Reference 可以只交文字；需要按原记录逐边界区分事实可见、条件满足与实际调用。权限存在不能证明模型遵循规则。本方案只补信息可见性，不承诺模型理解、有效恢复或 Critic 实际决策。

**验收：** 实际 launcher/plugin/ControlService 与固定 OpenCode 的本地确定性 provider 请求中，原结果及 host 事实须同时存在，ref/call、角色与完整性须和同源记录一致；仅 hook 返回、审计或消息保存不算到达请求。覆盖同 child 两轮 empty/partial length→stop、unknown 与重复／错身份／停止拒绝边界；旧轮不得改写，unknown 不冒充空报告。SDK 替身只证明相应分支，不冒充真实传输故障。

正式实现已核对实际父请求与持久化来源；缺 Part 身份字段的初版失败仍作为历史证据保留。host 检查与 plugin 保存之间仍非原子。早期证据见[父展示验证](../../gates/g-solver-verification-20261023/run-completeness-20261025/parent-display/README.md)与 §6 联合验证。

### 5.3 同步关联与多通知消费

**后续调用政策（2026-10-25，收窄）：** [第一优先级子设计](2026-10-25-design-v1-sync-resume-provenance.md)仅要求创建时保存 background、续接漏写时补上，细节以该文件为准；显式值保留，不新增模式锁定或报错永久禁用。本节既有同步来源／展示规则不变；promotion、错误和停止改造移出本次。旧强制后台补丁已撤回，最小补参代码及无模型验收已完成并合回主区。

**同步来源。** 在可信 dispatch 后以 `(parentSessionID, callID)` 区分每轮，可信 binding 后由 chat.message 冻结唯一 user，再按 assistant.parentID 分类。不得复用首轮 dispatchCallID、最新消息或旧后台 ref；同步不创建后台 execution/ref。同 call/user 幂等，不同 user 或多个活动候选持久 conflict/unknown；同 call 改参数拒绝，终态 call 不再派发。

SDK 读取前核对 parent/child、来源与有效性，读取后重查停止及当前记录；不能筛掉未完成或身份矛盾的 assistant 来制造唯一结果。原生 task.error 结束对应同步 call，并只释放该 call 的 pending；重复旧 error 不得清理新 call。after 缺失不回退旧报告。新增审计只保存来源／结果白名单事实，不保存正文、reasoning 或 error payload。

**多通知消费。** 从公开 `experimental.chat.messages.transform` 保存逐 session、匹配当前 user 的一次性上下文快照，提取 synthetic、未 ignored 的 completed／failed 通知；chat.params 取出即删除。host 仅在准入成功后，消费同 parent、已 queued 且 noticeMessageID 确在集合中的记录，逐 ref 记录 noticeID/admitNo；不清空全部 queued，不借 SDK 全历史冒充本轮输入。

consumed 表示可信通知出现在本轮获准上下文，不代表网络 ACK 或模型理解。实际父请求的展示另按 §5.2 验收。保留 starting/running、pending、resource 与预算／停止防护，不能因消费通知而提前收束。

**验收：** 正式实现统一覆盖后台 empty/partial 后同步 stop、纯同步 empty/partial、双后台通知与同步等待共存、后台失败通知；核对原输出保留、每轮唯一归属、每身份一次展示、逐 notice 消费和未提前结束。必要负例覆盖身份冲突、SDK 错误、await 期间停止、改参／重放、错误释放 pending。正式实现已按最终运行源码完成上述六案验收；必要负例由既有测试覆盖，不另开可行性计划。

### 5.4 历史原因复核与最小行为修正

**单次输出上限来源已确定。** 原 profile 引用的模型配置为 `limit.output=8000`，按 launcher 合并规则重建配置的 hash 与原 run 完全一致；host 全程单次准入上界仍为 4,451,538–5,000,000。多条 length 消息的 output＋reasoning 恰为 8000，Root 最后为 0＋8000。因此问题与单次额度触顶一致，不是总预算耗尽。原 HTTP 参数未留存，不能声称已验证 provider 实际请求／内部策略；现有证据也不能决定应调到哪个值。

**七次恢复不是七次无效重试。** 按发生顺序：Recon 补交有正文；Solver 补交有正文；Solver 第二轮为新实验；Strategy 首次补交为空（stop，不是 length）；Strategy 再补交有正文；Reference 补交有正文但仍 length；Solver 第三轮为新实验。五次补交中四次返回正文，正文不等于正确／完整。Recon 同一恢复 user 下存在多个 assistant，仍须按既有规则保留 unknown；不得为了显示成功而改成取最后一条。

原补交 prompt 已明确要求总结已有信息、不重做实验；新增同义提示没有独立修复依据。父保存输出和下一步 prompt 可支持其看到了空／截断和部分已恢复结论；缺少原请求快照，不把保存消息等同每轮完整送达。Critic 全程未调用，故没有 Critic 自身判断记录。Coordinator 的 seq807 已记录 redirect 和被否定路线；未调用不能归因于完全缺少信号或未发现问题。

**本次已实现的最小范围：** §5.2–§5.3 的工程接线，以及 Coordinator 现有 Critic 条件澄清：阶段交回是评估时点，无 artifact 不能代替无新信息，持续交接失败或已有路线需换路时应明确评估 Critic。保留 Critic 提建议、Coordinator 作最终决策，不新建自动调度／重复计数／强制调用机制。此前仅凭相同参数计数排除触发依据的判断作废；该文字修正仍不能保证模型遵循。

不新增统一恢复次数限制、不提高同步发布权限、不自动补叫 Root。8000 上限不在本次工程修复中直接调高：先保留配置来源证据，后续若验证调整须固定其他输入并有明确模型预算，评估报告完整性与成本／时延，不能仅看正文长度。Strategy 的空 stop 是独立反例，不能把所有空报告归于输出限额。

关联与展示用既有无模型验收即可；角色规则只做一致性检查，不冒称行为通过。后续有预算的行为验证应覆盖无 artifact 但有新信息、连续补交失败、已否定路线需换路三类场景，检查误触发／漏触发、有效报告和消耗；不新增验证 plan 或通用 gate。逐次来源、观察和限制见[追加复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/critic/report.md)。

## 6. 证据与完成声明

2026-10-25 原生探针固定 OpenCode **1.19.3**，使用实际产品链路或明确标注的隔离原型、本地确定性 provider、隔离 HOME/XDG 与 loopback-only 策略。源码版本、dirty 输入 hash、失败和独立复核均在下列既有记录中；不同批次不得拼成同源验收，测试数量不能相加。

| 对象 | 当前结论与证据 |
| --- | --- |
| 原始失败与 output 接线 | [Root 初查](../../gates/g-solver-verification-20261023/run-completeness-20261025/root/report.md)、[Critic 核对](../../gates/g-solver-verification-20261023/run-completeness-20261025/critic/report.md)；未证实传输丢失或上限接线错误；8000 配置来源已匹配历史 hash，Critic 多条件判断已纠正 |
| 已实现基线 | [Root 实现与复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/implementation/README.md)、[后台实现](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-implementation/report.md)及[复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-implementation/review.md)；已接入并有无模型验收 |
| 当前工程实现 | [父展示](../../gates/g-solver-verification-20261023/run-completeness-20261025/parent-display/README.md)、[联合报告](../../gates/g-solver-verification-20261023/run-completeness-20261025/design-finalization/joint-display/report.md)及[复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/design-finalization/joint-display/review.md)；早期原型供追溯；正式实现及独立 review 见[实施证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/README.md)，最终同源六案通过并接入主区 |
| 环境误判纠正 | [固定上游与准备核对](../../gates/g-solver-verification-20261023/run-completeness-20261025/design-finalization/throwback-readiness/README.md)；不构成新 readiness 功能 |

本轮交付完成本设计范围内的关联、展示、消费修复及 Coordinator 条件澄清。有效交接内容、避免无效恢复、最终报告质量与 Critic 决策仍按 §1 明示未解决；本地替身不能证明这些行为。自然竞态、所有 adapter 及启用压缩后的兼容性也未完成验收，不扩成当前新增任务。

实施中补齐了同 call 改参／终态重放、SDK 后身份重查、同步错误只释放本 call、active 同步阻止提前收束、缺快照不消费和空 prepared 分支。独立 review 无阻断；其要求的同 child 连续两次同步来源回归已补足。主区接入后 typecheck／build 及全套 49 文件、482 测试通过；主区与原生验收运行时代码 hash 一致，六案投影重放通过。正式六案使用 OpenCode 1.19.3 与本地确定性 provider，env-i／独立 HOME/XDG、外连 EPERM；部分／空报告、failed 通知及同步等待都在实际父请求中核对。实现、失败日志、版本与源码 hash 见[实施证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/README.md)。

历史探索、失败及细分验证留在原证据目录，正文不再重复执行日记；历史报告中的旧范围与章节号不作为当前待办或权威契约。
