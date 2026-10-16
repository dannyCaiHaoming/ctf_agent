# 文档索引

通用 CTF 解题 Agent 项目的设计与计划文档。**平时只需看两份活文档**，其余历史都在各自的 `archive/` 里。

## 活文档（平时看这两份）

| 文档 | 作用 |
| --- | --- |
| [`specs/2026-10-14-general-ctf-agent-system-design.md`](specs/2026-10-14-general-ctf-agent-system-design.md) | **权威设计 spec**：系统意图、架构、平台契约、状态与恢复、验证门槛。一切以它为准。 |
| [`plans/2026-10-16-ctf-agent-mvp-roadmap.md`](plans/2026-10-16-ctf-agent-mvp-roadmap.md) | **当前路线图**：把设计切成 M0→M5+ 的 MVP 里程碑，每个里程碑一份可验收产物。 |

## 目录约定

- `specs/` — 设计。当前只有一份权威版；`specs/archive/` 放被取代的前身。
- `plans/` — 计划。当前只有 roadmap；**每个里程碑启动时**用 write-plan 在此新增该里程碑的 detailed plan；`plans/archive/` 放废弃的旧计划。
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
