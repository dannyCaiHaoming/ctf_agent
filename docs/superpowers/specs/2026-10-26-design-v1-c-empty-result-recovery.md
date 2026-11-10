# design v1 C：生成到上限后的空正文与结果恢复

**状态（2026-11-10）：普通完成链的结果分类修复已落地（无模型验收通过）；生成额度另行调整为 child 输出上限 32000。模型补交行为与解题提速未验证。**

本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) C 的详细子文件，细节以本文为准。改写前的逐次验证记录（基线 hash、探针命令、复核意见）见 commit `268813d5` 中的本文与[证据摘要](../../gates/g-solver-verification-20261023/run-completeness-20261025/parent-display/c-terminal-message-verification.json)。

## 1. 问题（r4）

r4（`89e47dde` 加未提交修改，OpenCode 1.19.3，`volcano-coding/deepseek-v4-1-flash-261017`）出现两个独立的问题：

| 观察 | 能说明什么 |
| --- | --- |
| 6 次 assistant 以 finish=length、output=0、reasoning=8000 结束，分布在 Engineer、Verifier、Solver、Critic | 跨角色的生成不完整，不只是 Critic 的问题；与单次 8000 额度一致，不是 run 总预算耗尽 |
| Critic 读入大量进度与 Skill 后空输出 | 大输入与空输出同时出现，未证明输入长度是唯一根因 |
| 13 次后台 execution 全部 completed，但结果事实全为 `unknown／multiple_assistants` | 通知到了父端，但分类失去了区分能力 |

**两个问题要分开修：** 修分类不会产生正文，调额度也修不好误分类。分类问题的根源是：分类器把「同一轮有多个 assistant」当作结果歧义，而正常的工具调用链本来就会产生多个 assistant。

[结果完整性](2026-10-25-design-v1-run-readiness-and-result-completeness.md)继续负责身份关联、事实展示与 Root 完整性；本文只补多轮终态识别与生成恢复。

## 2. 目标

- **工程：** 已终止的生成不被当成完整报告，归属不明时也不被关联到另一轮。
- **行为：** 必要角色以有限的额外消耗交付可用结论，或明确以「未完成」结束，让 Coordinator 在原授权内选择补交、换路或停止。成功不等于每次都要恢复，也不能用强行输出一句话代替可用报告。

## 3. 结果分类规则

**状态：已落地（`child-result.ts`、`control-service.ts`，2026-10-27）。**

OpenCode 1.19.3 的 task 不提供精确的最终 assistantID，所以 host 检查同一冻结 user 下的完整消息链，区分已结算的中间步骤与唯一终态。不按数组最后一条或最大时间挑选。

**入口先判生命周期：**

| 入口 | 规则 |
| --- | --- |
| 可信关联的普通 completed | 启用多轮选择；completed 本身不等于报告完整 |
| 同步 running／promotion | 不是任务终态，不读 SDK 消息去猜；等原生后续 completion |
| 后台 error | 保持 execution failed 与原错误信封；只用同轮可靠事实描述报告，其余为 unknown，不拿后来另一轮的 stop 补本轮 |
| stop 同时带工具 | 不当最终消息；工具与消息都已结算的普通工具链可识别为中间步骤 |

**普通完成链的选择规则：**
1. 先核对完整的相关集合：冻结 user、session、parentID、重复 ID 与来源冲突；同 ID 要比较实际正文与工具状态，不能只比长度。不删除未完成或异常的消息来凑出唯一结果。
2. 中间步骤：消息已完成、无 assistant error、所有工具状态为 completed 或 error，finish 为 tool-calls 或原生仍会继续循环的 stop。普通工具 error 是已结算的实验反馈，保留，不被后续正文抹去。providerExecuted、interrupted 等特殊路径一律 unknown。
3. 唯一终态：同轮恰有一个不带工具的已完成 assistant，finish 为 stop 或 length，其余都满足中间步骤条件。出现多个终态、终态之后还有相关步骤、或缺少判断所需的时间与状态，都记为 unknown。
4. 报告含义：length（有没有正文都一样）为 incomplete；stop 带非空白正文才为 complete。complete 只表示报告形式完整，不代表内容正确或 solved。

**前提与边界：** 依赖当前配置关闭 auto compaction／prune，且原生 prompt 收尾后才返回普通完成结果。不承诺任意外部 SDK 改写或所有异常路径；读取失败、边界不明或出现冲突一律保持 unknown。不新增重读循环、锁、轮询或通用版本机制。

## 4. 生成额度

**状态：独立问题；child 输出上限自 a7 起设为 32000，见[结果完整性](2026-10-25-design-v1-run-readiness-and-result-completeness.md) §5.2。**

8000 是线索，不是参数处方。调整前要核对参数从配置到 OpenCode model limit、插件 `chat.params`、请求序列化的去向，并区分 output 与 reasoning 的计量。provider 不支持独立 reasoning 控制时就记录为不支持，不猜字段。任何额度调整都受 run 总 token、deadline、调用上限与用户授权约束，失败与恢复的消耗计入同一批。

## 5. 恢复做法（候选，未选定）

| 做法 | 适用条件 | 去向 |
| --- | --- | --- |
| 按相关性缩小决策输入 | 请求里有大量无关或重复材料，删减后关键事实仍完整 | 在现有读法或角色提示里局部修正；会丢决定性事实就不删 |
| 同任务补交结论 | 工作已完成、只缺最终正文，且任务已到可续接状态 | Coordinator 用既有 task 续接，只补结论；不重做已发生的副作用 |
| 缩小后续任务或报告未完成 | 无法安全恢复、来源未知或预算不足 | 保留已有事实，改成更小的目标或停止；不永久禁用 session |

补交前先确认上一次执行的状态：还在运行就不能因一次 length 重复启动；已执行的 HTTP、发布等动作不能因正文为空就当作没发生。

## 6. 验证记录

| 验证（2026-10-27） | 结果 | 能说明什么 |
| --- | --- | --- |
| 原记录复现 | Critic「工具 → length 零正文」与 Verifier「6 个工具步骤 → stop 正文」都被旧分类器判为 `multiple_assistants` | 确认分类问题 |
| 离线演算 | 24 项反例通过（两个终态、未完成后继、跨轮、同 ID 异文等） | 规则覆盖已知反例；不代表运行时保证 |
| 实现后的回归 | 旧分类器在同步与后台四项失败；新实现通过，两份定向文件 114／114；全套 533 项通过 | 原失败已修复，反例的拒绝语义保留 |
| 原生 scripted 探针 | 同步与后台各两轮：length 零正文得到 incomplete，续接后 stop 正文得到 complete | 父端显示与冻结 user 关联正确；无真实模型 |

**未证明：** 所有同 user 改写路径与自然竞态；额度改善对生成的实际效果；模型的补交行为；解题提速。真实模型对照需另行授权目标、模型、批次与预算，并固定其他输入。

## 7. 边界与关系

- 保留[创建方式保存与漏参补齐](2026-10-25-design-v1-sync-resume-provenance.md)和发布校验；不固定前后台模式，不永久撤销出错的任务。
- 不新增角色、judge、结果 schema、强制报告 gate、自建 provider 循环或 OpenCode fork；固定 JSON 输出不能让没生成的结论出现。
- 验证材料与判定条件归 [D 证据到可信完成](2026-10-26-design-v1-d-evidence-to-completion.md)；评估解题提速时，单独统计本问题造成的等待与恢复。
