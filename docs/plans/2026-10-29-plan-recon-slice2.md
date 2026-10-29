# Recon slice 2：首个可实施切片（评审草案）

日期：2026-10-29。依据：[Recon 重设计 §10](../superpowers/specs/2026-10-29-design-v1-recon-redesign.md#10-slice-2宿主约束可消费交接与预算可见性评审草案)，尤其 §10.4；架构边界依该设计引用的 V1／AGENTS。一次性交接物，只有本 plan 引用 design。**本次仅写草案，不执行以下工作。**

## 0. 当前唯一一步：让 Recon 的固定材料经 Coordinator 被 Solver 实际读到

**要回答的卡点**：保持原生同步 task 和私有 work 隔离，Recon 是否能发布必要材料，Coordinator 是否转交实际 ref，Solver 是否读到原 bytes，而不是遭 `denied: workspace path` 后重做？直接对照 r12 seq 816–819／publications=0，证据见设计 §10.1、§10.4。当前 Coordinator 文件并没有“不发布”的原句，错误发生在模型实际生成的分派中；不能做一个搜索替换就声称修复行为。

**为什么先做这一步**：限时之前先确认收束的交付出口。只加 cap 而无 ref 会更早空手终止；artifact.publish/read、同步 Execution 和跨角色读取已经存在（`apps/launcher/src/control-service.ts:550–563,770–792,825`；`apps/launcher/src/artifact-tools.ts:57–85`），可独立验证，不依赖未批准的 cap 数值。此步不是重新选择 convention-only 总方案：宿主 bound、maxToolJobs 接线与预算可见性仍是设计 §10 的已选范围，但**不塞入本次 §0**，也不因本步通过就宣布 slice 2 完成。不预排后续 roadmap。

### 修改范围（未来获得实施授权后）

| 文件 | 本步作用 |
| --- | --- |
| `product/opencode/agents/coordinator.md` | 对齐 `:19–31,40–43` 的分派和发布约定：Recon→Solver 与送 Engineer 一样传工具真实 ref；不让“不提交／不打包”扩张为“不发布”；缺 ref 明确未交付，不拿 work 路径当共享源。 |
| `product/opencode/agents/recon.md` | 对齐 `:10–14,20–24`：有可用基线即固定下一角色需要的材料，交回真实 ref／缺口；不等待完整深解才发布。保留主本单维护者、可选方法与精确转写边界。此步不修改为“host cap 已实现”。 |
| `product/opencode/agents/domain-solver.md` | 对齐 `:20–23,30–34`：消费上游 artifact.read 的真实 ref／分页，图像按真实发布 path 查看；来源不可得保留缺口，不默认重新解包／重跑作为交接成功。 |
| `tests/contract/d-artifact-handoff.test.ts` | 在已有控制层集成测试内补同步 recon→solver 的非秘密材料读写／发布／实际读取对照；不新建 fixture 目录、gate 或独立测试框架。复用真实 ControlService/ArtifactPublisher，仅 SDK 身份与消息作最小替身。 |

只读核对 `apps/launcher/src/control-service.ts`、`artifact-tools.ts`、`workspace-tools.ts`、`apps/opencode-plugin/src/index.ts` 的既有边界；**本步不预授权修改 host/runtime**。若这条既有同步链实际失败，保留原始失败及最小定位，交回修订设计／§0，不扩大成调度或预算修复。设计与本 plan 只在已有位置记录结果，不增加报告体系。

### 行为判据

1. 同一 run/challenge 内，从 Coordinator 的原生同步 task 准入和可信子绑定建立 Recon Execution；不直接注入 bindings、伪造 ref 或预填 publications。Recon 在自己的 work 写入非秘密基线／记录并调用 artifact.publish，取得 host 真实返回 ref；同步来源关联成立。参照 `control-service.ts:438–479,519–563,773–779`。
2. Coordinator 原样传 ref 至同题 Solver 的任务输入。Solver 的 work 起初为空；读取 Recon 私有路径的负例仍拒绝，随后通过 artifact.read 实际读到相同 bytes。需要多页的材料按 cursor 到 done；不要把“工具存在／ref 看起来正确／prompt 出现 publish”当成消费成功。不得为测试绕开原始失败路径。
3. 发布后再改 Recon 私有原文件，Solver 读到的已固定 ref 仍对应原 bytes；异题／伪造／损坏 ref 继续拒绝。复用既有反例，不重复扩张测试矩阵；保持 snapshotFixed、rangeComplete、originalComplete 区别及未知 producer，不为方便测试自填 hash／execution。
4. 没有确认发布回执时交接仍未确认，不虚构 ref，不把未知当失败后盲重发；无材料时保留缺口。私有 work 不变共享目录，不复制整个目录；Solver 不为取得已发布材料而重新执行 Recon 的解包／渲染 job。
5. 角色约定的静态一致性与无模型控制链通过分别报告。真实 Coordinator 不再生成“不发布”约束、真实 Recon 发布且 Solver 消费，要由后续明确授权批次验证；本步无模型通过只能标 **接线可用、真实行为未验证**。不要声称时间分配、精确转写、verified 或 solved 已改善。

判据只依行为与已配置边界，不固定 cap 数字、材料文件名／数量或分钟数。r11/r12 的 3–5 分钟估计不获此 plan 批准。

### 执行与验证方式

未来执行者先核对自己的工作区及已有改动，读取上述文件和现有测试，复现“私有路径拒绝但真实 ref 可消费”的最小链，再修订三份角色约定及必要的既有测试。局部验证命令取仓库现有 Vitest 入口：`npm test -- tests/contract/d-artifact-handoff.test.ts`；此命令是拟执行，当前未运行。集成交付按 `AGENTS.md:37–44` 完成适用的 `npm run typecheck`、`npm run build`、`npm test`。不安装依赖、不启动真实服务或 provider；本地确定性测试不使用 challenge 数据／答案。

**执行模型：Sonnet 5.5 或更高。** 本步虽涉及角色文字，却需判断同步 Execution、来源绑定、隔离拒绝和真实 bytes 消费，属于 `CLAUDE.md:37–43` 的运行时局部判断，不能交 Haiku 作机械改文案。cap 数值／严格墙钟与同步恢复等架构取舍留给 Opus 5.5 或同等设计能力审核，不由实现者擅定。按 `CLAUDE.md:45–52`，未来实施在独立 session／隔离 worktree 中进行；**当前 NO git 授权下不创建 worktree、不启动实施 session**。本段描述以后执行方式，不解除本次限制。

### 禁做

- 不实现 Recon cap、maxToolJobs 或预算快照；不改 launcher、control-service、plugin、JobManager、artifact transport 或全局预算默认值；发现依赖缺陷如实交回。
- 不新增 scheduler、monitor、watchdog、wakeup、framework、DAG、planner、共享可写 work、整目录自动复制、host 自动解题／恢复循环；不切 async，不修改 Verifier 模式。
- 不新增 fixture／gate／轨迹／里程碑，不恢复 M0–M6／M1B，不接 TSecBench，不 fork OpenCode、不直连 provider。
- 不做 recon-as-planner、自动演化／memory／RAG、OCR／视觉转写能力改造；不注入题解、候选、flag 或 oracle 答案。
- 不用 prompt 命中、mock 成功或人工预置 publication 宣称真实协作通过；不降低原隔离／来源／分页完整性要求。
- 不删除已有工作、不重置／stash、不安装、不联网、不做 challenge run，不 commit／push，不创建第三份文档。

### 授权范围与停止点

**当前授权仅为两份文档草案**：编辑既有 design、新建本 plan；以上产品修改、测试命令、worktree 和执行模型均尚未执行。未来需要明确实施授权后，才执行此 §0 的文件修改及无模型验证；没有真实模型调用授权，也没有 token 预算、目标/provider／批次范围，禁止自行 run 或重试。实施完成后在 §0 后记录结果、失败和未验证项并停止，不自动接下一片。结论归入既有 design 后才按后续明确授权处理一次性 plan；本次不删除它。

## 1. 当前交接记录

2026-10-29：完成草案与代码证据自检；无实现、无测试执行、无独立评审、无 Git／联网／挑战运行。整体 slice-2 的 cap、累计 jobs 和预算可见性仅为设计，未进入此 §0 实施范围。数值与严格墙钟接口问题见 design §10.7；不阻塞先审阅本步交接修复草案。
