# design v1 C／D／G：任务参数继承与同步交付身份

**状态（2026-11-10）：已落地。续接漏参补值（`b1afa29a`）与同步交付身份（merge `c120e143`）均通过无模型验证；promotion（Q5）记为限制、未实现。真实模型下的行为未单独验证。**

本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) C／D／G 的任务执行归属子文件。改写前的实施与整合记录（隔离工作树、hash 核对、测试数量变化）见 commit `268813d5` 中的本文。

## 1. 续接时漏写 background（r3）

**问题：** r3 中同一 child 首次以后台创建，续接时漏写 `background`，OpenCode 按前台执行，随后发布被 `artifact execution` 拒绝。OpenCode 1.19.3 的 task 按每次调用的 `background` 决定方式，`task_id` 不继承它；公开的 before hook 可以修改实际参数。

**决定：** 创建任务时保存有效的 `background`，同任务续接省略时补上保存值再交给 OpenCode。ControlService 计算有效值并按它登记本轮，插件经 before hook 把同一布尔值写入原生参数；只改 host 记录、原生仍收到省略值是不够的。

| 情形 | 行为 |
| --- | --- |
| 新建时为 true、false 或省略 | 按该方式调用；可信绑定后为该 child 保存（省略视为 false） |
| 合法续接，省略 `background` | 取创建记录的值写入本次实际参数 |
| 续接显式填写 true 或 false | 保留本轮的值，不拒绝也不覆盖，不改写创建默认值 |
| 续接省略，但没有可信创建记录 | 明确报告无法继承，不猜 false，不借旧记录 |
| 非布尔值，或不属于本父的 `task_id` | 走既有类型与身份检查，不通过补参绕过 |

**范围：** 只保存 `background`，复用现有 parent／role／child 记录；绑定前暂存，核对 call → child 后才保存。只保存在当前运行内存，不跨 run 或重启。prompt、description、model 等不从首轮重放。

**不采用：** 创建方式锁定（`mode change not supported`），它把默认值误当成不可变属性；task.error 后「本 run 永久不可续用」，那是额外的错误恢复政策；旧的四角色强制后台补丁及其 promotion、forceRevoke、stopChild 改造。这些都不是修漏参所需，旧补丁已撤回，不整包恢复。

**验证：** 无模型原生样本中，后台创建 → 同 child 漏参续接 → before 返回 true → 实际后台 → 本轮产物通过原发布校验并被 Engineer 读取。证据见[补参结论摘要](../../gates/g-solver-verification-20261023/run-completeness-20261025/task-inheritance/README.md)与[原生摘录](../../gates/g-solver-verification-20261023/run-completeness-20261025/task-inheritance/minimal-native-excerpt.json)。原始日志已按用户要求删除，只剩结论摘要。

## 2. 同步分派无法发布（r6）

**问题：** r6 中 Recon 与 Engineer 都以同步方式分派成功，但 11 次 `artifact.publish` 都因缺 execution 被拒。根因是 execution 只在 `background===true` 分支建立，同步分派从不建立，而发布与来源记录都要求本轮 execution。这不是绑定时序问题，同步 child 的 session 与绑定都正常。同一 run 中两次后台分派缺 `subagent_type` 被拒，是正确行为，与发布缺口无关。

**决定：** 同步与后台都拥有可信的本轮执行身份；同步或后台只决定等待和交付方式。保留「长任务推荐后台」，不恢复角色一刀切的后台限制，也不把显式 false 改成 true。

| 阶段 | 规则 |
| --- | --- |
| 建立 | 校验角色、父所有权、题目、模式参数与预算后，在原生任务开始前建立唯一的本轮 execution；新建与续接都如此。缺 `subagent_type` 时明确返回缺角色。被拒的调用不产生执行身份 |
| 绑定 | 沿 SDK parent／agent 与原生 call → child 关系绑定 session；新 child 在首次受管操作前完成。续接要关联本次 call，不能套用上次的执行 |
| 使用 | workspace.write、HTTP、job 等来源记录绑定本轮身份；发布继续严格核对 run、题目、来源、bytes、hash 与活动权限。资源产生时就固定身份，不在发布失败后补造 |
| 结束 | 同步从可信原生返回结算，后台从可信完成通知结算，只结束对应的执行。生命周期完成、报告完整性与 solved 分开记录 |
| 错误与停止 | 启动失败、原生错误、取消与 deadline 按实际情况结算；迟到事件不能复活执行或覆盖已知错误；不因一次普通错误永久禁用 session |
| 续接 | 同一 child 在前轮可续接、没有冲突的活动执行时，新 call 建立新 execution；旧产物的 producer 不改写 |

**实现：** `Execution` 增加 `mode: 'sync' | 'background'`，两种方式都在 `tool.before` 建立同一类 execution。`SyncCall` 改为结果交付视图，其 child、source、facts 直接读写所属 execution，两份状态不会分歧。`settleSync` 是同步 execution 唯一的结束出口：正常返回为 completed；错误、child 不符或缺绑定为 failed；停止、过期或撤销为 cancelled；已终态的不会被迟到事件复活。

**范围：** Verifier 仍须后台分派并绑定每轮的 version／preparation，不开放同步 Verifier；Intake 不因此获得发布权限；不新增网络或工具权限。工具说明与 `engineer.md`、`recon.md`、`domain-solver.md`、`coordinator.md` 的发布文案已对齐为「同步或后台都能发布」。

| 验证（2026-10-28，无模型） | 结果 |
| --- | --- |
| r6 失败链（新增原生 scripted 链 `tests/manual/g-sync-delivery.ts`） | 改前复现 0 个 execution 与发布被拒；改后同步 Recon 发布、Engineer 固定 package、同 child 再续接发布，3 个 execution 均为 sync／completed |
| r3 补参 | 漏参续接仍为后台；显式 false 实际同步且能交付；之后再漏参仍继承创建默认 |
| 负例 | 原生错误、child 不符与停止都会结算，之后不能发布；迟到的 `tool.after` 不覆盖错误；同步 Verifier 仍被拒 |
| 全套回归 | 合并后 `npm test` 597 项通过 |

## 3. 已知限制

- **promotion（Q5）未实现。** 同步调用若被转为后台（完成信封带 `metadata.background===true`），execution 会一直保持 running，同 child 无法续接，run 只能撑到 deadline。按可达性判定不实现：r6 中持续约 24 分钟的同步 Recon 没有任何 promotion 记录，无头产品路径也没有触发转后台的操作。这是安全的失败方式，不会误标 completed。**观察点：** 真实 run 一旦出现该信号，再设计可信的终态关联；不恢复旧的 SyncCall → Execution 补丁、provider 旁路或 OpenCode fork。
- `tests/manual/g-team-integration.ts` 在本改动前已失效（断言与同步 execution 语义冲突），未修。
- 真实模型下是否消除 r6，未单独验证。r6 本身在发布缺口暴露前已经 `deadline_exceeded`，Recon 效率问题归 [B 通用解题方法](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)。
