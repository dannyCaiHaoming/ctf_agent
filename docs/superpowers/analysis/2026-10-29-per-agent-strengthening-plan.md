# 九角色能力强化建议

日期：2026-10-29（Asia/Tokyo）。状态：**分析输入，供人工选择；不是设计决定、实施授权或真实运行授权。** 文件名中的 plan 不代表已批准的实施 plan。范围仅为授权 CTF 题目、靶场与附件。

## 1. 判断起点与证据口径

**建议保留七个角色的现有行为，只提出两个局部工具候选：Recon 的搜索覆盖信息、Domain Solver 的 job 终态双流摘录。当前没有足够依据追加角色 prompt。** 两项都改善已有观察的可解释性或读回成本，不增加实验、网络扫描或裁判权力；共享工具的其他使用者会受益，不按角色重复计为多个提案。

- **【本地】** 本次读取九份角色定义、产品运行约定、两个前分析、指定七个工具／插件文件、根目录 CLAUDE.md／AGENTS.md、核心设计 §1.5；另核对 control-service.ts 的权限、job 终态及原生 read 边界。静态代码可证明接口形状，不能证明模型会正确使用。
- **【用户事实】** A（未测线索交接）和 D（有界交回）已落地；r8-2 于 2026-10-29 约 12 分钟 SOLVED Throwback，r7 游走未重现，但只有一个非受控 Web 样本，D 的 Recovery Critic 路径没有触发。本次未读取原始 run 或重新统计，不把该结果归因于某一改动，也不把 Critic 未触发当作其有效性的证据。
- **【分析判断】** 下文取舍根据上述事实与实现推导；成本为相对修改及核验成本（low／med／high），不是工期或模型预算承诺。no change 的 low 表示保持现状、不产生实施成本。
- **外部来源：本次未使用 web。** 前篇[工具分析](2026-10-29-ctf-tooling-analysis.md)包含网络来源，本文只引用其仓库内分析结论，没有重新核实或转述外部工具的版本、安装和性能主张；也不借训练知识填补角色缺陷证据。

前篇[单 Agent 分析 §2、§4](2026-10-29-single-agent-capability-analysis.md)中的“单 needle／行首摘录”“缺差异视图”已被当前实现部分取代：[workspace-tools.ts](../../../apps/launcher/src/workspace-tools.ts) 的 `searchWorkspace` 已支持 multi-needle、命中邻近摘录和字符位置，`diffWorkspace` 已提供有界行级差异；[插件](../../../apps/opencode-plugin/src/index.ts)也已暴露。它们不是本次新增建议。旧文“尚待 r8”的时态按用户新事实更新理解，旧文不改。

边界依据：[CLAUDE.md](../../../CLAUDE.md)、[AGENTS.md](../../../AGENTS.md)、[产品 AGENTS.md](../../../product/AGENTS.md)、[核心设计 §1.5](../specs/2026-10-22-ctf-agent-design-v1.md#15-工具知識資料與隔離)。复用 OpenCode 会话、原生 task／skill／read 与模型循环；host 只承担可信身份、scope、预算、资源和证据事实。不新增框架、知识平台、wordlist、旁路求解循环、监控调度器或 judge 权限。Critic 提建议，Coordinator 决定。禁止正式求解中的公网检索和依赖安装。no-framework 等边界同时来自本次明确要求，不虚构 CLAUDE.md 中不存在的逐字条款。

## 2. 逐角色判断

工具名以下用受管逻辑名称；插件映射成 `ctf_*`。共同原生 `skill/read` 可按需读取固定离线方法，`read` 限 host 配置的 Skill 根，不能据此声称任意 Reference 目录均可读。权限依据为 [control-service.ts](../../../apps/launcher/src/control-service.ts) 的 `NATIVE_TOOL_ROLES`、`checkReadPath`、`checkIntake`、`checkSolver`、`checkProgress` 与 `toolBefore`，不能仅凭插件注册推定角色有权调用。

### 2.1 Coordinator

**当前能力。** 原生 task 分派／恢复，challenge.assign/unassign、task.stop、progress.read/note、verification.read、completion.request；负责题目／预算安排、线索交接、停滞决策与可信完成请求。没有直接实验、artifact 发布或验证签署权。

**结论：[prompt] no change。** 保留 A+D 的未测线索与有界回合交接，不加第二套计划、自动 Critic gate 或执行中唤醒。

**证据／理由。** [角色“未测具体线索交接”“有界回合分派”“进度与 Recovery Critic”](../../../product/opencode/agents/coordinator.md)已覆盖当前失误；[单 Agent 分析 §1.2](2026-10-29-single-agent-capability-analysis.md)明确它们依赖模型遵循。r8-2 是积极的用户报告，不足以定位残余 Coordinator 缺陷。当前 completion 请求也已由 [CompletionRequests](../../../apps/launcher/src/completion-tools.ts)维护机会、unknown 与精确候选去重，不需要角色再手算一套账本。

**风险／验证。** 保留的风险是模型仍可能不按时交回或漏线索；需要另行授权、实际出现停滞的 run 才能验证 D→Critic→Coordinator 决策路径。不能由正常成功样本声称该路径已通过。**成本：low。**

### 2.2 Intake

**当前能力。** challenge.list/read 读取本 run 的题目清单、固定材料、目标、启动可达性检查时间与非秘密完成限制；整理类型、范围、就绪状态、判定方式和未知项，不执行脚本或管理实例。

**结论：[code/tool] no change。** 不为 Intake 增加探测器、解包工具或新的能力清单服务。

**证据／理由。** [Intake 定义](../../../product/opencode/agents/intake.md)已要求无字段保持未知、不默认 Web；[插件 challenge.list/read 描述](../../../apps/opencode-plugin/src/index.ts)已有上述事实面。[工具分析 §2、§5.2](2026-10-29-ctf-tooling-analysis.md)仅指出镜像能力未实测，不能据此认定 Intake 必须增加工具。启动检查时间也不是持续就绪证明。

**风险／验证。** 附件题、失效目标或完成规则未知仍可能暴露接入缺口；若出现具体丢失／误读字段，再定位 host 数据或角色消费。不改动无需新增变更验收；跨题 Intake 能力仍需真实接题运行，现有 Web 一题不能替代。**成本：low。**

### 2.3 Recon

**当前能力。** workspace.list/read/search/diff/write、http.request、job.run/read/cancel、artifact.publish/read，建立有来源的基线、入口和未知项；按 A+D 先测具体线索，在停止条件到达时交回。

**唯一建议：[code/tool] 给现有 workspace.search 增加有界的覆盖信息。** 保留现有匹配语义，报告实际检查的文件数、按 binary／oversized 分类的跳过计数，以及是否因输出上限提前终止遍历。可附少量根限定跳过路径及原因，路径列表也必须有上限及省略标记；不新增搜索器、搜索续页或自动补查。只描述本次指定 scope 和已遇到的文件，未遍历部分不得推算为已检查。

**证据／理由。** [searchWorkspace](../../../apps/launcher/src/workspace-tools.ts) 第 315、317 行对超大／非文本文件直接 continue，返回仅有 matches 和 truncated；因此空 matches 且 truncated=false 仍可能漏掉这些文件。相邻 `diffWorkspace` 已报告 skipped，说明同一工具面可复用这种透明表达。[单 Agent 分析 §4 第 2 项](2026-10-29-single-agent-capability-analysis.md)也明确提出搜索覆盖问题；[Recon](../../../product/opencode/agents/recon.md)要求区分事实与推断。此缺口由代码确认，但没有证据证明它造成 r7 或 r8-2 的结果。

**风险／验证。** 低风险：只添加本权限内的观察元数据，不扩大读取范围。主要风险是覆盖字段被误读为环境全量搜索、跳过路径挤占输出，或模型看到跳过项便扩大枚举；字段和说明必须明确它们不是待办列表。未来无模型定向验证可检查混合文本／二进制／超大输入、命中上限提前退出、published 与私有 work 权限，以及完整响应大小上限；这是建议的验证方法，本次未运行。减少错误否定或游走的行为收益仍必须由授权真实 run 验证。**成本：low。**

### 2.4 Domain Solver

**当前能力。** 与 Recon 相同的 workspace／HTTP／job／artifact 面，可写和修正实验脚本、运行已有程序并提交候选来源；没有 package.publish、验证、提交或原生 task 分派权，遵循 A+D。

**唯一建议：[code/tool] 在既有 job.run 终态回复附带有界 stdout／stderr 摘录。** 只从已捕获的同一 job 双流取每流最多 2 KiB 的前缀，标识 stream、offset、编码、捕获长度、预览是否省略后续 bytes、原流是否已截断及继续读取 cursor；保留 job.read 原样续读。有效文本给可读摘录，二进制不伪装成文本，保留字节可追溯性。不新增参数化执行器或摘要模型，不重跑命令。

**证据／理由。** [job-tools.ts](../../../apps/launcher/src/job-tools.ts) 的 `snapshot` 只给 job/state/exitCode/signal/reapIncomplete，`read` 才给流 bytes；[control-service.ts 的 job.run 分支](../../../apps/launcher/src/control-service.ts)等待 `waitSettled` 后返回该 snapshot（Verifier 另有 inputAssociation），并没有自动附流内容。[单 Agent 分析 §4 第 2 项](2026-10-29-single-agent-capability-analysis.md)已指出双流读回成本；[Solver 角色](../../../product/opencode/agents/domain-solver.md)要求局部修正脚本错误，短错误输出正好可在终态时提供。接口成本存在可确认，r8-2 有多少可节省读回尚未知。

**风险／验证。** 低运行副作用风险：不发新请求、不执行额外命令；上下文可能反而增加，前缀也可能漏掉尾部错误。必须分开 preview 省略与源输出截断，不把摘录当完整 evidence，也不放宽 Engineer／Verifier 网络权限或 Coordinator／Critic 原文权限。未来无模型验证检查空流、短错误、二进制、多字节边界、超量流、超时／取消、cleanup unknown 及 Verifier inputAssociation 保留；读取必须在原终态语义内，不用摘录改变终态或证明完整性。工具可机械验证，净 token／往返收益和错误修正效果需要真实 run；若实际输出多而无需读回，收益可能为负。**成本：med**（job 返回、host 终态接线及工具说明联动，仍为局部扩展）。

### 2.5 Engineer

**当前能力。** workspace、job、artifact.publish/read 和 package.publish/read；读取同题原 ref，固定精确候选区间、解法与证据整包，无普通 HTTP，不能读 Solver 私有 work。

**结论：[prompt] no change。** 不再添加“避免复制”“先看完整性”或自动修复／补采证据规则。

**证据／理由。** [Engineer“读取与验证边界”“固定候选与解法包”](../../../product/opencode/agents/engineer.md)已明确未改证据直接选原 ref，只有衍生材料才重新发布，必要转换保留来源。[ArtifactPublisher](../../../apps/launcher/src/artifact-tools.ts)已区分 snapshotFixed、rangeComplete、originalComplete；[单 Agent 分析 §5](2026-10-29-single-agent-capability-analysis.md)排除将已修复的同步发布问题包装为新能力需求。没有当前 Engineer 失败证据支持新机制。

**风险／验证。** 大材料仍受 1 MiB 整包和分页成本限制，但没有证据支持本次扩大限制或新增装包器。保持现状无需新变更 run；交接效率的能力主张仍需真实 Engineer 路径。共享 job 摘录若获选只作为同一工具变更的回归范围，不算第二个角色提案。**成本：low。**

### 2.6 Verifier

**当前能力。** workspace、绑定 preparation 的本地 job、artifact.read、package.read/prepare、verification.report；独立使用已有材料做直接核实／LLM 审阅／unable，不发布、补证、重解、普通 HTTP 或提交。

**结论：[prompt] no change。** 保留三层审阅及“不补证、不重解”的既有约束，不追加强制 replay、第二审判角色或更严放行条件。

**证据／理由。** [Verifier](../../../product/opencode/agents/verifier.md)已有结论范围、必要前提、来源、精确 comparison 和 unknown 保留规则；[VerificationResults.register/read](../../../apps/launcher/src/verification-results.ts)区分 effectiveJudgment、候选比较与 completionAdmission，`replay unavailable` 仍是明确限制，不能当成已交付能力。[completion-tools.ts](../../../apps/launcher/src/completion-tools.ts)由 host 绑定裁判并保存结果。r8-2 整题成功不能独立证明 Verifier 的语义判断可靠，也不构成扩大它职责的理由。

**风险／验证。** 语义充分性仍属 Verifier 判断，不因机械比较通过而成为 host 证明。真实语义可靠性需要授权 run；不新增 prompt 时不虚构“提示词已验证”。共享工具变更须保持版本绑定、必要证据及完整性语义，但不借此次分析返工验证协议。**成本：low。**

### 2.7 Recovery Critic

**当前能力。** progress.read/note、固定离线 skill/read，加上 Coordinator 去敏交接；审查事实来源、推断范围和未测线索，提出 continue／redirect／stop_and_report 建议与 capabilityGap，不实验、不分派、不判 solved。

**结论：[prompt] no change。** 不再加触发频率、固定反思回合或强制改道规则。

**证据／理由。** [Critic 定义](../../../product/opencode/agents/recovery-critic.md)已经防止把有限搜索推成全环境不存在，也明确资料不足优先补已有记录、由 Coordinator 决定；[Coordinator](../../../product/opencode/agents/coordinator.md)已在交回边界评估停滞。用户明确 r8-2 未触发该路径，尚无 A+D 后的 Critic 实际失败可据以设计补丁。

**风险／验证。** 未触发意味着缺乏验证，不意味着角色无用或有效。需在预算明确且实际有停滞／交回的授权运行中观察建议是否基于事实、是否被 Coordinator 正确消费；不为凑触发而篡改题目或向 Solver 注入已知解法。无模型检查至多确认权限与接线。**成本：low。**

### 2.8 Reference

**当前能力。** 原生 skill/read 在固定允许根内读取已发布离线知识，依 Coordinator 的问题返回来源、适用条件和不适用理由；没有题目 HTTP、workspace、job 或 progress 权限。

**结论：[prompt] no change。** 不扩知识库、检索平台、默认全文载入或运行中联网。

**证据／理由。** [Reference 定义](../../../product/opencode/agents/reference.md)已要求知识带来源与适用条件；[核心设计 §1.5](../specs/2026-10-22-ctf-agent-design-v1.md#15-工具知識資料與隔離)要求知识版本在 run 前固定。[单 Agent 分析 §4 第 7 项](2026-10-29-single-agent-capability-analysis.md)把方法入口修改限定于确认 description 表达不足之后；“r7 没加载 Skill”不能单独证明 Reference 缺知识或入口坏了。

**风险／验证。** 允许根外的资料可能不可访问，未被调用也无法证明有效；本次没有读取资产发布清单，不声称所有 Reference 均可加载。出现具体无法找到／不适用的已发布方法时再定位；新增知识或 prompt 的实际帮助仍需授权真实 run。**成本：low。**

### 2.9 Strategy

**当前能力。** 原生 skill/read 与 Coordinator 交接上下文，排序假设、列前提和反证条件、选择最小实验及换路时机；没有 workspace／HTTP／job 实验或 task 分派权限。

**结论：[prompt] no change。** 不再要求一套假设账本、固定实验个数或额外策略审批。

**证据／理由。** [Strategy 定义](../../../product/opencode/agents/strategy.md)已经包含最小实验和反证条件；[产品共同协作约定](../../../product/AGENTS.md)已要求观察／假设、已否定路线和必要证据引用。[单 Agent 分析 §1、§5](2026-10-29-single-agent-capability-analysis.md)定位的是已有线索没有转成行动，不是 Strategy 缺少泛化规划文字；A+D 已在实际分派／执行边界处理这一点，没有证据支持再加一层。

**风险／验证。** Strategy 仍可能给出过多假设或不实用实验，但这只是可能性，不能当根因。需有实际 Strategy 调用及其建议被消费的 run 才能判断收益；r8-2 未提供该角色细分证据。**成本：low。**

## 3. 优先短名单与人工待决项

1. **可机械验证的 code/tool，优先考虑：** Recon 的搜索覆盖信息（low）排第一，解决已确认的观察范围不透明；Domain Solver 的终态双流摘录（med）排第二，属于可选易用性优化，净收益尚不确定。前者不增加搜索范围，后者不增加 job 执行。若人工选择实施，先完成局部无模型验证，再谈真实行为收益；本次未实现或运行这些验证。
2. **安全最小 prompt：当前为空。** 七个 no change 不表示永久冻结，而是尚无充分残余证据。A+D 已是行为基线，不为填满此栏追加重复要求。以后若选择任何 prompt 行为改动，必须标记 **needs-run**；静态文字检查不能验证模型遵循。
3. **延后／需更多证据：** 保持其余七角色现状；先取得 A+D 后真实停滞路径和角色级开销，再考虑是否有具体缺陷。前分析的 HTTP 批量对照、路由提取、浏览器／PTY／TCP、附件与数学工具不自动继承为本轮任务：分别需要已知实验往返瓶颈或新题型真实阻塞证据。nmap／dirsearch／Burp 等通用扫描与桌面工作流当前仍不推荐；无新知识平台或 wordlist 提案。

如果以后授权真实比较，应固定并记录 A+D 与当前 search/diff 基线、目标初态、代码版本、模型/provider、token 预算、批次和 deadline。观察线索到直接实验的延迟、无进展枚举、搜索结论是否越过覆盖范围、job 后续读回及实际 token、首个有效候选和最终可信状态；工具次数下降本身不是收益。一次只比较获选变化更易解释，不能混用不同 run 的成功片段；沿用 Throwback 也必须说明单题和既有知识限制。Critic 路径未触发时明确记“未验证”。

**本次仅创建本文；未修改代码、角色或其他文档，未执行 git、build、tests、安装、真实模型或目标请求，也未使用 web。** 已确认工作目录及目标文件此前不存在；遵守 no-git 要求，未检查分支或 dirty 状态，不作相关保证。本次读取不包含 r8-2 原始运行证据或镜像能力探测。本文仅为人工决策输入，任何提案的真实能力与效率收益，只能由另行明确授权的真实运行证明。
