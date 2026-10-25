# R4 同步、后台展示与消费有限联合验证

2026-10-25。结论：固定 OpenCode 1.19.3、本地 OpenAI-compatible 确定性 provider、实际 launcher/plugin/control 的正常路径可行。最终运行源码下，后台旧 ref 与同步新 call/user 分离，事实到达实际父请求；双后台的事实和同步事实可在同一父请求出现，两条 notice 同一准入消费。仅隔离验证原型，未接入主区、未 commit/push、无真实模型/目标/DB/oracle；不证明模型理解、真实解题或全部自然竞态。readiness 准备来源仍未决，不能据本结果定稿整份 design。

## 输入与候选

独占 worktree `/Users/caihaoming/.codex/worktrees/result-joint-validation/pentest-agent`；input-hashes.json/baseline 固定主会话提供的 dirty 输入，非只按 HEAD。已读 R2/R3 report/review 及父展示 report/review；未把 R3 测量 Map、Python 策略当作已执行契约。

prototype.patch 相对输入仅四文件：control-service、plugin、两份既有测试。候选复用父展示和 R2 逐 session/current-user 一次性快照；通知筛选同时接 completed/failed。同步按(parent,callID)独立记录，不建立后台 execution/ref；before 成功注册，chat.message 可信绑定后冻结 user，after 在 SDK 读取前校验可信 parent/child/role；读取后在串行队列复查停止、状态、来源。使用既有 classifyChildResult，未完成 assistant 也参与多 assistant 歧义。冲突持久 unknown；同参 active before 幂等，变体 before 与 done 后 before 拒绝；after 重复无读取/展示。可信 native error 将该 call 置 unknown/native_error 并仅释放匹配 pending，重复旧 error 不影响新 call。

同步白名单事实沿原生 tool.after 输出追加，以 callID 标识。实际 trace 的 prefixPreserved 全 true，metadata keys 保持原生集合，未替换原正文；后台 completion 原包络另加 synthetic 白名单 facts。没有额外 prompt、notice、ACK、后台 ref 或调度循环。事实完整不表示正确/solved。

## 最终同源样本

运行时代码 hash 为 source-hashes.json 的 control/plugin；最后仅增加重复旧 error 的测试断言，没有再改运行时代码。closed-* 为最终源码批次；失败样本采用 closed-projection-failed（仅修正探针 completed|failed 计数，运行时源码相同）。verify-projections.py 与 verified-projections.json 对实际 provider 的白名单投影逐项对照宿主事实；没有保存完整请求、原始文本或 reasoning。

| 场景 | 结果 | 实际请求 | 关键观察 |
| --- | --- | ---: | --- |
| 后台 partial length → 同 child 同步 stop | completed/0 | 6 | 旧 ref length/7、不被覆盖；同步新 user/call stop/8；末次父请求各一事实 |
| 后台 empty length → 同 child 同步 stop | completed/0 | 6 | 旧 ref length/0；同步 stop/8；身份分离 |
| 纯同步 empty length | completed/0 | 3 | 无后台 execution/notice；下一父 tool 消息事实 incomplete/length/0 |
| 纯同步 partial length | completed/0 | 3 | 无后台 execution/notice；下一父 tool 消息事实 incomplete/length/7 |
| 双后台＋同步等待 | completed/0 | 6 | 最后父请求2 notice、2后台facts＋1同步facts；两个queued同admitNo=6消费 |
| 后台确定性 HTTP400错误 | completed/0 | 4 | 原生 failed notice 在父请求1次；host error/incomplete，failed execution consumed |

组合场景按原生实际顺序：两个后台结果先 queued，父同步 reference call 随后冻结 user 并等待超过700ms，父下一请求直到同步结束才发生；没有早退。并非在同步进行时强造额外父请求，也不声称自然调度能任意重排。重复事实在历史父上下文后续请求中仍可出现，逐请求每 ref/call 唯一，不是每轮重追加。

## 一次 compaction 入口观察与限制

第一次名为 compaction 的高 usage 样本没有触发（产品 compaction.auto=false），不能作为 compaction 验证。随后仅一次公开 session.summarize 临界触发：context=8192、替身 prompt_tokens=8100，已有两 queued notice；HTTP500、未进入 experimental.session.compacting 或 compaction chat.params，之后 deadline_exceeded。未观察到 task.delivered，停止后queued为suppressed，没有错误消费。保留 final-compaction/metadata.json、hooks 与日志；运行源码对应 pre-review-source-hashes.json，不冒充最终源码联合成功样本。

compaction.disable=true 是相关配置，现有保存投影没有错误原因正文，不能断言500由该配置造成。此次只证明公开入口被拒且未消费，并未验证自然摘要/裁剪中的快照替换。按有限授权停止该方向，没有改角色权限、重试触发或增加ACK。普通transform仍不是最终wire集合，consumed仅表示可信hook上下文及对应准入；当前adapter的实际facts可见性有样本证据，不能推广所有adapter或后置插件。

## 定向检查、失败与审查修正

最终既有两测试文件65项通过，typecheck/build通过：directed-closed.log、typecheck-closed.log、build-closed.log；未跑全仓。新增直接候选分支覆盖读取前错parent、SDK错误、停止/冲突发生于SDK await、未完成第二assistant、重复before/after、持久来源冲突、同child活动重入、变体call拒绝、done回放拒绝、native error及绑定前pending释放、重复旧error不清新pending、failed通知消费。它们不代表自然race或真实HTTP读取错误。

保留早期样本和日志而不拼接为最终同源验收。评审识别并修复：completed筛选漏failed、变体重复call放行、done before回放、native error未收束sync及其pending。最后重复旧error断言曾误把拒绝detail当Error.message，directed-assertion-failure.log保存失败；只改测试为同时断言固定message与detail，随后65项通过。

早期plugin trace因环境白名单未穿透为空；探针通过已有配置env引用机制传入trace路径后重新采样，无需改产品环境接口。失败探针初次notices只计completed，保留closed-failed原投影，closed-projection-failed修正计数重跑同运行源码。launcher产生的raw运行目录都在白名单投影后删除，独立HOME已清理；不保留raw/密钥/reasoning。原型worktree保留供主会话独立review。
