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
| [核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md) | 已定稿 | — | 第 3 节仍列 4 项待决：接口的原生／受管映射、工具套件与 ARM64、产品网络隔离、成功率门槛；G 异步绑定／交付的固定原生路径已验证并接入主区 |
| [A／B 产品资产与 Skill](specs/2026-10-22-design-v1-ab-product-assets.md) | 已定稿；第 6 节列 7 项未定稿 | `product/` 两层布局、白名单复制到每次 run 的配置目录、副本 hash 与来源版本、Skill frontmatter 检查、同名目标拒绝；原生 `skill` 按需载入与附属 Reference 的 `read` 已在开发机实测可用（第 5 节） | 插件按角色放行 `skill`／`read`（待 C）；共用 `references/` 内容 |
| [入口与本地调试](specs/2026-10-22-design-v1-entry-local-debug.md) | 已定稿（两项未知数已由探针验证） | 启动脚本 `apps/launcher/src/launch.ts`：运行资料目录分区（仓库外、realpath）、工作目录边界检查、`opencode serve` 加一次 SDK 启动讯息、时限 abort 与结果保存；旧 `solveM1` 单一 Solver 入口已退场（第 1 节） | 把 ripgrep 作为开发机前置条件记入开发文档（第 4 节；本机已安装）。控制服务与 token 预算停止已由 C 实作 |
| [C 控制服务与会话绑定](specs/2026-10-23-design-v1-c-control-service.md) | 前台及 G 原生背景路径已定 | 根／子会话绑定、跨轮 pending、逐次准入、资源结算与预算停止、受管工具、异步结果交付及 task.stop 已接入；见 G §9.2 | D 工具、通用进度及共用知识目录 read 授权不由本次完成 |
| [E 最小版：题目来源与 Intake 接入](specs/2026-10-23-design-v1-e-intake-minimal.md) | 已定稿（最小版：只解决题目进得来；平台 API 与靶场部署不在范围，为 G、D 服务的部分列为延后项，第 6 节） | 全部（第 7 节）：release profile 的 `challenges` 栏位与题目清单（`apps/launcher/src/challenges.ts`，范例 `config/challenges.example.json`）、启动前凭据扫描、可达性检查与材料固定（`run-prep.ts`）、Intake 的 `challenge.list`／`challenge.read`（`intake-tools.ts`） | 第 6 节延后项（待 G、D）；真实模型冒烟已验证取题链（第 7 节，gate `e-intake-smoke-20261023`） |
| [G 最小版：解題工具與綁定](specs/2026-10-23-design-v1-g-solver-minimal.md) | 當前已定接入部分完成；整體延後項仍未定 | 題目綁定、三根工具、HTTP/job、RPC、原生背景交付／恢復／停止、角色權限及可信收束已接入主區；驗收見 G §9.2 | D 產物／候選／可信驗證仍是完整做題流程的直接依賴；隔離部署等按 G §10 延後，不擴回前置研究清單 |
| [现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md) | 大部分已过期：§1 清理方向已执行完、§2 静态对照已被真实探针取代、§5 指令收敛已完成；§4 教训仍有效，§3 偏离部分已解决 | — | 待精简为「教训与未解偏离」 |

**当前推进起点**：E 的取题、Intake 读题及 Coordinator 分派已通过带真实题目的冒烟；现在承接读题后的解题编排与工具执行，不重新研究题目接入。G §10.2／10.3 是延后工程及按需能力，不是下一轮三项研究任务。

**尚未接通的能力**：D 产物发布、固定候选、独立验证结果及平台／oracle 完成判定。G 已定工具与任务生命周期已接入；隔离部署、通用网络、完整配额及恢复按 G §10 延后，运行边界不据此豁免。

**唯一入口：** `apps/launcher`。旧 `solveM1`／`openCodeTask` 不恢复。当前可在无模型场景串起 E 读题、既定团队工具操作、结果交回与 Coordinator 后续决策；D 尚缺，因此不能声称完整做题流程或 solved 已成立。

**真实模型：** 2026-10-23 首次真实模型冒烟通过（火山方舟 Coding Plan、`deepseek-v4-1-flash-261017`，8 次模型调用、约 1.1 万 token，Coordinator 自行结束，无 provider 错误）；只确认接线，不代表解题能力。每批真实调用仍须另行授权。

**已知限制：** OS／网络局部机制证据不等于产品部署或完整 scope 已通过；真实模型解题工具使用未验证，单次输出上限仍依模型 limit.output 与剩余额度推断。

**G 当前状态：** 已按用户授权把核实的独立候选接入主区，已有失败及验证来源保留。具体决策、当前接入与延后项见 [G design](specs/2026-10-23-design-v1-g-solver-minimal.md) §9.2／§10；本批无真实模型运行。

**G 计划收口：** 七份临时验证 plan 的原始判据快照保存在各证据目录，结果已转入 design，活动 plan 已移除。专属验证 session 核对后归档，从活动列表移除；worktree 与证据保留。清理计划不表示 G 定稿，也不自动启动后续实现。

## 目录约定

- `specs/` — 设计与迁移记录：design v1、其详细 design 子文件，以及迁移记录。
- `plans/` — 按 `CLAUDE.md` 约定的 §0 交接计划，是一次性交接物：design 不引用 plan，结论转入 design 或 `gates/` 后删除。不放里程碑 plan。
- `gates/` — 只保留支撑 design 结论的最小原始证据（清理时保留的证据见迁移记录）。
