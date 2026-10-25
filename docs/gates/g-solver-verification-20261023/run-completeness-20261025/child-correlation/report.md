# child execution → 源消息：聚焦无模型验证

结论：**现有 chat.message 边界足以支持有条件的 background execution→child user 绑定，不需要先引入派发游标。** 原生联合验证中，必须等 SDK/native dispatch 校验和绑定完成，再在可信串行状态里按 parent+child 选唯一活动 execution，冻结该 hook 的 user message ID。首次入站时可能尚未绑定，不能仅按 hook agent 绑定。恢复同 child 时 binding.dispatchCallID 仍是首轮旧 callID，不能用它关联新 execution；应使用当前唯一活动 execution 的 callID/ref。

这是机制可行性与隔离原型结论，**没有修改主区生产实现，没有证明全部运行/竞争场景完成**。两组单child两轮运行 completed；双角色同提示并发的关联没有串轮，但两组 run 均 deadline_exceeded，不能写整链通过。

## 固定输入与边界

- 工作区：`/Users/caihaoming/.codex/worktrees/child-result-validation/pentest-agent`。基于主会话给定 `7f0ad97b`+138个dirty源码文件快照；`input-hashes.json`、`main-baseline.json`、`baseline/`原样保留。实际完整HEAD、各输入/类型/二进制hash、观测包装hash、批次源代码对应见 `source-manifest.json`。
- OpenCode **1.19.3**（产品launcher检查版本）；plugin/SDK安装声明 **1.19.0**；Node **v26.3.0**。未换provider、未真实模型调用、未触及真实目标、oracle、部署、commit或push。
- 本产品 `launch()`→`startManagedOpenCode()`→产品plugin→loopback RPC→ControlService，与本地确定性 OpenAI-compatible SSE provider **同一运行来源**。未使用纯OpenCode结果与ControlService替身拼接。
- OS策略 `isolation.sb`：默认拒绝outbound，仅localhost放行；额外禁止读取真实用户 `.config`、`.local/share` 和 `.codex/auth.json`。每个正式probe先实测 `1.1.1.1:443 → EPERM`，随后才启动产品。`isolation.json`记录环境键；启动为 `env -i`，只带PATH和隔离HOME，脚本仅加入虚构 `OFFLINE_STUB_KEY=local-only`。产品把OpenCode HOME/XDG放本次临时run，provider只启用stub，关闭外部技能/配置/模型发现/依赖安装。没有读取或输出真实凭据。
- usage来自stub固定每次input=1/output=1的实测返回，仅证明usage管道，不是模型费用或真实token计数；逐案见 `minimal-evidence.json`。未把不可得值当0。

## 同源原生结果

| case | 原生过程 | launcher结局 | 关联结论 |
|---|---|---|---|
| single-partial | 同child：length/7字符→stop/8字符；prompt/description相同 | completed/code0 | 两轮不同ref/user；assistant.parentID各自吻合 |
| single-empty | 同child：length/0字符→stop/8字符 | completed/code0 | 空首轮仍固定原user，不借第二轮stop补全 |
| notice-read-partial | 同上，在notice RPC入口额外读SDK | completed/code0 | 两次notice各自可读到对应assistant |
| notice-read-empty | 同上，首轮空text | completed/code0 | 首轮length/0，第二轮stop/8严格分离 |
| partial / empty | intake+strategy并发、相同prompt；恢复intake | **deadline_exceeded** | 三条call/ref/user链均独立成立；运行收束未通过 |
| sync-resume | 首轮background，第二轮同步恢复同child | completed/code0 | 第二轮有新user，但没有新活动execution/ref，候选返回unknown |

原始脱敏hook入口/返回顺序与100ms SDK轮询在各case `hooks.jsonl`、`metadata.json`；提取后的可信audit、最终execution元数据在 `trusted-metadata.json`。最小联合证据统一在 `minimal-evidence.json`，包括每条parent/call/ref/child/user/assistant链、time/finish/text长度、model.call交叉核对及来源。

具体例：single-partial首轮 `call_1_0` → ref `a133c861-be28-44be-9d52-a6132e0cb10f` → child `ses_e91429dc6ffewV0oeVzWvaBx6a` → user `msg_16ebd623c001hZj12bf6rJYaI0` → assistant `msg_16ebd62500011Mt0BPBQhuuK1c`，finish=length/textChars=7。第二轮同child的 `call_4_0` → 新ref `2cb80d98-9ce9-4198-a088-54a78fe3adcc` → 新user `msg_16ebd627d001Ei5UHcukJ6PdIN` → assistant `msg_16ebd6283001orghYtYKUWXuuE`，finish=stop/textChars=8。第二轮没有覆盖首轮。

### hook语义与冻结时点

公开plugin类型声明 `chat.message.output.message: UserMessage`、`chat.params.input.message: UserMessage`；SDK assistant有parentID。原生元数据逐条证实：产品传给ControlService的chat.message.messageID对应SDK **user**，而model.call.messageID是同一个user ID，**不是assistant ID**。

初次child chat.message入口时binding=null，execution已由父task.before创建；tool.after与bindFromSdk可交错。handle返回前，bindFromSdk使用SDK session.parentID/agent、待派发callID、父task运行tool metadata.sessionId，核对native call→child，才建立binding并把execution设running。本探针只在返回观测该结果；生产候选须把冻结放在handle内部现有串行状态检查处，不能在入口猜测身份，也不能把返回日志演算说成生产代码已有冻结。

同child恢复时binding保留原dispatchCallID（观测为call_1_0），新execution已经由父task.before创建（call_4_0或call_5_0），并携带同childID。按当前parent+child、state=starting/running、未delivered选择唯一execution，才能冻结第二轮user。SDK assistant按冻结user的parentID选择，不能取child最新assistant。

### notice时可见性：两层分开

v1包装只同步追加metadata日志，另以100ms轮询SDK。多数组合在notice前没有轮询样本，因此**不能证明通知瞬间原子可见**。

v2包装只在真实notice RPC入口、receiveCompletion消费前，额外await一次SDK messages读取；四次读取耗时分别2/2/2/3ms，均返回正确child user和对应completed assistant（首轮length且partial/empty，后轮stop），两组run均completed。v2只从notice解析child并读取该child的全部消息元数据，未在该原生路径按ref冻结/筛选结果；ref→execution仍是产品原有receiveCompletion的独立校验，ref/user→assistant筛选在离线原型完成，不能声称新分类已经接线。这个结果仅证明同源通知处理前可读性；**读取本身增加了交付延迟，不能宣称入口时刻原子快照或所有延迟场景都可见**。生产机制必须允许该次读取缺消息时unknown，不能用之后一轮stop补写前轮结果。

### 并发收束独立缺口

两组并发原生run中，ControlService按ref分别收到两条首轮notice，但下一次root model.call只携带最后一条notice的user ID；只有该ref出现task.delivered。另一ref持续queued，使hasOutstandingWork仍为真，直到25秒deadline后被停止逻辑改为suppressed。最终结果是deadline_exceeded；关联链并未互换。`trusted-metadata.json.correlationAudit`与finalExecutions可核对。此为本次顺带观测的独立运行收束缺口，**本片没有修改Root或delivery规则，也不把局部关联成立升级为多角色整链验收**。

## 最小候选与拒绝条件

仅background范围：在完成可信binding后，串行核对parent+child的唯一活动execution；首次冻结child user ID；已有冻结不被后轮覆写。相同hook重复可幂等；同ref出现另一个user应持久标记association conflict，后续读取继续unknown。notice按其ref读被冻结user，并按assistant.parentID找候选；缺user/assistant、多个候选、冲突或不支持的finish都unknown；停止后suppressed，无唤醒/重试/副作用。同步resume当前无新execution/ref，明确unknown，不认领已完成的旧ref。

`candidate-prototype.py`是**脱敏元数据重放/分类演示**，不是产品实现，也不是原生故障注入。17项断言覆盖错误child/parent、缺user、多个活动execution、同步无活动ref、停止后hook、缺消息、错user assistant、重复同ID消息、多assistant、assistant error、停止后结果、重复hook、冲突user、冲突后再次读取/重复仍unknown、旧notice在恢复后仍保持首轮incomplete。输出见 `candidate-tests.log` 与 `minimal-evidence.json.candidateTests`。

原型初版仅返回冲突unknown却保留可用旧映射，经主会话review后修正为持久conflict，并新增两项冲突后再次读取断言。其finish/text/error判断只用于本地确定性关联演示；不能称为完整的产品结果完整性实现或验收。无消息/延迟/错误/重复/停止负例属于明确标记的离线候选测试；本次未做真实HTTP传输故障注入，未自然观察重复notice或停止并发race。

最小潜在产品改动范围仅：ControlService Execution增加冻结user ID/association状态；在已有chat.message绑定成功后的串行边界冻结；notice路径按该ref/user以SDK读取assistant元数据并保留unknown；必要脱敏audit。现有plugin已经传user messageID，无须先增加prompt标记、result-ref、派发游标或统一同步框架。具体错误/多assistant完整性规则仍应复用/明确既有产品契约，不能直接复制此原型分类器。

## 基线、失败与可复现性

- 基线命令：`./node_modules/.bin/vitest run tests/contract/g-team-integration.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/g-async-lifecycle.test.ts`，**3文件26项通过**，见 `baseline/tests.log`。这是原有SDK替身/确定性基线，未拼接成原生验收。
- 运行命令统一为：`env -i PATH=/opt/homebrew/bin:/usr/bin:/bin HOME=<本目录>/home /usr/bin/sandbox-exec -f <本目录>/isolation.sb /opt/homebrew/bin/node --import <隔离工作区>/node_modules/tsx/dist/loader.mjs <本目录>/<probe文件>`；工作目录始终为上述隔离worktree。
- `probe.ts`对应single两组，`concurrent-probe.ts`对应双角色两组，`sync-probe.ts`对应同步对照，`notice-read-probe.ts`对应v2读取两组。`source-manifest.json.batchSourceMap`记录脚本/包装版本和SHA256。v1/v2完整观测副本及差异为 `control-service-observer-v{1,2}.ts` / `observer.patch`，只改隔离副本control-service，未回写主区。
- 首次TS探针因临时目录缺type=module导致CJS/top-level-await编译失败，未启动provider/OpenCode；`failure-cjs.log`保留。补package.json后重跑。
- 首次两组错误地在task初始包络出现childID时就尝试恢复，child仍active，真实tool.before拒绝 `execution still active`；没有第二轮模型请求，最终deadline_exceeded。保留 `failure-early-resume-{partial,empty}`、`failure-early-resume.log`。修正为等两条真实completed notice后恢复。`early-resume-probe.ts`是从保存的concurrent版本仅反转等待条件重建，**不是执行前存下的hash快照**；其hash仅供复现，不冒充早批执行前证明。
- v2首次启动命令的日志重定向路径拼写错误，shell在启动前拒绝，未启动probe；随后正确路径运行。离线汇总脚本首次遇新notice记录缺operation而KeyError，改为可选字段后17断言通过；都不是产品失败。
- 未运行typecheck/build/全套测试：没有产品实现变更，既定基线及真正产品launcher运行已完成；不以此宣称生产修复通过。

## 保留物与清理

`report.md`、`minimal-evidence.json`、`input-hashes.json`、`source-manifest.json`、`isolation.{sb,json}`、各probe/observer版本、`observer.patch`、候选脚本/结果、各case的hook/snapshot/trusted-metadata、baseline与失败日志保留。

launcher自动生成的临时runtime数据库/完整messages/产品prompt副本，在提取上述ID元数据后仅对本probe的9个`<case>/runs`目录做了清理，避免保存prompt/body/reasoning/控制凭据；精确列表见 `cleanup.json`。因此日志中的历史runDir已被清理，审查以保留的原始脱敏hook/metadata和提取audit为准。未读取既有原始run正文、未修改旧证据、主区或文档；隔离worktree保留。产品launcher已逐个关闭自己的OpenCode进程和本地provider；最后进程核对无本probe残留。

本片剩余限制：并发运行收束未通过；同步execution不支持；通知原子可见、自然重复/停止竞争、HTTP传输故障和真实模型能力均未证明。可定稿的只有**先绑定再冻结user的background关联小切片及unknown拒绝条件**。
