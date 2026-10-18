# M1 真实模型结果记录

## 校准 run 1：轨迹① `t1-script-error`

- 日期：2026-10-18（UTC）
- 类型：单次开发校准；**不计入正式六条轨迹的 2/3 门槛**
- 代码：`7cc94f482a046e46c10eb6f8dd9bfa92de790d67` (`feat: integrate M1 solver loop`)
- 模型/提供方：`deepseek-v4-flash` / Volcano Anthropic-compatible coding endpoint
- 温度：`0.2`
- prompt/tool：`solver-action-json/v2` / `m1-tools/v2`
- Reference：启用固定仓库 snapshot；canonical run binding 为 `local-recipes-candidate-1`，version `1.0.0-candidate`，digest `09bb5085c9fab4895c6cf4e3cb09192086e`（见 started event）
- 预算上限：wall `600000 ms`，steps `40`，tool jobs `20`，observable tokens `100000`
- 输入清单、fixture SHA-256、执行命令及完整 run 产物：`runs/m1-calibration-t1-20261018-1/`（本地 gitignored）
- 原始 fixture 未修改；`solve.mjs` 与 `payload.txt` 原样复制到 run workspace。credential 从本地 `.env` 读取，未写入记录/产物；临时 `.env` 副本已移除。

### 结果

**未通过；第一次 provider 动作在 fixture 执行前即被 scope guard 拒绝。** 正常 CLI 的 `solve --profile ...m1` 使用真实 `ProviderSolverDriver`、`SolverLoop`、`ToolRuntime` 和本地随机 fixture target。唯一一次 provider 调用返回了 schema-valid 的 `workspace.read` 动作，但将 `workspace.read.input.path` 设为 run 的 immutable ArtifactStore 绝对路径。`workspace.read` 只接受当前 task workspace 内的路径，host 返回 `scope_denied: workspace path outside authorized material scope`，SolverLoop 按安全边界结束 run。脚本尚未执行，未观察到脚本 raw stderr，也未发生局部修复或目标 HTTP 请求；因此轨迹①尚未跑通，T3b/M1 进度仍为 `0/6`。

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
