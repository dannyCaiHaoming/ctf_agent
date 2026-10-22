# 文档索引

通用 CTF 解题 Agent 项目的设计与计划文档索引。

- 架构与产品依据：[核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md)。
- 现状、教训与清理方向：[现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md)。
- 仓库开发规矩：根目录 [`AGENTS.md`](../../AGENTS.md)。

**用途边界：** 本产品只用于 CTF 比赛与学习题，操作对象限于授权题目、靶场和附件（见 design v1 开头）。

## 当前状态

每完成一步就更新本节；只写状态，细节看各自文件。更新日期：2026-10-23。

| 文件 | 定稿状态 | 已实作 | 未实作 |
| --- | --- | --- | --- |
| [核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md) | 已定稿 | — | 第 3 节仍列 5 项待决：原生 `task` 绑定时序、接口的原生／受管映射、工具套件与 ARM64、产品网络隔离、成功率门槛 |
| [A／B 产品资产与 Skill](specs/2026-10-22-design-v1-ab-product-assets.md) | 已定稿；第 6 节列 7 项未定稿 | `product/` 两层布局、白名单复制到每次 run 的配置目录、副本 hash 与来源版本、Skill frontmatter 检查、同名目标拒绝；原生 `skill` 按需载入与附属 Reference 的 `read` 已在开发机实测可用（第 5 节） | 插件按角色放行 `skill`／`read`（待 C）；共用 `references/` 内容 |
| [入口与本地调试](specs/2026-10-22-design-v1-entry-local-debug.md) | 已定稿（两项未知数已由探针验证） | 启动脚本 `apps/launcher/src/launch.ts`：运行资料目录分区（仓库外、realpath）、工作目录边界检查、`opencode serve` 加一次 SDK 启动讯息、时限 abort 与结果保存；旧 `solveM1` 单一 Solver 入口已退场（第 1 节） | 宿主控制服务（第 3 节，待 C）；运行配置中的题目来源与 Intake 接入工具（第 1、2、5 节，待 E）；token 预算停止（第 1 节第 5 步，现只有时限）；`config/` 仍是旧 m1 release profile，缺含题目来源的运行配置范例；把 ripgrep 作为开发机前置条件记入开发文档（第 4 节；本机已安装） |
| [现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md) | 大部分已过期：§1 清理方向已执行完、§2 静态对照已被真实探针取代、§5 指令收敛已完成；§4 教训仍有效，§3 偏离部分已解决 | — | 待精简为「教训与未解偏离」 |

**尚未接通的能力**（因此仍未授权真实模型调用）：产品插件、受管工具、控制服务 RPC、身份绑定、逐次预算准入、候选登记、独立验证、平台／oracle 提交。预算保护目前只有时限与用量记录。

**唯一入口：** `apps/launcher`。旧 `ctf-agent solve`（`solveM1`／`openCodeTask`）与 `--trajectory` 测试专用路径已于 2026-10-23 删除，`ctf-agent` 现只剩 `resume` 指令。**在控制服务按 design v1 C 实作完成前没有可用的解题路径**：launcher 能启动产品角色，但受管工具、候选登记与独立验证尚未接通。供控制服务接线的能力模组已保留（`runtime`、`state`、`artifacts`、`platform`、`local-oracle`，以及 supervisor 的 `responsibilities`、`candidate-control`、`candidate-verification`、`long-job-watch`、`compaction`、`local-resume`、`hypotheses`、`multiflag`）。

**已知限制：** 无。`npm test` 全绿（29 个档、174 个测试）；开发机已安装 ripgrep 15.2.0，原生 `skill` 可用。

**下一份要写的 design：** design v1 C（多 Agent 身份绑定、控制服务接线、逐次预算准入），连同 H 角色权限落地；之后是 design v1 E 的最小版（运行配置中的题目来源，本地靶场与附件优先；Intake 的接入工具）。两者实作接通后才做真实模型冒烟。

**进行中的 plan：** 无。框架实现与旧入口退役两份 plan 已完成并删除（结论见入口 design 第 1 节与本节），历史见 git。

## 目录约定

- `specs/` — 设计与迁移记录：design v1、其详细 design 子文件，以及迁移记录。
- `plans/` — 按 `CLAUDE.md` 约定的 §0 交接计划，是一次性交接物：design 不引用 plan，结论转入 design 或 `gates/` 后删除。不放里程碑 plan。
- `gates/` — 只保留支撑 design 结论的最小原始证据（清理时保留的证据见迁移记录）。
