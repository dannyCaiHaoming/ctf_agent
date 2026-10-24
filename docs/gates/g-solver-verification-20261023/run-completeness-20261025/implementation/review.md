# 独立复核

- 规格 verdict：实现逻辑符合 §7.1 的核心契约，但验收尚未完成（下面 P2 测试缺口）。
- 质量 verdict：请求修改测试后再收口；未发现需要修改生产逻辑的明确缺陷。
- 范围：只读核对 implementation.patch（相对 baseline，不是 HEAD）、候选源码相关调用链、plan、design §7.1、implementation-report、最终定向/全套日志及 native-minimal-evidence.json。未读真实模型 transcript/reasoning/oracle，未运行模型/目标，未改源码、commit/push 或派生 agent。未重跑已验测试。

## P2：来源变化测试不能识别漏掉第二次同源 idle 确认

位置：`/Users/caihaoming/.codex/worktrees/run-completeness-validation/pentest-agent/tests/contract/launch-evidence.test.ts:233-240`，尤其第239行 `expect(reads).toBeGreaterThanOrEqual(4)`。

现有输入序列是 first、first、second、second、second、second、同 second ID 的 cleanup abort。`checkBudget -> refreshObserved` 每轮先消耗一次 root 读取，之后 idle 判断再消耗一次。正确实现应在第2次读取观察 first、第4次观察 second 后重置计数、第6次观察 second 才停止，第7次导出看到 cleanup abort。

若将 launch.ts:285 中的 `(source === idleSource ? idleSeen + 1 : 1)` 错改成无条件 `idleSeen + 1`，就会在第4次读取提前停止，第5次正常 second 导出，reads=5，仍满足 >=4；最终 assistantMessageID=second、complete、hasError=false 也全部成立。因此该测试同时无法保证已经到达所构造的 cleanup abort 分支。这个反例由当前 seam 和代码逐步推导，未运行 mutation。

影响：两次 idle 同来源是本切片明确硬性要求，也是防止异步新输入提前收束的关键边界；当前通过计数不能证明其回归保护。

建议：最小加强为断言确切读取阶段（当前输入应 reads=7），并断言导出证据确实包含所构造的同源 cleanup abort、rootResult 仍保留完整性且 exportedSourceMatches=false。也可用停止回调记录 idle 确认已观察到第二次 second，避免只依赖总读取次数。应实际确认去掉来源重置后此测试失败，再恢复实现运行定向回归。保留现有真实 SDK 必需元数据，不更换失败样例。

## 已核对的正面结论及限制

- 分类器按可信 created 唯一选最新 user/assistant，parentID 关联；乱序、缺 ID/created、同时间歧义和未回复新 user 保留 unknown，不回退历史完整消息。
- 两次 idle 的生产代码确实比较相同元数据，pending/executions/resources 检查仍调用原 hasOutstandingWork。未完及 tool-calls 不自然收束；length/空白 stop/未知 finish 的生命周期与完整性分离。
- 自然收束前冻结，预算已触发清理时不伪取清理后摘要；真实错误与正常同源清理 abort 区分，历史真实 abort 保持失败。异常/导出失败有 unknown 路径。
- 同一 rootResult 交给 progress 和 run.json；只投影 ID、时间、finish、计数、错误标志及路径，不复制正文/reasoning。可信记录数量明示不代表 verified/solved。
- 查阅最终日志：定向2文件36项、全套49文件430项通过；报告称 typecheck/build 通过。最小原生投影四例固定1.19.3，各一次请求，64/512上限及 incomplete/complete 与报告一致。这些证明 launcher/原生本地替身链路，不证明真实模型或目标能力。
- 已有 progress 写入后证据写失败可造成生命周期展示与最终 run 状态不同，是报告明确列出的旧时序限制，不计入本增量缺陷。没有将这一旧问题扩大成本片阻断项。
