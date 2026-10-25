# design v1 C／E／H 详细 design：本地调试、环境就绪与会话结果完整性

记录日期：2026-10-25（Asia/Tokyo）。

**状态：Root 最终报告与子任务后台关联已实现并通过无模型验收；readiness、父上下文中的完整性展示及并发通知收束仍有缺口。** 本文是 [核心设计 v1](2026-10-22-ctf-agent-design-v1.md) C／E／H 的子文件。当前契约见 §4，未决问题见 §5，验证条件与证据见 §6；历史执行报告不作为当前待办清单。

## 1. 目标与范围

让用户与父 Agent 能区分运行结束、报告完整和解题成功；在需要 seed 的本地练习中，明确题目是否具备可信准备证据，避免在未知环境上继续消耗预算。

| 能力 | 当前状态 | 阅读位置 |
| --- | --- | --- |
| Root 最终报告完整性与摘要 | 已实现；生命周期与报告完整性分别记录 | §4.1 |
| 后台 execution 与源消息关联 | 已实现；完整性事实进入执行记录及审计 | §4.2 |
| 向父上下文展示新增完整性事实 | 尚未接入；审计可读不等于父模型已收到或理解 | §5.2 |
| 本地题目 readiness | unknown；准备来源和检查判据未定，代码尚无相应准入 guard | §5.1 |
| 同步恢复关联、并发通知收束 | 不在已交付范围；不能借后台单 child 验收宣称解决 | §5.3 |

不改变独立验证、可信完成或 solved 标准；不增加角色、Skill、result-ref 工具或求解循环。自动补报告、扩大 output 上限和自动 Critic 调度均不属于本设计已选方案。授权与真实模型预算沿用 AGENTS.md，不由本文状态推导。

## 2. 问题依据与已知边界

问题来自 throwback 调试 run `throwback-debug-20261024-r2-1`（下称 R），来源对话 `01a16d38-6063-7532-aeab-a9521de9d066`。R 使用 OpenCode 1.19.3、`volcano-coding/deepseek-v4-1-flash-261017`，基线 `cfa950fd` 且 `productDirty=true`；104 次准入，reported tokens 合计 561088。该历史消耗与配置不是新运行授权，也不能仅凭 HEAD 复原当时输入。

| 已核对的观察 | 支持的判断 |
| --- | --- |
| run 为 completed；publication、verification、completion 结果均为空 | 生命周期结束不等于有报告或 solved |
| 四个后台任务均 completed／delivered；三个交回为空，一个只有部分文字；对应子 assistant 均 finish=length | 已确认原始生成不完整，未证明“完整报告在传输中丢失” |
| Root 最后 assistant 为 length、无 text、无 info.error；旧 launcher 可据任意历史 completed 消息收束 | 需要关联最终输入与报告，完整性不能只看 error 或 completed |
| 四个通知已出现在父消息；Root 未调用 progress.read 或 Critic；重建计数没有达到角色规定的三次相同工具参数阈值 | 不能写成父完全没收到通知，也不能仅因 Critic 未介入就判定权限或提示词失效 |
| 来源对话称目标 CTFd 业务表为空；后续部署只读检查未找到绑定当前实例、材料版本及 judge 的 seed 完成记录 | readiness 仍 unknown；未独立复证空表，不据此断言整个镜像没有其他 seed 来源 |

原始 run、消息定位和 hash 索引见[证据入口](../../gates/g-solver-verification-20261023/run-completeness-20261025/README.md)。正文不重复完整 ID 清单；原始 reasoning、凭据及私有答案不作为开发文档内容。

## 3. 方案取舍

| 问题 | 选择与理由 | 未采用或未定部分 |
| --- | --- | --- |
| Root 报告缺失 | 增加独立完整性事实，保留既有退出码；可暴露空／部分报告而不把正常未解题写成程序失败 | 不自动续跑或补叫模型 |
| 后台报告属于哪一轮 | 可信 binding 后，用现有 chat.message 的 user ID 冻结唯一活动 execution，再按 assistant.parentID 读取 | 不使用 prompt 匹配、时间近邻或 child 最新消息；无需另建派发游标或 result-ref |
| output 上限是否接线错误 | 固定版本首次请求实测符合 model limit 与准入上界，不改 provider／plugin 上限逻辑 | 不外推到其他 adapter、后续预算变化或 R 中实际 8000 的来源 |
| readiness 如何证明 | 优先复用可信准备记录；没有记录时才评估题目专用只读检查 | 两者目前均缺成立条件，见 §5.1 |
| Critic 为何未介入 | 已有触发说明，不追加重复提示；先保留交接完整性事实可见性的方向 | 事实自动展示、语义停滞判断和调用效果尚未验证，见 §5.2 |

后台关联曾只有纯 OpenCode 的两轮消息读取证据，不能支持产品 call/ref→user 绑定。后续产品联合探针确认 hook ID 是 user ID，并在可信绑定后可选唯一活动 execution，才确定当前方案。该结论不依赖通知瞬间的原子可见性：缺消息仍应 unknown。

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

## 5. 未决问题与结果去向

### 5.1 Readiness：先确定可信准备来源

当前 `prepareRun` 只检查可达性；离线矩阵确认仅端口通可 accepted，新增 readiness 字段会被严格解析拒绝，也没有实例版本检查。材料题无 target 时仍可准备。这些是现有接口事实，不是 readiness 已实现。

| 候选 | 成立前提 | 当前缺口与去向 |
| --- | --- | --- |
| A. 复用部署／准备记录 | 能证明 seed 已完成，并绑定当前实例、材料版本和 judge | 未找到可信记录生产者；先核实实际部署材料与 seed 约定 |
| B. 题目专用只读检查 | 有明确预期 seed 及不泄密的验证判据 | 判据不足，不能以“CTFd 表非空”代替题目已就绪 |

两者均不足时保持 unknown。需要 readiness 的未来真实 run 在实现 guard 前，应由可信准备流程阻止重跑；不能声称代码已自动拒绝。若前提成立，最小潜在范围是 `challenges.ts` 的声明、`run-prep.ts` 及既有测试，不先扩平台框架或向模型开放 Docker／DB。

应区分“不适用”和“要求检查但缺证据”；实例重建／重置后不得复用旧 ready，检查失败不自动部署或修 seed。下一次验证应覆盖 required 缺 seed、仅端口通、有效准备、实例／版本变化和 not applicable；当前没有可信有效 ready 样本，也没有进行实际重建验证。

### 5.2 父上下文展示与 Critic：记录事实不等于消费事实

后台 source/resultFacts 已进入执行记录和审计，但本片没有把新增事实注入父上下文。后续如处理可见性，须验证通知 ref 对应的事实确实送到正确父轮次；不以审计存在、delivered 或模型自述代替消费证据。

R 中无达到既定三次阈值的相同工具参数组；digest 从两次开始返回 repeated，不等于列表为空。七次恢复、空交接或没有 artifact 都不能单独证明语义停滞。因此保留 host 记录确定性事实、Critic 判断、Coordinator 决策的职责，不新增自动调度、固定调用频率或重复提示。

完整性事实如何展示仍未定；Critic 实际调用效果也未验证。只有具体信息缺口或接口问题成立时才修改现有交接／progress 路径，不借此扩展角色或 Skill。

### 5.3 同步与并发边界

同步恢复没有新 execution/ref，当前保持不支持关联，不能借后台实现宣称已覆盖。两角色并发验证曾观察到：首轮两个通知均收到，但下一次 root model.call 只携带最后一个 notice 的 user ID，另一记录保持 queued，最终 deadline_exceeded。已观察链没有串绑，但并发收束未通过，具体修复需单独定位；本片未修改通知消费或 Root 调度。

自然重复通知、自然停止竞争、实际 HTTP 故障及真实模型报告质量均未完成验收。当前无模型结果不授权自动恢复真实调试。

## 6. 验证结论与证据索引

2026-10-25 的原生验证固定 OpenCode **1.19.3**，仅本地确定性 provider；使用干净环境、隔离 HOME/XDG 和系统 loopback-only 策略，启动前外连断言 EPERM。该隔离仅用于开发探针，不证明产品 Solver 的完整安全隔离。输入由各批源码 hash 固定，dirty 工作区、独立提交树与纯 OpenCode 探针分别陈述。

| 验证对象 | 关键结果 | 证据与限制 |
| --- | --- | --- |
| Root 缺陷与上限接线 | 空／部分 length 可自然 completed；output=64、准入=1000 时请求64，output=2048、准入=512 时请求512 | [首次验证](../../gates/g-solver-verification-20261023/run-completeness-20261025/root/report.md)；只核对固定版本首次请求，不归因 R 的历史上限 |
| Root 最终实现 | 原生四例均通过：空／部分 length 为 incomplete，正常 unsolved stop／小预算 stop 为 complete；主区 typecheck/build、430项，独立提交范围424项通过 | [实现与复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/implementation/README.md)；来源变化测试经 mutation 证明确实捕获提前收束，SDK分支测试不等于自然竞态 |
| 后台关联可行性 | 单 child 两轮及同步对照完成；并发两案 deadline；hook 绑定方案可行，通知瞬时原子可见未证明 | [关联验证](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-correlation/report.md)；早期纯原生探针不能与替身拼接成产品联合验收，观测包装会影响时序 |
| 后台最终实现 | 无 observer／额外轮询的产品接线两案均 completed/0；首轮 length 的 textChars=7/0、incomplete，次轮 stop=8、complete，两轮均 consumed且旧轮未覆盖 | [实现报告](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-implementation/report.md)、[独立复核](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-implementation/review.md)；主区 typecheck/build、458项，独立提交范围452项通过 |
| readiness／Critic | 准备来源与 seed 判据不足；当前记录不足以要求追加 Critic 提示 | [准备核对](../../gates/g-solver-verification-20261023/run-completeness-20261025/readiness/report.md)、[Critic 核对](../../gates/g-solver-verification-20261023/run-completeness-20261025/critic/report.md)；没有重启目标、读取 DB 或私有答案 |

Root 与后台实现均经独立规格／质量复核和主区验收。后台原生事实直接来自产品执行导出与审计，并与导出的 child 消息身份、parentID、finish、text长度交叉核对；停止、撤销、冲突、SDK缺失／错误等另由确定性测试覆盖，不冒充真实传输故障或自然竞态。

测试计数对应各自源码集合，不能相加；原生实现样本来自当时 dirty 工作区，并未在独立提交树另跑。提交范围记录分别见 [Root](../../gates/g-solver-verification-20261023/run-completeness-20261025/implementation/scoped-commit-validation.json) 与 [后台关联](../../gates/g-solver-verification-20261023/run-completeness-20261025/child-implementation/scoped-commit-validation.json)。真实模型效果未验证，本地替身 usage 不代表真实模型消耗。

失败尝试、red/green、源码清单、独立 review 和原生投影保留在上述既有证据目录；临时工作区路径及清理过程不再重复写入设计契约。历史报告中的旧章节号对应当时版本，当前结论按本文件主题章节读取。
