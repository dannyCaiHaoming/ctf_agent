# R3 独立只读复核

日期：2026-10-25。已核对 report.md、observer-candidate.patch、source-hashes.json、batch-source-hashes.json、minimal-evidence.json、native-summary.json、两案安全 hooks 投影、offline-check.py 及候选 control-service 相关段。最终源码 hash 实测匹配 0107443f79577dfadc27eaa379c2de0819d5b11823ede40d532f8a79fe7b2546。安全离线重放删除了脚本写 JSON 的语句后运行，得到 5 个原生 exact-read 行、14 项分类检查和 4 项纯注册策略断言通过，未改已有证据。未运行 HTTP、目标、Docker、模型或测试；未读敏感 raw；只写本 review.md。

## 结论与阻断范围

**没有阻止“公开接口存在最小可行路径”的证据问题。尚不能据此宣布完整同步候选已验证或可直接复制为生产实现。** 报告总体已明确分层；其开头的“足够”应限定为这 5 个正常返回样本的身份提取，不应覆盖冲突、幂等和停止契约。R4 联合展示仍是必要未完成项，不可与既有后台验收拼成同源集成证明。

### 需在定稿前明确的机制缺口

1. **逐 call 注册／冲突是独立 Python 策略，不是观察原型的已执行拒绝规则。** 原型在成功 tool.before 返回后直接 Map.set，同 call 重复会覆写 user/conflict/done；同 child 多个活动记录仅让 chat.message 不匹配，没有持久冲突状态；done 后的另一个 user 也不再记录。故 4 个 admit 断言只说明拟议策略可表达，不能证明产品或原型拒绝重入／幂等。设计应明确注册时的唯一活动约束、重复同 call/user 的幂等、不同 user 的持久 unknown，以及停止后的终态；验证最小边界即可，不需要统一任务框架或跨重启系统。
2. **after 读取前先验证身份，await 后再核对有效性。** 原型先用 metadata.sessionId 调 SDK，之后只把 parent/child 是否相符写成布尔值；不是先验证再读取。它也只在 SDK 后采样 stopReason，没有重新核对本 call 的终态／冲突是否在 await 期间变化。错误 metadata 缺失可在日志拼接处抛错。设计应规定校验合法 metadata、可信 parent/child/call 关联后才读取，再以末次串行检查提交本 call 的结果／展示许可，失败只使该 call unknown 或 suppressed，不破坏原生 task 输出。正常样本并未触发这些分支。
3. **离线分类器并未证明真实产品分类契约。** 它先筛 completed assistant，因此“一条完成 assistant 加另一条未完成 assistant”仍可判 complete；现有 multiple-assistants 反例只增加完成 assistant。应明确 assistant 集合歧义的规则并复用已有 child-result 分类能力／语义，不能把脚本 14 项通过当作最终分类器证明。无需为此自行增加另一套长期分类协议。

上述是正式设计与实现需闭合的边界，不否定 API 可行性，也不要求把所有自然竞态穷尽后才能选择候选 A。若当前只选择“逐 call＋冻结 user＋after 精确读取”方向，可带这些明确约束选择 A；若宣称该方向完整负例验证已经通过，则有阻断。

## 身份与时序证据

纯同步 stop 安全投影显示：parent tool.before return 后才有 child chat.message entry；child entry 时 binding 为 null，返回时已解析 parent 与 dispatchCallID；随后 after 带 parentSessionId/sessionId，SDK 投影唯一 user 及 parentID 指向它的完成 assistant。说明应在 chat.message 成功绑定后冻结 user，不能在入口因尚无 binding 而丢弃。

后台→同步 partial 案显示旧后台 dispatchCallID 仍为 call_1_0，同步新 call 为 call_4_0；同步 before 指定 child，chat.message 冻结新 user，after 读取的新 assistant 为 stop／8 chars。旧轮 user 对应 length／7 chars。empty 案同理。metadata 本身没有 user/assistant ID，单靠它或旧 dispatchCallID 无法识别恢复轮。候选的 per-call 路径在这些样本确实避免了取“最新消息”猜测。

deadline 样本仅证明外层 deadline_exceeded 且没有成功 after/exact-read，不证明 SDK await／plugin 保存处原子停止。后台 executionFacts 的 completeness 为 null 也不应解释为后台完整性丢失：该投影未提供它的最终完整性证明，本轮结论只使用其旧 source/ref 与同步新 user 的分离事实。

## 来源与 R4

四个主案例来自 type guard 修正前源码，两个追加案例来自最终源码；旧 hash 是重建标记，不是现场不可变源码证据。报告正确披露，有限 API 观察可分别采用，但不得称同一源码同批验收。50 项既有测试只证明受影响既有检查未退化，不验证新增 Python 注册策略已接入候选。observer 文件 I/O、SDK 读取和额外轮询改变时序，不能外推无 observer 产品的调度。

R4 最小联合验证应保留报告列出的实际父请求检查：后台旧 ref 与同步新 call/user facts 同时正确；纯同步 length/empty 在下一父请求出现且不额外唤醒；后台多 notice 与同步并存时各自关联／消费，停止、重复、冲突和读取失败仅作用本 call。必须以 R2 选定通知契约和本节同步契约同源运行，不靠安全投影、离线分类或存储消息代替实际父请求。原生 tool.after 是否允许追加白名单事实且保留原包络仍需实际验证，本次未证明。

建议把 A 写成带上述约束的方案选择，明确本次只证明接口和正常身份链；保留 R4 与针对最终接线的定向负例为剩余验证。无需选择排除同步的 B，也不把未知边界隐去来宣告整体定稿。
