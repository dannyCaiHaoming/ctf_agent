# M1 Task 1 — 职责与自适应会话模型验证

日期：2026-10-18。范围：[M1 plan Task 1](../superpowers/plans/2026-10-18-m1-solver-loop-plan.md#task-1职责与自适应会话模型)。

## 实现

- Contracts 定义九种职责、固定职责集合、task 身份，以及完整的严格 handoff envelope。提交 payload 不接受模型自报身份，由 Supervisor 从绑定注入 task/attempt。
- `ResponsibilityRegistry` 固定 run/challenge/task/session/responsibility/lease 关系；拒绝职责越权、重复绑定与外部修改返回对象。Lease 可续期或撤销，异步引用验证结束后再次检查有效性。
- 推理上下文使用 Supervisor 签发的非可复制 handle，不能跨 task 复用；verification task 独占职责，必须使用独立 task/session/context。
- Observation refs、assumptions、rejected assumptions、decision outputs 使用独立结构。所有引用经 host 提供的 ArtifactStore 验证；文件内容损坏时拒收。
- `PublishedRevisionService` 区分发布与采用；仅采用的新产物或依赖变化失效直接及传递下游。相同内容与依赖不产生失效；未采用发布、普通工作区修改与无关产物不失效旧候选。

## 验证证据

先写失败测试：初始 3 个测试文件共 52 项因缺少 schema/服务而失败。补充严格 session 输入测试后，先确认 1 项失败，再实施修复。

| 验证 | 结果 |
| --- | --- |
| `npx vitest run tests/contract/responsibility-*.test.ts` | 4 个文件、54 项通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm run gate:m0` | 15 个文件、92 项通过；内嵌 deterministic suite 90 项通过 |
| `npm test` | 16 个文件、95 项通过；含 3 项本地求解集成测试 |
| `git diff --check` | 通过 |
| 独立审查 | Task 1 spec compliance PASS；code quality APPROVED；无 Critical/Important/Minor 问题 |

54 项新增测试按文件分布：handoff 37 项、sessions 10 项、revisions 6 项、真实 ArtifactStore 1 项。覆盖每个 envelope 字段的缺失与畸形输入、越权与伪造身份、两种创建顺序的 Solver/Verifier 上下文复用、lease 过期/撤销、验证期间撤销、直接/传递失效、旧版本回退、循环依赖，以及所有引用位置的同长度内容损坏。

## 验收边界

本次完成的是 **Task 1 的 Supervisor API 与确定性契约**。这些 API 已从 Supervisor 包导出，尚未接入现有 M0 CLI、线性模型流程或 OpenCodeBridge 工具调度。后续调度必须将真实 provider session/context 对应到 host handle；不能给旧 history 新签发 handle 来冒充独立上下文。

Registry/revision 状态在内存中；revision service 由 host 按 run/challenge 实例化。持久化与 checkpoint 恢复、真实 provider 上下文隔离、候选验证模式/签署、运行用量的权威记账属于后续任务，本次未验证。Handoff 中的 revision/dependency_versions 当前做结构校验，实际发布采用由 host API 控制；后续编排还需连接两者。

未调用真实模型或 TSecBench，未执行 M1 六轨迹统计 Gate，未开始 Task 2–12。未提交或推送。
