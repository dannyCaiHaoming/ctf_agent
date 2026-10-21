# 文档索引

通用 CTF 解题 Agent 项目的设计与计划文档。**开工先读 spec、roadmap 和当前里程碑 plan**；历史不作为待办。

**唯一当前主线：** [真实 Web 解题闭环与方法固化](plans/2026-10-20-m1-autonomous-first-challenge-plan.md)。MFW 首题已成功，Throwback、Seizure-Cipher 未解出；S1/S2 定向验证通过。Web Skill v2 已补两项通用方法，输入接线及第三次 trace 离线对照通过，内容待用户审核。每次 run 收尾自动导出 canonical events、result JSON 和可读 postmortem；第四次记录的[自动复盘](../gates/m1-web-validation/throwback-s3-retry3-20261021/postmortem.md)已通过离线核验。第五次 run 是我误启动的记录：0 observable tokens、6 次 admitted calls 后因 provider HTTP 429 / AccountQuotaExceeded 停止，没有靶场请求；用户已澄清未要求重跑，不将其算作授权验证。详见[Throwback 复盘](../gates/m1-web-validation/throwback-s3-20261021.md)和[第五次误启动记录](../gates/m1-web-validation/throwback-s3-retry4-20261022/run-report.md)。旧 M1／M1B 轨迹仍冻结，历史“下一步”不再执行。

**当前停点：** Web Skill v2 草案待用户审核。run 结束自动复盘已按时间排序、配对工具事件、链接真实 seq/JSONL 行、摘要阶段与人工复盘卡点，并以第四次记录离线核验；此次功能实现与验证未调用真实模型。第五次误启动 run 不属于用户授权的模型验证；没有靶场请求且 observable tokens 为 0。任何后续真实 run 均需新批次明确授权。不提交，保留现有未提交改动。

## 活文档与里程碑记录

| 文档 | 作用 |
| --- | --- |
| [`specs/2026-10-14-general-ctf-agent-system-design.md`](specs/2026-10-14-general-ctf-agent-system-design.md) | **权威设计 spec**：系统意图、架构、平台契约、状态与恢复、验证门槛。一切以它为准。 |
| [`plans/2026-10-16-ctf-agent-mvp-roadmap.md`](plans/2026-10-16-ctf-agent-mvp-roadmap.md) | **当前路线图**：把设计切成 M0→M5+ 的 MVP 里程碑，每个里程碑一份可验收产物。 |
| [`plans/2026-10-17-m0-host-foundation-plan.md`](plans/2026-10-17-m0-host-foundation-plan.md) | **M0 detailed plan — COMPLETE (2026-10-17)**：任务与验收均为可勾选候选框；T9b 后移 M2。 |
| [`plans/2026-10-18-m1-solver-loop-plan.md`](plans/2026-10-18-m1-solver-loop-plan.md) | **冻结／历史 M1 COMPLETE（仅轨迹①）**：OpenCode 独立验收 3/3，既有交付截至 `baed7fa` 已 push；新增偏移实现归档清理见 plan 文末。轨迹②–⑥属 M1b，进度见下一行。 |
| [`plans/2026-10-19-m1b-trajectory-2-plan.md`](plans/2026-10-19-m1b-trajectory-2-plan.md) | **冻结／历史 M1b 轨迹② COMPLETE**：百炼 DeepSeek v4 Flash 正式验收 3/3。 |
| [`plans/2026-10-20-m1-autonomous-first-challenge-plan.md`](plans/2026-10-20-m1-autonomous-first-challenge-plan.md) | **唯一当前主线**：记录 MFW 结果、S1/S2/S3 状态、Throwback S3 修复与后续预算边界及 S4–S6 条件。旧 A–E 快照保留。 |
| [`plans/2026-10-20-m1b-trajectories-3-6-plan.md`](plans/2026-10-20-m1b-trajectories-3-6-plan.md) | **冻结历史**：保留 DVGA 与轨迹资料；原 §0.5 已被独立主线取代，不再是当前清单。 |

**当前边界：** 第四次 Throwback run 的独立 10M observable-token 批次已结束：在 8,746,368 tokens 时因 APIError 停止，未达到阈值；前一批累计越界仍作为历史记录保留。后续真实模型批次需新的单批授权。不启动 TSecBench，不提交；保留现有未提交改动。自主首题与 API 全流程分别取证，M0／M1 历史完成不代表陌生题自主求解。

## 目录约定

- `specs/` — 设计。当前只有一份权威版；`specs/archive/` 放被取代的前身。
- `plans/` — roadmap 与各里程碑 detailed plan；**每个里程碑启动时**才新增对应计划。`plans/archive/` 放废弃计划，`plans/history/` 放历史复盘，均不自动构成待办。
- `reviews/archive/` — 对 spec / plan 的历史评审，按评审对象命名。目前没有进行中的评审，故只有 archive。

## 工作流

1. 读权威 spec 建立全局认知 → 读 roadmap 看里程碑切分与验收门槛。
2. 当前切片复用现行 detailed plan；新里程碑另行授权后规划。实施 → 验证 → 汇报停止；提交/合并、下一切片及模型批次分别按授权执行。
3. review 的发现折回**当前里程碑的 plan**，不折回 roadmap、不推翻已验收的里程碑（避免旧计划那种「累加累加」死循环）。

## archive 里有什么

| 文档 | 说明 |
| --- | --- |
| [`specs/archive/2026-10-13-...design.md`](specs/archive/2026-10-13-ctf-solving-agent-design.md) | brainstorm 前身，已被权威设计取代。 |
| [`plans/archive/2026-10-15-...implementation.md`](plans/archive/2026-10-15-general-ctf-agent-system-implementation.md) | 旧的 391KB 单体计划，水平分层+累加膨胀导致死循环，已废弃。加固细节可按需取用。 |
| [`reviews/archive/2026-10-14-...design-review.md`](reviews/archive/2026-10-14-general-ctf-agent-design-review.md) | 对权威设计 spec 的分轮评审（可能含尚未处理的意见，需要时查阅）。 |
| [`reviews/archive/2026-10-15-...implementation-review.md`](reviews/archive/2026-10-15-general-ctf-agent-system-implementation-review.md) | 对上面那份单体计划的审计。 |
