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
