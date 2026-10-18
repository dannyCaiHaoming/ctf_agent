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
