# R4 独立最终复核

日期：2026-10-25。复核对象为 joint-display/publish 的最终报告、四文件原型、源码／发布清单、定向日志及安全请求投影，并只读核对实际候选相关实现。最终四源码 hash 与工作区一致；publish-hashes.json 的 54 文件逐项匹配。安全重放 publish/verify-projections.py 时移除唯一写 JSON 语句，6 个最终运行源码原生投影及1个旧源码 compaction 入口失败均通过。独立复核没有运行 HTTP、目标、Docker、模型、产品测试或读取敏感 raw；只写本 review.md。

## 结论

**本轮有限联合可行性通过，无剩余阻断该结论的具体缺陷。不是生产实现完备或整份设计定稿。** 最终候选与65项定向检查闭合了本次复核识别的具体问题；固定 OpenCode 1.19.3、本地确定性 adapter 的六场景证明事实可以到达实际父请求。R1 仍未解决；compaction／裁剪中的快照替换没有成功证据，必须如实保留限制，不能把HTTP500或deadline写成压缩路径通过。

## 原型问题与闭合证据

- completed 筛选漏 failed：最终 plugin 同时识别 completed/failed。最终同源原生 HTTP400 样本确实产生 failed notice，父请求1个notice及error/incomplete事实，execution consumed；没有把外层completed解释为报告完整。
- 改参重复call放行：最终变体fingerprint先持久标conflict再拒绝，避免跳过任务归属／角色检查；active同参before保持hook幂等，done后的before拒绝，重复after不再读取或追加。
- native error留active／pending：最终可信task.event按parent/call收束同步记录并仅清匹配call的pending；测试覆盖绑定前失败、新call继续及重复旧error不清新pending。没有引入统一任务框架。
- R3旧评审中的读取前身份与await后状态问题：实际候选在SDK前校验metadata与可信parent/child/role，await后串行复查call状态、stop、active/expiry和source变化。产品候选定向测试覆盖错parent不读、SDK失败、await间stop／冲突。绑定parentID/role仅首次建立，现有路径不改写身份，未将额外假设的身份变更列为blocker。
- 分类复用既有classifyChildResult；一条完成加一条未完成assistant仍是multiple_assistants，避免R3离线脚本只计完成assistant的不足。相关断言执行实际候选，不再以Python策略代替注册实现。

已查日志：最终两测试文件65项通过，typecheck/build通过。本复核没有重跑这些检查；这些确定性分支不等于自然race或真实HTTP读取故障已验。

## 实际父请求与消费

六案安全投影与host execution／sync.result交叉核对通过：后台partial／empty后同child同步stop，旧ref分别length／7和0，新同步call/user为stop／8且不覆写旧source；纯同步empty／partial下一父请求tool消息出现incomplete／length／0和7，不制造后台execution／notice；组合案同一个父请求携带2条后台facts与1条同步facts，两后台同admitNo=6消费。同步等待期间没有额外父请求／早退；这只证明观测顺序，不声称任意自然重排都已覆盖。

plugin after trace显示原生output前缀保留、metadata集合保持；旧fact在后续历史上下文再次出现不等于重复追加。脚本唯一性断言检查完全相同对象，独立读取最终投影亦未见同ref/call多条事实；不由脚本断言外推所有冲突变体均已测试。

## 来源与明确限制

运行时代码最终control hash 68f4dd40cf953a0d4e62582db32776c565e04567bc90a455985873eb20776a43、plugin hash 3f17411ab37571b2084b3e4426f7a4314382b25349b355b3360cd483ac5cb1d8。最终六场景运行时同源；最后增加旧error断言只改测试。failed探针首次仅计completed，之后修安全投影计数并以相同运行时代码重跑，报告已披露。早期样本／旧测试／旧hash不拼接成最终批次。

唯一公开summarize临界样本来自pre-review源码，HTTP500、未进入compacting hook或compaction chat.params，deadline后queued suppressed且没有task.delivered。这证明未误消费的失败观察，不证明压缩／裁剪成功，也不能仅凭compaction.disable推断500根因。普通transform不是最终wire集合；consumed仅可表述为可信hook上下文及对应准入，当前adapter最终请求中的facts可见性另由六案支持。不得推广到所有adapter、后置插件、自然摘要或模型理解。

建议将本轮结论与具体契约回写现有design：R2/R3/R4的有限可行性已有证据，正式实现仍需适用同源验收；保留compaction未知和R1未完成，不自行排除目标或再增加框架／模型运行。主区产品未接入，未commit/push。
