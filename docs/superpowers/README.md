# 文档索引

通用 CTF 解题 Agent 项目的设计与计划文档。**开工先读 spec、roadmap 和当前里程碑 plan**；历史不作为待办。

## 活文档与里程碑记录

| 文档 | 作用 |
| --- | --- |
| [`specs/2026-10-14-general-ctf-agent-system-design.md`](specs/2026-10-14-general-ctf-agent-system-design.md) | **权威设计 spec**：系统意图、架构、平台契约、状态与恢复、验证门槛。一切以它为准。 |
| [`plans/2026-10-16-ctf-agent-mvp-roadmap.md`](plans/2026-10-16-ctf-agent-mvp-roadmap.md) | **当前路线图**：把设计切成 M0→M5+ 的 MVP 里程碑，每个里程碑一份可验收产物。 |
| [`plans/2026-10-17-m0-host-foundation-plan.md`](plans/2026-10-17-m0-host-foundation-plan.md) | **M0 detailed plan — COMPLETE (2026-10-17)**：任务与验收均为可勾选候选框；T9b 后移 M2。 |
| [`plans/2026-10-18-m1-solver-loop-plan.md`](plans/2026-10-18-m1-solver-loop-plan.md) | **M1 COMPLETE（2026-10-19，仅轨迹①）**：OpenCode 独立验收 3/3，既有交付截至 `baed7fa` 已 push；新增偏移实现归档清理见 plan 文末。轨迹②–⑥属 M1b，进度见下一行。 |
| [`plans/2026-10-19-m1b-trajectory-2-plan.md`](plans/2026-10-19-m1b-trajectory-2-plan.md) | **M1b 轨迹② — COMPLETE（2026-10-20）**：百炼 DeepSeek v4 Flash 正式验收 3/3。 |
| [`plans/2026-10-20-m1b-trajectories-3-6-plan.md`](plans/2026-10-20-m1b-trajectories-3-6-plan.md) | **当前主线 — M1B §0.3**：host 管 cursor + 上下文测量，尚未实施；本地 HTTP 已接入但求解验证未闭环。⑤⑥③④暂停；§1–8 为历史资料。 |
| [`plans/2026-10-19-m1b-trajectory-2-plan.md`](plans/2026-10-19-m1b-trajectory-2-plan.md) | **M1b 轨迹②完成**：T2-A/B 确定性集成完成；T2-C 百炼 DeepSeek v4 Flash 正式验收 3/3；其余轨迹的历史记录与暂停状态见 M1B §0。 |

## 目录约定

- `specs/` — 设计。当前只有一份权威版；`specs/archive/` 放被取代的前身。
- `plans/` — roadmap 与各里程碑 detailed plan；**每个里程碑启动时**才新增对应计划。`plans/archive/` 放废弃计划，`plans/history/` 放历史复盘，均不自动构成待办。
- `reviews/archive/` — 对 spec / plan 的历史评审，按评审对象命名。目前没有进行中的评审，故只有 archive。

## 工作流

1. 读权威 spec 建立全局认知 → 读 roadmap 看里程碑切分与验收门槛。
2. 启动某个里程碑 → 在 `plans/` 生成它的 detailed plan → 实现 → 验收 → 合并 → 开下一个。
3. review 的发现折回**当前里程碑的 plan**，不折回 roadmap、不推翻已验收的里程碑（避免旧计划那种「累加累加」死循环）。

## archive 里有什么

| 文档 | 说明 |
| --- | --- |
| [`specs/archive/2026-10-13-...design.md`](specs/archive/2026-10-13-ctf-solving-agent-design.md) | brainstorm 前身，已被权威设计取代。 |
| [`plans/archive/2026-10-15-...implementation.md`](plans/archive/2026-10-15-general-ctf-agent-system-implementation.md) | 旧的 391KB 单体计划，水平分层+累加膨胀导致死循环，已废弃。加固细节可按需取用。 |
| [`reviews/archive/2026-10-14-...design-review.md`](reviews/archive/2026-10-14-general-ctf-agent-design-review.md) | 对权威设计 spec 的分轮评审（可能含尚未处理的意见，需要时查阅）。 |
| [`reviews/archive/2026-10-15-...implementation-review.md`](reviews/archive/2026-10-15-general-ctf-agent-system-implementation-review.md) | 对上面那份单体计划的审计。 |
