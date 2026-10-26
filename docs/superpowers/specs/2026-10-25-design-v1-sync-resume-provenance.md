# design v1 C／D／G：创建时保存前后台参数，续接漏写时补上

日期：2026-10-25（Asia/Tokyo）。**状态：最小修复及无模型验收已完成，已合回主工作区；一次性 plan 已删除。** 本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md)的第一优先级详细子文件，细节以本文为准。沿用旧路径；此前同步执行归属、四角色强制后台及扩大的生命周期方案不再作为本次要求。

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

隔离区 `/Users/caihaoming/.codex/worktrees/task-parameter-minimal/pentest-agent`，HEAD 与 Git 祖先均为 `ee78e017a3fdbb8418329ca1843968b2fc2596f5`，带入原区 tracked dirty 与必要 untracked 输入。创建的有效布尔值在 pending 经准确 call→child 核对后保存到现有 dispatched 记录；前后台均核对创建 call，已有 native after 元数据可直接绑定，否则读取父会话的原生 task part。续接只在省略时读取创建值，显式值保留且不回写创建默认。host 以同一有效值登记，plugin before 只写回 background 和既有 description；不重放首轮指令。

既有参数／插件测试覆盖 true／false／省略创建，续接漏参，显式同值／反值及后续再漏参，错误 child／角色、无创建记录、非布尔值与 host/plugin 一致性。部分旧 SDK 替身补入原生 call→child 元数据；旧同步语义样本显式 false，返回断言补上有效值。最终 `npm test`：49 文件／486 项通过；typecheck、build 通过。

最终产品源码仅一次原生无模型 success：后台创建完成 → 同 child 续接真实漏参 → before 返回 true → 原生后台 → 本轮产物原发布校验通过并由 Engineer 读取核对。原生链的 call、child、两个 execution、发布 hash 与源码 hash 见[最小摘录](../../gates/g-solver-verification-20261023/run-completeness-20261025/task-inheritance/minimal-native-excerpt.json)。固定环境 OpenCode 1.19.3、SDK/plugin 1.19.0，本地 scripted provider；隔离 HOME/XDG，外联自检 EPERM。真实 usage unavailable，不作真实模型能力或 solved 结论。原生验收后产品源码未再修改。

未引入模式锁定、task.error 永久 revoke、promotion、SyncCall 转 Execution、stopChild／F1/F2/F3 改造或同步发布扩权；原发布与 Verifier 校验保留。显式切换的完整发布能力、错误／停止生命周期与跨 run 恢复仍在范围外；未因本片补参新增模式拒绝。本片已按逐文件 before/after hash 合回 `/Users/caihaoming/Documents/pentest-agent`，原有 dirty 输入保留；未 commit／push。必要原生摘录保存在既有证据目录，报告与单次原始样本保留于主区忽略目录 `runs/task-parameter-minimal/`；本次独立工作树验收收口后归档移除。

主区收口：整合前逐文件 before/after hash 一致，按本片增量合入，范围外已有输入未变；主区 typecheck、build、49 文件／486 项测试全部通过，产品源码 hash 与原生验收一致，因此没有重复原生样本。早期四项新增断言曾有效失败；中间回归因 SDK 替身缺 call 元数据、旧漏参同步假设失败，补足替身并将同步用例显式设 false 后通过，未放宽产品校验。结果已转入本文与 README，plan 删除。本次工作树归档移除，未 commit／push。
