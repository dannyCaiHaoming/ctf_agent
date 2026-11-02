# MVP R4：Recon 后续请求完整消费历史 plan

类型：实现与必要修复
依据：[Recon 详细 design](../specs/2026-10-29-design-v1-recon-redesign.md) §4；核心 design v1 的 host／模型职责及可信状态边界。
依据版本：`a97251a6`；当前 `main` 上已有未提交 Recon 统一修复及接口探针，必须原样保留。
执行者／工作区：主会话，`/Users/caihaoming/Documents/pentest-agent`。
状态：执行中

## 0. 当前交接
- 当前 MVP 核心目标：每次 Recon 请求都能机械导航完整调查历史；历史只追加不改写；最近工具调用与结果完整配对；当前状态可信可见；projection 失败时不出站。
- 本 plan 只完成：design §4 的上下文投影、append-only 投递、compaction 恢复、同版去重、session 隔离和投递审计。
- 这项工作为何直接影响当前目标：若历史仍被删除、重写或被 18KB／最近 N 条截断，Recon 无法判断哪些线索已查过，也无法据此选择下一步。
- 当前已完成到哪里、下一步是什么：append-only 放置接口已由 13 项脚本探针确认可做；该探针使用产品固定的 OpenCode runtime `1.19.3`、plugin／SDK `1.19.0` 组合，`1.19.0` 公开类型已包含 `session.compacted`。当前产品代码仍会改写 synthetic context，投影仍是最近 N 条和 18KB 摘要。接口探针未验证产品接线；现已进入 RED 契约测试，先建立完整索引、消息不改写、追加去重、session 隔离、compaction 恢复、tool pair、fail-closed 与投递审计反例，旧实现应失败。
- 必要的已有未提交依赖：现有 Recon 存储、hook、episode／experience 改造位于当前工作树，不在 HEAD `a97251a6`。
- 必须保留的接口／验收：事实主本仍是 `recon_turns`、完整结果和 artifacts；原生 OpenCode 循环及 compaction 不变；工具调用和结果不拆对；decision 可选；失败不静默降级。
- 本次不做：§5 budget handoff、§6 fixed snapshot 正文消费、§7 episode 内容忠实性；真实模型、commit、push。
- 授权范围、环境、实际成本边界和暂停点：允许产品集成与无模型验证；禁止真实模型调用；不 commit、不 push。
- 必读输入及交付位置：design §4、`apps/opencode-plugin/src/index.ts`、`apps/launcher/src/investigation-context.ts`、`apps/launcher/src/control-service.ts`、`tests/contract/`、placement gate；结果暂存 plan §3，收口后回写 design §4／§8、handoff 和既有 gate。
- 项目指令与 Skill 入口：仓库 `AGENTS.md`；`/Users/caihaoming/.codex/skills/fucxxx-codex-spec/SKILL.md`、`fucxxx-codex-spec-plan/SKILL.md` 及主包 `references/execution.md`、`closeout.md`、`design-and-plan.md`。

## 1. 工作安排
| 必要步骤 | 为什么需要／前置依赖 | 预计涉及位置 | 行为判据 |
| --- | --- | --- | --- |
| 核对公开接口版本组合 | 产品 runtime 与 plugin／SDK 版本不同；无模型 gate 必须证明实际组合可用，失败时报告接口缺口而非回退改写 | `packages/opencode-bridge/src/server.ts`、`package.json`、placement gate | 固定组合为 runtime `1.19.3`、plugin／SDK `1.19.0`；`chat.message`、`tool.execute.after`、`experimental.session.compacting`、`session.compacted`、`experimental.chat.messages.transform` 均可由公开接口消费 |
| 建立 §4 契约测试 | 先让原缺口可重复失败，防止只测装配 | `tests/contract/investigation-context.test.ts`、`tests/contract/opencode.test.ts` | 覆盖不改写消息、只追加、去重、session 隔离、compaction／cancel 恢复、tool pair、fail-closed、完整索引分页、当前状态和投递审计；旧实现上预期 RED |
| 实现机械导航视图 | 所有步骤必须可达，不能由 host 语义筛选 | `apps/launcher/src/investigation-context.ts` | 稳定排序；索引分页／cursor／fingerprint／result ref／completeness；最近完整 tool／result；当前问题、jobs、publications、budget、closure、gaps、handoff、少量经验入口可见 |
| 接入 append-only combo | 删除 synthetic context 会破坏历史与缓存公共前缀 | `apps/opencode-plugin/src/index.ts`、`control-service.ts` | `messages.transform` 不增删改消息；`chat.message`／`tool.execute.after` 追加；`sessionID + version` 去重；cancel／compaction 后重新追加；A/B session 隔离 |
| 完善 projection 与投递审计 | 仅有文本不足，host 必须能重建实际给模型的内容 | `apps/launcher/src/control-service.ts` | projection 失败阻止 `chat.params`；`context.presented` 绑定 session、message、challenge、version、record IDs、coverage、正文 hash、UTF-8 bytes 和实际投递范围 |
| 完成定向和集成验证 | 证明接线覆盖原始失败契约 | 测试、manual probe／replay | 定向测试先绿；typecheck、build、全量 test、deterministic 和两个 manual 脚本通过 |
| 独立复核与收口 | 检查遗漏并形成长期依据 | design §4／§8、handoff、`docs/gates/recon-context-interface-20261031/` | 无历史改写、tool pair 完整、无 A/B 串线、projection fail-closed、审计可重建；回写后删除本 plan |

## 2. 验证方式
- 使用什么入口、输入或原始失败：append-only placement 的 13 项反例，以及 r16 A 长轨迹无法机械导航、B 固定快照仍需后续消费的上游事实。
- 可以用替身的边界及不能由此证明的能力：脚本化 OpenCode hook 可证明消息放置、去重、配对和 fail-closed；不能证明真实模型理解、prefix-cache 命中或 token 收益。
- 定向回归与最终集成验收：新增/扩展 contract tests 后运行 `npm test`；产品原生 manual probe 验证首轮、工具续接、cancel、compaction 和 session 隔离。
- 验证命令／操作及可观察的预期结果：`npm run typecheck`、`npm run build`、`npm test`、`npm run test:deterministic`、`npx tsx tests/manual/recon-context-interface.ts`、`npx tsx tests/manual/recon-original-replay.ts` 均通过；不在这些流程调用 provider。
- 需特别复核的风险或尚未覆盖的失败条件：自动 overflow compaction 和真实 provider cache 仍属真实行为 unknown。
- 判定与去向：通过则 §4 契约可进入长期 design 并继续 §5；部分通过保留 plan 和未完成项；失败保留原始命令输出并修复。
- 结束条件：§4 所有离线可验证契约通过，或到达明确的公开接口缺口。

## 3. 临时执行结果
- 实际修改和产物：已核对产品固定 OpenCode runtime `1.19.3` + plugin／SDK `1.19.0`；placement gate 与该组合一致，SDK `1.19.0` 类型含 `session.compacted` 事件；R4 契约测试已开始扩展。
- 按任务对应的实际验证、结果和证据链接：placement gate 见 `docs/gates/recon-context-interface-20261031/placement-validation.json`；当前只证明公开接口放置，不证明产品接线。
- 已完成任务、当前停点及下一步：公开接口版本组合已核对，当前停点是编写并观察 RED 契约测试，下一步按失败证据修改 investigation view、plugin 与 control service。
- 会影响后续任务的计划纠错或实现决定、理由与影响：待记录。
- 未运行、失败与限制：真实模型未运行；commit/push 未授权。
- 是否发现必须由主会话决定的变化：待执行。
- 对子 design 和总 design 的回写建议：待执行。

## 4. 主会话复核与收口
- 差异、目标和证据是否一致：待复核。
- 必要复跑及主区整合验收结果：待复核。
- 结论与未完成事项已转入何处：待收口。
- 文档入口受影响条目是否随 design 同步：待收口。
- 活动链接、会话和工作区如何收口：完成后删除本 plan并更新 handoff。
