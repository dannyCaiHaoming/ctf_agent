# design v1 D：固定候选、独立验证与可信完成

更新：2026-10-28。本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) D 的接口契约子文件。**用户已确认三层 Verifier 与预算内自动尝试策略，见 §5–7；独立工作区已实现新行为并通过本地确定性验证，已核对整合主区，真实模型／裁判行为尚未验证（见 §8.1）。** 五个旧接口已有接入与历史验证证据，其中“必须 effective verified 才能提交”的旧准入不再是目标设计。r5 分析与实验保留在[证据到完成子文件](2026-10-26-design-v1-d-evidence-to-completion.md)，不能据新设计追补历史成功。

## 1. 目标与职责

沿用 OpenCode 原生会话、任务与工具循环：来源角色交付现有材料 → Engineer 固定候选与解法包 → 独立 Verifier 直接核实或用 LLM 审阅 → Coordinator 按题目限制与预算请求判定 → host 保存裁判结果。

- Verifier 的对象是候选 flag 及其依据。它消费现有解题过程、理论、材料和日志，不补采证据、不修解法、不重新解题，也不因材料不足要求团队反复补包。
- Engineer 整理已有交付物，不负责为通关制造完整证明。Coordinator 不预填验证结论，不把缺资料自动变成新的求解／验证任务。
- host 绑定题目、候选精确 bytes、来源、版本和操作状态，提供实际判官能力、提交限制与剩余预算，负责准入、去重和可信结果；模型不手填或猜这些事实。
- 独立验证意见与裁判结果分别记录。无法验证仍可按 §7 尝试，LLM 认为可信也可能被拒绝；只有绑定裁判确认接受并整题完成、记录有效保存才为 solved。

## 2. 共用边界

遵守核心设计 §1.3、§1.5、§1.6 与 E/C/G 的取题、身份、准入、预算、停止约束。不另建 provider 循环、候选 registry 或通用 Agent 框架。授权题目、附件与目标不因验证扩张。

独立会话是上下文边界，不是同 UID 的操作系统隔离。可信稳定根、无不受管并发写入属于当前运行条件；私有答案／凭据不能放在 job 可读位置。原生上下文隐藏全部宿主路径的 H1 完整判据未通过；不因最小交接成立而改判通过。

## 3. 接口一：发布与交接固定证据

来源角色从自己获准的 file、已结束 job 流或 HTTP resource 发布；host 核实 run/challenge/session/execution/source 并固定 bytes、范围及 hash。当前实现仍依赖后台执行来源。r6 后已选定支持获准同步角色的完整交付，execution 建立／绑定／结束／续接和最小无模型验证以[任务执行归属设计 §8](2026-10-25-design-v1-sync-resume-provenance.md#8-r6支持同步任务交付设计已选接线待验证)为准；尚未实现或验证，不删除发布校验，不扩大 Verifier 权限。原续接补参通过不代表同步发布已通过。

返回的 artifact ref 才是发布身份；resource 是来源操作句柄，不能当 ref。读、列、查复用同一授权 registry，Engineer 不读 sibling work，也不通过直接写 published 目录制造引用。普通文件仅在能匹配可信 workspace.write 时记录 producer，否则为 unknown/null；复制 HTTP/job 输出不继承原来源。

完整性分别记录：`snapshotFixed` 固定快照、`rangeComplete` 所选范围完整、`originalComplete` 原输出完整。截断输出可作为片段发布，但原完整性为 false；普通 file 为 unknown。未结束 job 不发布。每文件／流上限 1 MiB、页上限 32768 bytes；不是 run 级无限保留承诺。

按“写完再发布”固定，保留路径、descriptor、前后身份与 hash 检查，拒绝已观察到的改写／替换／symlink。H5 只在上述运行条件下成立；不能证明抵御任意恶意同 UID 并发或原子快照。

H7 区分发布提交、RPC 回复和下游收到：提交前停止不产生半引用；提交后回复丢失保留已固定事实，但调用方保持 unknown，暂停受影响交接，不盲重发或重跑来源 HTTP/job；迟到回复不授予继续操作权限。已有程序／替身对照不证明模型会遵守，也没有对所有新调用的 unknown 强制锁、自动找回或跨重启恢复。

## 4. 接口二：一次固定候选与解法包

仅 Engineer 发布完整包；候选为同题合法 ref 的非空、精确 byte 区间，拒绝非法整数／越界，不 trim、不转码、不正规化候选。未改动证据直接引用原 artifact；分析衍生物另存并说明转换，不能覆盖原来源。

`files` 最多32项，选择 artifact ref 或 E material，加相对 path 与 script/input/evidence 用途；拒绝越界、大小写/NFC 别名、重复及父子路径冲突。argv 是建议命令，不是已执行事实；提取说明与前提随包保存。

沿用一次 artifact publish 固定 manifest envelope，以包 ref 为 version，不设 latest。manifest 绑定候选来源／范围／bytes／hash、文件引用与来源／完整性、E 材料 bytes、建议 argv 和说明。候选与 E 材料内嵌；其他 artifact 保留原固定引用。序列化 envelope 上限1 MiB，含 base64 与元数据开销，超限拒绝而非截断。

`package.read` 按明确 version 读取 manifest/candidate/file；file 必须是精确 manifest path。返回固定 bytes 的32768-byte分页与 size/hash/offset/nextCursor/done，核对包本体、候选和必要引用，损坏不静默替换。准备目录只是执行副本，不改变原来源。

候选或相关输入变更需新 version；无关工作、新包出现不自动使旧结果失效。提交与未知回复沿用 §3，不能靠重新打包掩盖未确认的发布。

## 5. 接口三：三层 Verifier

Coordinator 交固定 challenge/version、候选、现有材料与预算，由 host 绑定独立 Verifier execution。独立性是独立判断，不继承 Solver 私有推理；可以审阅解法说明、复用已有脚本，不必从零再解题或另写解法。三层是处理顺序，不是每次都要跑完的三套流程。

| 层次 | 职责与停止点 | 交付与去向 |
| --- | --- | --- |
| 一：可直接核实 | 流程／资料明确时，检查已有计算、提取链和候选；可使用已提供且在实际授权能力内的验证步骤。不能简单执行或得不到明确结论时转二，不为此建设新验证流程 | 支持则记录直接核实及依据；发现明确反证则 rejected，不把反证当成“无法验证” |
| 二：LLM 推理核实 | 基于已有过程、理论、材料、日志独立审阅，判断推导、来源说明与候选是否相符；这是允许的验证能力，不要求每个判断都有程序重算证明 | 支持则记录 LLM 审阅及理由／限制；有反证则 rejected；仍不能判断则转三 |
| 三：无法确定后尝试 | 记录 inconclusive 和具体原因，结束验证；不补资料、不要求完整复现、不循环生成报告直到 verified | Coordinator 自动按本题提交限制与剩余预算尝试交给裁判，不逐次询问用户；实际准入由 host 执行 |

`verified` 是 Verifier 的支持性结论，必须区分直接核实与 LLM 推理依据；不是裁判认可。`rejected` 是有反证的角色判断，不自动写入“裁判确认错误 flag”记录。`inconclusive` 是无法确定，不是错误，也不再单独构成禁止尝试的理由。三层不能把有反证的 rejected 伪装成第三层来消耗机会。

权限不因三层扩大：Verifier 不提交、不使用提示／管理实例、不修改原候选及证据。目标操作只能用已经获授且实际可用的能力；现有 replay 不可用或操作边界不明时，转已有材料的 LLM 审阅，不能通过 job 联网旁路执行。本次不以前置实现通用 replay、网络隔离或包外脚本绑定阻塞三层方案。

现有 package.prepare／关联 job 继续服务第一层：host 自动保存指定版本、实际 argv、输入快照、输出与终态。只在实际执行时使用，不强制第二／三层先运行脚本。前后 hash 不证明持续完整性或全部依赖封闭；记录此限制，不要求 Verifier 为所有题目证明任意依赖、全新实例或历史部署一致。

## 6. 接口四：记录判断与诊断，不以补证换放行

报告保留固定候选引用、所用层次／方法、判断、依据和限制；host 自动附带可确定的来源、执行与完整性事实。已有问题和 unknown 如实保存，不清空 issues、不把 unknown 改 assumed，也不将未支持的方法改名为已支持。具体字段映射属于实现细节，优先复用既有记录，不新增通用证明 schema。

需要区分两类问题：

- **验证依据不足：** 材料不全、流程难以重现、证据来源未知、脚本不能区分旧内容等，影响验证结论与日志，允许进入第二／三层。不能因 issues 非空、没有必要 job 或完整来源证明，就统一禁止第三层裁判尝试。
- **请求本身不可信或不可执行：** 题目／版本／execution 冒用、候选无法读取或 bytes 已改变、越权、预算耗尽、已确认错误候选重复、尚有结果未知的提交等，仍由 host 阻止相应操作。不能借第三层绕过这些事实检查。

已有材料损坏或变化时，旧的支持结论不能继续宣称有效；如果候选身份和精确 bytes 仍可信，可以如实记录证据失效后的无法验证状态，按第三层处理。候选本体变化必须作为新候选核对，不能沿用旧版本／报告。自由文字不能补造身份、改写原记录或覆盖可信状态。

报告与执行记录仍固定、按明确版本读取；重复同内容沿用原结果，冲突不覆盖。分页是传输细节，应由宿主／工具尽量完成机械拼接与校验，不把模型手工维护 hash／偏移量变成验证职责。读取失败不能伪装成“LLM 已审阅”；工具失败按真实状态记入诊断。

日志面向开发者：记录本次可读材料、采用层次、判断理由、缺口与工具失败。日志可用于之后修系统，但不自动派发补证任务或创建新的 gate。无需通用充分证据矩阵、强完整性证明或置信度评分阈值作为提交前置。

**2026-10-28 实现状态：** `mode=llm` 不强制 job／prepare／必要 evidence；`mode=unable` 只接受 inconclusive。取消的是 LLM 的强制程序证明，不是报告已声明条件：必要 unknown、未解 issues、未证 requirements 与必要 evidence 的实际缺口仍使有效支持降为 inconclusive。`verification.read` 分开固定原报告、storedEffectiveJudgment、当前 effectiveJudgment／currentAvailability 及 completionAdmission；hardBlocking 同时使当前支持失效、usable=false 并禁止提交。角色文案已同步；真实模型是否自然遵循仍未验证。

## 7. 接口五：按限制自动尝试与可信完成

由 Coordinator 根据 Verifier 记录提出明确 challenge/version/result 的提交意图，host 解析固定候选并执行准入。第一／二层支持的候选与第三层无法确定的候选都可进入提交；**不再要求 effective verified 才能请求裁判**。第三层自动使用本题允许的提交机会和剩余预算，不逐次问用户，不扩大已授权目标、预算或平台权限。没有判官则保存 candidate_only，不虚构提交或成功。

host 从实际题目／adapter 配置及运行记录检查提交次数、速率／冷却、扣分规则、deadline和剩余预算；模型不估算剩余次数或把 unknown 当无限制。约束不明时先使用已有可信查询／配置，仍无法确认准入就记录具体阻塞，不反复向用户询问，也不自行增加配额。等待冷却仍占用原时间预算，不靠新 run／session 重置限制。

提交前核对题目与候选绑定、精确 bytes、权限／预算、去重及在途状态；保存 intent 后在发送前再次核对。相关证明不足不伪装成支持结论，也不与候选本体损坏混为一谈。裁判实际收到固定 bytes；旧字符串接口必须无损 UTF-8 往返，不 trim。

| 裁判／操作结果 | host 的记录和后续动作 |
| --- | --- |
| 明确判 flag 错误 | 保存题目／裁判作用域、精确候选 bytes或可核对的指纹、原回执；同题同裁判作用域下不再次提交同一候选，换包、version或execution不能绕过。恢复同一任务时复用已有记录，不能让新 session遗忘判错 |
| accepted 且 confirmed completed | 有效保存后记 solved；不要求事后把原 inconclusive 改 verified。部分接受仍为 partial，不能重复提交已接受的同一部分凑整题完成 |
| 超时、断连、回复不匹配、保存失败或结果未知 | 记录 unknown，不能计作错误 flag，不能盲重发。保留在途 intent／已知消耗，有可信状态查询时按事实收束；不能假设未消耗次数或换候选逃避未知状态 |
| 配额／冷却／权限等非答案拒绝 | 按实际原因处理，不加入错误 flag 记录，不将所有 rejected 响应一概解释为答案错误 |

错误候选记录由 host 持有并用于去重，LLM 的记忆或 Verifier 自己的 rejected 不代替裁判确认。题目／裁判作用域由 host 确定，不默认扩成跨不同实例、比赛或任务的全局黑名单。

保留停止边界：发送前停止不发送；发送后未知不回滚外部事实。发送状态、原回复与本地保存分别记录。无需新建通用跨平台恢复系统，但实现必须用已有持久运行记录保持已知错误与未知提交状态，不能通过遗忘获得重试。可信 accepted/completed 与正确候选绑定仍是 solved 的依据；HTTP 200、退出0、LLM自述均不能替代。

### 7.1 已有工程证据

下表是历史验证的索引，不是本次重新执行的结果；各批版本与原始失败以对应来源清单为准，不拼接成一次验收。

| 能力 | 已有证据与边界 |
| --- | --- |
| 发布及 H1/H5 | [原型主核对](../../gates/d-artifact-handoff-20261024/parent-review/README.md)；H1 完整隐藏路径失败、H5 条件保留 |
| H7 RPC／停止 | [主核对](../../gates/d-h7-rpc-stop-20261024/parent-review/README.md)；unknown／不重试的模型行为未由替身证明 |
| 发布主区接入 | [接入记录](../../gates/d-artifact-handoff-20261024/integration/main-integration-20261024/README.md)：348项全套、typecheck/build，四产物与 H7 同源对照 |
| 固定包 | [接入记录](../../gates/d-artifact-handoff-20261024/candidate-package/integration/main-20261024/README.md)；包身份、分页、边界及未知回复 |
| Verifier 关联 | [接入记录](../../gates/d-artifact-handoff-20261024/verifier-handoff/integration-main/README.md)：372项全套与六个原生场景；V3 反例仍成立 |
| 固定报告 | [主核对](../../gates/d-artifact-handoff-20261024/verification-result/parent-review/README.md)、[修正核对](../../gates/d-artifact-handoff-20261024/verification-result/review-fixes-20261024/README.md)；机械成立不证明语义判断 |
| 报告到可信完成 | [D5入口](../../gates/d-artifact-handoff-20261024/trusted-completion/README.md)、[主区接入](../../gates/d-artifact-handoff-20261024/trusted-completion/integration-main/README.md)：43项定向、403项全套及同源十案，含拒绝、无裁判、传输未知、停止和预算；typecheck/build通过 |

历史证据有选择性保留：D5 主区批次保留可还原的原生消息／关键记录；其他批次不承诺完整转储，范围见各 README/retention。之后调整探针输出位置不冒称重新运行原批。旧角色文案 conditionalOn 不代替实际 original.premises/requirements 字段。

### 7.2 真模型本地整链证据与限制

2026-10-24 本地 Docker `mfw`，OpenCode 接入的 `volcano-coding/deepseek-v4-1-flash-261017`：首批授权250,000 tokens，一次 run 实耗251,953、98次准入，因预算停止，verification/completion 均空；不能与下一批拼接。其间发现 prepare 的 workspace 路径映射缺口并修正，见[首批报告](../../gates/d-e2e-mfw-20261024/REPORT.md)。

另获授权的新批上限10,000,000 tokens，实际1,065,186、297次准入；三份 inconclusive、一份冲突拒绝之后，最终同批 recompute 报告以5项 evidence、2项 assumed、0 issues 得到 candidateEqual=true/effective verified，再由本地精确判官 accepted 并保存 solved=true，见[第二批报告](../../gates/d-e2e-mfw-20261024-b2/REPORT.md)。

这是一次本地单题整链证据，不证明生产判官部署、秘密隔离、多题成功率或任意任务能力；不授权后续模型运行。r5 未完成不会抹去此事实，此事实也不能替 r5 消除 blocker。

## 8. 设计状态与实现范围

三层职责、无法验证时按题目限制与预算自动尝试、不重复提交裁判确认错误的 flag、unknown不当错误，已由用户于2026-10-28确认。无需继续为这些产品选择做抽象可行性验证。本次在独立工作区完成报告语义、候选读取、completion 准入／持久去重及角色／插件同步，状态与边界见 §8.1。父会话已核对独立审查修复并整合主区；无模型结果不代表真实能力验收。

旧页面对照及 r5 blocker 保留为历史证据和开发诊断，详见[证据到完成子文件](2026-10-26-design-v1-d-evidence-to-completion.md)；不作为要求 Verifier 补资料的理由。通用 replay 平台、任意依赖捕获、全新实例复现、历史部署一致、强隔离证明及新评分系统不作为三层方案前置。已有权限／scope限制仍生效，不能以减少验证负担扩大能力。


### 8.1 2026-10-28 三层与受限尝试：无模型结果

基于主区 HEAD `6fa6c6621464bcdd11ac618fa930b7d1bdbe9bbd` 及当时最新未提交设计，在 gpt-6.1-sol 独立子 session 完成实现与审查修复，父会话核对源码 hash 后整合主区；未 commit／push。实际环境、源码 hash、首败与日志历史统一保留于[既有最小结果 JSON](../../gates/d-artifact-handoff-20261024/trusted-completion/three-level-verifier-20261028.json)。

LLM 审阅不强制 job／程序证明，显式必要 unknown、issues、requirements 仍使支持降为 inconclusive；候选可信时可按第三层提交，原报告不改。Verifier 分派只核对候选身份、原引用与精确 bytes，证明损坏留作诊断；prepare 仍严格检查依赖。身份、候选、预算、停止及发送前异步复查保留。

同一 completion 目录内按可信 challenge／judge scope 延续错误去重、配额、冷却及 unknown，run 只作来源记录。显式稳定 scope 可跨 adapter id；未显式配置且标签变化无法对应既有作用域时拒绝并要求 host 提供 scope，不静默清历史。明确不同题／scope 隔离，不建全局错误 flag 黑名单；accepted／wrong_answer 不重送，未决或坏记录不盲重发。

限额计算为 `max − usedBeforeRun − 目录内已预留或发送机会`；`usedBeforeRun` 固定表示**本目录之外、同一可信题目／裁判作用域的既有消耗**，恢复时沿用，不能每次 run 刷新为含本目录记录的全量，避免双扣或重置。配置未知不放行。非答案拒绝不永久缓存：可信条件恢复后，同 version/result 重新核对准入，无需重包；原已发送机会仍保守计数。

最终同一源码：受影响六文件 **131/131**，`typecheck`／`build` 均 exit0，全套 **49 文件、591/591、exit0**。确定性替身覆盖固定包→独立审阅→受限判官→可信保存；第三层接受且整题完成可 solved，原 inconclusive 保留。父会话整合后复跑同组六文件，131/131 通过；整合源码与子区全套检查的源码 hash 一致。具体命令和历史版本结果见上述 JSON，不拼接验收。

本次未访问原题、私有 oracle、真实模型／裁判或历史攻击脚本；原 r5 及 blocker 不改、不追补 solved，网络权限未扩大。模型自然行为、解题能力、真实 adapter 部署及强隔离未验证；只恢复提交记录，不承诺多进程协调、完整 OpenCode 会话或 Verifier registry 恢复。
