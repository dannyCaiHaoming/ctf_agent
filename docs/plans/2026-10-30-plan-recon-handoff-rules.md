# Recon 交回判断：四种原因落入角色与方法（一次性计划）

依据：[Recon 重设计 §11](../superpowers/specs/2026-10-29-design-v1-recon-redesign.md)，红线见同文 §5、§10.1。只有本计划引用设计。人类已批准实施本步。

## §0 当前一步：把四种交回原因与三条落地原则写进现有角色和方法

**卡点**：Recon 的停止判断靠“高／低价值”，没有参照物；Coordinator 派单只写“本轮问题”，没有写成要消除的具体不确定性。本步只改 prompt 资产，让判断有参照、派单有焦点、交付以下游可开工为准。

### 修改范围

| 文件 | 本步作用 |
| --- | --- |
| `product/opencode/agents/recon.md` | 用 §11.2 四种交回原因（依据＋交回什么）取代“高价值才继续／低价值即停止”那句；加入继续判准（下一次实验的不同结果会改变什么决定）与交付标准（§11.3 第 3 点四项）；第四种对应 host closure 拒绝消息，收束时不宣称基线完成。删去过时的“不新增時間／步數限制”。保留现有职责边界、主本、去敏与发布规则。保持精简，不把方法全文搬回角色。 |
| `product/skills/recon-investigation/SKILL.md` | “Ask one distinguishing question”补上“会改变什么决定”的判准与 §11.3 的正反例（同 URL 前提改变可复验；只换呈现方式不足以继续）；交回段改为四种原因与下游可开工标准，附“可能是某种编码”与可执行交付的对比。保留现有反证范围、主本、发布与 unknown 规则；版本号加一。 |
| `product/opencode/agents/coordinator.md` | 有界回合分派改为“本轮要消除的不确定性”，附 §11.3 第 1 点的 Web 与坐标／图像两例，并写明精确转写不是 Recon 交回前提；加入按需再调查规则：Solver 发现前提缺口时可在原授权与剩余预算内派一次明确调查，须带新证据或具体缺口，不写“继续找”，换会话不重置额度。保持与现有未测线索、停滞与交接规则一致。 |
| `product/opencode/agents/domain-solver.md` | 一句：接收 Recon 交付中“尚未证明的部分”作为待验证前提；发现前提缺口时经 Coordinator 请求一次明确调查，而非自行重做 Recon 全部工作。 |

不改 host、插件、配置、schema 或测试逻辑。

### 行为判据

1. 四个文件互相一致：同样的四种原因、同样的继续判准、同样的交付标准与再调查规则；不出现相互矛盾的旧句（尤其“高／低价值”与“不新增時間／步數限制”）。
2. 文字只给判断参照，不新增必填字段、模板、schema 或要求每次工具调用写说明；主本仍只在实验或路线变化时更新。
3. 不写题目专属解法、答案、坐标或固定路线；两类派单例子是通用题型说明。
4. 现有约束不被削弱：职责边界（精确转写与深解归 Solver）、主本单一维护、tested≠refuted、发布与 unknown 规则、去敏清单、Coordinator 的未测线索与停滞规则。
5. 静态检查与真实行为分开陈述：无模型检查只证明文字一致、资产可发布；Recon／Coordinator 是否按此行事须后续授权 run 验收（§11.5）。

### 验证

运行 `npx tsc --noEmit`、`npm run build`、`npm run test:deterministic`（角色与 skill 资产有发布／配置契约测试，须保持全绿）。若某契约测试断言了被改写的旧文字，说明原因再最小调整该断言，不削弱其约束。

### 禁做

- 不改 host／control-service、plugin、launcher、opencode.json、schema、预算或 cap 相关文件（cap 由另一分支处理）。
- 不新增 schema、字段校验、模板强制、语义判卷、调度、续跑或唤醒机制；不让 Recon 成为 planner；不给 Recon task 委派权。
- 不写题目专属解法或答案；不放入凭据、oracle 私有答案、flag、cookie、完整 prompt、chain-of-thought 或 job argv。
- 不删除既有工作，不改其他角色或父 design；不联网、不跑挑战或真实模型；不 commit／push。

### 授权与执行模型

人类已批准本步：仅限上表四个 prompt 资产及必要的最小测试断言调整，加上述无模型验证。真实 run 未授权。

**执行模型：gpt-6.1-sol（high）。** 理由：需在四个文件间保持一致并保留大量既有约束，属局部判断，不是机械替换。

### 结果记录（2026-10-30）

- 已按 §0 修改四个 prompt 资产：Recon 用四种有依据的交回原因替换旧高／低价值判断，删除“不新增時間／步數限制”，加入继续判准与四项下游交付标准；recon-investigation 升至 Version 2，加入同 URL 前提变化可复验、仅换呈现不足以继续的对照与可执行交付示例；Coordinator 按具体不确定性派单并加入两类例子及按需再调查规则；Domain Solver 增加一句接收待验证前提、经 Coordinator 请求明确调查的约定。
- 测试断言未修改：未发现既有契约测试断言被替换的旧措辞；未增加测试逻辑。作者已按行为判据自查文字一致性，职责、单一主本、反证范围、去敏、发布与 unknown 规则保留。
- `npx tsc --noEmit`：通过（exit 0）；`npm run build`：通过（exit 0）；`git diff --check`：通过。
- `npm run test:deterministic`：失败（exit 1），40 个测试文件中 28 通过／12 失败；636 项中 532 通过／86 失败／18 跳过，另报 10 个未处理错误及末尾缓存写入错误。输出包含 `listen EPERM: operation not permitted 127.0.0.1`、超时、`lease expired`，以及符号链接 `node_modules` 内临时文件和 `.vite/vitest/results.json` 写入 `EPERM`；未扩大权限、重试或修改相关代码，不能宣称全绿。
- 失败文件：`tests/bootstrap/test-harness.test.ts`；`tests/contract/` 下的 `control-service.test.ts`、`launch-evidence.test.ts`、`workspace-view.test.ts`、`http-lifecycle.test.ts`、`d-h7-rpc-stop.test.ts`、`http-tools.test.ts`、`g-coordinator-stop.test.ts`、`run-prep.test.ts`、`d-artifact-handoff.test.ts`、`runtime-interactive-sessions.test.ts`、`slow-tools.test.ts`。
- 除四个资产及本记录外未修改受管文件，保留原有 `node_modules` 链接；未联网、未跑挑战／真实模型、未 commit／push。静态文字复核与编译通过不证明模型遵循或实际交付可用，真实行为仍待后续授权 run 验收。
