# design v1 C／D／G：任务参数继承与同步交付身份

更新：2026-10-28（Asia/Tokyo）。本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) C／D／G 的任务执行归属子文件，沿用原路径。

**当前决策：支持已获准同步运行的 Recon／Domain Solver／Engineer 完整交付成果，execution 不再以后台模式为存在前提。设计与最小验证见 §8；尚未实现或执行本轮验证。** 不扩大 Verifier 权限，不恢复四角色强制后台或整套旧生命周期补丁。

**历史已完成：** §1–7 记录 r3 的创建方式保存／续接漏参修复，已随 `b1afa29a` 提交。该轮主动排除了同步发布，不能将其通过解释为 r6 问题已修。以下“本次／移出范围”均指当时批次；§8 仅重新纳入当前交付直接依赖的执行身份与结算，不恢复其他旧待办。

## 1. 唯一目标与原始问题

**创建任务时保存有效 background；同任务续接未填写时补上保存值，再交给 OpenCode。** 不让模型每轮重复维护 host 已知参数。

原失败为 `throwback-debug-20261025-r3-1` 内的同一 child 续接：首次后台，续接漏写 background，OpenCode 按前台执行，随后发布被 `artifact execution` 拒绝。这是新 run 内的续接，不是跨 run 恢复。原日志位于 `/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261025-r3/runs/throwback-debug-20261025-r3-1/`；既有定位为 audit seq1412／1427、1676／1681／1728／1739、1778。

OpenCode 1.19.3 的 task 按每次调用的 background 选择方式，省略默认前台；task_id 本身不继承该参数。公开 before hook 可以修改实际 args。已采用本地无模型样本验证该接口能补回 background，见 §5。不重开接口可行性探索，不改变 OpenCode 或新增执行框架。

## 2. 已确定的最小规则

| 情形 | 本次行为 |
| --- | --- |
| 新建 background=true | 按后台调用；可信绑定后为该 child 保存 true |
| 新建 background=false 或省略 | 按前台调用；可信绑定后保存 false |
| 合法同 task_id 续接，background 省略 | 从该任务创建记录取值，写入本次实际调用参数 |
| 续接显式填写 true 或 false | 保留本轮填写值，不以与创建值不同为由拒绝，也不覆盖；不改写创建默认值 |
| 续接省略但没有可信创建记录 | 明确报告无法继承，不猜 false、不借旧执行记录、不静默换 child |
| 非布尔值、未知或不属于本父的 task_id | 保留字段类型和既有身份准入检查，不通过补参绕过它们 |

创建默认值与本轮显式选择分开：例如后台创建后显式 false，本轮仍是 false；以后再次省略时仍补创建的 true。这是补参规则，不表示本次已验证所有切换后的发布或生命周期能力。

仅新增保存 background，复用现有 parent／role／child 记录与绑定。绑定前暂存于本次 pending，准确核对 call→child 后再保存，不能按同角色猜任务。保存范围为当前运行内存，不增加磁盘持久化或跨 run／重启恢复。

仅在续接漏写时补值。prompt、description 的用户内容、command、model/provider、调用与消息编号、Verifier version/preparation 不从首轮重放；身份、权限、预算、期限及原有状态检查继续走已有逻辑。

**明确撤销两项新增设计限制：** 不加 `mode change not supported` 的创建方式锁定；不因 task.error 新增“本 run 永久不可续用”规则。前者把默认值误当不可变属性，后者是额外的错误恢复政策，均不是修复漏参所需。现有停止／撤销约束不因此删除，已有错误处理也不在本次重新设计。

## 3. 最小接线与已有代码取舍

采用已验证的接线：ControlService 计算有效值，按同一有效值登记本轮；plugin 通过公开 before hook 将该布尔值写入原生 args。不能只修改 host 记录而让原生仍收到省略值。复用原来的前台结果路径、后台 Execution 和发布校验，不新建结果接收机制。

2026-10-25 清理：原工作区 `/Users/caihaoming/Documents/pentest-agent` 已按逐文件前后 hash 撤回旧四角色强制后台补丁及配套测试／指令，恢复为该补丁之前的已有工作，未实现补参。扩大实现未合入，废弃隔离区归档回收。本次最小代码现已合回主区，下表保留本片选择边界，不能整包恢复旧扩大补丁。

| 已有增量／位置 | 本次取舍 |
| --- | --- |
| ControlService 的 dispatched 记录增加 background，首次可信绑定写入 | **保留**，用于保存创建值；只依赖现有任务记录 |
| toolBefore 的漏参解析、以有效参数 registerDispatch、返回 taskBackground | **保留并缩小**：只补省略值；显式值原样进入既有流程 |
| plugin index 的 taskBackground 布尔值写回 | **保留**，保证真正发给 OpenCode；不扩成任意 args 覆盖 |
| bindFromSdk 精确核对 call→child | **保留参数归属所需部分**，避免保存到另一个任务；不连带引入错误恢复政策 |
| 四角色强制 background=true 的新增分支与 Coordinator 重填要求 | 旧补丁已精确撤回；后续只补创建保存、漏参继承说明，长作业推荐后台仍可保留 |
| 相反值拒绝分支，以及要求其拒绝的测试／文案 | **不保留**；本次代码没有该拒绝分支 |
| taskEvent 自动 forceRevoke、报错后永久禁止复用，以及配套断言 | **不保留到本片**；原有 taskEvent 逻辑不因本次顺带改写 |
| promotion 通知 tag、SyncCall 转 Execution、对应 after／通知转换 | **移出本次**；不新增运行中转后台处理 |
| stopChild 的 F2 当前轮停止／历史 ref 修复 | **移出本次**；不能作为漏参修复的前置验收 |
| F3 在绑定时提前写 SyncCall.childID，及目录等待／失败后的清理回归 | **移出本次**；该轮是为扩大的错误撤销契约补修，不与保存 background 一起合入 |
| 其他结果分类、重复调用策略变更和大矩阵测试 | 不整包吸收；仅保留补参直接需要的参数一致性断言，既有行为其余不改 |
| 身份／scope／hash／来源／预算／停止，以及 Verifier 每轮版本约束 | **保留已有校验**，不以修复漏参为由删掉或扩展 |

普通前台 artifact/package 发布以及 Verifier 前台能力不在本次交付范围。既有 Verifier 专用准入与新增的四角色一刀切检查不同，不能一起删除。本次不宣称显式模式切换后的全链路能力，也不为未验证能力新增一刀切限制。

## 4. 移出本次的事项与停止边界

运行中 promotion、全面前后台结果改造、报错后的取消／abort与可恢复条件、当前轮停止修整、同步发布身份、跨 run 恢复，均不再是本次交付项或通过条件。保留本节的历史发现与补参结论摘要，废弃代码以应用归档可恢复，不留在活动交付中；**不自动新建计划、不接着实施**。重复与扩展场景材料已按用户清理要求移除。

已有 F1/F2/F3 发现不能被改写成“没有问题”；但其扩大实现不因此成为补参修复的必需内容。若后续提取最小代码时出现直接阻断原失败链的具体依赖，先报告依赖和范围影响，不能再次自动并入整套生命周期修复。

## 5. 已有结论与证据边界

已有无模型证据支持选择上述公开 before 补参方案，无需把方案可行性重新验证一遍：

- 后台创建→同 child 漏参续接，调用者没有补填重发；OpenCode 实际仍走后台，本轮发布与读取通过，原发布校验保留。
- false／省略创建的前台样本，漏参续接实际保持前台并返回报告。
- host 记录与原生参数一致；只改 host 账本或要求模型每轮重填均不能代替该修复。

历史结论：[补参历史结论摘要](../../gates/g-solver-verification-20261023/run-completeness-20261025/task-inheritance/README.md)。强制后台、promotion、停止和永久撤销的重复样本及旧范围审查已按用户要求清理，不能再将其列为本次验收。原始日志和三个样本已按用户清理要求删除，现仅保留结论摘要，不能据此重核原始运行；废弃隔离代码可通过应用归档恢复。

固定环境为 OpenCode 1.19.3、SDK/plugin 1.19.0；本地脚本 SSE、仅 loopback、隔离 HOME/XDG，无产品真实模型。扩大实现最新保存了 546 项测试与八个原生样本通过，但该代码包含本次排除的内容，且最终限定复审已停止。**这些结果证明当时版本，不代表已经提取并验收了本次最小补丁。** 历史扩大版本不作为本片验收；以下 §7 记录本片最终代码的独立验收。不声称真实解题或 solved。

## 6. 本片最小验收定义

1. 既有测试中检查创建 true／false／省略的记录值；续接省略继承；显式 true／false 不被覆盖或因与创建值不同而拒绝。显式选择不改写创建默认值。
2. 核对 plugin 收到并写回有效布尔值、host 登记方式与原生一致，错误任务身份和无可信记录不误继承；保留有效既有检查。
3. 核心无模型原生样本只要求：后台创建完成→同任务漏参续接→实际仍后台→本轮产物通过原发布校验并接收。复用已有驱动与证据位置，不要求补齐八场景矩阵。
4. 将来代码改变后按仓库规则做适用定向检查及 typecheck/build/test；没有新代码变化、失败或明确未决点就不重复。原生样本只针对最终最小代码的原失败链，不因文档变更重跑。

完成含义仅为“创建方式已保存，漏参续接已正确补值，原失败链通过”。本次由 GPT-6.1-sol 子 session 实施并完成上述最小验收，现按用户要求仅将本片增量合回主区。结论已转入本文和既有 README，一次性 plan 已删除。

## 7. 本片实际结果（2026-10-25）

本节以下为当时实施与整合记录，“未 commit／push”描述该历史阶段。2026-10-26 已随 `b1afa29a` 收口参数继承、进度接入与路径修复；提交前主区 typecheck、build、49 文件／486 项测试通过，未新增真实模型或原生 scripted 运行。提交不扩大下述最小验收边界。

隔离区 `/Users/caihaoming/.codex/worktrees/task-parameter-minimal/pentest-agent`，HEAD 与 Git 祖先均为 `ee78e017a3fdbb8418329ca1843968b2fc2596f5`，带入原区 tracked dirty 与必要 untracked 输入。创建的有效布尔值在 pending 经准确 call→child 核对后保存到现有 dispatched 记录；前后台均核对创建 call，已有 native after 元数据可直接绑定，否则读取父会话的原生 task part。续接只在省略时读取创建值，显式值保留且不回写创建默认。host 以同一有效值登记，plugin before 只写回 background 和既有 description；不重放首轮指令。

既有参数／插件测试覆盖 true／false／省略创建，续接漏参，显式同值／反值及后续再漏参，错误 child／角色、无创建记录、非布尔值与 host/plugin 一致性。部分旧 SDK 替身补入原生 call→child 元数据；旧同步语义样本显式 false，返回断言补上有效值。最终 `npm test`：49 文件／486 项通过；typecheck、build 通过。

最终产品源码仅一次原生无模型 success：后台创建完成 → 同 child 续接真实漏参 → before 返回 true → 原生后台 → 本轮产物原发布校验通过并由 Engineer 读取核对。原生链的 call、child、两个 execution、发布 hash 与源码 hash 见[最小摘录](../../gates/g-solver-verification-20261023/run-completeness-20261025/task-inheritance/minimal-native-excerpt.json)。固定环境 OpenCode 1.19.3、SDK/plugin 1.19.0，本地 scripted provider；隔离 HOME/XDG，外联自检 EPERM。真实 usage unavailable，不作真实模型能力或 solved 结论。原生验收后产品源码未再修改。

未引入模式锁定、task.error 永久 revoke、promotion、SyncCall 转 Execution、stopChild／F1/F2/F3 改造或同步发布扩权；原发布与 Verifier 校验保留。显式切换的完整发布能力、错误／停止生命周期与跨 run 恢复仍在范围外；未因本片补参新增模式拒绝。本片已按逐文件 before/after hash 合回 `/Users/caihaoming/Documents/pentest-agent`，原有 dirty 输入保留；未 commit／push。必要原生摘录保存在既有证据目录，报告与单次原始样本保留于主区忽略目录 `runs/task-parameter-minimal/`；本次独立工作树验收收口后归档移除。

主区收口：整合前逐文件 before/after hash 一致，按本片增量合入，范围外已有输入未变；主区 typecheck、build、49 文件／486 项测试全部通过，产品源码 hash 与原生验收一致，因此没有重复原生样本。早期四项新增断言曾有效失败；中间回归因 SDK 替身缺 call 元数据、旧漏参同步假设失败，补足替身并将同步用例显式设 false 后通过，未放宽产品校验。结果已转入本文与 README，plan 删除。本次工作树归档移除，未 commit／push。

## 8. r6：支持同步任务交付（已实现并通过无模型验证；promotion 为已知缺口）

### 8.1 依据与范围

r6 `throwback-debug-20261028-r6-1` 中，两次后台分派的保存参数缺少 subagent_type，被拒为 role not dispatchable；随后 Recon／Engineer 明确同步分派成功，但11次 artifact.publish 均因缺 execution 被拒。会话／题目已绑定，task-executions、publications、verification-results、completion-results 均为空。对应来源为 `/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261028-r6/REPORT.md` 及该 run 的 control-audit／root messages；不是后台能力不可用，也不是 r5 五项报告限制再次阻塞。

**2026-10-28 只读诊断（未改代码）已把根因定稿，不再是待确认线索。** execution 身份只在 `task` 分派的 `background===true` 分支铸造（`apps/launcher/src/control-service.ts:555–561`）；同步分派走 `syncCalls` 分支（同文件 :549–554），**从不建立 execution**。而 artifact/package.publish 与文件／HTTP／job 来源记录都要求 `operation.execution`（:764/:789/:171，经 :704 与 :172 以「`childID===本session` 且 `state==='running'`」查找），因此同步分派的来源角色结构上无法发布。r6 `control-audit.json`（2070 条）佐证：4 次分派全为同步（4 条 `sync.source`，各自 `bind via dispatch` 均成功），`task.execution` 记录 **0 条**，11 条 `denied: artifact execution`（Recon `ses_e801097e` 6 条、Engineer `ses_e7ff9a1b` 5 条）。两次后台分派缺 subagent_type 在建 execution 之前即被**正确**拒绝（2 条 `denied: dispatch`），与 publish 缺口相互独立：前者是 prompt/角色问题、宿主行为正确，后者才是宿主侧结构缺口。**不是绑定时序问题**——同步 child 有 session、绑定正常，只是没有 execution 物件。修法须在 `syncCalls` 与 `executions` 之间定出单一来源／活动状态（见 §8.2 末段），不维护两份可能矛盾的状态；具体接法由 §8.3 最小验证确定。

r3 是后台创建后漏参续接，r6 是首次有效调用就显式同步。旧补参规则继续有效；本次补齐其未覆盖的交付身份。采用**同步和后台均可拥有可信本轮执行身份**，保留长任务推荐后台，不恢复角色一刀切后台限制，不把显式 false 偷改为 true。

范围是已有角色权限内的来源记录、artifact/package 交付与必要生命周期接线。Verifier 仍沿用既有后台准入、独立会话及每轮 version/preparation 绑定；本次不开放同步 Verifier，不新增网络／工具权限。Intake 等已有同步用途保持，不因此获得发布权限。不得恢复旧补丁中的永久错误撤销、通用恢复框架或整套调度改造。

### 8.2 execution 的建立、绑定、结束和续接

下表是目标行为，不承诺当前结构或公开 hook 已完成全部接线。复用 ControlService、原生 task、既有 call/source/binding 与结果出口；不另建一套任务 registry，不由模型填写 execution。

| 阶段 | 宿主规则 |
| --- | --- |
| 建立 | 校验角色、父所有权、题目声明、模式参数及预算／停止边界后，在原生任务开始前为获准调用建立唯一的本轮执行引用，关联 run、parent、callID、role、challenge及适用的version。新建与续接均如此；同步／后台只决定等待和交付方式。缺 subagent_type 明确返回缺角色，不能猜角色或改调度方式。被拒调用不产生可用执行身份 |
| 绑定 | 初始为待绑定；沿现有 SDK parent/agent 和原生 call→child 关系准确绑定 session，并关联本轮 user/source。新 child 首次受管操作前必须完成；续接也要关联本次call，不能仅凭已绑定session或同角色套用上次执行。缺失、冲突或并发轮次不明时拒绝受影响操作，不借历史 execution |
| 使用 | 获准执行期间，workspace.write、HTTP、job 等来源记录绑定本轮身份；artifact/package 发布继续严格核对同run／同题／来源、bytes、hash及活动权限。资源产生时固定身份，不在发布失败后补造。旧资源保留原producer，当前选择者按既有 selectedExecution 语义记录；普通文件来源未知仍为unknown/null |
| 正常结束 | 同步从可信原生 completed 返回结算，后台从既有可信完成通知结算。身份、call和child核对后，只结束对应执行，不影响同session历史轮次。同步返回与后台通知各沿既有出口记录交付，不重复唤醒。生命周期完成、报告完整性与solved分别记录；正文为空或unknown不等于执行仍在运行 |
| 错误／停止 | 分派启动失败、原生task错误、取消和deadline按真实事实结算本轮及其资源；迟到事件不能复活执行或覆盖已知错误。不因一次普通错误永久禁用session。停止／结果未知继续保留既有边界，不允许凭不明状态新开一轮绕过未决资源；不为本片新增通用重试政策 |
| 续接 | 同一child的前轮已具备既有可续接条件、无冲突活动执行时，新call建立新execution；旧产物／来源身份不改写。省略background仍继承创建默认，显式值保留且不修改默认。模式变化不重置预算、题目、资源或版本要求；同步完成后必须能合法继续，不能遗留永远running的execution |

**运行中转后台不是新一次执行。** 原生同步调用若返回 running／promotion，只表示等待方式变化，不可标 completed、不可创建第二个来源身份或释放原执行。后续只能依公开接口可信关联的终态结算，父 idle 不能提前收尾。这一关联的具体接法是 §8.3 的待验证点；不直接恢复旧 SyncCall 转 Execution 补丁，也不从自由文本猜关联。

工程上应让同步与后台共享可信身份与发布规则，保留各自结果交付入口。是否让现有 SyncCall 引用 Execution、以及复用哪些字段，由最小验证确定；不得维护两份可能矛盾的来源／活动状态。只将本轮身份必要的停止、错误与收束关系接通，不顺带修改结果分类、恢复策略或完整会话持久化。

### 8.3 最小无模型验证与结果去向（已实现并通过无模型验证，2026-10-28；结果见 §8.4）

复用既有 contract 文件及已有原生 scripted 驱动；隔离模型凭据、只用本地确定性响应和非秘密字节，不访问原题或私有oracle。不新增 gate体系、持久fixture或全队做题流程。以下是行为覆盖，不要求每行另造测试平台。

| 要回答的问题 | 最小观察与判据 |
| --- | --- |
| r6 原失败点能否消除 | 首次同步分派来源角色→可信绑定→写文件／产生来源→artifact.publish→同题Engineer读取并固定package。先复现现代码 execution缺失，再核对本轮身份和精确bytes；不是绕过publish或预造ref |
| r3 修复与显式选择是否保留 | 后台创建→漏参续接仍实际后台；显式false续接实际同步且能交付；后续再漏参仍继承创建默认。每轮执行引用不同，旧产物producer保持原值 |
| 同步分派能否建立并结算执行身份（§8.1 诊断：缺口在 execution 铸造，非绑定时序） | 一个最小原生scripted同步交付链，观察同步分派即建立 execution、绑定 sync child、首次工具前为 running、同步返回后结算及同child下一轮；不能仅用手工注入execution的替身证明成立 |
| 结束／错误会不会串轮或放行非法发布 | 在既有定向测试检查正常结束、启动失败／task错误、停止后的当前轮结算与拒绝；错parent／child／题目、无执行身份仍拒绝。已结束资源的合法读取与本轮新发布按各自既有权限处理 |
| 同步转后台是否保留同一执行 | 复用公开task接口的最小promotion观察：running不结束、不重复建身份；后续可信终态关联原执行，且不因父idle提前结束run。不扩成通用promotion框架 |

**结果去向：** 原生绑定、完成／续接和必要promotion关联均可通过现有公开接口闭合时，回写具体版本与观察，再拆实施plan。若只需现有hook的局部接线，记录位置和边界；若确实缺少可信关联，则记录具体缺口和受影响路径，保留unknown，不宣称全链支持。需要新增入口限制或改变显式模式选择时，回到设计讨论，不自行恢复后台强制、provider旁路或OpenCode fork。不能拿普通completed通过代替promotion成立。

完成本片只证明同步交付身份与生命周期接线，不证明真实模型遵循或CTF解题成功。2026-10-28 已完成只读根因诊断（根因定稿见 §8.1），并据此实现最小接线、通过无模型验证，结果见 §8.4。

**r6 另有一个独立卡点，不被本片 publish 修复掩盖：** 本次 run 在 publish 缺口暴露之前已 `deadline_exceeded`（Recon 约 t=1489s／24.8 分才首次 publish，30 分到时），停止原因是 deadline 而非 token/准入/job 上限。即使同步执行身份修好，throwback 这次也会超时。Recon 效率属 [B 方法泛化与效率](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)范围，不由本片承诺解决。

### 8.4 实现与无模型验证结果（2026-10-28）

据 §8.1 根因在独立 worktree（Sonnet 执行）实现最小接线并通过无模型验证，已提交（`b2f64c56`）并合入主区（merge `c120e143`，本地，未 push）。无真实模型调用。实现本身未改 `opencode-plugin`；随后（§8.4 末「说明对齐」）单独对齐了工具说明与角色文案。

**单一身份的接法（落实 §8.2「不维护两份可能矛盾的状态」）：** `Execution` 增 `mode:'sync'|'background'` 字段；同步与后台都在 `tool.before` 铸造**同一个** execution（同步的 `delivered` 初始为 true 且不带 `[ctf:ref]` 描述，后台行为不变）。`SyncCall` 退化为结果交付视图，其 `childID`／`source`／`facts` 经访问器直接读写所属 execution，故两者不可能分歧。新增 `settleSync` 为同步 execution 的**唯一**结束出口：原生正常返回→completed；`task.event` error／返回 child 不符／binding 缺失→failed；stop／过期／撤销→cancelled；已终态者不被迟到事件复活（`bindFromSdk` 亦只改非终态 execution）。同步 `tool.after` 的 child 不一致由抛 `completion correlation` 改为走 failed。

**已闭合（经现有公开接口，原生时序成立）：**
- r6 失败链已消除：改前跑新加原生 scripted 链复现 r6（`task-executions`／`publications` 0 条，审计 `denied: artifact execution`／`artifact source`／`package execution`）；改后同链成功——同步 Recon 写文件并发布、bytes 精确，同题 Engineer 读取并固定 package，同 child 再同步续接一轮再发布。3 个 execution `mode` 均 `sync`、状态均 `completed`、ref 互异，第二轮复用同一 child；审计顺序为 铸造→绑定→首次受管工具→`sync.settled`；旧产物 producer 不变。
- r3 保留：后台创建→漏参续接仍后台；显式 `false` 续接实际同步且能交付；再漏参仍继承创建默认。
- 负例仍拒：原生 error／返回 child 不符／stop 均结算且其后不可发布；迟到 `tool.after` 不覆盖已知错误；同 child 同时只一轮活跃、同一 callID 不可重放、同步 Verifier 仍被拒、Intake 不获发布权限。
- 验证手段：`npx tsc --noEmit`、`npm run build`、`npm run test:deterministic`（38 文件／554 项）全绿；新增原生 scripted 链 `tests/manual/g-sync-delivery.ts`（本地确定性 stub provider + 真实 `launch()`，不写 `docs/gates`、不依赖 loopback 靶场）。既有反证断言按行为翻转（`control-service.test.ts` 1 处、`g-async-lifecycle.test.ts` 5 处 `toHaveLength` 由「同步续接不建 execution」改为「每个同步调用恰好一个 execution」），另加 6 条新测试。合并主区后完整回归 `npm test`：**49 文件／597 项全绿**（`test:deterministic` 为其中 555 项）。

**未解缺口（Q5，promotion，按设计未实现）：** 同步调用若返回 running／promotion（完成信封带 `metadata.background===true`），execution 保持 `running`、无出口结算，同 child 后续续接被 `execution still active` 拒绝，父 idle 判断持续认为有未完成工作。未恢复旧 SyncCall→Execution 补丁，也未猜关联。

**可达性判定（2026-10-28 复核）：现有证据支持此缺口不可达于产品自身分派，故按限制记录、不实现 Q5。** 依据：r6 真实 run 中一个同步 Recon 持续约 24 分钟，其 control-audit 的 promotion／`background:true` 记录为 **0 条**（仅 3 条 `task.correlate`、3 条 `sync.result`，均为正常同步完成），即 OpenCode 1.19.3 未把长前台任务自动转后台；无头产品路径也没有触发 promotion 的交互动作（无 TUI 用户操作、模型无「转后台」工具）。promotion 信号只能来自 OpenCode 核心（不在仓库源码内，无法静态证伪），且现有防呆**失败安全**（不误标 completed、不污染状态；最坏为被转后台的同步 child 无法续接、run 撑到 deadline，而非静默错误）。**观察点：** 真实 run 若在同步调用上实际出现 `metadata.background===true`，回到此卡点设计可信终态关联，不恢复旧 SyncCall→Execution 补丁／provider 旁路／OpenCode fork。

**说明对齐（2026-10-28，消除错误说明、非提示词修 bug）：** 下列文案此前仍称产物只能在后台任务发布，与同步已支持冲突，已对齐实际能力、保留 Verifier 后台要求：`apps/opencode-plugin/src/index.ts` 的 `artifact.publish` 描述由「in a native background task」改为「whether this task was dispatched synchronously or in the background」；`product/opencode/agents/engineer.md`、`recon.md`、`domain-solver.md` 发布句去掉「原生背景任務內」前提（同步或背景分派皆可发布）；`product/opencode/agents/coordinator.md` 分派说明区分「长任务推荐 `background=true`」与「recon／domain-solver／engineer 同步亦可、两者同样能发布」，verifier 仍强制 `background=true`。此为文案对齐，未改代码逻辑。

**仍未处理：** `tests/manual/g-team-integration.ts` 在本次改动**之前**即已失效（HEAD 代码跑亦 `phase 12≠13`，其断言与现同步 execution 语义冲突），未改，属 B 范围。

**真实模型行为仍未验证。** 本片只证明无模型下的身份与生命周期接线；是否在真实 run 下消除 r6、以及 promotion 可达性，需另行取得模型 token／时间授权后验证。
