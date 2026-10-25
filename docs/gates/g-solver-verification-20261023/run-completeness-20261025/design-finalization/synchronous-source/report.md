# R3 同步源归属无模型验证

结论：候选 A 在 OpenCode 1.19.3 的公开 hook/SDK 上具备最小可行路径，**metadata 单独不足以定位本轮 user，但 tool.before 逐 call 记录 + chat.message 冻结 user + tool.after 的 parent/child metadata 核对足够**。无需把同步任务造为后台 execution/ref；保持父原生等待和同步返回即可。本次只是隔离观察原型，不是产品交付，未接入主区，也没有同步事实展示到父请求的联合验收。

## 输入与边界

工作区 `/Users/caihaoming/.codex/worktrees/sync-result-validation/pentest-agent`，为主会话当前 dirty 输入副本，非只按 HEAD。执行前输入与 baseline 在 `input-hashes.json` / `baseline/`；最终观察改动在 `observer-candidate.patch`，hash 在 `source-hashes.json` / `batch-source-hashes.json`。仅修改该副本 `apps/launcher/src/control-service.ts` 以投影身份和在同步返回边界读取精确 user 对应的元数据；没有改变 task 返回正文、通知消费、Root 调度、角色配置或通用框架。原型保留供 review。

固定实际二进制 `OpenCode 1.19.3`，实际 launcher/plugin/control，本地确定性 OpenAI-compatible HTTP 替身。env -i、独立 HOME/XDG，OS sandbox 仅允许 loopback；每批启动前连接外网得到 EPERM（`isolation.json`、`isolation.sb`）。没有真实模型、目标 HTTP、oracle、秘密或 reasoning 读取；只投影会话、消息、call 身份、完成状态、finish、字符数。usage 是替身声明，不能视为真实消耗。

## 原生结果

`candidate-final.log`、`additional.log`、`native-summary.json`、各 `candidate-*/hooks.jsonl` / `metadata.json` 可核对：

| 场景 | run 状态 | 本次同步 exact-read | 后台 execution 数 | 请求/child 调用数 |
| --- | --- | --- | --- | --- |
| 后台 partial length 后同 child 同步 resume | completed/0 | 新 user、唯一 assistant stop、8 chars，complete | 1（旧轮） | 6/2 |
| 后台 empty length 后同 child 同步 resume | completed/0 | 新 user、唯一 assistant stop、8 chars，complete | 1（旧轮） | 6/2 |
| 纯同步 partial length | completed/0 | 唯一 assistant length、7 chars，incomplete | 0 | 3/1 |
| 纯同步 empty length | completed/0 | 唯一 assistant length、0 chars，incomplete | 0 | 3/1 |
| 纯同步 stop | completed/0 | 唯一 assistant stop、7 chars，complete | 0 | 3/1 |
| 纯同步延迟响应超过 2.5s deadline | deadline_exceeded/1 | 没有同步成功返回/exact-read，不能分类为完整 | 0 | 1 个已记录响应请求；另有 1 次 child HTTP 已进入但延迟未完成 |

这里 completed 是外层运行状态；纯同步 length 两例仍由宿主元数据判为 incomplete。两个后台→同步场景原 execution/source user 保持首轮，没有产生新 execution。同步新 call/user 与旧轮不同；旧 `binding.dispatchCallID` 仍是首轮 call，不能用它代表恢复轮。

原生顺序为同步 task.before 返回 → child chat.message（首次可在绑定前进入）→ child model.call → assistant completed → parent tool.after。`tool.after` metadata keys 为 parentSessionId/sessionId/model/truncated，公开 metadata 没有新 user/assistant ID。初次后台 after 与 child chat.message 可交错，所以不能只用“最近 call / 最近消息”猜测。观察原型在 before 成功后按 parent/call 暂存，在本轮 chat.message 成功后冻结精确 user，在 after 校验 metadata parent/child，再 SDK 只投影该 user 与 parentID 指向它的 assistant。5 个成功同步返回均有 parent/child 一致、唯一 user/assistant、无读取错误；没有复用旧后台 ref。

## 证据级别与必要设计约束

**已证（原生有限样本）**：公开接口可给出本轮 call→user→assistant/after 链；empty/partial length 与非空 stop 可区分；后台后同步 resume 不会自动建立新后台 execution/ref。同步成功返回后读取已完成 assistant 的元数据可行，不需额外 prompt/通知。

**仅离线候选负例**：`offline-check.py` / `minimal-evidence.json` 有 14 项分类检查与 4 项注册策略检查，覆盖错 parent/child、用户冲突、缺 user、SDK 失败、多个 assistant、停止后抑制、重复同 user、同 child 活动重入及重复 call。它们不证明自然竞态、实际 HTTP 读取错误或产品已执行这些注册拒绝规则。运行观察原型的 Map 是测量用最小实现，尚未具备完整持久幂等/冲突/同 child 并发拒绝契约；正式设计须明确这些契约，而不能直接复制原型。

**已观察停止，未证明原子性**：延迟 child 时外层 deadline 确实终止为 deadline_exceeded，未伪造 complete；stop 在 SDK await 前后、plugin 保存前的竞态只做离线抑制检查，未宣称自然 race 全覆盖。不得因 after 缺失去取旧消息或把 pending 当 complete。

**未知**：同步 facts 注入实际父请求（R4）、自然重入竞态、tool.after 之前消息已保存的所有时序、跨重启的记录恢复。wrapper 增加少量同步文件 I/O，after 增加一次 SDK 读取，外加元数据轮询，均可能影响时序；不能与无 observer 产品后台验收拼成同一运行证据。

## 范围与 R4

推荐保留 A 为可实现候选：最小同步身份/完成事实契约以 `(parent,callID)` 为键；新建同步 call 记录与旧后台记录分离；after 保留原生输出包络；父展示可在该同步 tool.after 返回边界追加宿主白名单事实。同步不用后台 delivery/notice 消费语义。应核对 metadata parent/child、hook 冻结 user 和 assistant.parentID；重复 call/user 幂等，不同 user 冲突应持久 unknown；同 child 多个活动候选不得猜测；停止不新增展示副作用。以上是设计建议，非本次已实现产品。

候选 B 明确排除同步会使历史原调试七次同步恢复的完整性无法被宿主说明；后台旧 ref 只能说明旧轮，不能覆盖恢复结果。不能据此替用户选择 B，也不能把 unknown 作为整份设计完成。

R4 只需围绕新增联合边界：同 child 先后台 length 再同步 stop 时，旧 notice/ref 与新同步 call/user facts 同时正确；纯同步 empty/partial 的 tool.after 宿主事实实际到达下一父请求且没有额外唤醒；并发后台通知与一个同步 call 并存时不互相消费或串绑；重复 after/用户冲突/停止及 SDK 读取错误只作用于本次 call，不清空后台 queued。并发通知收束由 R2 契约决定，本次没有修它。

## 检查、失败与留存

最终 `fixed-typecheck.log`、`fixed-build.log` 均通过；`final-tests.log` 现有受影响两文件 50 项通过。离线候选 14+4 项通过。这些只证明构建/分支，不证明真实模型理解或解题。

保留失败：首个 observer 四案实际完成记录在 `native.log` 与旧 hooks；随后误用相同 run 目录被 blocked_configuration 拒绝，`candidate-native.log` 保留，未覆盖任何原 run。该次脚本 metadata 被拒绝结果覆盖，故首批不作为主要完整证据，主要结果全部来自独立 candidate-* run。候选第一次 typecheck 因 union time.completed 类型访问失败（`final-typecheck.log` / `final-build.log`），只加字段存在 guard 修正，之后通过；四个主候选原生案在该类型修正前运行，两个追加案在修正后，batch hash 分开，不称同一源码同批集成验收。

没有 commit/push，没有主区写入。launcher 在 finally 关闭本地 provider；各 native 进程已退出。worktree 与原型保留。R1 及 R2/R4 整体依赖未因本结果消失，尚不生成实现 plan。
