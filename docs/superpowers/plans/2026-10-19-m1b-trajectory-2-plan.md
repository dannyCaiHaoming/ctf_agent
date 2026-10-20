# M1b 最小实施计划：先做轨迹②

> 状态：**轨迹② T2-A / T2-B 确定性集成完成；T2-C 于 2026-10-20 完成百炼 DeepSeek v4 Flash 正式验收 3/3。轨迹②已完成；M1b 的③–⑥尚未启动。** T2-C 验收时未 commit、未 push；后续交付授权见第 7 节。
> 核查基线：`main@7687a2b9c4bd401e50c38de6a4dfdbc04fe1c6bb`，2026-10-19。
> 依据：[权威 spec §12.2](../specs/2026-10-14-general-ctf-agent-system-design.md)、[roadmap](2026-10-16-ctf-agent-mvp-roadmap.md)、[已完成 M1 plan](2026-10-18-m1-solver-loop-plan.md)。
> 本轮证据：[T2-A/B 验证记录](../../gates/m1b-t2-deterministic-20261019.md)，两项复核问题已修复；M0 163/163、M1 3/3、全量 269/269、typecheck/build 全过；②累计新增 33 项测试，仅用固定本地 provider。

## 1. 下一步与边界

是，M0/M1 之后应进入 **M1b**。M1 已完成的是 OpenCode 轨迹①，正式批次 3/3；不重开 M0/M1，也不把旧六轨迹组件测试当作 M1b 验收。

本切片只推进 **轨迹②：机制前提被有效反证 → 保存反证 → 换路线，不原样重试**。②验收并复核后才规划③的实施细节；③–⑥现在仅登记资产与缺口，不并行建设。

roadmap 总表的“其余五条、每条 3 次、18 次”存在算术口径残留：②–⑥对应 **15 次新增正式结果**；加上①已有的 3 次，六条共 18 次。历史批次仍各自保留，不混并成绩，也不因此重跑①。本计划不是对 15 次运行的授权。

## 2. 可复用资产与真实缺口

| 资产 / 轨迹 | 当前可复用内容 | 尚缺什么 / 本轮处置 |
| --- | --- | --- |
| OpenCode 底座 | `apps/cli/src/commands/solveM1.ts`、`openCodeTask.ts`、`apps/opencode-plugin/src/index.ts`：真实 session、受管工具、权限/预算、canonical events | 已补②的入口、工具与受信任 oracle 选择；确定性接线通过，真实模型待 T2-C |
| ② 假设与实验 | `packages/supervisor/src/hypotheses.ts`：生命周期、反证引用、真实 receipt 绑定、fingerprint；现有 lifecycle/routes/progress 测试 | 已复用并接通机制预测/结论、真实 stdout 送达、canonical snapshot 与否定 fingerprint；成功执行和机制成立分开记录 |
| ② 本地题材 | `fixtures/trajectories/t2-falsified/`：literal parser、独立 decode 路线与 payload | 原材料未改；已增加隔离任务说明与行为判分正反测试，README 不进入模型输入 |
| 候选与独立验证 | `localJobCandidateResolver.ts`、`candidate-verification.ts`、LocalFlagOracle：成功 stdout 绑定、独立 task/session replay、权威提交 | resolver 未改，②确定性接口测试已走独立 replay/accepted；oracle 按受信任的 t1/t2 选择，模型无配置权限 |
| ③ 长作业 | Runtime job/PTY/TCP、`long-job-watch.ts`、State outbox、幂等 claim；独立验证已使用 watch | 尚需真实 OpenCode Worker 释放后接回 completion 并继续；当前受管 solver 只暴露同步有界 `job.run`。后移，②不补长作业工具面 |
| ④ compaction / 新 session | hypothesis snapshot、原始 artifact、`compaction.ts`、本地恢复测试 | `LocalCompactionAdapter` 是 host 恢复封装，不证明真实 OpenCode 新 session；当前 compaction 禁用。②已写入否定 fingerprint，但真实新 session 回取与不重做仍未接线验收。后移，不预建恢复框架 |
| ⑤ 验证后 rejected | 独立验证三模式、stale/generation 检查、oracle rejected 返回 | 缺模型收到 rejected 后诊断并继续的真实轨迹；保留现有组件与负向测试，②只用 replay，不补其余模式集成 |
| ⑥ partial / 多 slot | `multiflag.ts`、LocalFlagOracle、verified candidate resolver、续跑组件测试 | 缺 OpenCode 获取权威 partial/已接受 slot 后继续剩余 slot 的端到端证据。后移 |
| 冻结资产 | Reference snapshot/检索、领域解析库与 skills、通用验证框架、度量扩展 | 原样保留；不是②准入前置，不扩充 |
| 退役框架与历史 | `archive/pre-opencode-20261019/`、冻结配置、全部 `docs/gates/` 历史记录 | 仅历史参考；不重新导入生产、不恢复 ProviderSolverDriver/SolverLoop/JSON action 协议或旧 agent 自动加载 |

②行已按本轮实现与测试更新；③–⑥为资产检查结论，未新增集成验收。清理基线的确定性验证见 [清理记录](../../gates/m1-path-retirement-20261019.md)；①真实验收见 [b2 results](../../gates/m1-opencode-t1-bailian-20261019-b2/results.md)。

## 3. 轨迹②的最小闭环

模型提出可证伪前提 → 执行区分性 probe → 完整 raw 输出实际进入模型输入 → 模型说明反证并登记 → host 保存原始证据与否定状态 → 模型选择不同机制的下一步 → 实际执行新路线。

用现有本地题材收尾时，继续复用“成功输出 → 候选绑定 → 独立 replay → oracle accepted”。这是本切片的端到端收尾要求，**不能用 accepted 代替前面的反证/换路证据**，也不把它扩张成所有机制反证的通用定义。

### 本轮已补齐的三个接线缺口

1. **语义记录**：通过 `hypothesis.propose/conclude` 登记前提/可证伪条件、结论与换路理由，复用 HypothesisManager。`prediction` 是模型选择的可校验语义谓词（当前 fixture 为 `expression_evaluates`，其他路线为 `other`）；ID、receipt、ref、fingerprint、步骤和预算由 host 绑定，结论直接关联当前已声明实验，无需模型拼接 receipt。不增加角色编排或每轮统一 JSON 动作。
2. **反证送达**：②的 `model.input` 已核对成功 probe 完整 stdout 的真实 tool part、session 和原始字段，并绑定同 run/task/session 的真实 receipt。`exit 0` 是执行成功，仍可得到 `rejected` 机制结论；工具故障不能冒充反证。
3. **题目入口**：新增 `--trajectory t2` 及相应本地题目描述/oracle，保留①默认路径；未增加通用 challenge 插件系统。②已有 decode 路线不需要 patch，①“读到 stderr 才修复”的规则保留。

语义校验复用 HypothesisManager 的 `validateProgress` 接口：本地 fixture 可核对 literal observation 是否确实否定被测的求值前提，但 host 不能替模型生成假设、宣布换路或选择 decode。只凭命令名、退出码、出现另一个 fingerprint 或最终 flag 不得判通过。

fixture 的源码/说明可能提前揭示机制，因此正式判分必须看到“提出前提 → 实际 probe → 读取结果 → 解释反证”的顺序。模型直接读源码后走 decode 可以解出题，但**没有轨迹②证据，不算②通过**。不将 README、预期答案或换路攻略放入 prompt；不强制探测参数必须是 `2+2`，也不强制某个修补/脚本名。

## 4. 三步实施清单

### T2-A：先固定判据，写失败测试

- [x] 为现有② fixture 定义隔离材料、题目说明与 host-only oracle；冻结判分所需事件顺序。
- [x] 正向：命令成功但前提被反证，模型证据送达、反证入库、不同路线执行；最终候选独立 replay/accepted（固定本地 provider 的确定性证据）。
- [x] 负向：工具故障冒充机制反证、缺 raw 送达、跨 run/challenge/task/session 或伪造 receipt、先换路后补结论、仅换 ID/重复原实验、直接给答案，均不能冒充②成功；无真实成功输出的候选继续被拒绝。
- [x] 保留①既有正反判据，不删除断言、不降低覆盖；新测试先失败。

### T2-B：只补薄控制层接线，使确定性测试变绿

- [x] 接通上述语义登记、成功输出送达与题目选择；使用现有 HypothesisManager/state/artifact，不复制生命周期实现。
- [x] 将反证引用及否定 fingerprint 写入 canonical state/checkpoint；未实现新 session 恢复。
- [x] 既有 fingerprint 只承担规范化实验去重，不能证明语义不同；增加前提/换路理由与实际行为判据。重复调用被 host 拦下时，②判分仍失败；模型自然语言理由的真实语义审查留在 T2-C。
- [x] 运行 M0/M1 gate、完整测试、typecheck、build，并用无外部模型的 OpenCode 接口 fixture 验证②接线。仅标“确定性集成完成”，不标轨迹完成。结果见页首记录。

预期改动面限于 `solveM1.ts`、`openCodeTask.ts`、plugin 工具定义、必要的本地题目配置/②测试及验收文件；现有 supervisor 组件优先原样复用。公共 plugin/SDK/server 接口若无法提供必要证据或 hook，报告设计 blocker；不维护 fork、不绕过 OpenCode。

### T2-A/B 复核修复（2026-10-19，仅轨迹②）

- [x] 补齐“反证送达后、结论登记前重试”的失败回归；将判分检查起点改为反证送达，原参数、括号形式与换算术参数的重试均不能借延后登记结论而通过。
- [x] 补齐外层/嵌套括号的控制层与 OpenCode 完整链回归；采用 Node 仅语法检查支持合法算术表达式，保留非法/非算术输入拒绝、原始反证和真实 receipt 约束。新增 11 项先出现 8 个预期失败，再全部转绿；当前② 33/33，M0/M1 gate 和全量检查通过，失败与新文件 hash 记入验证记录。

### T2-C：冻结并真实验收（2026-10-20 完成）

- [x] 用户授权后核查网络/模型可用性；预检使用独立的一次 550-token 有界推理，未包含题目材料，不计作 solver attempt。认证 models HTTP 200、目标模型列出且 OpenCode 推理成功；精确余额/剩余额度及金额费用不可查询，记录为 `unavailable`。
- [x] 冻结 source/config/material/grader hashes、模型与 OpenCode 版本、prompt/tool manifest、preset/介入政策、逐 run 预算、批次授权次数及 attempt 台账，见 [正式结果](../../gates/m1b-opencode-t2-bailian-20261020-b1/results.md) 与 [manifest](../../gates/m1b-opencode-t2-bailian-20261020-b1/manifest.json)。
- [x] 冻结后做 **3 次独立正式 run，3/3 通过**；三份 run/challenge/session 独立，全部 canonical/raw/provider usage 和证据包留存，无自动重试。
- [x] 完成语义复核：三个 run 均实际提出并测试可证伪前提，读取 probe 原始输出，正确登记反证并选择/执行不同机制路线；候选来自新路线输出并经独立 replay 与权威 oracle 接受。题材源码在探测前已可读，结果记录保留此限制，未将其夸大为无材料提示的盲测。

冻结预算沿用①已验证上限：每 run 600 秒、`maxSteps=40`、`maxToolJobs=20`、100,000 observable tokens；本批三次实测分别为 27/23/35 steps、6/4/4 jobs、50,292/47,369/78,112 observable tokens。`maxSteps` 不是纯模型调用次数。usage 记录在每份结果中；账户剩余额度及金额费用为 `unavailable`，token 数不是精确费用保证。

停止规则：本批授权 3 次，三次正式 run 已全部占用；累计轨迹②为 **3/12**，本批后续 run 被三次授权上限拒绝。12 是绝对停止上限，不是调用授权；本轮没有消耗校准 attempt。M1 旧 b1/b2 台账保持不变；换模型/配置须保留批次关联与②累计次数，不得靠换批静默绕过停止规则。达到 12 次必须停止并请用户重评。

## 5. 明确不做

不实现③–⑥、不增加领域技能/Reference/通用指标平台、不恢复自建循环，不接 TSecBench/VPN/Docker/多题调度，不改历史验收结果。T2-C 已按用户授权完成；本轮不 commit、不 push，保留既有无关工作区改动。

## 6. 交付复核与后续顺序（2026-10-20）

- [x] 两处修复及全部 33 项②回归再复核通过；结论登记前重试不能漏判，合法括号仍须满足原始反证、receipt 和独立验证约束。既有①断言、冻结组件与历史验收文件未修改，未新增自建模型循环。
- [x] 提交前重新运行 M0 163/163、M1 3/3、全量 269/269、typecheck/build/diff 检查，结果与 9 个受检文件 hash 匹配；记录见验证文档末节。

T2-A/B 复核时的本地交付范围曾为轨迹②代码、测试、计划、索引与验证记录共 11 个路径；既有 M0 plan 改动、未跟踪的 AGENTS.md 和根目录 replay 暂存保持原样。本文后续追加的 T2-C gate 结果是独立验收证据。本轮不 commit、不 push。

②正式验收结果与语义复核见 [T2-C 结果记录](../../gates/m1b-opencode-t2-bailian-20261020-b1/results.md)。下一步应在单独启动③时再制定其最小实施计划；④–⑥随各自启动再展开，本次未新增其详细计划或实现。

## 7. 验收证据交付（2026-10-20）

用户追加明确授权：优先提交并 push 轨迹②，提交 `AGENTS.md`，并将 `.m1-verification-replay/` 加入 `.gitignore`。上文及正式结果中的“不 commit、不 push”保留为 T2-C 执行当时的范围记录，本次交付按此追加授权执行，成功状态以 Git 提交及远端分支核对结果为准。

- 交付包含已提交的 T2-A/B 实作，以及本次 T2-C 原始证据包、冻结 manifest、三次 attempt/result、预检、语义复核、停止记录、配置、runner、停止规则测试、计划及索引更新。
- 三份证据包 SHA-256 与各自结果记录逐份一致，全部 canonical 检查及冻结绑定记录通过；不重新运行真实模型，不改写冻结 manifest 或历史结果。
- 154 个冻结文件中，`solveM1.ts` 的工作区版本有一行未验收变更；本次保留该变更、不暂存，提交中的版本与冻结 hash 一致。既有 M0 plan 修改也保留在提交之外。
- `.m1-verification-replay/` 仅为本地重放暂存，加入忽略规则；正式证据仍完整保存在 `docs/gates/m1b-opencode-t2-bailian-20261020-b1/` 并纳入交付。
- 本次提交前检查：全量 271/271、M0 165/165、M1 3/3、typecheck、build 通过；原始三个 run 重新判分均通过且数据库 hash 匹配。首次受限环境全量检查为 237 通过/34 失败，原因为 localhost 监听被拒绝及其后续超时；受控放行本机端口后全量通过，未修改实现。新增两项停止规则测试使全量/M0 分别较前次增加 2 项。
