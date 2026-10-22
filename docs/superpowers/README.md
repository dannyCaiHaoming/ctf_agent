# 文档索引

通用 CTF 解题 Agent 项目的设计与计划文档索引。

- 架构与产品依据：[核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md)。
- 现状、教训与清理方向：[现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md)。
- 仓库开发规矩：根目录 [`AGENTS.md`](../../AGENTS.md)。

**用途边界：** 本产品只用于 CTF 比赛与学习题，操作对象限于授权题目、靶场和附件（见 design v1 开头）。

## 目录约定

- `specs/` — 设计与迁移记录。当前只有 design v1 与迁移记录两份。
- `plans/` — 按 `CLAUDE.md` 约定的 §0 交接计划（如 [清理计划](plans/2026-10-22-cleanup-plan.md)）。不再放里程碑 plan。
- `gates/` — 只保留经清理决定保留的最小证据（见迁移记录）。
