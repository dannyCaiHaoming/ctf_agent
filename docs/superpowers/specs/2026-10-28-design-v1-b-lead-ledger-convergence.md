# design v1 B：显式线索/假设帐本与强制消费（收敛主设计）

日期：2026-10-28（Asia/Tokyo）。状态：**聚焦 design，待计划与真实 run 验证；未改产品、未运行模型。** 本文是 [B 方法论 §7](2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序20261028r7-驱动参考外部-ctf-agent-设计) 投资优先序 #1 的详细设计，是收敛问题的**主方向**；[路线复核 §5](2026-10-25-design-v1-negative-evidence-and-route-review.md) 的有界交回（D）与宿主信号（B）在本设计之下分别作节拍与兜底，[路线优先级增量](2026-10-28-design-v1-b-evidence-to-action-route-priority.md) 的 Skill 内容增量优先级更低。参考外部设计（PentestGPT 的 PTT 任务/线索树为最直接对照；训练知识截至 2026-01，细节待原文核对）。

## 1. 目标与原始问题

**目标：** 让 solver 面前始终有一份**显式、持久的线索/假设清单**，每步行动对照它选择，使「已浮现但未测的具体线索」永远可见、挡在通用枚举/深挖之前，从而收敛。

**原始问题（r7，已核实）：** Recon 已发布含 `/admin/chal/delete` 的 baseline，Domain Solver 已取得 RCE，却在 78 次 HTTP／几十次搜索里从未请求该路线，末段约 20 分钟发散翻档。线索与能力在手却走丢——这是 LLM 长程探索的典型失败，PentestGPT 用显式 PTT、Cybench 用子任务分解来治它。本项目当前 solver 的「计划」只存在模型脑内（隐式），没有外显可对照的线索状态。

## 2. 落地约束（已只读核实，2026-10-28）

1. **现有 progress 帐本 solver 用不了。** `ctf_progress_read`／`ctf_progress_note` 经 `checkProgress`（`control-service.ts:661`）限 `coordinator`／`recovery-critic`。solver 级的线索帐本要么新增 solver 可用面，要么放别处。
2. **note schema 不是线索清单。** `validateProgressNote`（`progress-ledger.ts`）是路线决策（stage/route/summary/blocker/nextAction/capabilityGap），没有「逐条线索＋tested/untested 状态＋来源 ref＋低成本测法」。线索帐本是不同结构。
3. **宿主握有机械信号的原料但抽取脆弱。** 宿主有 `publications`（发布内容字节）与 http 请求审计，原则上可算「发布过却从未被请求的路线」；但从自由文字 artifact 抽路线是启发式，易漏易误。
4. **「强制消费」对 LLM 本质上是遵循问题。** 不能真的强制模型去「查」帐本（与 L1 skill 调用同族）。**最稳的形式是把线索状态自动注入上下文，而非指望模型主动调工具读。**

## 3. 要回答的问题

1. **帐本存放与维护者？** solver-local（workspace 文件）／Coordinator 级（扩现有帐本）／新 solver 作用域工具／宿主派生，各自的可见性与强制力如何？
2. **怎样让「消费」尽量不依赖模型自觉？** 自动注入每轮上下文、还是加工具让模型调？注入的最小单位是什么（未测线索清单？下一步候选？）？
3. **线索从哪来、谁登记、状态谁更新？** Recon 浮现→谁转成帐本条目；solver 测过后 tested/refuted 由谁改；跨角色（Recon/Solver/Coordinator/Critic）如何共享同一份而不产生两套状态？
4. **宿主机械信号要不要做、做到哪？** 「发布过未请求的路线」作为提示值不值得抽取？抑或只把语义判断交给 Critic（§5）？
5. **怎样算它真的改变了行为**（而非只多了一份没人看、看了不照做的清单）？

## 4. 候选做法与结果去向（不预先定案）

- **A. 帐本自动注入上下文（推荐优先评估）。** 每轮 solver 任务／有界回合的 prompt 里，由 Coordinator（或宿主在交接处）带入「当前未测线索清单（含来源 ref 与低成本测法）」。不依赖模型调工具读，契合「常驻、始终在上下文」。结果去向：若能界定注入内容的最小面与来源（Recon 交付＋Critic 更新），写入 `coordinator.md`／solver 角色的交接措辞，复用现有 task 交接，不新建 registry。
- **B. 扩 progress 帐本为结构化线索条目。** 在现有 ledger 增「lead」类型（id／描述／来源 ref／status：untested|testing|refuted|confirmed／cheap-test），并把 solver 纳入**受限**读写面（只读本题自己的线索、写状态）。结果去向：涉改 `checkProgress` 权限与 note schema，是接口改动，先记影响面再拆最小 plan；仍不强制「每步必调」。
- **C. solver-local 帐本（workspace 文件，如 `work/leads.md`）。** 角色 prompt 要求维护并每步对照。零新接口，但纯遵循、宿主不可见、不跨角色共享。作 A 的退化备选。
- **D. 宿主派生「发布过未请求」提示。** 从 `publications` vs http 审计机械算出候选未测路线，经既有 `ctf_progress_read`（Coordinator/Critic）surface。结果去向：仅当抽取足够可靠才做；否则记为启发式信号、不作强制依据，语义判断仍归 Critic。
- **与 D(§5 有界交回) 的合成：** 在每个有界回合／交接边界，Critic/Coordinator 复核并更新帐本，未测线索即 redirect 的依据；[路线复核 §5](2026-10-25-design-v1-negative-evidence-and-route-review.md) 的节拍让帐本有被复核的时点。**判断仍归 Recovery Critic、只建议、Coordinator 决定**，不新增 judge 权。

**倾向：** A（自动注入）为主、以最小结构支撑；B 的结构化条目若 A 证明需要宿主侧状态再上；C 作退化；D 仅在抽取可靠时作辅助提示。先评估 A 能否只靠现有 task 交接落地。

## 5. 最小验证与边界

- **无模型只能验装配**：注入面确实带入未测线索清单、帐本状态在交接处被更新、与 §5 节拍衔接、不泄露秘密/候选原文/flag。**是否真收敛只能真实 run（r8，另行授权 model／provider／批次／token）认账**：行为判据——solver 在深挖通用枚举前实际请求了帐本中的未测具体线索（如 `/admin/chal/delete`），且未测线索不被 20 分钟发散淹没。不拿「帐本已建／已注入」冒充收益；无收益即缩小或撤回，不删失败样本。
- **边界（禁做）：** 不建通用 planner 框架/任务编排系统/漏洞百科；帐本最小、复用现有 task 交接与 progress/Critic，按实际缺口增量。不强制「每步必调工具」（对 LLM 无效且违反 skill-discovery「不强制」精神）。不新增 judge 权、Critic 仍只建议。不把候选原文、flag、cookie、控制秘密、完整 prompt、chain-of-thought、job argv 放进帐本或注入面。一道 web 题证据有限，保持可证伪。未经授权不运行真实模型、不 commit／push。

## 6. 完成含义

本片完成仅指：**定出线索帐本的存放/维护/消费的最小形式（优先验证 A 能否靠现有交接落地），并明确行为收益只能由真实 run 认账。** 不证明 throwback 可解或泛化。结论定稿后转入 [B 方法论 §7](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)，落地措辞进 `coordinator.md`／solver／`recovery-critic.md`，据此生成的一次性 plan 完成后删除。外部系统引用（PentestGPT PTT 等）待抓原文核对后补确或更正。

## 7. 实现结果（2026-10-28，候选 A 已落地）

选定并实现**候选 A（自动注入，不靠模型主动调工具读）**，仅改角色 prompt、无新工具/接口/schema。`coordinator.md` 新增 `## 未測具體線索交接`：每次原生 `task` 分派/恢复带入未测具体线索（去敏描述、来源 ref、低成本测法），空清单明写、缺来源保留为缺口（非「无线索」），交回后依证据更新 tested/untested/refuted 并带入下次分派与 Critic 复核；`recon.md`／`domain-solver.md` 新增 `## 未測具體線索`：深挖通用枚举/档案搜索/RCE 前先低成本测未测线索，逐条回报状态且保留不确定性（tested≠refuted）；`recovery-critic.md` 增一条：对照被忽略且有来源支持的未测线索作 redirect 建议。候选 B（结构化帐本条目）/C（workspace 文件）/D（宿主派生提示）未采用——A 靠现有 task 交接即可落地。

实现由 GPT-6.1-sol（high reasoning effort，经 codex）完成、主助手复核，`tsc --noEmit`／`build`／`test:deterministic`（38 文件 555 项）全绿，已合入 main（merge `3ad11f48`，含 `862b85ee`），未 push。**行为收益（深挖前先测未测线索、不被发散淹没）仍未验证，须另行授权的真实 run（r8）认账。** 一次性 plan 已删。
