# Recon cap trigger：高上限兜底的一次性实施计划草稿

**依据**：[Recon redesign §10.3b](../superpowers/specs/2026-10-29-design-v1-recon-redesign.md)，保留 §10.3 的 closure／局部停止边界；本计划只从该设计生成。状态：**待人类评审，尚未授权实施**。当前只允许写这份计划及上述 design，禁止产品代码、git、网络、挑战运行。

## §0 当前唯一一步：用现有 B/R 配置落实“自然交回＋高异常上限”，验证机械边界

**要回答的一个卡点**：同一套已有准入／closure 机制，能否在显式宽松配置下容纳 142 次自然 Recon 调用，同时在显式紧配置或高上限最终耗尽时保留局部收束／停止，而不加入 host 语义判断？本步不验证解题能力，不预排后续步骤。

**推荐方案**：采用 design §10.3b 的 (c)＋(a)：自然交回为主，负责人事前通过 release profile 选择 B/R；未配置仍 unavailable。沿用 `n>=B-R` closure、`n>=B` exhausted 的机械公式；**本方案是预算使用政策与量级修正，不是新自适应算法**。当前实现已经参数化，若边界符合判据就保留谓词，不为“重设计”制造功能性改动。首切可交付为配置语义澄清＋高／低／OFF 行为回归；不擅自给现有生产配置启用 cap。

### 文件范围与当前证据

以下是未来实施允许触及的最小范围，**本次均不修改**。源码行号按草稿形成时版本定位，实施前须重新核对。

| 文件 | 本步职责／改动边界 |
| --- | --- |
| `apps/launcher/src/control-service.ts:47–49,498–564` | 核对 closure trigger、reconQuota、checkReconExhausted、checkReconTool；澄清 B 为显式异常兜底、R 在 B 内，以及计数边界注释。只在本步测试发现违反下列机械判据时作必要关联修复；现有公式正确则不改算法。不新增统计状态、timer、mode 或抽象。 |
| `apps/cli/src/composition/releaseProfile.ts:11–13,53–58` | 澄清字段语义与配置责任；保持现有缺省和成对安全整数校验，不自动注入默认 B/R。**配置形状不变，无新 loader 分支。** |
| `config/release-profile.schema.json:23–35` | 更新 description，说明 explicit pathological ceiling、reserve、缺省 OFF；字段名／类型／dependentRequired 不变，无 schema 形状迁移。若执行者认为需要新字段，应回到设计评审，不自行增加。 |
| `tests/contract/slow-tools.test.ts:51–217` | 在既有测试设施内增加宽松配置／自然结束／无发布长调用的机械回归；复用已有小预算 closure、硬停、跨 session、异步重查与配置测试。测试中的 B/R 是输入，不是产品默认。 |
| `tests/contract/launch-evidence.test.ts:88–94,118` | 复用既有 cap 接线测试；仅在前项暴露相关接线缺口时补充同一行为断言，不新增挑战 fixture 或 gate。 |

配置示例仅在 design 与测试输入表达：宽松候选 `reconMaxModelCalls=512, reconClosureReserve=10`；历史紧配置 `35/10`；第三种两字段都省略。数值依据与非最优／非授权性质见 design §10.3b。不修改实际 run-data、历史 profile、通用示例配置或预算快照；未来运行负责人若选高 cap，需在其获授权的 run profile 中显式填写，未配置者继续 OFF。

### 行为判据（全部机械，可独立验收）

1. **OFF 与输入检查**：两字段缺省时，`reconQuota` 不产生局部限制；142 次或更多准入不会因 Recon cap 被拒，既有全局限额仍生效。只填一个、非安全整数、R≤0、R≥B 均由现有 profile 校验拒绝。不得填隐式 35 或 512（RP:53–58；Schema:23–35；CS:525–530）。
2. **宽松预算不截断历史长度**：在全局预算充足的无模型测试中显式传 B=512/R=10；第 14、25、35、142 次准入后都仍 exploration，探索 tool.before 不得因 Recon cap 拒绝；142 次后走已有同步结束入口，父任务可继续，不需要先花完额度。该序列不提供语义内容、无需发布 artifact；**无发布、重复指纹、长分析本身均不能触发 closure**。这是边界回归，不是复现 r15 solve（审计 r14 A seq 46–180、r15 A seq 45–1135；CS:509–558）。
3. **高上限仍有效**：同一显式配置下 n=501 仍 exploration，n=502 切 closure；探索在 tool.before 与 tool.execute 都拒绝，不能新增资源／spawn；workspace.list/read/write、job.read/cancel、artifact.publish/read 保留到硬边界之前。测试用通用 `B-R` 表达边界，并至少另用一组不同的合法 B/R 证明 runtime 未写死数值（CS:513–558；既有测试 `slow-tools.test.ts:51–91`）。
4. **紧配置仍可选**：B=35/R=10 时 n=24 exploration、25 closure；允许在 28 次后沿正常任务结果路径交回。不要把这组历史配置认定为通用默认，或要求每次 Recon 必须走到 25 才交回（r13 A seq 248,255,297,300）。
5. **B 边界与 never stopAll**：第 B 次准入标 exhausted，可完成该次文本；下一次受检查的 model.call／工具入口拒绝并只停止本 Recon，不能准入 B+1。保留已发布 refs、局部原因、abort 未确认时的 unknown；Coordinator／其他角色在全局预算充足时仍可继续。局部 closure／耗尽绝不调用 stopAll。不得把 B 次文本完成解释成保证 B 次内仍可发工具／发布（CS:540–550；既有测试 `slow-tools.test.ts:94–144`）。
6. **计数归属与竞态不退化**：按 service/run＋challenge 累计，换 Recon session、同题续接或再次派单不重置；不同题独立计数。准入串行和异步准备后的重查保持，不能在等待期间跨入 closure 后启动新探索。**per-session concurrency 与 maxToolJobs 的计数／限制完全不变**（CS:509–537；`slow-tools.test.ts:147–185,220` 起的既有回归）。
7. **全局优先且不冒充完成**：局部窗口不能扩展全局 token/step/deadline；全局预算耗尽仍可按原逻辑 stopAll。自然交回、受限收束、局部停止、unknown、solved 分别报告，不因 cap 命中生成 completed/solved。此步不增加局部墙钟保证（CS:359–366,498–506,540–550；design §10.3 与 §10.3b）。

### 实施与验证方式（未来授权后，一步完成即停）

- 先核对指定文件与既有测试；把上述高阈值和自然结束断言加入现有测试文件，使用真实 ControlService 入口、模拟 SDK，不访问挑战、不调用模型。若新增测试先通过，说明原参数化实现已支持它，**不强求造一个失败再改产品逻辑**；据此只澄清配置／注释。
- 定向运行仓库已安装的 `./node_modules/.bin/vitest run tests/contract/slow-tools.test.ts tests/contract/launch-evidence.test.ts`。覆盖高／紧／OFF、B−R 与 B 边界、同步自然交回和局部停止；保留既有异步竞态与并发断言。不下载依赖；若依赖缺失或本地回环权限不足，记录阻塞，不联网安装或宣称通过。
- 相关源码／测试变化后运行 `npm run typecheck`、`npm run build`、`npm test`，记录退出码及失败；修复范围限本步关联缺口，不削弱已有测试（命令定义见 `package.json:9–14`，仓库验证要求见 `AGENTS.md`「验证与结果」）。这些是未来执行命令，本次不运行。
- 完成后在 §0 之后记录实际文件、版本、配置、检查结果／失败及证明边界；影响设计的结论回写 design。只称机械策略／接线验证，不称真实硬停或真实解题验证。没有新 run，r13/r14/r15 只是历史计数依据；不拼接三次轨迹当一次新验收。

### 禁做清单

- 禁止 host 判断“覆盖足够”“调查有价值”“已无新知识”，禁止读任务正文／响应／artifact 正文进行收益评分；不分析漏洞或利用方式。
- 禁止 scheduler、framework、monitor、watchdog、wakeup、DAG、新 planner、自建 provider loop、OpenCode fork；不把同步 dispatch 改成 background。
- 禁止加入指纹／发布停滞触发器、自动按挑战类型分类、运行中自动扩额、退款、重置或新配置 map；不将数值硬编码到 runtime。
- 禁止因为局部 closure／耗尽调用 stopAll；不删除合法的全局 stopAll，不隐藏 abort unknown、不伪造交回／完成。
- 禁止修改 per-session concurrency、maxToolJobs、角色权限或无关发布／求解流程；不新增 fixture、gate、轨迹或长期 roadmap。
- 禁止修改／删除历史审计和 run-data、恢复冻结任务、触碰其他会话工作、commit/push；不运行真实模型、不运行挑战、不联网安装或查询。

### 授权范围与执行模型

**当前授权仅为两文件设计草稿**。本 §0 是待批准的实施范围描述，不产生实施、git、模型调用或预算授权；本次不执行上述任何产品修改／测试。未来若批准本步，建议范围限表列文件的必要修改和无模型验证，不允许清理删除或真实调用。挑战 run／provider 调用预算为**未授权**，候选 B=512 不是 token 预算；真实运行仍须另有目标、provider／模型、批次和 token 上限授权（`CLAUDE.md:31,58–64`）。

**执行模型：Sonnet 5.5 或更强，亦可用用户指定的 gpt-6.1-sol。** 理由：涉及真实 host 准入、closure 状态和局部停止，需要运行时局部判断，属于 `CLAUDE.md:37–43` 表的 Sonnet 5.5 档，不适合按清单修改的 Haiku 档。该表本身没有 gpt-6.1-sol 名称，后者来自本次用户要求，不冒称为表内型号。

未来实施遵守 `CLAUDE.md:47–52` 的独立 session／独立 worktree 约定；**当前禁止 git，不创建 worktree**。未来执行前必须具备相应授权并核对未提交工作；本草稿不覆盖当前禁令。一步结束即停，返回人类评审，不自动启动下一 run 或扩大设计。

### §0 实施结果（2026-10-30，Asia/Tokyo）

本次依人类明确批准执行上述一步，原文的“待批准／未来授权”是草稿时状态；不含真实 run 授权。工作区 `/Users/caihaoming/Documents/pa-wt-cap`，分支 `codex/recon-cap-trigger`，基线 `de5639fec0d35e3c057566afef5347ec56554725`，Node `v26.3.0`、本地 Vitest `2.1.9`。初始仅有未跟踪的 `node_modules` 软链接，保留原状。

- 实际修改：`apps/launcher/src/control-service.ts`、`apps/cli/src/composition/releaseProfile.ts` 的语义／计数注释，`config/release-profile.schema.json` 的 description，`tests/contract/slow-tools.test.ts` 的回归，以及本记录。`launch-evidence.test.ts` 无接线缺口证据，未修改。没有修改实际 profile、历史资料或 design 决策。
- **运行逻辑未变**：现有参数化谓词满足离线判据；两个 TS 文件移除注释后的编译 JS 与基线相同，schema 除 description 外结构相同。缺省仍 OFF，无隐式 B/R。最终 ControlService SHA-256：`e0ab1f90456047d1889ae17d145b0eae4e4fbe74ded469d48cf8aeca1f770bb0`。
- 新增 4 项参数化行为用例：512/10 在 14、25、35、142 次保持 exploration、重复相同 workspace.list 且无发布后自然同步交回；35/10 在 24 exploration、25 closure、28 次自然交回；512/10 与另一组 73/6 在 B−R−1／B−R／B 精确切换，两工具入口拒绝探索且无新资源／spawn，收束出口保留，B+1 不准入、只局部停止并保留 refs／unknown，父任务可继续，不产生 solved。补 3 项非法输入（负 R、非安全整数 B/R）拒绝；加强 OFF 至 143 次仍可探索、全局第 145 次被拒及两字段均无默认。所有 B/R 仅为测试输入，既有设施仅增加可选全局准入额度参数。

| 检查 | 退出码／结果 |
| --- | --- |
| `./node_modules/.bin/vitest run tests/contract/slow-tools.test.ts tests/contract/launch-evidence.test.ts` | 1；40 passed、48 failed（88）；含下述已修正的 2 项新断言，其余为回环 EPERM／相关超时；另有缓存写入 EPERM。日志 `/tmp/pa-cap-targeted.log`。 |
| `npm run typecheck` | 0；最终版本通过，日志 `/tmp/pa-cap-typecheck-final.log`。 |
| `npm run build` | 0；最终版本通过，日志 `/tmp/pa-cap-build-final.log`。 |
| `npm test` | 1；38 文件通过、13 文件失败；577 passed、90 failed、18 skipped（685），12 unhandled errors；含同 2 项新断言，以及回环 EPERM、目录写入 EPERM、超时和后续 lease expired。完整日志 `/tmp/pa-cap-test.log`，失败名称索引 `/tmp/pa-cap-failure-index.log`。 |
| 修正后补充离线回归 | 0；32 passed、22 未选中；命令见下，日志 `/tmp/pa-cap-offline-regression.log`。 |
| 静态差异复核 | `git diff --check` 通过；无独立 reviewer，已自复核文件范围、运行逻辑与 schema 形状。 |

补充命令：`./node_modules/.bin/vitest run tests/contract/slow-tools.test.ts -t 'explicit recon|recon cap closes|recon closure preserves|recon exhaustion at either|background recon|global model cap|recon continuation|recon rechecks|unconfigured recon cap|release profile|maxToolJobs' --cache=false`。它保留并验证已有局部停止、跨 session／题目、异步重查、并发与 maxToolJobs 断言；未选中的回环测试不计通过。

首轮两项新用例误把 workspace.list 的已 settled 资源记录断言为空；核对真实记录后修正为数量等于调用数、全为已 settled 的 workspace.list 且无 job，修正后通过。完整命令统计保留首轮原始结果，未将补充结果拼接为全套通过。沙箱禁止 `127.0.0.1` 监听；既有 `node_modules` 指向主仓库，其 `.vite/vitest/results.json` 及既有 bootstrap 测试 `.tmp-secret-profile.json` 写入被拒。未提权、改软链接或越界修复；补充命令只禁用测试缓存。**实施已落地，完整集成验收仍受阻**。仅证明无模型机械边界，不证明真实模型 B 硬停或解题能力；没有网络查询、模型／挑战 run、commit／push，一步结束即停。

## 草稿核对记录

本次仅静态阅读现有源码／测试和三个 audit 的机械字段、计数、时间及终态；没有执行测试、模型或挑战。真实 B 硬停仍未验证：r13 只到 28<35，r14/r15 cap OFF。既有测试描述见 `tests/contract/slow-tools.test.ts:94–144`，不能把“存在测试”写成“本次测试通过”。完整计数、seq 锚点及结果限制记录于 design §10.3b。
