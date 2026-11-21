# 文档索引

通用 CTF 解题 Agent 的开发文档入口。更新日期：2026-11-20。

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
| 排查 Coordinator／Recon／Solver 重复探索、交接后无推进，区分架构与能力问题 | [团队决策上下文](specs/2026-11-07-design-v1-team-decision-context.md) | 进行中（2026-11-19）：工作簿与假设证据引用已落地，解题收益未验证；停止规则的 3 次变更后观察只部分遵守；未更新条目提示不实施；候选写入后交回的合成对照结论 unknown、不实作；工作簿省略规则已实作（先压缩成短列、受保护条目不删），短列展开验证案例已备、待真实 run；未解 run 的提前结束归因为环境/工具边界，不改停止规则。 |
| 判断一次失败卡在方法发现、内容、承接、派单措辞还是模型能力；改提示或 Skill 前先定位 | [固定决策点诊断](specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md) | 暂缓（2026-11-19）：合成对照结束，Q2–Q5 未成立，记为 unknown 并停止；harness 保留，已支持本地无害 job、用量与逐次理由记录，并用于候选交回与短列展开的合成案例；§9 仅作局部回归材料。 |
| 修改产品资产布局、固定副本、原生 Skill／Reference 载入 | [A／B 产品资产与 Skill](specs/2026-10-22-design-v1-ab-product-assets.md) | 资产复制、metadata、版本记录已接入；历史无模型 skill → read 连通成立。当前角色准入与 Skill 根内受控 read 已接入，见下方 Skill 核对 §7.2；共用知识目录仍待按需推进。 |
| 修改角色／Web Skill 中的工具用法，排查旧接口描述 | [产品角色与 Web Skill 契约对齐](specs/2026-10-24-design-v1-product-instruction-contract-alignment.md) | 六份产品文档清理已完成、无模型回归与复核通过；必要清理及剩余收口已提交（`31b10b58`、`f7ad776b`）。不证明模型遵循。 |
| 修正报告 blocker 的交接、无依据重包或重算比较区间 | [Agent 交接连续性](specs/2026-10-24-design-v1-agent-handoff-continuity.md) | 一般派单、交回与续接见[团队决策 §6.2](specs/2026-11-07-design-v1-team-decision-context.md#62-派單與交回的內容契約)。报告 blocker 和比较区间以交接设计 §5.1、§7 为准，最小修改已实施并通过无模型回归（`77e40a5d`），效率改善未验证。 |
| 调整 Skill 发现描述、判断适用条件或是否需要拆分 | [Skill 找得到、用得对](specs/2026-10-24-design-v1-skill-discovery-and-use.md) | 已落地（2026-11-20）：Web Skill 入口与条件分区（现为 v7），选用收益未验证；§10 两项触发位置候选已在 harness 备好单变量对照、模型对照待授权，产品端暂缓；§11 列三个 Skill 的入口、决策来源与验证层次。 |
| 排查启动、运行目录、依赖或结束时证据保存 | [入口与本地调试](specs/2026-10-22-design-v1-entry-local-debug.md) | `apps/launcher` 入口及资料分区、启动／停止／保存已接入；依赖条件见 §4，控制服务与预算停止见 C。 |
| 修改会话身份绑定、工具准入、预算或任务停止 | [C 控制服务与会话绑定](specs/2026-10-23-design-v1-c-control-service.md) | 前台及 G 原生背景路径、逐次准入、结算与停止已接入；进度摘要见本地练习 design，更完整通知按需推进。§3.1 让 dispatch 拒绝原因对模型可见；§3.2（2026-11-10）处理 read path（按角色区分可用提示，audit 记 rootTag）、artifact source（未发布 ref 的固定提示）、http.request 的 4 次 timeout（确认是请求截止竞态非参数越界，未改代码）与 binding lapsed 截止竞态（audit 记 deadline detail，不改错误码）。 |
| 修改产物发布、固定候选、独立验证或可信完成 | [D 最小版](specs/2026-10-24-design-v1-d-candidate-verification-minimal.md) | 五接口已接入并完成无模型验收；§7.2 记录一次本地 `mfw` 真实模型整链 verified／accepted／solved。生产裁判部署与秘密隔离仍有缺口。 |
| 修改题目输入、材料固定、可达性或 Intake 工具 | [E 最小版](specs/2026-10-23-design-v1-e-intake-minimal.md) | 最小取题链已接入，真实模型冒烟验证过取题；平台 API 与靶场部署等延后项见 §6，不自动恢复。 |
| 修改 workspace／HTTP／job、异步交付、恢复或执行边界 | [G 最小版](specs/2026-10-23-design-v1-g-solver-minimal.md) | 已定部分通过无模型验收，单题真实运行观察见 §9.2。[§5.3](specs/2026-10-23-design-v1-g-solver-minimal.md#53-執行環境) 区分预览省略、已保存可续读及超限丢弃，job 终态审计逐流记录 metadata（2026-11-20），此前缺记录的 run 记为 unknown。隔离、网络 scope、资源总量与 D／E 接口仍有未定项（§10）。 |
| 排查模型误用 workspace 路径或改进工具说明 | [G run 复盘与路径可发现性](specs/2026-10-24-design-v1-g-run-review-and-path-affordance.md) | 路径说明与示例已修正，既有 guard 保留，定向回归通过；修正后的模型遵循未验证。 |
| 修改进度记录、停滞信号、Critic 判断，或准备练习批次 | [本地三题练习与进度帐本](specs/2026-10-24-design-v1-local-practice-suite-and-progress-ledger.md) | 进度帐本已接入并通过无模型验证，仍有效。mfw、throwback 在多次真实 run 中经 exact judge 核对，seizurecipher 仍未核实。固定三题批框架未采用，题集与验收由 [B §7](specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序) 的 7 题基线及资格检查承接，本三题框架不设正式成功率门槛。 |
| 排查空交接、length 结束、结果归属或父上下文缺信息 | [结果完整性与交接可见性](specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) | 已按最小范围接入：同步关联、父展示、多通知消费及 Critic 条件澄清；无模型验收与独立 review 通过，见[实施证据](../gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/README.md)。child 输出上限自 a7 起为运行设定 32000；最终报告措辞已写入 Coordinator 角色档（§4.1.1），一次手动盘点报告符合措辞要求；角色版本、普遍报告质量与 Critic 调用效果仍未验证。实作 plan 已完成回补并删除。 |
| 改进通用解题方法、Skill／Reference 与失败归因 | [B 通用解题方法与耗时优化](specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md) | 进行中（2026-11-20）：同版本 7 题基线已跑完（14 run、6 solved、约 5.37M token）；3 题思考设定对照只见方向；候选写入后的交回合成对照结论 unknown、不实作，剩余时间重开保留为假设；方法补齐第一个选题（新证据改写已记结论）的范例已写入 `python-runtime-diagnosis` Reference，效果待同版本配对验证。 |
| 排查停滞未触发换路、Critic 复核关键前提或搜索结果有效性 | [否定证据与路线复核](specs/2026-10-25-design-v1-negative-evidence-and-route-review.md) | 搜索取证、事实交接与有界回合交回（§5 候选 D）已接入。配对批次两次 Critic `redirect` 均获承接，停止归因中 13/15 次派过 Critic，9/15 次记录 `redirect` 并在 Critic 后执行了有界实验（[团队决策 §6.3](specs/2026-11-07-design-v1-team-decision-context.md#63-候選與收尾)）。取证、判断及换路的质量仍未验收。 |
| 修改同步任务交付身份、续接参数继承 | [任务参数继承与同步交付身份](specs/2026-10-25-design-v1-sync-resume-provenance.md) | 同步交付已实现并合入（merge `c120e143`），无模型验证通过；Q5 promotion 按可达性判定记录为限制、未实现。 |
| 排查 finish=length、空正文或结果分类 | [生成到上限后的空正文与结果恢复](specs/2026-10-26-design-v1-c-empty-result-recovery.md) | 普通完成入口的多轮分类修复已合入；转后台、错误与不支持链的边界保留；实际额度接线与生成改善待验证。 |
| 追溯旧 r4／r5 Verifier 拒绝原因 | [D 从证据到验证结论](specs/2026-10-26-design-v1-d-evidence-to-completion.md) | 历史问题与证据子文件；当前职责与提交策略以 D 最小版 §5–7 为准。 |
| 修改 Recon 记录、上下文呈现、经验／lesson 或执行中时间事实 | [Recon 重设计](specs/2026-10-29-design-v1-recon-redesign.md) | 记录、上下文、交回与 episode／lesson 已在真实 runtime 走通，时间事实已落地（`7c414e6e`），长 child 仍常到末段才交回。§4 索引按需读取（默认索引摘要＋`repeat_of`，`context.index`／`context.workbook` 可退回与配对）通过无模型契约测试。2026-11-16 冒烟观察到单次最大投影约 56K→15K bytes、1 次 `recon.read` 展开（[团队决策 §6.1](specs/2026-11-07-design-v1-team-decision-context.md#61-題目工作簿第一片)）。按需读取及经验的解题收益仍未验证。 |
| 分析 run 墙钟时间、token、思考开关与上下文成本 | [解题延迟与上下文成本](specs/2026-11-04-design-v1-run-latency-and-context-cost.md) | §3.1、§3.2、§3.4 已采用；§3.3 并行与 §3.5 已试路线摘要延后；Coordinator 关闭思考与出处条件修订待配对 run（需另行授权预算）。 |
| 决定解题工具映像装什么、x86 程序怎样处理、job 在哪个容器执行 | [工具映像与架构](specs/2026-11-21-design-v1-tool-image-and-architecture.md) | 已落地（2026-11-21，开发部署）：Ubuntu 24.04 ARM64 单一工具映像（含 Pwn／Reverse／Mobile 工具）、x86 用映像内 QEMU；launcher 以 `--tool-image` 启用每会话工具容器，默认关闭；无模型检查 28 项、脚本化整题 run（与宿主模式对照）与独立 Linux arm64 Docker Engine 都通过。真实模型是否读工具清单未验证；job 网络暂关，待 G §5.5。 |
| 评估题目图片能否交给模型观察 | [图像观察](specs/2026-10-29-design-v1-image-observation.md) | 候选 A（`workspace.view` 图像交付）已合入 main；模型能否借看图解题未证实，B／C／D 未做；不是模型调用授权。 |
| 追溯旧架构取舍、迁移原因或已知教训 | [现状、教训与迁移记录](specs/2026-10-22-ctf-agent-current-state-and-migration.md) | 历史参考，部分状态已过期；优先核对当前实现与详细 design。旧待办、冻结轨迹和里程碑不自动继承。 |

## 当前能力边界

当前同一 launcher 入口已在本地 Docker 单题上串起取题、团队工具、产物发布、独立验证及可信完成；成功与预算停止的历史均保留在 D §7.2。一次非生产整链成功不外推为多题成功率或完整产品验收。

此后路径说明、产品契约、交接与 Skill v4 的修改各有其无模型或静态验证，不能借用此前真实 run 宣称优化效果已验证。生产秘密隔离、完整网络 scope 及资源边界仍以核心 design 和 G 的未决项为准；在途模型调用可能越过预算门槛，不把额度视为绝对封顶。

本产品限授权 CTF 比赛、学习题与靶场；全局运行和授权约束见 AGENTS.md 与核心 design，不在索引维护副本。

## 收口时同步索引

每个 plan 执行、验收并回补对应 design 后，同步本 README 的相关行：何时读取、已实现部分、验证层次及剩余限制。状态改变或文档新增、删除、改名时，一并修正链接；不等到 commit 才更新，也不以 plan 删除推断整个 design 已完成。

先把决策与验证结果写回 design，再更新索引摘要，最后删除结论已转入的临时 plan。只改受影响条目，不在这里复制测试日志、token 明细、运行日记或另建任务路线图。全局开发硬约束仍由 AGENTS.md／CLAUDE.md 维护。

**新证据改变另一份 design 的验证层次时，同步那份 design 的状态行与本索引对应行。** 新证据通常先写进当时活跃的 design 或分析；被它影响的姊妹 design 若只在状态行写着“待真实 run”“未验证”，要改成实际达到的层次（例如“已在真实 run 观察到机制，收益未验证”），正文不动。

## 目录约定

- `specs/`：核心设计、详细 design 子文件与历史迁移记录。
- `plans/`（即 `docs/superpowers/plans/`，需要时才建）：按 CLAUDE.md 的 §0 交接执行，一次性交接物；design 不引用 plan，结论回写后删除。
- `analysis/`：不进本索引，分三类——调研（如开源调研）、一次性核对记录（如某次批次或问题的核对）、审阅清单（待用户逐项决定）。每份开头一行标状态：**现行**（仍在使用或待决定）、**已并入**（写明并入哪份 design 的哪一节；只部分并入时写明哪部分仍有效）、**历史**（只供追溯）。并入后加标记，不自动删除。
- [docs/gates/](../gates/)：支撑 design 结论的最小原始证据；只按相关 design 的引用读取。
