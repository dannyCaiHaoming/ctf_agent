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
| [核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md) | 已定稿 | — | 第 3 节仍列 5 项待决：接口的原生／受管映射、工具套件与 ARM64、产品网络隔离、成功率门槛、解题子会话与题目的绑定（C.1 绑定时序已定稿，采原生 `task`） |
| [A／B 产品资产与 Skill](specs/2026-10-22-design-v1-ab-product-assets.md) | 已定稿；第 6 节列 7 项未定稿 | `product/` 两层布局、白名单复制到每次 run 的配置目录、副本 hash 与来源版本、Skill frontmatter 检查、同名目标拒绝；原生 `skill` 按需载入与附属 Reference 的 `read` 已在开发机实测可用（第 5 节） | 插件按角色放行 `skill`／`read`（待 C）；共用 `references/` 内容 |
| [入口与本地调试](specs/2026-10-22-design-v1-entry-local-debug.md) | 已定稿（两项未知数已由探针验证） | 启动脚本 `apps/launcher/src/launch.ts`：运行资料目录分区（仓库外、realpath）、工作目录边界检查、`opencode serve` 加一次 SDK 启动讯息、时限 abort 与结果保存；旧 `solveM1` 单一 Solver 入口已退场（第 1 节） | 把 ripgrep 作为开发机前置条件记入开发文档（第 4 节；本机已安装）。控制服务与 token 预算停止已由 C 实作 |
| [C 控制服务与会话绑定](specs/2026-10-23-design-v1-c-control-service.md) | 已定稿：采原生 `task`（2026-10-23 零 token 探针验证，第 8 节） | 首版：`apps/launcher/src/control-service.ts` 与 `control-rpc.ts`，产品插件改为只转发、预设拒绝；根／子会话绑定、待绑定分派（同父同角色一笔，父会话下次准入时释放）、逐次模型调用准入、时限与预算统一停止、用量下限标记、原生 `read`（限 Skill 副本）／`skill`／`task` 的角色核准；受管工具接线（插件注册为 `ctf_<名称>`，零 token 确认受 per-agent 权限控制，第 8 节） | 其余受管工具（待 G、D）；单一子会话撤销（`revoke` 已实作但无调用方）；任务状态读取；共用知识目录的 `read` 授权 |
| [E 最小版：题目来源与 Intake 接入](specs/2026-10-23-design-v1-e-intake-minimal.md) | 已定稿（最小版：只解决题目进得来；平台 API 与靶场部署不在范围，为 G、D 服务的部分列为延后项，第 6 节） | 全部（第 7 节）：release profile 的 `challenges` 栏位与题目清单（`apps/launcher/src/challenges.ts`，范例 `config/challenges.example.json`）、启动前凭据扫描、可达性检查与材料固定（`run-prep.ts`）、Intake 的 `challenge.list`／`challenge.read`（`intake-tools.ts`） | 第 6 节延后项（待 G、D）；真实模型冒烟已验证取题链（第 7 节，gate `e-intake-smoke-20261023`） |
| [现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md) | 大部分已过期：§1 清理方向已执行完、§2 静态对照已被真实探针取代、§5 指令收敛已完成；§4 教训仍有效，§3 偏离部分已解决 | — | 待精简为「教训与未解偏离」 |

**尚未接通的能力**：解题角色的受管工具（工作区、HTTP、作业）、候选登记、独立验证、平台／oracle 提交。控制服务已提供逐次模型调用准入与预算停止（预算暂用 release profile 的 `maxSteps`／`maxObservableTokens`／`wallClockMs` 过渡映射），真实模型调用仍须每批另行授权。

**唯一入口：** `apps/launcher`。旧 `ctf-agent solve`（`solveM1`／`openCodeTask`）与 `--trajectory` 测试专用路径已于 2026-10-23 删除，`ctf-agent` 现只剩 `resume` 指令。**在控制服务按 design v1 C 实作完成前没有可用的解题路径**：launcher 能启动产品角色并让 Intake 取题，但解题角色的受管工具、候选登记与独立验证尚未接通。供控制服务接线的能力模组已保留（`runtime`、`state`、`artifacts`、`platform`、`local-oracle`，以及 supervisor 的 `responsibilities`、`candidate-control`、`candidate-verification`、`long-job-watch`、`compaction`、`local-resume`、`hypotheses`、`multiflag`）。

**真实模型：** 2026-10-23 首次真实模型冒烟通过（火山方舟 Coding Plan、`deepseek-v4-1-flash-261017`，8 次模型调用、约 1.1 万 token，Coordinator 自行结束，无 provider 错误）；只确认接线，不代表解题能力。每批真实调用仍须另行授权。

**已知限制：** 单次输出上限依插件取模型 `limit.output` 与剩余额度的较小者，未在请求级记录；Intake 已有取题工具且真实模型冒烟确认能读到三道本地 Docker 题；但解题角色（Recon、Domain Solver 等）仍没有任何受管工具，分派后无法动手。`npm test` 全绿（32 个档、201 个测试）；开发机已安装 ripgrep 15.2.0，原生 `skill` 可用。

**下一步：** 写最小 G 的详细 design：解题角色的工作区读写与 HTTP／脚本执行，连同解题子会话与题目的绑定（design v1 第 3 节待决项）；首题的真实模型验证待最小 G 接通后进行。

**进行中的 plan：** 无。E 最小版实现 plan 已完成并删除（结论见 E design 第 7 节与 C design 第 8 节，原文见 git 历史）；真实模型冒烟 plan 已完成，先提交存档再删除（结论见 C design 第 8 节与入口 design 第 2 节）；控制服务首版 plan 已完成并删除，该 plan 未曾提交，原文未存档。

## 目录约定

- `specs/` — 设计与迁移记录：design v1、其详细 design 子文件，以及迁移记录。
- `plans/` — 按 `CLAUDE.md` 约定的 §0 交接计划，是一次性交接物：design 不引用 plan，结论转入 design 或 `gates/` 后删除。不放里程碑 plan。
- `gates/` — 只保留支撑 design 结论的最小原始证据（清理时保留的证据见迁移记录）。
