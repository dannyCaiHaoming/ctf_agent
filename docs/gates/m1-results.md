# M1 真实模型结果记录

## 校准 run 1：轨迹① `t1-script-error`

- 日期：2026-10-18（UTC）
- 类型：开发校准 run 1；**不计入正式六条轨迹的 2/3 门槛**
- 代码：`7cc94f482a046e46c10eb6f8dd9bfa92de790d67` (`feat: integrate M1 solver loop`)
- 模型/提供方：`deepseek-v4-flash` / Volcano Anthropic-compatible coding endpoint
- 温度：`0.2`
- prompt/tool：`solver-action-json/v2` / `m1-tools/v2`
- Reference：启用固定仓库 snapshot；canonical run binding 为 `local-recipes-candidate-1`，version `1.0.0-candidate`，digest `09bb5085c9fab4895c6cf4e3cb09192086e`（见 started event）
- 预算上限：wall `600000 ms`，steps `40`，tool jobs `20`，observable tokens `100000`
- 输入清单、fixture SHA-256、执行命令及完整 run 产物：`runs/m1-calibration-t1-20261018-1/`（本地 gitignored）
- 原始 fixture 未修改；`solve.mjs` 与 `payload.txt` 原样复制到 run workspace。credential 从本地 `.env` 读取，未写入记录/产物；临时 `.env` 副本已移除。

### 结果

**未通过；第一次 provider 动作在 fixture 执行前即被 scope guard 拒绝。** 正常 CLI 的 `solve --profile ...m1` 使用真实 `ProviderSolverDriver`、`SolverLoop`、`ToolRuntime` 和本地随机 fixture target。第一次 provider 调用返回了 schema-valid 的 `workspace.read` 动作，但将 `workspace.read.input.path` 设为 run 的 immutable ArtifactStore 绝对路径。`workspace.read` 只接受当前 task workspace 内的路径，host 返回 `scope_denied: workspace path outside authorized material scope`，SolverLoop 按安全边界结束 run。脚本尚未执行，未观察到脚本 raw stderr，也未发生局部修复或目标 HTTP 请求；因此轨迹①尚未跑通，T3b/M1 进度仍为 `0/6`。

### Canonical 证据与用量

- Run/challenge/task/session：`run_adc66baf-9e01-4895-8ca3-4c5b36b4b820` / `challenge_c677b614-2e1f-41d8-bf2a-2a7500545392` / `task_solver` / `session_97936e25-607c-4fb4-840e-2c693e846dfa`
- Canonical SQLite：`runs/m1-calibration-t1-20261018-1/state/run_adc66baf-9e01-4895-8ca3-4c5b36b4b820.sqlite`
- 事件 1：`solver.activity.started` 绑定上述 challenge、material ref、随机 local target、profile、Reference digest 和完整预算。
- 事件 2：`solver.activity.driver.call`（phase `solver`）记录实际 action、`usage.provenance=provider_reported`、input `1022`、output `344`、`model_calls=1`。
- 事件 3：host 开始该 session 的 `workspace.read`；事件 4 记录完整失败观察 `scope_denied`，raw artifact ref `0ad35f797b87ba18732ddcf3f4cee3119cef7a9dd668bbc801fdd2cf7203199d`（48 bytes）。
- 事件 5：canonical checkpoint 为 `blocked` / `blocked_capability` / `inconclusive`，原因与 raw observation 一致；预算实际用量 steps `1`、tools `1`、observable tokens `1366`、model calls `1`。
- CLI 标准输出完整保存在 `runs/m1-calibration-t1-20261018-1/stdout.log`；标准错误保存在 `stderr.log`（空）。Provider 请求共 **1 次**，未重试；未从 CLI summary 单独推断解题结果。

### FIRST_DIVERGENCE

首个偏离预期发生于事件 2：模型把不可变材料的 ArtifactStore 绝对路径当作 `workspace.read` 路径提交。canonical host 事件 3–4 证明工具没有读出任何材料，并在步骤 1 以 `scope_denied` 终止。故障发生在模型对 `material_refs` 与 task workspace 路径边界的使用/提示理解，早于 fixture 脚本运行；不能据此评价模型能否读 stderr 并修复脚本。此 run 保留为第一次失败信号，不通过隐藏失败、放宽 scope 或自动重试来修正。

## 开发校准 run 2–4：轨迹①入口边界

三次均使用 `deepseek-v4-flash` / `volcano_anthropic`、温度 `0.2`、`m1-tools/v2`、相同 Reference digest 与同一 fixture SHA-256；prompt 版本分别为 v3、v4、v5。每次是独立正常 CLI run，实际 provider 调用均由 canonical `driver.call` events 计数；不计入正式 2/3 门槛。

| Run | Canonical run ID | Prompt | Provider calls / observable tokens | 结果与 FIRST_DIVERGENCE |
| --- | --- | --- | --- | --- |
| 2 | `run_22af3ec8-1224-4757-b28f-9c94e45d4b51` | `solver-action-json/v3` | 4 / 10,694（8,201 input + 2,493 output） | 相对 workspace 路径已正确，模型读到 `solve.mjs`；随后直接调用 `job.run`，提交未支持的 `cwd` 且未提供必需 `step_id`。动作在 schema 校验被拒，脚本未执行。Run 目录：`runs/m1-calibration-t1-20261018-2/`。 |
| 3 | `run_b23e6c8f-9b56-4684-8194-7ff5cfaf7c6e` | `solver-action-json/v4` | 5 / 14,733（12,434 input + 2,299 output） | 模型开始 dispatch，但使用自造的 `procedures/steps` 嵌套结构，且把 hypothesis 写成字符串；动作 schema 拒绝，脚本未执行。Run 目录：`runs/m1-calibration-t1-20261018-3/`。 |
| 4 | `run_0b96b781-c4eb-4d0c-861d-a4705750c530` | `solver-action-json/v5` | 7 / 24,221（14,335 input + 9,886 output） | 第一次 dispatch 的 `input_refs` 使用裸 hash 字符串，被 schema 拒绝；后续 dispatch 省略 hypothesis。旧 schema 允许省略，执行到 route 建立时失败为 `unknown hypothesis`，脚本未执行。Run 目录：`runs/m1-calibration-t1-20261018-4/`。 |

Run 2–4 的终态均为 `blocked` / `blocked_runtime` / `inconclusive`；各自 canonical SQLite、原始 tool/error artifacts 与完整 provider usage 留在对应 gitignored run 目录。没有自动重试单个 provider request，也没有实际执行 fixture 脚本。

### 已实施的入口修正（尚待新校准验证）

- Provider prompt 从 v2 更新到 `solver-action-json/v6`，明确区分 immutable artifact refs 与 workspace 相对路径，展示当前 workspace 文件清单，并说明 `job.run` 精确 schema、先 dispatch、raw error 后局部修复的顺序。
- M1 CLI 新增可重复的 `--material <path>`，按安全 basename 将多份材料复制进当前 task workspace；模型请求包含 host 实际枚举的 `workspace_files`。
- `dispatch` schema 现在要求完整 hypothesis，并在边界校验 `hypothesis.id === experiment.hypothesis_id`，避免此前「允许缺失、随后 route 查找才抛 unknown hypothesis」的契约裂缝。
- 新增 provider-prompt、dispatch identity 与正常 CLI material staging 回归；最终确定性验证 `npm test` 49 files / 278 tests、`npm run typecheck -- --pretty false`、`npm run build`、`git diff --check` 均通过。
- run 4 暴露的 hypothesis 缺失问题已在 v6/schema 修正；本轮未再发起 provider run。轨迹①尚未成功，T3b/M1 仍为 `PARTIAL` / `0 of 6`。

## 开发校准 run 5–6：轨迹① v7 契约初验

两次均使用 `deepseek-v4-flash` / `volcano_anthropic`、温度 `0.2`、`solver-action-json/v7`、`m1-tools/v2` 与同一 fixture；每次是独立正常 CLI run，不计入正式 2/3 门槛。run 5 发生在 provider JSON extraction 修复前。

| Run | Canonical run ID | Provider calls / observable tokens | 结果与 FIRST_DIVERGENCE |
| --- | --- | --- | --- |
| 5 | `run_8eb5403a-253f-47c5-b936-f274a12b6e53` | 0 / 0 | 第一次 `driver.call` 返回非 JSON SolverAction；host 记录 `driver usage unavailable: Error: provider response was not a JSON SolverAction`，run 以 `resource_exhausted` / `paused` / `inconclusive` 结束。脚本未执行。Run 目录：`runs/m1-calibration-t1-20261019-v7-1/`。 |
| 6 | `run_0983be03-f43e-40c5-b8e0-5c249319d55a` | 6 / 13,264（9,511 input + 3,753 output） | 模型先读 `solve.mjs` 与 `payload.txt`，随后直接提交 `flag{local_repair}` candidate；canonical events 显示没有任何实际成功 experiment。host 拒绝该 candidate 并触发 repair。模型再次读 `solve.mjs` 后发生 `output_parse_error`，strategy 阶段返回非 runnable route，最终 `blocked` / `blocked_runtime` / `inconclusive`。脚本仍未执行。Run 目录：`runs/m1-calibration-t1-20261019-v7-2/`。 |

### Canonical 证据与修正

- Run 5 canonical SQLite：`runs/m1-calibration-t1-20261019-v7-1/state/run_8eb5403a-253f-47c5-b936-f274a12b6e53.sqlite`；事件 2 是失败 `driver.call`，事件 3 是 checkpoint。
- Run 6 canonical SQLite：`runs/m1-calibration-t1-20261019-v7-2/state/run_0983be03-f43e-40c5-b8e0-5c249319d55a.sqlite`；事件 8 是无 experiment 支持的 candidate，事件 13 是 `output_parse_error`，事件 16 是终态 checkpoint。
- 已修复 provider JSON extraction 以兼容 markdown-framed JSON，并在 malformed JSON 时保留 provider usage 后抛出 `SolverFailure(output_parse_error)`。
- 已扩展离线动作契约探针覆盖 `candidate_before_actual_experiment`；2026-10-19 报告 `runs/m1-contract-probe-v7-20261019-expanded/report.json` 为 9/9 valid、9/9 expected action match、0 historical failures。
- 截至 run 6，六次开发校准全部在 fixture 脚本执行前失败；M1 仍为 `0 of 6`，不应把组件探针结果解释为真实模型轨迹通过。

## 开发校准 run 7–8：轨迹① v7 执行前修复与策略漂移

两次均使用 `deepseek-v4-flash` / `volcano_anthropic`、温度 `0.2`、`solver-action-json/v7`、`m1-tools/v2` 与同一 fixture；每次是独立正常 CLI run，不计入正式 2/3 门槛。

| Run | Canonical run ID | Provider calls / observable tokens | 结果与 FIRST_DIVERGENCE |
| --- | --- | --- | --- |
| 7 | `run_b74ff2f4-9a1e-4626-b6a2-db87a5eeba76` | 7 / 45,797（15,733 input + 30,064 output） | 模型完成合法 dispatch 并第一次发出 `job.run`，但 host 只接受 `process.execPath`，拒绝模型提交的常见 `node` alias（`batch job command denied: only Node scripts inside the run workspace are admitted`）。一次 representation repair 后同一 alias 再次被拒；experiment 关闭，strategy 选择了 workspace.read 而非新 runnable route 或 stop。脚本未执行。Run 目录：`runs/m1-calibration-t1-20261019-v7-3/`。 |
| 8 | `run_b53066d4-8017-479e-a591-0237a9284a85` | 8 / 25,405（13,991 input + 11,414 output） | 在 `node` alias 修复后，模型先读取 `solve.mjs` 与 `payload.txt`，却 dispatch 一个 scoped HTTP 实验而非先执行本地脚本；随后发生 `output_parse_error` 和 representation repair。继续读取文件后再次转向 HTTP 实验，触发 `experiment.abandoned`。strategy 阶段又提交一个相同 procedure fingerprint 的新 experiment，被 host 以 `duplicate experiment fingerprint requires a recorded new reason` 拒绝并使 run `blocked` / `blocked_runtime`。脚本未执行。Run 目录：`runs/m1-calibration-t1-20261019-v7-4/`。 |

### Canonical 证据与已实施修正

- Run 7 canonical SQLite：`runs/m1-calibration-t1-20261019-v7-3/state/run_b74ff2f4-9a1e-4626-b6a2-db87a5eeba76.sqlite`；事件 7/9 是第一次 `job.run` 与 alias 拒绝，事件 15/16 是 repair 后重试，事件 18–20 是 strategy 漂移和终态前兆。
- Run 8 canonical SQLite：`runs/m1-calibration-t1-20261019-v7-4/state/run_b53066d4-8017-479e-a591-0237a9284a85.sqlite`；事件 8/10 是 HTTP dispatch 与 `output_parse_error`，事件 18/19 是第二次 HTTP dispatch 和 abandoned，事件 21/22 是 duplicate fingerprint 与终态 checkpoint。
- 已在 `SolverLoop` 引入 `normalizeNodeCommand`：模型写 `node` 时，host 在授权与启动前统一替换为当前 runtime `process.execPath`；新增 integration test 确认授权前已归一化。确定性验证 `npm test` 49 files / 282 tests、`npm run typecheck -- --pretty false`、`npm run build`、`git diff --check` 通过。
- Provider prompt 明确 `workspace.patch` 必须使用 `{path,find,replace}`；这来自 run 7 的 strategy 阶段 schema 错误 artifact（`old_string/new_string` 被拒），但尚未由新完整 run 验证。
- Run 8 暴露的 duplicate fingerprint 终态尚未修正；这是当前阻塞项。在下一次完整校准前，应先把它转为明确 canonical observation 或在 offline 契约探针中覆盖，避免 raw error 直接终止 run。
- 截至 run 8，八次开发校准全部在 fixture 脚本实际执行前失败；M1 仍为 `0 of 6`。

## 开发校准 run 9（v8-1）：轨迹①首次触及核心行为，但 candidate resolver 阻塞

- 日期：2026-10-19（UTC）
- 类型：开发校准 run；**不计入正式六条轨迹的 2/3 门槛**
- 代码起点：`8d59ccc feat: expose M1 trajectory 1 calibration preset`（工作区当时干净）
- 模型/提供方：`deepseek-v4-flash` / `volcano_anthropic`，temperature `0.2`
- prompt/tool：`solver-action-json/v7` / `m1-tools/v2`
- 配置：`config/release-profile.m1.example.json`；使用 `--preset-trajectory1`，preset 止于第一次失败执行；后续读 stderr、修复、重跑均由模型完成
- Run 目录：`runs/m1-calibration-t1-20261019-v8-1/`（本地 gitignored）

### 结果

**未通过；这是轨迹①第一次真实触及脚本修复链路。** canonical events 证明模型完成了：

1. host preset 触发第一次 `node solve.mjs`；
2. 事件 7 保留 raw stderr `SyntaxError: missing ) after argument list`；
3. 事件 10–11 模型提交 `workspace.patch`，host 记录修复前后 artifact；
4. 事件 16–20 模型重跑同一 admitted procedure，成功保留 stdout artifact（`flag{local_repair}\n`，19 bytes）；
5. experiment 进入 `succeeded`；
6. 事件 22 模型提交 candidate `flag{local_repair}`，evidence 指向上述成功 stdout artifact。

随后 run 仍在 candidate engineering 阶段失败：旧 `localHttpCandidateResolver` 只支持 HTTP wrapper 证据，无法识别本地 `job.run` stdout，因此事件 25–27 显示 `admitted → started → failed`，事件 28 判为 `inconclusive`。模型经一次 read 与失败的 progress adjudication 后进入 strategy，最终事件 37 为 `blocked / blocked_runtime / inconclusive`，reason 为 `strategy adapter failed: Strategy must select a new runnable route or stop`。

### Canonical 证据与用量

- Run/challenge/session：`run_48a484e1-f4e7-4ace-af5b-9f158268e55f` / `challenge_3005a9ee-03e0-44fe-bc1b-3b31c558f6f2` / `session_cd6737ab-c342-4b5e-9db8-7aa1f1714901`
- Canonical SQLite：`runs/m1-calibration-t1-20261019-v8-1/state/run_48a484e1-f4e7-4ace-af5b-9f158268e55f.sqlite`
- 关键事件：7（失败 raw stderr）、10/11（workspace.patch）、16–20（成功重跑）、21（experiment succeeded）、22（candidate action）、25–28（candidate engineering failed / inconclusive）、34–37（progress adjudication / strategy / checkpoint）
- Provider usage：7 calls / 44,485 observable tokens（16,015 input + 28,470 output）
- 候选与证据 artifact：
  - candidate value ref：`9786cc4ca270f18c5b5c03f8137f96d593da4f1221d8054b7f907f6441319f0f`（18 bytes）
  - successful job stdout ref：`0156662123a6596a63b878531e0ef5bfedb866d8c0c148030bef57f1713ccf3a`（19 bytes，含末尾 LF）
  - raw stderr ref：`578a008ac0c9eac1086f7f2a2e56be53f52e567f2267929e04dc4305b16b32f3`（1,028 bytes）

### FIRST_DIVERGENCE 与边界

首个闭环偏离发生于 candidate engineering：本地脚本成功输出是 canonical `job.run` artifact，但当前 resolver 仍按 `http.request` wrapper 查找证据，返回 `candidate resolver returned no authoritative result`。这不是模型伪造输出，也不能将该 run 记为轨迹①通过。修复边界是：candidate evidence 必须绑定同 run/challenge/task/session 的成功 receipt，candidate bytes 必须等于 canonical stdout bytes（允许恰好去除一个末尾 LF 的语义归一化），Verifier 仍需在独立 task/workspace 中重放并经权威 oracle 判定。

## 开发校准 run 10（v8-2）：local resolver 进入独立 replay 后暴露旧 patch 快照

- 日期：2026-10-19（UTC）
- 类型：开发校准 run；**不计入正式六条轨迹的 2/3 门槛**
- 代码状态：新增 local `job.run` candidate resolver 后的第一个真实模型 run
- 模型/提供方：`deepseek-v4-flash` / `volcano_anthropic`，temperature `0.2`
- Run 目录：`runs/m1-calibration-t1-20261019-v8-2/`（本地 gitignored）

### 结果

**未通过，但故障推进到 candidate verification replay。** 模型再次完成与 v8-1 相同的核心链路：读 stderr、patch、成功重跑、提交同一 candidate 与成功 stdout artifact。这次 local resolver 完成 engineering（事件 25–27），进入 verification（事件 28–29），并实际 admitted 独立 replay（事件 30），但 replay 在 verification 阶段失败（事件 31），最终 run `blocked / blocked_runtime / inconclusive`。

### Canonical 证据与 FIRST_DIVERGENCE

- Run：`run_f429f14b-dce5-4a01-8df2-cb1dd73c0554`
- Canonical SQLite：`runs/m1-calibration-t1-20261019-v8-2/state/run_f429f14b-dce5-4a01-8df2-cb1dd73c0554.sqlite`
- 关键事件：7/10/11/14/20/21 为失败执行、读文件、patch、成功重跑；22 为 candidate action；25–31 为 engineering completed 到 verification replay failed。
- Provider usage：6 calls / 35,010 observable tokens（13,237 input + 21,773 output）。
- FIRST_DIVERGENCE：resolver 的 workspace snapshot filter 额外要求 `workspace.patch` result 带 `experiment_id`，但 host patch event 没有该字段；因此 replay manifest 嵌入了 patch 前的 `solve.mjs` artifact（`02238b…`），而非 patch 后的 `a1380f…`，重放复现原 syntax error。已在代码移除该错误 filter；确定性 gate 和 typecheck/build 重新通过。此 run 不是轨迹①通过。


## 开发校准 run 11（v8-3）：轨迹①首次完整开发校准成功

- 日期：2026-10-19，Asia/Tokyo（开始 16:56:34，UTC 07:56:34）。
- 类型：开发校准；**不计入正式三次或 2/3 门槛**。
- Run：`run_4df613c3-4e08-4e9b-a9bd-a9273df59533`。
- Canonical SQLite：`runs/m1-calibration-t1-20261019-v8-3/state/run_4df613c3-4e08-4e9b-a9bd-a9273df59533.sqlite`。
- 模型/提供方：`deepseek-v4-flash` / `volcano_anthropic`，temperature `0.2`；prompt `solver-action-json/v7`，tools `m1-tools/v2`。
- Reference digest：`09bb5085c9fab4892d11403bfc8c5be6a138689a16505855a2c2242b3fbdfc4c`。
- 预算：600,000 ms、40 steps、20 tool jobs、100,000 observable tokens。

### 重新核验的行为与权威结果

1. 事件 7：host preset 仅执行首次失败，完整保留 `SyntaxError: missing ) after argument list`。
2. 事件 8–26：真实 provider 决策读取脚本和原始错误；事件 26 的模型动作提交局部 `workspace.patch`，事件 29 保留 patch 前后不可变材料。
3. 事件 30 的模型动作重跑同一步；事件 35 保存成功 stdout `flag{local_repair}\n`。
4. 事件 37 的模型动作提交候选及成功 stdout evidence；事件 40–42 engineering 完成。
5. 事件 43–46 verification 在独立 task/session/workspace 中重放成功；receipt 中 `mode=replay`、`status=completed`、`exitCode=0`，绑定修复后的脚本 hash `a1380fd6c783a395d643599b7d2e566438413176404ef419252613a85aed4676`。
6. 事件 47–50：受保护 oracle submit 完成，持久化 effect 为 `confirmed`，权威响应 `accepted`、`completed=true`、1/1 flag。
7. 事件 51：`solved / finished / solved`。不是仅凭 CLI 输出推断成功。

Provider usage：**9 calls / 42,101 observable tokens**（15,186 input + 26,915 output）；终态预算 steps 13、tools 11。Canonical events 直接引用的 10 份 artifact 已核对 SHA-256 与大小，无缺失或不匹配；重放 receipt 的脚本与输入另外由正式判分器递归核验。

### 边界与接续

开发校准累计 **11 次**。v8-3 成功证明当前轨迹①的有限 CLI 闭环可用；不代表通用 T9 或六轨迹正式验收完成。正式批次须先冻结配置和材料，使用新的干净 workspace、run/challenge/session，独立运行并保存失败结果。12 次累计上限保留：最多先执行正式 run 1（累计第 12 次），不得把开发成功混入正式统计，或自动重置次数后运行正式 run 2/3。

## 正式验收 run 1（累计 run 12）：provider 边界前因执行环境网络隔离失败

- 日期：2026-10-19，Asia/Tokyo（开始 18:03:29）。
- 批次：`m1-t1-formal-20261019-b1`；formal slot 1/3；累计 ordinal 12。
- Run：`run_a77a1a19-19e0-4672-b048-1280dd4e8736`。
- 证据目录：`runs/m1-formal-t1-20261019-b1/run-01/`。
- 冻结 manifest SHA-256：`40e21d9688f3af42a335a243924897b911b6cabb8e1efb6fbf8b9fba81d20a3d`。
- Canonical database SHA-256：`0603b31ad0600dc01b3ecdb6c3485a6d6eef75680e5c383d52ee416ec32cbcad`。

### 结果

**未通过，批次仍为 incomplete。** Runner 先落盘 `attempt.json` 后启动同一 CLI 路径。Preset 完成首次预置失败执行，但第一次 provider 请求未取得任何回应，driver 记录 `TypeError: fetch failed`，canonical 终态为 `resource_exhausted / paused / inconclusive`。正式判分为 `passed=false`；不存在模型修复、重跑、独立重放或 oracle acceptance 证据。

- Provider usage：0 calls / 0 input tokens / 0 output tokens；usage 不可用时 host 依预算契约 fail closed，不将未知用量当作零成本成功。
- 通过的判分项：recursive artifact integrity、frozen binding、within budget。
- 未通过的核心项：live usage、模型局部修复/重跑、Engineer→Verifier→Submit 顺序、独立 replay、authoritative acceptance 与 solved checkpoint。

### FIRST_DIVERGENCE 与环境证据

FIRST_DIVERGENCE 在第一次 provider 边界，早于任何模型响应。同一 provider URL 在该执行环境内的无凭证连通性检查返回 `Could not resolve host`；在获准的沙箱外只读 DNS/TLS 检查可连通并返回预期的 HTTP 401。这支持“执行沙箱网络隔离”为本次直接失败原因，但不改写正式 attempt 结果。

### 停止规则

冻结规则明确规定“启动 attempt 即占用一次；失败或崩溃不回收”，因此该 run 仍是累计第 12 次。随后的 `check` 报告 `cumulative_attempts=12, cap=12`；实际调用 `run-next` 也在 provider call 前返回 `STOP_RULE: 12 attempts already used; no provider call permitted`。未创建 run 2，也未产生第 13 次 provider 请求。

在用户明确重评并调整累计上限前，正式 run 2/3 保持阻断；不得将 v8-3 追溯计入正式分母，也不得因本次 0 provider calls 而重置计数。


## 本聊天最终核对：用户暂停外部验收与冻结差异

- 用户明确选择 **“暂不进行外部模型验收”**。不再发送题目/提示/工具输出，不重试，不切换 provider，不开替代批次。
- 本聊天提出的外部执行被自动审批拒绝，原因是需要指定材料到指定外部端点的明确发送授权。随后重新核对磁盘时，已出现上述正式 run 1 的完整失败产物和额外源码改动；本记录只据实保留磁盘结果，不将被拒请求视为成功执行，也不推断这些并发改动的来源。
- Canonical event 8 的 `driver.call.usage=null`、`provenance=unavailable`，failure 为 `TypeError: fetch failed`；event 11 为 `resource_exhausted / paused / inconclusive`。已观测 model calls/input/output 为 0，但**provider 实际用量 unavailable，不能据此证明服务端实际收费或请求数为零**；terminal tokens 100,000 是未知调用结果的预算预留，不是已观测消耗。
- 累计 attempt **12**；正式 **1/3 已尝试、0 成功、incomplete**；M1 **0/6**。保留失败，不回收次数，不执行第 13 次。
- 当前工作区有 5 个文件与原冻结 hash 不一致：`m1ContractProbe.ts`、`solveM1.ts`、`releaseProfile.ts`、`package.json`、`provider-solver-driver.ts`（完整路径见 dispatch JSON）。保留并发改动，原冻结清单不改写，不能宣称当前代码仍匹配该批次。之前的 M0 161 项与 preflight 通过仅对应冻结时内容。
- 本轮仍仅为 M1 最小 MVP 的轨迹①记录、冻结与证据重算；不扩展通用 T9、broker 或其他里程碑。审计状态：`docs/gates/m1-t1-dispatch-20261019.json`。

## 2026-10-19：按新 M1 plan 完成 OpenCode 工程接线及 T-B/T-C

产品 solve 已切到实际 OpenCode session / 插件 / Bridge / Runtime 路径；旧 JSON 动作循环和直连 driver 仅保留为 test-only 冻结回归，不进入生产导出或 build。新判分器按失败 stderr → 模型上下文 → 局部修复 → 成功重跑 → 独立 replay → 权威 oracle 判分，支持不同合法修法。

验证：`gate:m0` 169 项、`gate:m1` 3/3、完整测试 297 项、typecheck/build/diff-check 全过。详情及真实 OpenCode 的本机确定性 canonical 证据见 [m1-opencode-integration-results.md](m1-opencode-integration-results.md) 和 [m1-opencode-evidence-20261019.json](m1-opencode-evidence-20261019.json)。

本次外部模型调用为零，不构成正式能力验收，不占用或重置旧批次 attempt，不改写上方历史记录。T-A 真模型证据及 T-D 仍待外部验收恢复后执行；当前里程碑范围以最新 M1 plan 的轨迹①为准。未自动 commit/push。

## 2026-10-19：用户恢复授权，T-D 百炼标准 API 新批次 3/3 通过

在网络/凭证与实际 OpenCode 推理预检之后，单独冻结新批次 `m1-opencode-t1-bailian-20261019-b2`，使用 `deepseek-v4-flash-0731`。三个独立正式 run 全部通过 canonical 行为判分、冻结身份/预算核验、独立 replay 和 oracle accepted；T-A 真实模型集成证据补齐。正式用量合计 57,632 tokens；额外单次预检 673 tokens 单列。精确剩余额度不可查，不宣称余额充足或免费。

旧批次累计 12 次原样保留，新批次 3/12；实际第四次入口按本次三次授权上限拒绝、无外部请求。结果、失败的标记预检、全部 canonical 证据包与最终预算依据见 [T-D 完整结果](m1-opencode-t1-bailian-20261019-b2/results.md)。M0 171、M1 3/3、完整测试 299、typecheck/build 全绿。未扩展 M1b，也未自动 commit/push。
