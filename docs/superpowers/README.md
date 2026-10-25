# 文档索引

通用 CTF 解题 Agent 的开发文档入口。更新日期：2026-10-25。

## 如何按需阅读

先遵守根目录 [AGENTS.md](../../AGENTS.md) 与适用的 [CLAUDE.md](../../CLAUDE.md)，再按下表选择与当前任务有关的文档；不要求每次通读所有 design、历史记录或 gates。

- 需要确认全局架构、职责、授权或验收边界：读 [核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md) 的相关章节。
- 修改某个具体能力：读对应详细 design；详细 design 是核心设计的子文件，具体决策及验证限制以它为准。
- 执行已授权工作：读对应的现存 plan §0 及其引用的 design。plan 是临时交接物，不是另一份设计权威；没有 plan 不等于尚未实作。
- 需要核对失败、版本或原始证据：沿 design 指定的位置读取必要记录，不默认加载整个 gates 或 run。历史迁移文档不作为当前任务清单。

本索引只帮助选择文档，不会自动加载内容，也不向产品解题 Agent 注入这些开发资料。状态描述不授予真实模型运行、提交或部署权限；按用户当前目标推进，不由索引推导下一项任务。

## 按任务查找 design

状态按当前工作区及各 design 的记录汇总；“已接入”不代表相关工作均已提交或完成产品验收。只在需要区分本次收口时列出提交记录。具体测试、版本、预算、运行历史与证据位置留在对应 design。

| 何时读取 | 文档 | 当前状态与未验证边界 |
| --- | --- | --- |
| 判断跨组件职责、产品范围或验收要求 | [核心设计 v1](specs/2026-10-22-ctf-agent-design-v1.md) | 当前架构依据；第 3 节仍有待决项，不把全文视为全部已实现。 |
| 修改产品资产布局、固定副本、原生 Skill／Reference 载入 | [A／B 产品资产与 Skill](specs/2026-10-22-design-v1-ab-product-assets.md) | 资产复制、metadata、版本记录已接入；历史无模型 skill → read 连通成立。当前角色准入与 Skill 根内受控 read 已接入，见下方 Skill 核对 §7.2；共用知识目录仍待按需推进。 |
| 修改角色／Web Skill 中的工具用法，排查旧接口描述 | [产品角色与 Web Skill 契约对齐](specs/2026-10-24-design-v1-product-instruction-contract-alignment.md) | 六份产品文档清理已完成、无模型回归与复核通过；必要清理及剩余收口已提交（`31b10b58`、`f7ad776b`）。不证明模型遵循。 |
| 修正报告 blocker 的交接、无依据重包或重算比较区间 | [Agent 交接连续性](specs/2026-10-24-design-v1-agent-handoff-continuity.md) | Coordinator／Verifier 最小修改已实作、无模型回归通过并提交（`77e40a5d`）；其余一般交接建议仍为候选，效率改善未验证。 |
| 调整 Skill 发现描述、判断适用条件或是否需要拆分 | [Skill 找得到、用得对](specs/2026-10-24-design-v1-skill-discovery-and-use.md) | 单一 Skill 已更新至 v4 并提交（`77e40a5d`）；五情境静态核对及独立复核通过。未新增 Skill／角色提醒；当前原生加载与模型选用效果未验证。 |
| 排查启动、运行目录、依赖或结束时证据保存 | [入口与本地调试](specs/2026-10-22-design-v1-entry-local-debug.md) | `apps/launcher` 入口及资料分区、启动／停止／保存已接入；依赖条件见 §4，控制服务与预算停止见 C。 |
| 修改会话身份绑定、工具准入、预算或任务停止 | [C 控制服务与会话绑定](specs/2026-10-23-design-v1-c-control-service.md) | 前台及 G 原生背景路径、逐次准入、结算与停止已接入；进度摘要见本地练习 design，更完整通知按需推进。 |
| 修改产物发布、固定候选、独立验证或可信完成 | [D 最小版](specs/2026-10-24-design-v1-d-candidate-verification-minimal.md) | 五接口已接入并完成无模型验收；§7.2 记录一次本地 `mfw` 真实模型整链 verified／accepted／solved。生产裁判部署与秘密隔离仍有缺口。 |
| 修改题目输入、材料固定、可达性或 Intake 工具 | [E 最小版](specs/2026-10-23-design-v1-e-intake-minimal.md) | 最小取题链已接入，真实模型冒烟验证过取题；平台 API 与靶场部署等延后项见 §6，不自动恢复。 |
| 修改 workspace／HTTP／job、异步交付、恢复或执行边界 | [G 最小版](specs/2026-10-23-design-v1-g-solver-minimal.md) | 已定部分接入主区并有无模型验收，单题真实运行观察见 §9.2；整体未定稿，隔离、网络 scope、资源总量与剩余契约见 §10。 |
| 排查模型误用 workspace 路径或改进工具说明 | [G run 复盘与路径可发现性](specs/2026-10-24-design-v1-g-run-review-and-path-affordance.md) | 路径说明与示例已修正，既有 guard 保留，定向回归通过；修正后的模型遵循未验证。 |
| 修改进度记录、停滞信号、Critic 判断，或准备练习批次 | [本地三题练习与进度帐本](specs/2026-10-24-design-v1-local-practice-suite-and-progress-ledger.md) | 进度帐本最小切片已接入并通过无模型验证；三题真实模型批次未授权，部分题目 oracle 未核实，不设正式成功率门槛。 |
| 排查空交接、length 结束、结果归属或父上下文缺信息 | [结果完整性与交接可见性](specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) | 已按最小范围接入：同步关联、父展示、多通知消费及 Critic 条件澄清；无模型验收与独立 review 通过，见[实施证据](../gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/README.md)。8000 未调；报告质量与 Critic 实际调用效果未验证。实作 plan 已完成回补并删除。 |
| 追溯旧架构取舍、迁移原因或已知教训 | [现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md) | 历史参考，部分状态已过期；优先核对当前实现与详细 design。旧待办、冻结轨迹和里程碑不自动继承。 |

## 当前能力边界

当前同一 launcher 入口已在本地 Docker 单题上串起取题、团队工具、产物发布、独立验证及可信完成；成功与预算停止的历史均保留在 D §7.2。一次非生产整链成功不外推为多题成功率或完整产品验收。

此后路径说明、产品契约、交接与 Skill v4 的修改各有其无模型或静态验证，不能借用此前真实 run 宣称优化效果已验证。生产秘密隔离、完整网络 scope 及资源边界仍以核心 design 和 G 的未决项为准；在途模型调用可能越过预算门槛，不把额度视为绝对封顶。

本产品限授权 CTF 比赛、学习题与靶场；全局运行和授权约束见 AGENTS.md 与核心 design，不在索引维护副本。

## 收口时同步索引

每个 plan 执行、验收并回补对应 design 后，同步本 README 的相关行：何时读取、已实现部分、验证层次及剩余限制。状态改变或文档新增、删除、改名时，一并修正链接；不等到 commit 才更新，也不以 plan 删除推断整个 design 已完成。

先把决策与验证结果写回 design，再更新索引摘要，最后删除结论已转入的临时 plan。只改受影响条目，不在这里复制测试日志、token 明细、运行日记或另建任务路线图。全局开发硬约束仍由 AGENTS.md／CLAUDE.md 维护。

## 目录约定

- `specs/`：核心设计、详细 design 子文件与历史迁移记录。
- `plans/`：按 CLAUDE.md 的 §0 交接执行，一次性交接物；design 不引用 plan，结论回写后删除。
- [docs/gates/](../gates/)：支撑 design 结论的最小原始证据；只按相关 design 的引用读取。
