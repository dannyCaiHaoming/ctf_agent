# 本地调试：环境就绪与会话结果完整性

日期：2026-10-25。状态：**Root 最终报告完整性与展示已接入主区并通过无模型验收（§8）；readiness 与子任务可靠关联仍 unknown，未扩展实作**。

本文件是[核心设计 v1](2026-10-22-ctf-agent-design-v1.md) C／E／H 的子设计，仅补充本次调试暴露的环境准备、结果完整性与停滞反馈边界。原有会话绑定、预算、独立验证及可信完成契约保持有效。本文不授权真实模型调用、部署、commit 或 push。

## 1. 目标与范围

避免在未准备好的本地题目上消耗解题预算；让用户与父 Agent 分清“会话停止”“产生完整报告”“完成解题”。先定位结果没有产生、结果传输缺失和报告未被使用各自的证据，再决定修复位置。

本次不增加 Skill 数量、角色、provider 求解循环或通用 Agent 框架，不改变成功标准，不恢复冻结工作。不能靠增加 token 上限、自动反复续跑、固定解题路线掩盖缺口。已有正常完成时的 aborted 展示修复属于前次未提交工作，本次保留，不作为本设计新成果。

## 2. 证据、版本与可支持的结论

来源对话：`01a16d38-6063-7532-aeab-a9521de9d066`，最后调试 run：

`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261024-r2/runs/throwback-debug-20261024-r2-1`（下称 R）。

R 的 `state/run.json` 记录 OpenCode `1.19.3`、`volcano-coding/deepseek-v4-1-flash-261017`、产品基线 `cfa950fd7129203f21baceeab399ed9cf675a1c7` 且 `productDirty=true`；不能仅凭 commit 还原当时产品副本。记录 104 次准入，reported input/output/reasoning 合计 561088 tokens。预算为 5000000 observable tokens／30 分钟，不是本次新授权。

### 2.1 已从保存记录独立核对

| 观察 | 可支持的判断 |
| --- | --- |
| run 的 status／stopReason 都为 completed；publication、verification、completion 三份结果均为空 | 生命周期正常收束不等于生成报告或解题成功；本次没有可信成功结果 |
| 四个后台 task 均记录 completed、delivered=true；Recon、Solver、Reference 的 task_result 正文为空，Strategy 正文 trim 后 113 字符 | 控制层接到原生完成通知，但没有检查交接正文是否完整；delivered 不证明内容可用 |
| 在各完成通知时间之前，对应子会话最后完成的 assistant 都为 finish=length；前三个没有 text，Strategy 有 114 字符 text | 原始生成已经不完整；当前证据不支持“完整报告在传输中丢失”。113／114 差异来自去除空白，不能称为截断证明 |
| Root 最后 assistant 为 finish=length、output=0、reasoning=8000，无 text，无 info.error | 主会话没有给出最终文字，不能借更早完成的 assistant 判为最终报告完成 |
| 初次后台分派后还有 7 次同步 task 恢复；进度 seq807 有 Coordinator redirect，没有 Critic note | 重复追问和未使用 Critic 是可观察行为；不能仅从无 note 推断 Critic 接口损坏 |

用于复核的消息对应：

| 角色 | child session | 完成通知前最后完成 assistant |
| --- | --- | --- |
| Recon | ses_e91976ffdffeBxuzwPMt40YQJk | msg_16e6af0d7001cdApelKFduOA3M |
| Solver | ses_e91937473ffe9rvyclpW6c0S7U | msg_16e6ebe03001u5Dl5BSjQTyfQu |
| Reference | ses_e918ecdcdffeaCUstMjllEBWkf | msg_16e71776d001oiO0SPQcW8tBeu |
| Strategy | ses_e918eb7b2ffelD8zc2YP0820Rn | msg_16e714866001XGNbhBwF5CakLd |

Root 最后消息：`msg_16e73fd29001eDvFWx4cx2qUKN`。只核对元数据和 text 是否存在，不读取或转存 reasoning 正文。

关键文件 SHA-256：

- `state/run.json`：`568713dc614183b4f3443abaf46e1757f765316c8155f794e2c52482a0ac4ba5`
- `evidence/task-executions.json`：`6a79713ab5517b8eed7ad75375de1b2747071a06ececf7752b974741af7dd2e9`
- `evidence/publications.json`、`verification-results.json`、`completion-results.json` 均为 `[]`，各为 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。

原始 run 留在仓库外，本轮没有新增 gate 或复制敏感运行材料。后续验证若需长期可移植证据，只保留脱敏的最小元数据到既有 docs/gates 位置，不复制凭据、私有答案或 reasoning。

### 2.2 来源对话的观察，尚未独立复现

对话收尾报告称：目标镜像与 HTTP 入口可用，但 CTFd 的 challenge／key／file／solve 表为空，只有正常注册产生的两个 team；host 有私有 oracle 答案，未证明目标中已部署相应题目。该观察足以提出“本地题目准备缺口”，不能独立证明任意攻击路线不可行或整个镜像没有题目。本轮不重启容器、不读取 oracle 答案。目标种子、题目预期部署方式和 oracle 对应性需由可信准备过程进一步核对。

### 2.3 实现与未知因果

- `run-prep.ts` 的 reachability 只检查 TCP；[E 最小版](2026-10-23-design-v1-e-intake-minimal.md) 原本没有承诺业务种子检查。这是新增的本地准备契约缺口，不是已有 seed 校验失效。
- `launch.ts` 在 root idle 时检查任意 assistant 的 completed 时间，连续两次且无 outstanding work 即停止；只有 info.error 才将相关错误反映为 failed。finish=length 可以通过现有完成条件。
- `control-service.ts` 接受原生 task 完成包络，保存结果并置 delivered；没有核对对应子消息终止原因。delivered 描述收到／排队，不证明父模型理解或消费。
- 当前示例 provider 配置的 output limit 为 8000；不是本 run 实际请求上限的直接证据。admission 的 maxOutputTokens 是预算剩余额上界，不等于模型最终请求参数。必须捕获固定运行时发出的无模型请求，核对 model limit、plugin chat.params 与 provider 参数的实际关系，不能先归因于其中某一层。

## 3. 设计选择与待验证分支

本节至 §5 保留验证前的问题与候选分支；当前选择、已定范围及未决项以 §7 的验证回写为准。以下候选不能独立当作已定实作要求。

### 3.1 本地题目准备：可信准备过程负责，Agent 不猜测

建议优先扩展现有本地准备入口，要求需要 seed 的本地练习显式声明准备要求，由可信 host 核对目标实例、题目版本、准备完成证据以及与私有判官的绑定。HTTP 200、TCP 通和 host 有答案都不单独构成 ready。模型只收到不含解法的就绪结论或阻塞原因；不得拿到 DB／Docker 控制权或私有答案。

候选 A：复用本地部署／准备脚本输出的实例绑定凭据，在 launcher 准入前验证。候选 B：若现有部署没有可靠记录，在同一可信边界增加题目专用只读 readiness 检查。A 优先，B 只在 A 不能证明实际 seed 时使用；不预设通用平台 adapter 或把“CTFd 表非空”硬编码为所有题目的标准。若两者都不能无泄密地证明准备情况，保持 readiness unknown，报告具体缺口，不启动要求该检查的模型 run。

不要求 readiness 的附件题、外部题仍使用原有契约；必须区分“不适用”和“要求检查但缺证据”。声明要求后缺失检查不得静默降级。证据绑定当前实例与准备版本，实例重建／重置后不得复用旧 ready。准备检查失败发生在模型准入前，保留原因，不自动部署、修复 seed 或扩大权限。

待回答：本地 throwback 的题目究竟通过何种部署步骤植入？现有准备入口能提供哪些可信、无秘密的实例与版本证据？只核对这些问题后才确定新增字段和最小文件范围。

### 3.2 Root 收束：运行终态与报告完整性分别记录

确定采用两个维度：原有生命周期状态仍用于表达运行结束／失败／停止；新增或复用的完整性事实说明最终报告完整、未完整或无法判断。字段位置与命名待核对现有结果消费者后定稿。不能将“没解出”一律改为程序失败，也不能把 completed 展示成“已交付完整结果”。

以本次 root 工作最后对应的 assistant 及其 finish／text／error 和未完成任务为依据，不使用历史任意 completed 消息。正常终止并有最终 text 可以说明报告存在，不证明内容正确；finish=length 即使有部分文字也标为未完整。未知 finish、缺少可关联消息时为 unknown，不能猜测完整。无任务未结且生命周期可收束时保存事实性 host 摘要：停止原因、报告缺失／部分产出、可信产物状态及证据引用。host 不代写模型的解题结论。

本次推荐最小实现不自动补叫模型。不完整报告应可见、可诊断；以后如确需“只收束报告”的有界恢复，须另证原生续接安全性、预算边界与无副作用重放，不能默认持续重试。退出码是否改变需检查现有 CLI 消费者后决定，不能以退出码代替两个维度的事实。

### 3.3 子任务：先辨明未产出，再谈补取

复用既有 task 身份绑定、完成通知与停止抑制。候选做法是由 host 通过公开 SDK 读取该次执行对应的子消息元数据及可交付 text，为父会话提供“原生执行已结束，但报告为空／未完整”的事实。原包络及原始 finish 保留，不伪造完整报告。

必须绑定 task execution／call／child／对应消息范围：子会话后来被恢复后，不能用新的最后消息覆盖旧交接结论。SDK 读取延迟或先后事件不齐时先记 unknown，不提前宣称空结果；补齐策略需在无模型时序验证中确定，停止后不得唤醒父或新增模型调用。

只有确认子会话曾产生完整 text、而通知未传递完整内容时，才比较原生补取与受控稳定 result ref；现有四个案例不满足这一前提，因此本轮不默认新增 result-ref 工具。不得暴露 sibling 会话、reasoning，或绕过独立 Verifier 的材料边界。重复通知必须保持幂等，不能由“补交付”重复执行任务或外部副作用。

### 3.4 Critic：先核对信号到达，再选最小修正

[进度帐本设计](2026-10-24-design-v1-local-practice-suite-and-progress-ledger.md) 已有重复失败、连续无新产物交接等触发意图；本轮没有证据证明这些条件曾形成可见且及时的提示。现有 digest 可统计重复工具指纹，不代表已实现所有触发条件。

候选 A：既有信号与权限均足够，只有指令遗漏，则仅修正 Coordinator 的条件说明。候选 B：关键事实缺少可见入口，则在现有 progress／交接反馈中补充事实性信号及引用，不加新调度器。先用保存轨迹核对触发点、当时父上下文可见内容及 role 权限，再选择 A／B；两者皆无缺口则保留模型遵循未验证，不盲目叠加规则。

连续空报告可触发“检查交接失败原因”，不能直接等同于解题无进展；没有发布 artifact 也不等于 text 没有新证据。host 只计数确定性事实，Critic 判断是否停滞及建议，Coordinator 决定路线。一次事件只提示一次，出现新的相关证据才重新评估；不强迫每次工具错误调 Critic，不在停止／预算耗尽后追叫 Critic，不创建无限批评循环。

## 4. 无模型验证要回答什么

后续验证分别覆盖可独立验收的能力，不把四部分打包成一次大型实作。依赖是：环境准备先于真实能力复测；结果完整性证据先于传输补取与停滞策略结论。当前只记录问题和分支，不预排实施路线图。

| 问题 | 最小验证及结果去向 |
| --- | --- |
| readiness 可以可信证明吗 | 在无模型条件核对准备入口及题目声明；覆盖 required 缺 seed、仅端口通、版本／实例变化、有效准备、not applicable。能复用记录选 3.1 A，否则评估 B；不能证明则 unknown／不准入 |
| output 上限实际在哪层生效 | 固定 OpenCode 1.19.3，使用本地确定性 provider 替身并阻止真实外联，捕获请求参数；比较 model limit、plugin 上界、剩余额。若接线缺陷证实才修复；合理上限也会 length，仍须完整性处理 |
| 收束能识别最终报告吗 | 覆盖空 length、部分 text length、正常 stop 的 unsolved 报告、更早完成但最新未完、子任务仍活跃、缺元数据和错误。核对状态／展示／退出码消费者后定字段；不得破坏正常清理 aborted 展示 |
| SDK 可关联到正确的一次交接吗 | 使用原生 task 与本地替身验证完成通知先后、同 child 恢复、重复通知、停止并发、SDK 暂缺消息；能关联才补事实，不能可靠关联时保持 unknown 并记录接口缺口，不自建旁路循环 |
| Critic 信号缺在哪 | 从本次保存记录重建候选触发点与当时可见信息，再做权限与提示的无模型检查。能证明信息缺失才补可见性；已有信号可见却未遵循不声称离线修复了模型行为 |

无模型替身只能证明接线与确定性行为；模型报告质量、Critic 选择、效率和 throwback 成功率都需要未来单独有预算授权的真实验证。

## 5. 最小修改范围的决策边界

- 若 3.1 能复用准备证据，仅触及既有可信本地准备入口、`run-prep.ts`／必要配置解析及对应测试；不改 Solver 工具或加入平台框架。
- 结果完整性优先检查 `launch.ts`、`control-service.ts`、现有进度呈现及直接消费者；SDK／插件只有在真实接线缺口被证明后纳入。保留现有审计原始事件与停止规则。
- Critic 只有 §3.4 A／B 被证实时才修改对应角色文案或现有 progress 接口；不连带重写 Skill、独立验证、候选发布。
- 验证结论回写本文件并同步核心设计与 README 后，才把已定的独立切片拆成实作计划。当前未选定新的 schema、工具、退出码或重试机制。

## 6. 设计阶段记录（本轮验证前）

完成保存记录和现有实现的只读核对，形成上述草案与待验证分支。本轮没有运行产品模型、重启目标、执行实现回归或改动产品代码；前次调试报告的 410 项测试属于前次证据，不计入本轮验证。用户批准设计方向后，下一步是聚焦未知机制的无模型验证，而不是直接扩大真实调试预算。

文档核对：独立 GPT 6.1 Sol builder check 未发现影响下一份聚焦验证计划的重大缺项；确认未将原始未产出写成传输丢失、未隐含自动恢复循环。三份受影响文档的本地链接及差异格式检查通过；与本轮写入前快照相比，原有文件仅核心设计和 README 改变，其他未提交工作保持原样。该复核只覆盖设计可执行性，不构成运行时验证。

## 7. 2026-10-25 无模型验证与范围收敛

以下是本轮实际验证，不借用前次调试测试。执行区从 `cfa950fd` 建立独立 worktree，再按 SHA-256 清单叠加主区当前产品快照；不能把 HEAD 当作完整源码版本。源码主区未改。执行模型 GPT 6.1 Sol，主会话核对结果；临时探针只在隔离区运行。用户明确禁止真实模型、commit、push。

### 7.1 Root：缺陷复现，最小契约定稿

固定 OpenCode **1.19.3** 与本地 OpenAI-compatible 确定性 provider，四例各发一次本地请求：空 length、部分 text length、stop 的 unsolved text、预算小于模型 limit。前两例仍返回 `code=0 / status=completed / stopReason=completed`，已复现原失败类别。三份可信产物结果全部为空；无追加 prompt 或自动恢复。

在模型 output=64、准入上界=1000 时，实际 HTTP 请求 `max_tokens=64`；output=2048、准入上界=512 时为 `512`。这两种首次调用没有发现上限接线错误，不修改 provider 配置、SDK 上限或 plugin 参数逻辑；不外推到其他 adapter、后续预算变化或历史真实请求的具体 8000 来源。

OS `sandbox-exec` 对运行探针及其 OpenCode 后代拒绝外连，只允许 localhost；启动前对外部地址的连接断言为 EPERM，随后本地 provider 可用。环境由 `env -i` 建立，仅注入本地虚构 key；宿主配置隔离、禁止自动更新/模型抓取等沿用现有 bridge。最初 sandbox 地址语法错误发生在 runtime 启动前，修正后才运行，失败未删除。不把该开发探针隔离宣称为产品 Solver 完整安全隔离。

另有五例 SDK stand-in：旧消息已完成但最新 assistant 未完仍 completed；pending 未绑定派发及缺 completed 时间会 deadline；root APIError 最终 failed；缺 finish 仍 completed。它们只证明 launcher 分支，不能冒充原生活跃子任务竞态验证。既有基线 3 文件／24 项、临时 stand-in 5 项通过，未运行全仓。

**据此固定的最小修改：**

1. 在现有 `state/run.json` 增加 `rootResult` 元数据，并把同一计算结果交给 progress 最终摘要。包括来源 user／assistant 消息 ID（不可确认时 null）、原始 finish、是否已完成、text 字符数、是否有 error、`completeness`（complete／incomplete／unknown）及简短机器可判别原因；正文仍留现有 messages evidence，不复制 reasoning。这里的 complete 仅表示报告正常结束且有文字，不是内容正确或 solved。
2. root idle 检查不能再使用历史任意 completed。读取最新相关 user 输入及与之对应的 assistant，保留 parentID、创建／完成元数据；后续 assistant 尚未完成时不回退旧报告，也不立即收束。无法唯一确定最新消息／输入关联时保持 unknown，沿用预算／deadline，而非猜测。原 pending／executions／resources 阻止收束的条件不放宽。公开 SDK 的 assistant.parentID 在本次真实 root 输出可对应 user 消息；复合事件与同时到达的输入仍须在实作定向测试覆盖。
3. finish=length 总为 incomplete；stop+completed+非空 text+无 error 为 complete；stop 空正文为 incomplete（missing_text）；未知 finish、缺元数据或关联不明为 unknown。实际 error 保留原失败路径；完整性不能覆盖生命周期错误。tool-calls 不能当最终报告完成。
4. 保持 CLI 生命周期退出码：completed 仍为 0，错误／预算／deadline 沿用既有非零契约。`rootResult` 和 progress 明示 incomplete／unknown，不能把 completed 文案等同交付完整报告。保留现有正常 shutdown aborted 的展示修复，原始审计不改写。结束前后如消息发生变化，不用清理 abort 覆盖已确认的最终报告，需保留判定来源和收束原因。
5. host 只给事实性摘要（运行终态、报告完整性、可信产物状态、证据引用），不补写推测性解题结论，不自动调用模型补报告。

最小文件为 `apps/launcher/src/launch.ts`、`progress-ledger.ts` 及其现有 `launch-evidence.test.ts`／`progress-ledger.test.ts`；可在 launcher 内提取小型纯分类函数，但不先引入通用结果框架。搜索到 launcher CLI 直接返回 code/status/runDir；`apps/cli` 的 resume 是另一契约，不联动修改。外部消费者未知，因此保留原退出码；新增字段是加法。该范围随后已完成实作，当前状态与验收见 §8。

### 7.2 Readiness：A／B 均不足，保留 unknown

独立核对部署 Dockerfile／compose／prepare 逻辑：找到镜像启动、依赖安装、`db.create_all`，没有可复用的 seed 完成且绑定当前实例／材料版本／judge 的记录。白名单 Docker inspect 只见原容器 exited、固定 image ID、无挂载；没有启动目标、读 DB 或读私有答案。因此未独立复证历史“空表”，也不声称整个镜像无其他 seed 来源。

真实 `prepareRun` 的离线 TCP／文件矩阵确认：仅端口通会 accepted；新增 readiness.required／evidence 字段被现有严格解析拒绝；不存在实例版本检查；无 target 的材料题可继续准备。所谓“实例变化”只是无契约情况下的接口等价检查，没有实际重建；没有虚构有效 ready 样本。既有 run-prep／opencode-config 2 文件／15 项通过。

**选择结果：目前不能选 A 或 B 实作。** A 缺可信准备记录生产者，B 缺本题预期 seed 和无秘密检查判据。要求 readiness 的未来真实 run 应保持未就绪、不准入；现有代码尚无此拒绝能力，因此在实现前由本地练习准备流程明确阻止这类重跑，不能误称 guard 已存在。

后续最小潜在范围是 `challenges.ts` 的声明、`run-prep.ts` 的检查及现有 `run-prep.test.ts`，但前提是先确定可信准备来源与实例／版本／judge 对应的判据。若声明放 challenge list，就无须先扩 profile schema。**本轮最小可实作集合不含 readiness 代码**，不为了赶进度新增只有 ready=true 的假证明、不开放 Docker/DB 给模型。下一次涉及该题准备时，先核实其可信部署材料与 seed 约定；未知保留，不把环境检查降级为 TCP。

一次限定部署文件读取碰到 README 末尾 Solution 链接标题，未访问链接或解法正文、未读取 flag；这是读取范围偏差，后续限制为部署文件和白名单结构字段。该标题未作为判断证据。

### 7.3 Critic：补交接事实，不追加自动调度

当次固定 Coordinator／Critic 文件与当前文件 hash 相同。Root 实际 `ctf_progress_read=0`、`task(recovery-critic)=0`、`ctf_progress_note=1`（seq807）；权限与工具静态接线存在，不证明此 run 已实际调用。四个原生后台通知均已出现在父消息记录，不能称父完全看不到结果；缺的是 finish／来源消息／完整性事实。

在 seq258／647／785／793 的通知及 seq807 前，按 digest 的 tool+fingerprint 分组，均无达到 Coordinator 三次触发阈值的组。digest 本身从两次开始返回 repeated，因此这不表示 repeated 列表为空。七次 task 恢复不等于七次相同工具参数；没有发布产物也不能证明其 text 没有新知识。现有 Coordinator 已写触发条件，且读取进度是按需；当前证据不足以选择 A 继续堆提示词。

**选择 B 仅限子任务完整性事实的可见性，并入 §7.4，不新增独立 Critic 改动。** host 不判定语义停滞，不自动派发 Critic，不添加固定频率、全局去重器或新角色权限。现有 digest 按全 audit 聚合且没有推送，不扩大到跨题停滞判定；若未来需要该行为须另有证据。Critic 调用效果仍未验证。

### 7.4 子任务：能读取两轮事实，执行到消息的可靠绑定未证实

固定 OpenCode 1.19.3＋公开 SDK，在仅本地确定性 provider 下真实运行原生 background task；这是 probe-root/probe-child 的纯原生探针，未加载产品 plugin／ControlService，不能和下述替身测试拼接成产品联合验收。两组均恢复同 child 一次：第一组 length／13 字符 → stop／15 字符；第二组 length／无 text → stop／15 字符。原生通知均可为 completed，正文分别对应部分／空／正常结果。没有观察到完整文字在传输中丢失。

SDK 中 assistant.parentID 可关联到各自 child user 消息；但原生 task metadata 只有 parentSessionId／sessionId／model／background／jobId／truncated 等，jobId 对应 child，完成通知没有 source message ID。产品的 description `[ctf:ref]` 能关联 execution 和 notice，不能据此推导 child user message ID。**本轮未证明 callID/ref → child user → assistant 的全链可靠关联。**

运行探针按 200ms 读取；一次间隔内可能已收到通知并恢复，因此只证明最终两轮消息可读，未证明通知到达时 SDK 原子可见。自然重复通知、停止竞争、暂缺消息／延迟尚未覆盖。既有 3 文件／26 项 SDK 替身测试通过，支持现有幂等／停止边界；不能升级为上述自然 runtime 证明。探针最初有隔离 profile 与标题请求分类失败，正式样本在修正并验证外连 EPERM 后运行；失败单列，不混入通过样本。

**选择结果：不直接实现读取 child 最新消息作为结果，不新增 result-ref。** 若后续推进，候选是派发前后冻结消息游标，在唯一活动 execution 范围内绑定 child user 和 assistant；该策略必须先验证歧义、缺消息和恢复并发，不能先假定成立。无法唯一绑定时 unknown，原包络保留，停止后不唤醒／续跑。此次子任务信息缺口已定位，但可靠补取机制尚未定稿，**不纳入本轮最小可实作集合**。§7.3 的 B 仅确定事实应可见这一方向，须等待本节绑定可行性；不能为立即推送事实而猜测消息来源。

### 7.5 证据与收口

最小可移植证据存放在既有 [G 验证资料下的本轮证据目录](../../gates/g-solver-verification-20261023/run-completeness-20261025/)：保存探针源码、请求／消息元数据投影、现有接口矩阵、源码 hash 和分层报告；不复制原始真实模型 transcript、reasoning、控制凭据或 oracle。完整临时探针输出留在报告所列本机审计目录，未纳入仓库。资料目录不是新增可执行 gate 或产品 fixture。

主会话独立核对 root 实际请求、消息 parentID/finish、准备接口结果与资产／源码快照；另有独立 reviewer 核对计划合规及证据质量。测试计数分属不同子验证，不能求和冒充同一全链验收。未修改产品代码，所以未重跑全仓 typecheck/build/test。

**本次确定的最小实作切片只有 §7.1：Root 最终报告完整性与展示。** provider output 接线、自动恢复、Critic 调度、Skill 扩展均不改。环境就绪与子任务源消息可靠绑定是已定位但仍有未决证据的独立项，不阻塞这个可独立验收的 root 切片，也不因 root 修复而宣称已解决。该验证轮次未进入实作；随后用户授权的 §7.1 实作结果见 §8。

收口：独立复核的计划合规与证据质量均通过，见证据目录 `review-final.md`。四份临时验证 plan 的结论已全部转入本文件与最小证据，按仓库规则删除；README 和核心 C／E 摘要同步。主会话核对三个隔离区原有137文件与快照均一致，未发现产品代码被改；探针／OpenCode serve 进程检查无匹配。三个验证 worktree 暂留（`run-completeness-validation`、`local-readiness-validation`、`child-result-validation`），因为应用归档会生成 Git 快照，本轮不执行任何 commit／push；没有归档或删除其他工作区。本轮新生成的临时测试与探针未接入产品。

## 8. 2026-10-25 Root §7.1 实作与主区验收

用户批准实作 plan 后，GPT 6.1 Sol 在复用的 Root 隔离工作区执行，主会话独立核对增量并接入 `/Users/caihaoming/Documents/pentest-agent`。基础是当前 dirty 快照，不是 HEAD 全部差异；只接入以下四个文件，其他既有工作保留：

- `apps/launcher/src/root-result.ts`：新增小型纯元数据分类器；按可信创建时间选唯一最新 user／assistant，再用 parentID 关联。相同毫秒但父子身份唯一可以成立；多个同时间候选、缺身份／时间或无法关联仍 unknown，不按数组顺序回退旧报告。
- `apps/launcher/src/launch.ts`：两次 idle 必须来源与终态事实一致；最新未完／tool-calls／关联不明不自然收束，原 pending／executions／resources 防护保留。正常退出码保持0；报告完整性独立记录，不自动补叫模型。
- `apps/launcher/src/progress-ledger.ts`：用同一个 rootResult 展示完整性、原因、来源元数据及证据位置；可信产物记录数不代表 verified／solved；旧正常清理 aborted 文案保留。
- `tests/contract/launch-evidence.test.ts`：补齐 SDK mock 原本缺失的 user／parentID／created／finish，保留原失败与usage断言，增加来源、错误、预算、导出与清理回归。没有修改产品角色、控制服务、插件、provider 或其他CLI入口。

### 8.1 实际记录与收束边界

`state/run.json.rootResult` 的实际字段是：`userMessageID`、`assistantMessageID`、`userCreated`、`assistantCreated`、`assistantCompleted`、`finish`、`completed`、`textChars`、`hasError`、`completeness`、`reason`、`observedAt`、`exportedSourceMatches`、`evidence`。无法确定的引用／时间／finish为null；textChars沿用JavaScript字符串length，只是可见text的长度，不包含reasoning内容。

length／空白stop为incomplete，正常stop且已完成且非空text且无error为complete；未知finish为unknown，但已完成且来源可靠时可结束生命周期。缺来源、未完成、tool-calls不满足自然收束。真实APIError保持failed，历史真实abort也不被最后一个正常报告掩盖。因此生命周期failed与报告complete可以同时存在：二者描述不同事实。

`observedAt` 标出收束前观测冻结时间。只有停止前没有真实error、导出的abort又属于同一冻结assistant时，才按清理处理，不覆盖rootResult；原始审计和错误记录仍保留。预算检查可能已经开始abort，此时只使用先前观测，没有先前观测就标unknown/snapshot_unavailable，不能在清理后重取并冒充最终报告。证据导出失败标unknown/export_unavailable，不提供不存在的文件路径。

SDK读取与导出不是原子操作；`exportedSourceMatches` 显示导出的来源／终态事实是否仍匹配冻结观测。它不能证明没有更晚消息或所有原生竞态都已消除，摘要已明确“收束前观测冻结，非原子最终快照”。既有 progress 先写、后续证据落盘失败再改变最终run状态的时序限制仍保留；本片未扩展成通用证据系统重构。

### 8.2 验证、复核与证明层次

- 先运行原基线2文件16项；新增14项测试先产生预期失败，再实作。补充边界的red覆盖同毫秒唯一父子、无completed的APIError、预算已开始清理、历史真实abort。
- 独立review指出“来源变化重置idle”的旧新增断言不够严格。修正后明确断言第7次读取和实际同源清理abort导出；短暂删除来源重置逻辑时，实测在第5次读取提前停止且测试失败。恢复生产文件后SHA-256与review前一致，没有保留mutation。
- 修正后定向2文件／36项通过。主区接入后实际运行 `npm run typecheck`、`npm run build`、`npm test`，全部通过：49文件／430项。独立review最终规格与质量均通过。
- 最终生产源码的 OpenCode1.19.3 本地确定性四例全部通过：空length与partial length为completed/0 + incomplete；正常unsolved stop及小预算stop为completed/0 + complete。每例一次请求，max_tokens依次64／64／64／512，三类可信产物记录均为空。测试review修正没有改变生产源码，未重复该原生批次。此项是无模型实际接线验收，不是模型解题能力验收。

证据在既有目录的 [implementation 子目录](../../gates/g-solver-verification-20261023/run-completeness-20261025/implementation/)；包含相对开工快照的精确增量、red／mutation、主区检查记录、源码hash、原生最小投影及独立review结论。报告正文／reasoning、控制凭据、私有oracle均未进入rootResult或新增人工摘要。

本片已达到无模型交付条件；readiness、子任务可靠关联、Critic行为及真实模型报告质量仍按 §7.2–7.4 保留，不借本次430项通过宣称解决。实施 plan 结论已转入本节后删除，核心design与README同步；未commit/push，Root工作区保留，未改其他工作区。

### 8.3 独立提交范围核对

用户随后授权提交本修复，并明确允许包含其尚未提交的必要底座：progress-ledger.ts，以及 control-service.ts 的审计 role/challengeId 字段、redactions/onAudit 配置和 record 回调三处接线。未包含 progress.read/note 工具注册、插件、角色文案或其他调试改动；工作区完整快照与此次提交树须分开。

从 cfa950fd 导出基础并叠加上述最小提交文件后，typecheck/build通过，独立提交候选全套48文件／424项通过。初次临时导出目录没有.git导致唯一git check-ignore测试失败（其他423项通过）；补建临时Git元数据后，源码不变重跑整套424项通过。此结果不能与工作区430项计数混为同一集合。记录见 implementation/scoped-commit-validation.json；原生四例仍是§8.2的工作区接线证据，未另跑真实模型。本次只提交上述范围及对应design、索引与证据，不push。
