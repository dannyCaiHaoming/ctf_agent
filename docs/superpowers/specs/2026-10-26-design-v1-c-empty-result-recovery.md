# design v1 C：生成到上限后的空正文与结果恢复

日期：2026-10-26；2026-10-27 更新（Asia/Tokyo）。状态：**已验证两个原始分类断点及同步／后台原生工具链；普通完成入口的最小多轮分类修复已按 §3.1.2 实现、通过无模型验收并合回主区（§5.4）；转后台、错误与不支持链的边界保留。实际额度接线及生成改善仍待独立验证。** 本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) C 的详细子文件，细节以本文为准。本片已修改结果分类及完成入口，未改配置、角色或发布校验，未运行真实模型；历史预算不继承。

## 1. 问题背景与证据

原 run：`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261026-r4/runs/throwback-debug-20261026-r4-1/`。版本为 OpenCode 1.19.3，产品 HEAD `89e47dde` 且工作区有未提交变更；模型为 `volcano-coding/deepseek-v4-1-flash-261017`。复现必须使用 run 保存的配置、资产及对应源码哈希，不能仅由 HEAD 推定输入。以下路径均相对该 run。

| 已观察事实 | 解释边界 |
| --- | --- |
| 消息中 6 次 assistant 为 finish=length、output=0、reasoning=8000：Engineer 2、Verifier 2、Solver 1、Critic 1 | 是跨角色的生成不完整现象；不能只修 Critic，也不能把所有 length 都当空白 |
| Critic `evidence/messages-ses_e8c4e20c8ffeK8MCXYu73eos6U.json` 先读 progress(limit=200) 和 Web Skill，输出约 63022／11581 字符；随后消息 input=25460、reasoning=8000、output=0 | 大输入与空输出同时出现，尚未证明输入长度是唯一根因；字符数不等于 token 数 |
| Critic 的同步 task `call_00_mby58byi8lk9f5324ji43gm7` 已返回 completed，task_result 为空；附加事实为 unknown／multiple_assistants | 后来的 abort 不能倒推为空正文原因；本例不是尚未返回，也没有证据表明生成的正文在传输中丢失 |
| `child-result.ts` 有 length → incomplete 分支，但先要求同一冻结 user 仅有一个 assistant；多于一个先返回 unknown／multiple_assistants | 分支存在不代表真实多轮任务会进入该分支；复用现有出口，检查选取规则，不再建通知机制 |
| r4 的 13 次后台 execution 均 completed／delivered，resultFacts 全为 unknown／multiple_assistants；父消息实际包含这些事实 | 通知已到达而分类失去区分，不能统称为父端未收到；原通知文本是否有其他有用信息应另看，不归咎 Coordinator 忽视准确状态 |
| r4 admissions 的单次上界为 3,784,868–5,000,000；当前 profile 所指配置为 limit.output=8000 | 六次纯 reasoning 触顶与单次额度一致，不是 run 总预算耗尽；当前文件不等于历史配置，需匹配 r4 configSha256，不能声称已见实际 provider 请求 |

既有[结果完整性设计](2026-10-25-design-v1-run-readiness-and-result-completeness.md)已记录历史 8000 配置来源及输出接线调查。先复用该证据、核对 r4 是否同源；不重复已成立的结论。该设计继续负责身份关联、事实展示与 Root 完整性，本文补充其真实多轮终态识别缺口及尚未确定的生成／恢复策略；不重做已有身份和显示接口。

### 1.1 两个可定位的原始消息对照

2026-10-27 只读复核基线为主区 `2be4ebbe` 加已有文档改动，未运行验证或真实模型。原 Critic 同一 user `msg_173b1df3b001Y7jZEy73SbLPzo` 下依次为 `msg_173b1df49001VcyWmpkxEE3rzG`（tool-calls，progress／skill）和 `msg_173b1e68a001oNrDKMkfYK2Iyz`（length、零正文）。最终 Verifier `ses_e8c467a92ffeZ8nDKrwwc0ycvr` 的续接 user `msg_173ba5fae001j5IVPjk30Xqnwe` 下有六条 tool-calls assistant，再由 `msg_173bb583f001X04LbKGepHztqY` 以 stop／非空 text 结束；后台事实同样变为 multiple_assistants。来源分别为对应 `evidence/messages-<session>.json`、`task-executions.json`、Root messages 和 `control-audit.json`。

这证明“同 user 多条 assistant”不能单独作为冲突依据；尚未证明靠排序或最后一条就能安全选终态。原始消息事实、SDK 返回顺序保证、原生任务结束边界和跨轮归属需要分开核实。既有测试中的两个终态、未结束后继及重复 ID 冲突仍是有效反例，不能为处理正常工具链删掉它们。

## 2. 要解决什么，达成后有什么效果

**产品目标：** 减少单次生成未交付可用正文的情况，并在确实未完成时准确交回原因，使 Coordinator 能在原授权内选择补交、换路或停止。生成端避免问题与结果端准确表达是两个独立判据：修分类不会产生正文，调额度也不会修复消息误分类。

**当前最小工程问题：** 正常工具调用链与真正多终态／跨轮冲突如何区分。已按公开原生结束边界完成 §3.1.2 的最小分类修正，验收见 §5.4；不把恢复调度作为前置工程。

成功效果有两层：工程上，已终止的本次生成不会被当成完整报告，也不会因未知归属被错误关联到另一轮；行为上，必要角色能以有限额外消耗交付可用结论，或者明确结束为未完成。成功不等于每次必须恢复，更不能以强行输出一句话代替可用报告。

## 3. 解决方向、候选做法与结果去向

先沿实际链路定位：run 配置／模型额度 → OpenCode／公开插件参数 → 实际 provider 请求与 finish → 子消息 → task 生命周期 → 父上下文。宿主只投影可知状态，Coordinator 决定解题动作，OpenCode 保持原生调用循环。

| 待验证做法 | 适用证据 | 结果去向 |
| --- | --- | --- |
| 利用公开原生结束消息身份或已证实的任务结束边界区分工具链与终态 | 同一冻结 user 的中间 tool-calls 与最终 stop／length 可可靠关联 | 优先复用已给出的身份；没有直接身份时才验证有界候选选择。证据不足、冲突或仍有未结束后继保持 unknown，不按数组最后一条或时间最大值硬选 |
| 按相关性缩小当前决策输入：按需读取相关进度与 Reference，不重复搬入全文 | 具体请求含大量无关或重复材料，关键事实可完整保留 | 在现有读法／角色提示中局部修正；若删减会丢决定性事实，不采用该删减 |
| 使用公开配置调整单次输出或 reasoning 分配 | 确认 r4 实际请求额度及 provider 支持的公开参数；预算允许 | 仅为受影响情境选择可解释配置；若不支持或效果不成立，记录缺口，不猜参数、不无上限加 token |
| 同任务补交已完成工作的结论 | 已有结果、引用可用，只缺最终正文，且任务已达到允许续接的状态 | Coordinator 使用既有 task 续接，说明只补当前结论及缺口；保留创建参数继承，不重做已发生的工具副作用 |
| 缩小后续任务或报告未完成 | 当前上下文无法安全恢复、来源未知、没有新依据或预算不足 | 保留已有事实，改成更小的授权目标或停止；不得永久禁用整个 session，不盲目新建任务绕过限制 |

以上是候选组合，尚未选定提高额度、特定压缩阈值或自动重试策略。补交前必须确认上一执行的状态：仍在运行不能因一次 length 消息就重复启动；已执行的 HTTP／发布等动作不能因空正文被视为未发生。副作用结果未知时沿用既有 unknown 边界。

**定位分支：** 若正确完整性已经到达父端而 Coordinator 无依据等待／重试，修决策输入和恢复指令；若确定终态没有到达或关联错误，按既有 C 接口做最小接线修复；若原生任务本身尚未结束，先查公开生命周期行为，不预先增加定时器、轮询或通用调度器。

### 3.1 结束消息识别：调查分支与已定范围

优先检查固定 OpenCode 1.19.3 的公开 task／SDK／事件接口是否提供可绑定到本轮 user／call 的最终 assistant 身份。若存在，验证真实性与同步／后台对应关系后采用；若没有，检查任务已结束、同 session／冻结 user、完整消息集合下，能否排除已完成工具调用中间消息并唯一识别终态。这是验证时的候选分支；验证结论见 §5.1，限定后的实施决策见 §3.1.2。

2026-10-27 本片验证结论见 §5.1：公开 task 未提供精确最终 assistantID；有界集合选择仅在同一冻结 user 的相关投影完整且稳定时成立，当时保留为条件性候选。后续不要求所有入口共用该前提，而按 §3.1.1 限定入口、§3.1.2 限定可识别链；不是把演算的手工条件值当作宿主证据。

无可靠终态、两个相冲突的终态、未完成后继、同 ID 矛盾、来源缺失或跨轮混入时继续 unknown；停止／错误事实不能被后续正常文字掩盖。不要删除异常消息后制造唯一结果。若公开接口不足，记录准确缺口，保留 unknown，不加轮询、定时器、后台接管或 OpenCode fork。若本轮身份／状态本来正确，才转向父端使用方式；不能先以增加恢复提示代替分类修复。

### 3.1.1 已定的最小入口边界

依据 §5.2，入口先判生命周期与来源，再决定能否分析本轮消息；不要求所有入口共用一个“已稳定”假设。

| 入口／观察 | 已定边界 |
| --- | --- |
| 可信关联的普通 completed | 原生等待 prompt 返回支持正常收尾边界；仍须读取同一冻结 user 的完整相关投影并检查身份、冲突、工具结算及终态。不得因 completed 就直接给报告 complete；length、空白 stop 仍为 incomplete，不能唯一识别则 unknown |
| 同步 running／promotion | 本次同步返回不是任务终态，不据当前 SDK 消息发布终态判断；保留未完成／unknown，沿用原生后续 completion，不加轮询或重分派 |
| 后台 error | 保留 execution failed 和原错误信封，正文不能改写生命周期。报告完整性与生命周期独立；仅同一冻结 user 的可靠事实才能描述报告，证据不足为 unknown，不能拿后来另一轮的 stop 补本轮。并非所有 failed 都必须强制把报告改成 unknown |
| stop 同时带工具 | 不能直接当最终消息。若工具及消息已结算、属于 §3.1.2 支持的普通工具链，则可识别为中间步骤；providerExecuted／interrupted 等特殊路径本片不推定，保持 unknown |

入口边界本身不能修复 multiple_assistants；本次将普通完成路径的具体选择规则限定如下。不增加全面隔离、锁或生命周期改造。

### 3.1.2 最小分类修复定稿：已完成的普通工具链

**要修的源头：** 现有分类器把 assistant 数量当作结果歧义的判断依据。正常工具链会产生多个 assistant，却不一定有多个最终结果。本片改为检查同一冻结 user 的完整消息链，区分已结算中间步骤与唯一终态；不增加恢复调度或自动重试。

**适用前提与依据：** 仅对可信关联的普通 completed 入口采用本规则，保持当前关闭 auto compaction／prune 的运行配置。固定版本源码支持 prompt／processor 收尾后才返回普通完成结果，既有原生探针覆盖正常工具链；host 沿用同 call/ref→冻结 user 关联、无 limit SDK 全页读取和读后绑定／停止复核。这里采用的是受管正常完成路径的契约，不承诺任意外部 SDK 改写、所有 promotion／异常路径或跨页事务隔离。读取失败、边界不明或出现相关冲突立即保留 unknown，不新增重读循环、锁或通用版本机制。

1. **先核对完整相关集合。** 保留已有冻结 user、session、parentID、重复 ID 与来源冲突校验；同 ID 必须比较实际正文与判定所需工具状态，不能只比长度。跨轮消息不用于补齐本轮，但相同 ID 在其他身份下的矛盾不能被筛掉。不得删除未完成或异常消息制造唯一结果。
2. **识别中间步骤。** 消息已完成、无 assistant error，存在普通 host 执行的工具调用，所有工具状态均为 completed／error，finish 为 tool-calls，或者为原生仍会继续循环的 stop。普通工具 error 是已结算的实验反馈，不自动变为 assistant APIError，也不能因后续正文而抹去。特殊 providerExecuted、interrupted/orphan、未知工具状态／finish 保守 unknown；不声称覆盖全部原生链。
3. **识别唯一终态。** 同轮恰有一个不带工具的已完成 assistant，finish 为 stop／length；其余均满足中间步骤条件，并且可核对其结束不晚于终态开始。时间只验证链的一致性，不以最大时间或数组最后一项选择消息。多轮所需时间或状态缺失、终态之后还有相关步骤、多个终态、未完成后继都 unknown。单消息既有可判事实与错误语义保留，不为新多轮路径增加无关必填条件。
4. **保留原报告含义。** length（有无正文）均 incomplete；stop 非空白正文才 complete，空白正文 incomplete。complete 仅代表报告格式上的完整，非内容正确或 solved。assistant 错误、停止及失败生命周期继续保存；复杂错误链无法可靠选取则 unknown，不从后续文字推翻原错误。不因 error 信封强行改写已知报告完整性。
5. **非适用入口不提升。** running／promotion 不发布终态判断，等原生后续 completion；不固定前后台或创建新执行来规避。后台 error 保持 failed，不能进入“正常 completed 多轮链已收尾”的假设；沿用可可靠确定的同轮报告事实，其余 unknown，不重做错误生命周期。

**定稿的程度：** 这是有限修复决策；产品实施与无模型验收已在 §5.4 完成，不代表全部竞态已被实测。stop-with-tools 的中间步骤规则来自固定版本 prompt.ts 的显式继续条件，先前离线候选对此 unknown；实施时须补一条对应回归，不能宣称已由上一批24项覆盖。原生及源码已有依据足以开始这个最小实现，不再把证明所有同 user 改写路径作为前置条件。若实施碰到不满足上述受管前提的具体入口，保持 unknown 并记录，不扩为全生命周期项目。

**验收针对原失败：** 原 Critic 工具链应识别为 length／零正文 incomplete；正常 Verifier 工具链应识别最终 stop／非空正文 complete，且中间工具 error 与任务失败状态不被覆盖。再覆盖 stop+工具的中间步骤及原有冲突／未结束／跨轮反例。真实模型恢复、正文产生和耗时改善不在此验收中。

### 3.2 生成额度：独立验证问题

8000 是强线索而不是参数处方。需要先匹配 r4 配置 hash，再核对配置 → OpenCode model limit → plugin chat.params → 请求序列化的参数去向，并区分 output／reasoning 的计量定义。历史 HTTP 请求若未保存，就明确不可追溯；当前受控请求捕获只证明当前同版本接线，不冒作原请求。

若本地接线错误，修配置／插件实际丢失边；若参数正确而 provider 接受方式或 reasoning 分配未知，查该版本公开能力再决定是否值得模型对照。若不支持独立 reasoning 控制，保留不支持，不猜字段。按需缩小输入与调整额度是待比较的方法，不预定数值或优先有效性。当前首份验证不执行这项参数探针，也不做模型对照；该问题的后续安排只由其证据需求决定，不阻断消息识别这一独立切片。

## 4. 限制与不做

保留[创建方式保存与漏参补齐](2026-10-25-design-v1-sync-resume-provenance.md)及发布校验；不固定前后台模式，不永久撤销错误后的任务。不上新角色、judge、结果 schema、强制报告 gate、自建 provider 循环或 OpenCode fork。固定 JSON 输出不能让未生成的结论出现，不作为首选修复。

本次不决定数值阈值。任何额度调整受 run 总 token、deadline、调用上限及用户重试授权共同约束；所有失败和恢复消耗计入同批，不重置预算、不静默切换 provider。上下文压缩不得删掉关键反证、来源或未确认副作用。

## 5. 需要验证什么与完成条件

本节保留验证问题及历史结论；§5.4 记录其后实施验收。最初验证只回答：**现有公开原生链路能否把多轮工具调用中的结束消息可靠关联到本次任务，而不误选其他轮次或冲突消息。**

复用 §1.1 的失败与正常对照；原始记录只读，提取身份、finish、完成状态及正文长度等最小事实，不复制 reasoning、候选正文或完整工具输出。先复现当前 multiple_assistants，再核实固定版本公开接口。只有原记录不能回答运行时契约时，才复用已有本地 scripted provider 驱动做最小原生探针；不用真实模型，不重跑原题。原生探针与离线消息变体分开陈述，不把 mock 的选择结果当作原生接口保证。

本片完成条件：对正常工具链后的 stop、length 空正文、length 部分正文给出可核对的身份／结束依据；对跨轮、未结束、冲突、未知来源和停止相关反例保留边界；每项结论标明证据是原记录、源码契约还是实际探针。结果足以选择 §3.1 的一个分支，或明确接口不足即可结束，不要求先修改产品得到绿灯。把版本、条件、命令、失败与最小证据回写本文，不自动实施修复或转入参数实验。

生成端需要另行确定 §3.2 的参数去向；接线成立不证明生成改善。真实模型对照必须另有目标、模型/provider、批次及 token 预算授权，固定其他输入，单变量比较可用交接与时间／token，保留失败，不能以输出更长替代内容有效。当前文档与无模型切片均不把整个 C、恢复效果或模型能力标为完成。

### 5.1 2026-10-27 验证结论（条件性，未实施）

基线 `2be4ebbeb63f670b7da9fe03cfca925a8278f4e7`，OpenCode 1.19.3／SDK 包 1.19.0；三个携入文档 hash、源码来源及最小事实见[证据摘要](../../gates/g-solver-verification-20261023/run-completeness-20261025/parent-display/c-terminal-message-verification.json)。生产代码、角色及既有断言未改。

- **原记录：** Critic 同 user 的 tool-calls → length／零正文；Verifier 续接同 user 的六条 tool-calls → stop／2222 字符，均复现当前 `multiple_assistants`，并与同步回覆、后台 execution／父通知事实对应。Verifier 中间一条工具 error 保留；最终报告完整不代表此前工具成功、内容正确或 solved。r4 为 `89e47dde` 加未知 dirty，不能据此声称与当前源码相同。
- **源码契约：** [task.ts](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/tool/task.ts#L201) 等待 prompt，再把返回消息裁成 text；同步 metadata、后台通知均未暴露精确最终 assistantID。原生结束只能提供生命周期边界。当前 host 冻结 call/ref → user，读取后重查来源、绑定及 stop/有效期；无 limit 的 SDK messages 经服务端遍历所有页，返回按创建时间／ID排列的全体消息，排序本身不是选择规则。
- **原生探针：** 复用旧驱动，仅补同步／后台两个入口，各同 child 两轮：真实只读工具调用 → length 空正文，再续接工具调用 → stop／14 字符。两组 launcher 和驱动均 exit 0，分别 7／9 次本地 scripted 请求，child 各 4 次；当前父端仍如实显示 `multiple_assistants`。首次驱动误用 intake 未开放工具导致 exit 1，保留失败；不算有效工具链。loopback-only、空白凭据环境、无真实模型或目标。usage 为 unavailable，脚本伪造用量不当实测。
- **离线候选：** 完整校验同 user 集合及重复 ID 后，要求唯一无工具的终态，其余为已完成且工具已结算的 tool-calls，保留顺序矛盾和错误事实；再区分 length／stop／正文非空白。24 项演算通过，含两个终态、未完成后继、跨轮、停止／错误、缺来源／读取失败、纯空白 stop、同 ID 等长异文 digest 冲突。`stop` 携带工具也可能被原生 prompt 继续执行；本候选对此返回 unknown，**不覆盖全部正常链**。候选未接入生产；历史与原生已保存数组上的演算不冒作运行时保证。既有 75 项定向测试通过，未改其拒绝语义。

**收敛分支：有界集合的条件性候选，尚未闭合实现规则。** `completeStableRound` 只指**同一冻结 user 的相关消息／parts 投影完整，并在选择所依赖的期间不被相关写入改变**。普通 completed 路径中，原生等待 prompt／processor 完成再结算 job；后续 task 创建新 user；当前配置关闭自动 compaction／prune。这些源码与记录支持该局部推论。后台先标 completed 后允许新 user 追加，不自动破坏旧 user 投影；无需据缺少事务快照推出全面隔离。

但不能从现有所有出口直接推出该条件：同步 `toolAfter` 自身未要求 completed 而非 running／promotion 信封；后台 error 信封不能被后来 stop 文字覆盖；现有读取前后重查来源／绑定／停止，不是对同 user 所有消息／parts 改写的直接版本检查。本轮没有证明所有返回路径中均无相关后续改写，也未测试这些自然竞态。因此保留条件性与 unknown；**未证明“公开接口完全不足”，也未证明当前 host 在所有入口已满足稳定性条件**。不新增全局隔离、轮询或恢复机制；参数、模型效果与产品实现均未进入本片。

主助手已核对原生驱动、同步／后台结果及独立复核意见；复核发现的纯空白正文、等长异文冲突已补入离线演算，stop 携带工具的适用限制保留。120 份产品／测试文件 hash 与验证前一致，主区既有改动未覆盖。结论与最小证据已合回主区，必要驱动、短日志和源码来源保存在忽略目录 `runs/c-terminal-message-verification/`；一次性验证 plan 已删除。专用工作树在保留这些材料后归档。不自动开始实现或额度验证，未 commit／push。

### 5.2 2026-10-27 入口边界复核与主助手裁定

原调试对话基于相同 `2be4ebbe`／OpenCode 1.19.3／SDK 1.19.0，复用已保存 tag 源码、同步／后台探针作只读核查，没有新增测试或模型调用。报告保存在主区忽略目录 `runs/c-terminal-message-verification/entry-boundary-review.md`。task 等待 prompt 返回后才结算正常结果，但同步等待可由 promotion 提前返回 running；job error 通过失败信封交付。上述证据足以区分 §3.1.1 的入口，不证明所有同 user 消息改写或自然竞态不存在。下载源码与 hash 沿用 §5.1 摘录；没有重复75项检查或原生探针。

主助手核对 `control-service.ts` 的 receiveCompletion／toolAfter、`child-result.ts` 与既有结果完整性设计 §3 后，修正报告中“error 后出现 complete 就覆盖错误”的过强表述：receiveCompletion 已独立保存 execution failed，resultFacts 不会把它改成 completed；同 child 新 user 的文字也受冻结 user 过滤。既有契约允许 failed 与报告 complete 并存，不应通过本片改成一律 unknown。要保留的是错误生命周期、同轮归属与真实完整性，不新增错误永久禁用或模式限制。

结论：最小入口规则定稿，完整结果选择器仍未定稿；不能据此宣称 C 已可直接整体实现或空正文已解决。报告的普通 completed 规则是必要入口条件，并非消除 multiple_assistants 的充分算法。后续设计只需补清正常多轮链的选择条件及对应反例，不预排更多测试批次；8000额度问题仍独立。复核中四条 jq 投影因 parts:null 失败，随后安全投影成功，未拿失败输出作依据。未改产品／角色／配置，未 commit／push。

### 5.3 2026-10-27 范围收口决策

用户要求确认方案围绕 C 核心并收口结果分类。本次复核固定版本 prompt.ts 1099–1125 的工具继续条件与现有分类器后，选定 §3.1.2 的普通完成工具链规则。§5.1／§5.2 保留当时验证的限制，不追溯标成全入口证明；现在通过限定入口和已知链语义作实施决策，不再将“全部路径稳定性证明”作为前置交付。此决策没有新增实验或改变原验收门槛，也不把复杂未知链提升为完整。额度耗尽导致无正文仍是 §3.2 独立问题。

### 5.4 2026-10-27 最小分类修复实现与无模型验收

基线 `2be4ebbeb63f670b7da9fe03cfca925a8278f4e7`，OpenCode 1.19.3／SDK 1.19.0；GPT‑6.1‑sol 子代理在专用工作树实现，另一子代理只读审查通过，主助手执行原生探针并核对增量后合回主区。四份源码／测试的最终 hash、实际检查命令及退出码、原生消息身份与结果事实，追加在既有[证据摘要](../../gates/g-solver-verification-20261023/run-completeness-20261025/parent-display/c-terminal-message-verification.json) 的 `implementation` 中；之前的条件性验证与失败不改标。

- **实现源头修复：** `child-result.ts` 从“一轮只能有一个 assistant”改为完整相关集合中的普通工具中间步骤与唯一无工具终态。比较实际正文、工具状态与必要时间；不靠最后一条或最大时间选结果。单条带工具的 stop／length 也不能冒作最终报告。未知工具语义、冲突、未完成及跨轮边界保留。
- **完成入口：** `control-service.ts` 只有可信普通 completed 才启用多轮选择；同步原生 completed 信封须与 child 身份吻合，running／promotion 不读取 SDK 后猜终态。后台 error 保持 failed，不启用普通完成多轮假设；原本可靠的单条报告完整性仍独立保存。插件与发布校验未改，没有前后台限制、永久禁用、重试或新调度器。
- **原失败回归：** 用不含历史秘密正文的 Critic“工具→length空正文”及 Verifier“六个工具步骤（含一个普通工具error）→stop正文”结构，先确认旧分类器在同步／后台四项均因 multiple_assistants 失败（exit 1），再通过真实控制服务及父端输出断言。新增正常与必要反例后，两份既有定向文件 114／114 通过；stop+工具作为中间步骤由定向测试覆盖，未冒称原生探针覆盖。测试装配阶段曾缺 SDK 父消息导致 unbound session，修正测试装配后继续；失败日志保留，不当产品缺陷或通过证据。
- **原生父端：** 复用既有本地 scripted 驱动，同步与后台各同 child 两轮。第一轮实际工具后 length／0 字符准确交回 incomplete，续接实际工具后 stop／14 字符交回 complete；核对冻结 user、所选 assistant 与父端显示。两组 launcher 及驱动均 exit 0，分别 7／9 次本地请求，child 各 4 次。原生信封、关联身份与原工具结果保留。空白凭据环境、loopback-only，外联探测为 EPERM；没有真实模型，usage unavailable，脚本伪造用量不作实测。
- **最终检查：** 最终源码的 `npm run typecheck`、`npm run build`、`npm test` 均 exit 0；49 份测试文件共 533 项通过。测试使用本片独立 cache，TMPDIR 在仓库外，未改共享依赖。合回后以 hash 核对与已验源码完全一致，并做差异／文档连结检查，不重复未变源码的全套测试。

本片仅合入两份产品文件和两份既有测试；C 与核心设计更新实际状态，其他未提交工作保留。必要驱动与短日志保存在忽略目录 `runs/c-classification-implementation/`、`runs/c-classification-native/`，结论转入本文后删除本次 plan，专用工作树归档；未 commit／push。

**完成边界：** 普通工具链的结果识别工程修复已完成，不等于整个 C 完成。仍未验证或实施 §3.2 的生成额度改善、模型补交行为、解题提速；不支持链继续 unknown，也不承诺任意外部同 user 改写。真实模型或新参数实验不由本次验收自动授权。

## 6. 与其他设计的关系

[证据到可信完成](2026-10-26-design-v1-d-evidence-to-completion.md)负责验证材料及判定条件，不在这里改 Verifier 门槛。B「通用方法与耗时」草案（尚未提交）可分析知识缺口，但评估解题加速时须单独统计本问题造成的等待与恢复。三者按具体依赖推进，不构成固定里程碑顺序。
