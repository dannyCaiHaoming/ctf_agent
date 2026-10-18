# M1 Task 2 验证记录

日期：2026-10-18。实现位于独立工作区 `codex/m1-task1-responsibilities`，尚未提交或整合到 main。

## 实现

Hypothesis/Experiment/Repair schema 与生命周期、单 primary + 低成本且有判别意义的 counterprobe、内容/状态/过程/参数指纹去重，以及四类经宿主核实的 semantic progress 均已实现。

`HypothesisManager` 消费可信宿主的 Runtime receipt 与不可变 artifact refs。工具错误、403、429、超时及格式错误不能直接拒绝机制假设。普通修复、等待和 transient retry 不刷新进展。两个真实完成但无进展的窗口请求 Strategy；其后至多一次 Recovery Critic。

独立审查发现并修复两处问题：步骤标签/同内容引用路径绕过去重，以及主线切换遗留运行中旧试验。最终指纹按内容身份排序去重并保留真实有序工具操作；运行中试验不能被改派路线角色，需真实终态后才能改路。

## 验证

- TDD：先确认缺少实现的失败；审查回归先出现 5 项失败，再修复。
- `npx vitest run tests/contract/hypothesis-lifecycle.test.ts tests/contract/hypothesis-routes.test.ts tests/contract/hypothesis-progress.test.ts`：33 项通过。
- `npm run typecheck`：通过。
- 最终 `npm test`：19 个文件、128 项通过；内嵌 deterministic suite 123 项通过，包含 M0 gate 与本地冒烟集成。
- `git diff --check`：通过。
- 独立审查复核：spec PASS、quality APPROVED；两项 Important 均已修复，无新增问题。

## 边界

本次完成可供 Task 3 使用的宿主 API，仍需后续 Solver 将真实工具 receipt、语义核实与 canonical SQLite events 接入。回调必须由宿主掌握，不得用模型完成布尔值或无条件成功回调代替。未运行真实模型，也未宣称通过 M1 六轨迹统计门槛。
