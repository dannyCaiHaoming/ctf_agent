# design v1 D：从证据到可接受的验证结论

更新：2026-10-28。本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) D 的历史问题与证据子文件。**当前职责与提交策略以 [D 最小设计 §5–7](2026-10-24-design-v1-d-candidate-verification-minimal.md) 为准：直接核实 → LLM审阅 → 无法确定时按题目限制与预算自动尝试。** Verifier不补资料，确认错误flag不重复提交，unknown不当错误、不盲重发。策略已由用户确认；独立工作区已实现并通过确定性验证，已核对整合主区，实际状态与边界见 [D §8.1](2026-10-24-design-v1-d-candidate-verification-minimal.md#81-2026-10-28-三层与受限尝试无模型结果)。

以下 r4/r5 原报告、blocker与离线实验均保留原版本语境。它们解释旧实现如何拒绝，不再规定“必须充分证明才能请求裁判”。历史 r5 仍为 inconclusive、无completion，不因新设计追补成功。报告表达与旧页面实验是局部诊断，不作为三层方案的前置，不据此增加通用验证体系。

## 当前状态：已修复、历史限制与待验证

**五类 blocker 是旧 r5 报告的降级原因，不是五项未完成开发任务。** 已修复的是“不确定就一律不能提交”的链路；未将旧报告的五项限制清零，也没有补记 r5 成功。下文 §1–2、§4–5.2 保留历史证据，涉及“缺口”的表述只限定原验证主张。

| 分类 | 已确认状态 | 证据／位置 |
| --- | --- | --- |
| 已修复：证据交接 | 原件直引与 HTTP 来源元数据传递已接入；不能补做 r5 未发布的 resource，也不证明模型已正确使用 | §6，历史无模型检查 |
| 已修复：三层 Verifier 与提交 | 直接核实／LLM审阅／无法确定分层，报告意见与提交准入分开；按可信限制自动尝试，保留候选、身份、预算及停止校验 | [D §8.1](2026-10-24-design-v1-d-candidate-verification-minimal.md#81-2026-10-28-三层与受限尝试无模型结果) |
| 已修复：审查发现的关联缺口 | 同目录同可信作用域的历史跨 run 延续；证明损坏不堵住 Verifier 分派；非答案拒绝可重新准入原报告；裁判标签变化有歧义时不重置历史 | 同上；定向131项、全套591项，typecheck/build通过；主区定向复验通过 |
| 历史限制：五类 blocker | 原前提、issues、来源与依赖未知继续保留，不能宣称 verified；不再单独构成第三层提交禁令 | §2.2逐项标明现状 |
| 历史限制：脚本与材料 | 旧页面假阳性在离线模拟中成立，但未证实 r5 实际发生；包外脚本绑定、历史部署及未发布材料没有追补 | §1、§2、§5.1–5.2；不列为当前必须修复项 |
| 仍待验证：真实行为与接入 | 新角色能否自然交接、如实保留不确定并自动请求判定，以及实际裁判的限制／回执能否接通，尚无新真实运行证据 | 下节；无模型通过不能替代 |

### 剩余工作与范围

当前 D 的实现和无模型检查已完成，剩余重点是**实际接入核对与真实行为验证**，不是继续消除五项历史 blocker：

1. 若准备下一次真实验证，先核对该次启动入口实际注入的裁判、稳定 scope、提交限制及已有消耗是否符合当前接口。现有替身检查不证明某个历史启动脚本已兼容；只处理核对出的具体差距。
2. 在明确目标、模型/provider、批次和 token 预算授权后，观察三层职责能否在真实链路中执行：无法验证时如实交回，Coordinator 在允许条件下请求裁判，可信回执与保存决定完成状态。这是已有行为的待验证部分，不要求一轮运行强行覆盖全部层次，也不预设必须重跑 r5。

当前没有上述真实运行授权，本次不执行、不新建 plan。原脚本修复、通用 replay、历史部署一致性证明、多进程协调和完整会话恢复均不因本次整理变成待办；若以后目标确实依赖，再另定范围。r5 保持 inconclusive、无 completion。

## 1. r5 当时成功了什么、卡在哪里（历史记录）

原 run：`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261027-r5/runs/throwback-debug-20261027-r5-1/`。OpenCode 1.19.3，`volcano-coding/deepseek-v4-1-flash-261017`，产品版本 `6fa6c6621464bcdd11ac618fa930b7d1bdbe9bbd`、productDirty=false。以下路径相对此 run。

固定 version `f0a80e86-ab0f-4495-9bcf-8e17a934f1a1`；Verifier execution `6cd43d83-dd02-4eaa-a0de-1a9aed8e40ee`；报告 `0063135b-b061-419c-8000-51cff36d601a`。原报告为 verified/replay，宿主为 inconclusive/candidateEqual=null，`evidence/completion-results.json` 为空。

| 链路 | 已核对事实 | 不能据此声称 |
| --- | --- | --- |
| Solver → Engineer | HTTP resource `f54b23fb…`（4183 bytes）、`9f636afb…`（7573 bytes）未发布；Coordinator 当成 ref 交接，artifact.read 正确拒绝 | 不是已发布证据丢失；后续 HTTP 元数据修复不补做发布 |
| 包 → Verifier | 固定候选26 bytes；包内 replay.py 对应自身 job `29075f7a…`，包外自写脚本对应 job `650d7562…`，均 exited/0、同版本/preparation、前后 matched | 不是完整依赖、执行中持续完整性或安全网络 replay 证明 |
| 输出 → 候选 | 保存 stdout 33 bytes，其中 `[6,32)` 离线核对与候选相等；脚本有实际目标读取／提取，非只 echo 候选 | 不补记原 host 的 candidateEqual，不证明原题全部语义或充分独立验证 |
| 报告 → Coordinator | 完整21271-byte报告单页读回，长度/hash匹配，五类 blocker 保留 | 不是流过期、报告截断或接收丢失 |
| Coordinator → 裁判 | 没有请求判定；启动器已注入 `local-throwback-exact-v1` | 不是裁判拒绝，也不是无裁判配置；未 accepted/solved |

证据入口：`evidence/verification-results.json`、`publications.json`、`completion-results.json`；消息 session 尾部依次为 Solver `e85097228ffesBV9OZcvUuv7wA`、Engineer `e85082c3affea69is6996v3tFR`、Verifier `e85073cd1ffeU9jRvO4OdTiSeV`、Coordinator `e851e43c9ffep6sSbfl5yXfzei`（文件名 `evidence/messages-ses_<id>.json`）。启动器为 run 上两级 `run-once.mts`；不读取／复制私有答案。

解释机械结果的实现：[verification-results](../../../apps/launcher/src/verification-results.ts)、[control-service](../../../apps/launcher/src/control-service.ts)、[completion-tools](../../../apps/launcher/src/completion-tools.ts)。**根本断点是主张、必要条件、证据用途与可用方法未形成一致契约；五项并非同一种 bug，也不全是误报。**

## 2. r5 原报告的主张与证明负担（历史分析）

C1–C5 是旧报告分析标签，不新增产品字段。下文“缺口／阻断”解释旧规则或限制某项验证主张，不是新版第三层的通用提交禁令。无法证明不改写为verified；是否提交与solved另按当前D §7。

| 主张 | r5 支持程度 | 对历史主张的限制（不是新提交条件） |
| --- | --- | --- |
| C1 固定候选身份与保存输出相等 | 身份／范围明确，离线相等 | host 可确定比较对象，候选不能循环证明自己的来源 |
| C2 在指定本地实例独立取得并提取该候选 | 两个自身 job 有现场获取证据，包括新随机 route；仍有脚本、状态与语义限制 | 需证明数据来自授权目标且支持实际任务；退出0与相等不充分 |
| C3 全新／重置实例可重复 | 未验证，仍可见此前页面 | 新 route 不等于干净实例；不能据此声称已证明全新实例可重复，不新增重置验证任务 |
| C4 历史比赛部署一致及原题全部语义 | 缺题面／部署对应，文件字面值与答案的联系尚需依据 | 不能从 C2 外推；也不能无依据把历史部署一致性变成所有本地任务的前提 |
| C5 可信裁判接受且整题完成 | 裁判存在但未调用 | 不要求 Verifier 预知接受；题意关联仍需判断，solved 只认实际判定与记录 |

### 2.1 六项前提与五项 issues

编号按原报告顺序。以下必要性分析不修改原报告状态，尤其不把待定项改 assumed 或藏到背景。

| 原字段 | 核对与处理依据 |
| --- | --- |
| P1 assumed：授权本地实例 | host scope／题目绑定支持授权对象，不证明历史部署；尽量直接提供 host 已知事实 |
| P2 assumed：文件字面值为答案 | 是候选与任务的语义联系；读取成功、惯例格式或存在裁判都不能代证 |
| P3 unknown：包与目标持续完整性 | 混合本地执行和外部状态。分清实际依赖；前后 matched 不证明持续完整性。原 requirements=false 不取消这项 premise 对 verified 的限制 |
| P4 unknown：跨 job 状态／未验全新实例 | 检查实际数据是否依赖前次残留；不能直接删掉，也不能未经分析要求所有现场观察都先重置实例 |
| P5 unknown：候选 file 原始完整性 | file 的 originalComplete=null 是事实；固定比较对象与独立证明来源不同。若结论依赖该来源，现证据不足以支持 verified；不派发补证任务 |
| P6 unknown：本地与历史比赛一致 | 对 C4 是真缺口；是否影响本地任务由实际验收决定，现材料不足以定其必要性 |
| I1：源码字面值、函数／路由未知 | 可能影响题意联系；既不能因可读而认定答案正确，也不能仅因不是专属端点否定候选 |
| I2：无硬编码完整候选，且声称无 flag 前缀 | 前者为支持性观察；后者与脚本搜索／说明文字矛盾，应纠正。未见完整常量也不充分证明独立性 |
| I3：Solver 两个 ref 缺失 | 实为未发布 resource 误传。独立新证据能否替代须看证明链，不能伪造原观察已交付 |
| I4：包外自写脚本未固定 | 原 preparation 不包含 `../../indep/verify_replay2.py` bytes；当前磁盘内容不能追补历史绑定。若该脚本是必要证据，缺口保留 |
| I5：无题面、格式靠惯例、无平台判定 | 题意依据不足与尚未请求判定分开；不能由此推断 host 没有裁判 |

### 2.2 五项 evidence 与五类 blocker（历史限制，不是待办）

| evidence（0起始） | 事实与用途边界 |
| --- | --- |
| 0 | 包内脚本 job stdout，33 bytes，necessary=true，comparison `[6,32)`；支持相等，不能独自证明语义 |
| 1 | 同 job stderr，364 bytes，necessary=true；步骤日志不是完整 HTTP transcript |
| 2 | 自写脚本 job stdout，1083 bytes，necessary=true；片段完整不等于全部响应完整，脚本绑定仍缺 |
| 3 | 候选 file ref `39fa5ee0-a188-44de-b287-c1492a06b212`，26 bytes，necessary=true、originalComplete=null；比较对象不自动是独立来源 |
| 4 | HTTP ref `78ddedaa-d7ac-499d-a5c5-a5090f3ddcbb`，2584 bytes，necessary=false；含新 HTTP 来源字段，不能替未发布 resource 补历史 |

前三项 originalComplete=true 只表示对应捕获输出流完整，不证明全部网络操作、依赖或目标状态完整。

下面五项仍可使原报告保持 inconclusive；**保留降级理由与允许受限尝试并不冲突**。不删校验、不把 unknown 改成 assumed，也不要求 Verifier 补齐证明。明确反证 rejected、候选损坏、错身份及预算／提交限制仍按当前 D 阻止发送。

| 历史 blocker | r5 的准确触发点 | 当前状态与处理（非待办） |
| --- | --- | --- |
| replay unavailable | replay 分支无条件降级；精确 comparison 仅在 recompute 执行 | **能力限制保留，提交耦合已修。** 未建设 replay；新流程可用 LLM 审阅或无法确定记录，不再把建设 replay 作为前置 |
| required premise unknown | P3–P6 任一 unknown | **历史未知保留，提交耦合已修。** 必要前提未知仍使支持不足；候选可信且限制允许时可走第三层，不需先消除全部未知 |
| unresolved verifier issues | I1–I5 非空 | **历史问题保留，提交耦合已修。** 不宣称支持 verified；保留诊断，不要求 Verifier 修完问题才能请求判定 |
| undeclared dependencies unknown | declaredDependenciesOnly=true，必要证据未提供 proven_absent | **证明能力限制保留，提交耦合已修。** 原要求未获证仍记不确定；LLM审阅不强制程序证明，不把该字段改 false 来过关 |
| necessary source incomplete or unknown | evidence[3] 原完整性 null | **来源限制保留，候选与证明检查已分开。** 不追补原来源完整性；候选本体及原引用严格核对，证明不足可转第三层 |

## 3. 从历史问题保留的责任与撤回的要求

保留 host真实来源／版本／候选绑定、resource与ref区分、能力信息如实交付、原报告不可改写，以及停止、预算、未知提交等事实边界。缺口可以影响Verifier意见，但不必全部由它解决。

撤回“先建立通用充分接受条件”“证明重放安全或补齐包外脚本绑定后才能推进D”“所有必要unknown或issues都禁止请求裁判”等作为产品前置的要求。不能把真实未知改成assumed来凑verified，也不需要这样做：三层方案允许如实inconclusive后自动尝试。Verifier不补资料、不修脚本、不重新探索，诊断留日志供开发者使用。

r5 当时的代码按旧规则降级是历史事实，不代表新策略仍应禁止它进入预算内尝试；也不能据新策略断言历史裁判必接受。已知候选身份或bytes损坏、错题、越权等仍阻止请求，与证明不足分开。

## 4. 旧报告表达验证的结论与局限（历史记录）

2026-10-27 的离线组件核对基于同一产品版本 `6fa6c662…`，由 gpt-6.1-sol 开发子 session 在隔离区执行；没有产品模型调用。实际 Node26.3.0、tsx4.23.15、Zod3.25.76。直接 import 既有 reportSchema 与 VerificationResults.register/read，以固定历史 evidence、原候选和独立内存 context 核对；未运行 ControlService 身份／来源解析或当前有效性链路。

原报告不变作负对照；分析副本仅整理文字和 I2，保留2 assumed/4 unknown、requirements、comparison、全部 source/association 与 necessary `[true,true,true,true,false]`。两者均无损序列化／分页，重现同五类 blocker，effectiveJudgment=inconclusive、candidateEqual=null。组件命令一次 exit0；14份原输入与123份产品／角色／测试／依赖文件 hash 未变，父 session 独立核对；实际依赖版本修正文档后只重做收口检查。

**设计纠正：** 这回答了“缺口能否保存、现行拒绝能否重现”，没有构造由证据独立支持的可接受正例，也没有检测必要事实被移除后是否拒绝。因此原先“本例表达问题已完成／无需据此扩 schema”对接受能力的推论撤回；该次实验既不足以支持扩 schema，也不足以证明旧接口足够；后续三层实现的结果另见 D §8.1。问题在验证判据缺乏区分能力，不能归咎执行者未按 plan 做，也不能增加测试数量替代判据修正。

[原去敏记录](../../gates/d-artifact-handoff-20261024/report-expression-20261027.json)保留21项主张／前提／issues／evidence映射、命令及原结论，不重写历史；其关于设计充分性的解释以本节纠正为准。临时驱动、原副本、结果和日志保留于 `/Users/caihaoming/.codex/worktrees/d-report-expression-verification/pentest-agent/runs/d-report-expression-verification/`。一次性 plan 的结论已转入本文及该证据，完成父核对后移除；不把旧 plan 当后续设计依据。

## 5. 已完成的局部调查与当前去向

原调查问“运行包内脚本为何不能进入可信判定”。现已区分旧接口拒绝与局部脚本限制；用户选择三层策略后，不继续以补证完成为推进条件。下面只保存定位与实验结论，不自动生成后续验证任务。

### 5.1 当时源码与原记录已能回答的部分（历史调查）

2026-10-27 只读复核同一 r5 版本、原报告 evidence[0–2]、prepared `inputs/replay.py`、当时 control-service/job-tools/verification-results 与 Verifier 角色说明；未执行历史脚本、访问目标或调用裁判。

- **包内脚本已有执行关联，不缺通用收据。** `replay.py` 为6371 bytes，SHA-256 `d1f7d54b18d69a7d288ad01e9cd015e737cbfcb1db1a3669c263fb14615084df`，在必要 job 的 preparation.files 中；实际 argv 为 `python3 replay.py --base http://127.0.0.1:8001`，前后 matched、exited/0，输出已保存。不能把第二份包外脚本的缺口套到第一份上，也不需要新建脚本登记体系来证明这些已有事实。
- **实际联网能力与验证用途冲突已确认。** 脚本经 urllib 登录、写入模板页面、读取目标文件；这不是只用固定材料的本地重算。当时 job.run 直接启动受管进程，未强制作业网络 scope；旧 Verifier 文案允许选择安全重放，却又限定 job 本地重算、没有普通 HTTP，report 的 replay 无条件阻断。新版角色已按三层策略同步，未新增受控网络 replay；相关范围已由 [G §5.5／§6](2026-10-23-design-v1-g-solver-minimal.md)记录。不能将网络可达视为已批准的重放接口，也不需要再次做实验来证明这条源码中的无条件拒绝。
- **脚本对新旧状态的区分有具体缺口。** 使用固定 `PAGE_ROUTE="flagchk"`，写入后只接受状态200/302，再读取该路由并从响应提取匹配字符串；没有本次操作标识或新内容核对。原 stderr 证明本次写入返回302，未保存该写入响应的完整业务结果。§5.2 的离线对照已确认：在“匹配的写入返回302但页面未更新、随后读取旧页”的模拟条件下，原脚本仍返回0并输出相同匹配字符串。这是脚本层面的假阳性路径，不是已经证实 r5 发生了该情况；注释声称运行间重置，也不是 host 记录。
- **第二份脚本不能无条件补证。** 新随机路由提供额外支持，但其实际脚本 bytes 不在原 preparation.files 中；只有决定必须依赖它时，才考虑最小关联办法。当前文件不能追补历史。

### 5.2 旧页面误判最小验证（已完成）

2026-10-27 在不访问原题、其他服务或网络、不读取私有 oracle 的条件下完成。输入为 r5 preparation `77016744-85ab-47ac-8973-b1d553d59691` 中的 `replay.py`：6371 bytes，SHA-256 `d1f7d54b18d69a7d288ad01e9cd015e737cbfcb1db1a3669c263fb14615084df`，与原报告 preparation.files 一致；执行前后原文件和隔离副本 hash 均未变。驱动使用 Python 3.13.10，只把模块的 `http` 边界替换为离线模拟器，调用未改动的 `main()`，并在加载和调用前阻断 socket 连接。

- **A：本次写入有效。** 初始无页面；匹配写入返回302并把页面设为包含 `flag{offline_marker}` 的新页；随后读取200。脚本返回0，stdout 为 `FLAG: flag{offline_marker}`。
- **B：写入未更新、旧页仍在。** 初始已有包含同一非秘密标记的旧页；同一匹配写入返回302但不改变页面；随后读取200仍是旧页。脚本仍返回0，stdout 与 A 完全相同。
- **控制。** 两例都实际经过 `GET / → POST /admin → GET /admin/pages → POST /admin/pages/flagchk → GET /flagchk`；请求字段、nonce/route 校验、写入 payload hash 和状态序列一致，差异仅来自模拟器初始状态及该次写入是否更新页面。没有真实 socket 尝试，产品代码／既有测试未改。

**结论：** 在这个明确的离线条件下，原脚本无法区分“本次写入产生的新页面”和“写入返回302但未生效后读到的旧页面”；只看退出0与提取到的匹配字符串，不足以证明整条获取链在本次执行中产生了该内容。该结论支持前述静态推断，但不证明 r5 实际读了旧页面，也不证明目标存在该故障。该历史实验不修脚本、不新增 host gate、不改变原报告或solved；新版将这一限制作为审阅依据和诊断，而非要求Verifier补证的前置。最小去敏记录见[离线对照证据](../../gates/d-artifact-handoff-20261024/replay-stale-page-20261027.json)。

### 5.3 新策略已定，历史调查不再扩成前置

2026-10-28用户确认：流程资料明确时直接核实；不能简单复核时用LLM审阅现有过程、理论与日志；仍不能验证则记录原因，按题目提交限制与剩余预算自动尝试，不逐次询问。确认错误的flag由host去重，结果未知不当错误、不盲目重发。完整行为与职责统一见[D §5–7](2026-10-24-design-v1-d-candidate-verification-minimal.md)。

旧页面实验仅说明脚本在指定模拟条件下无法区分新旧内容，不证明r5发生该故障。它应进入开发诊断，不要求Verifier修脚本、补本次操作证明或重跑全题。原关于扩大Verifier目标操作能力、通用replay、包外脚本关联的候选不作为本轮必须选择或实现的事项；现有能力不足时可以直接进入第二／三层，不绕过权限。

旧实现的 effective verified 提交前置已改为判断与准入分离，角色／插件也已同步；显式 unknown、issues 与未证必要 requirements 仍使支持降为 inconclusive，但候选可信时可在 host 限制内按第三层提交。本次只有本地确定性替身接线，无新真实产品运行或接受证明，状态见 D §8.1。原始证据继续保留，不清空旧报告的必要条件、不改模式、不将模型判断升为裁判结果。

## 6. r4 已完成修复与保留证据

r4 run 位于 `/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261026-r4/runs/throwback-debug-20261026-r4-1/`，产品记录 `89e47dde` 且 productDirty=true，不能仅凭 commit 还原源码。最终包 `0fc41d40-e254-407a-ad93-3c38858d3c43`：三份原 HTTP／文件副本长度为26/26、6218/6230、2638/2638；prepare 保留了所选副本 bytes，损失发生在重新复制／发布时，不是 prepare 损坏。两份报告虽 candidateEqual=true，仍有四类 blocker、无 completion。

原 ref 经既有 publish/read/package/prepare 可保留来源和精确 bytes，离线42项定向检查通过，见[原件可读性证据](../../gates/d-artifact-handoff-20261024/original-evidence-readability-20261026.json)。具体 HTTP 上下文当时未进入来源记录，manifest 不能恢复未采集事实。

基于 `fb8f618b6174ea1e9f02adbb8f636f924f92c316` 的最小修复已于2026-10-27核对接入：同 body capture 的实际 method/status/有界 Content-Type/host scope origin 随 callID/resource→source.http→publication→manifest/prepare 交付；角色改为原件直引、Coordinator 交目标、Verifier 独立选方法。未修改报告 schema／判定门槛。

所有 path 仍为 null/omitted_unattested，不能核实具体 endpoint；userinfo/query/fragment不传值，缺失／已知秘密／超2048 bytes分别标记 missing/redacted/omitted_over_limit。精确历史时间、认证、请求参数、当前状态与业务语义未因此获证；200不等于业务成功，不追补旧来源。

新增断言先8 fail，随后82项定向及 typecheck/build通过；全套首败57项，涉及仓库内 TMPDIR 隔离与 require-is-not-defined。仅调整专用区的仓库外 TMPDIR 后全套494/494、exit0，源码未再改。配置、来源hash、首败／成功日志保留于主区忽略目录 `runs/d-http-evidence-implementation/`；主核对10份源码／角色／测试与已测评审快照一致，未重复全套。该轮工程结果不证明模型遵循，也不消除 r5 历史限制或追补 verified/solved；后续三层实现状态见本文开头。

[空正文恢复](2026-10-26-design-v1-c-empty-result-recovery.md)与[方法／耗时](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)各自处理其问题，不作为本设计固定前置。新版三层策略不新增角色、通用证明／replay／恢复系统，也不扩网络、同步发布或预算权限；实现范围以当前D §5–7为准。
