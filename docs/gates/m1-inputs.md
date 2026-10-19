# M1 轨迹①正式验收输入与预算 — 2026-10-19

## 新批次：OpenCode + 百炼标准 API（2026-10-19 用户恢复授权）

本节为当前 **T-D 新批次 `m1-opencode-t1-bailian-20261019-b2`**。下方原批次内容是历史冻结记录，不覆盖、不混并。恢复依据：用户明确要求先查网络/额度、冻结新批次，再运行 3 次正式验收并遵守 12 次停止规则。底座由旧 direct-provider 改为 OpenCode，provider 改为百炼标准按量 API；不是火山或百炼 Coding Plan。

| 项目 | 冻结值 |
| --- | --- |
| 发布配置 / 模型配置 | `config/release-profile.m1-td-bailian-20261019.json` / `config/opencode.m1-td-bailian-20261019.json` |
| engine / SDK | 实际 `opencode serve` 1.19.3 / `@opencode-ai/sdk` 1.19.0；依赖以 lockfile hash 为准 |
| 模型 / endpoint | `bailian/deepseek-v4-flash-0731` / `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 参数 | temperature 0.2；单轮 host 输出上限 4,000 tokens；不设置 seed/top_p/thinking，provider 默认思考保留；配置 context 128,000/output 8,000 是客户端保守配置，不是测得的模型规格 |
| prompt / tools | `opencode-t1/v1` / `ctf-managed-t1/v1`；仅 workspace.list/read/search/patch、job.run、candidate.register；全部实现文件 hash 冻结 |
| Reference | disabled / snapshot null；轨迹①不用 Reference |
| 材料 | 仅原始 `fixtures/trajectories/t1-script-error/solve.mjs` 与 `payload.txt`；SHA-256 见新 manifest，不摄取 README 或旧修复文件 |
| 预置 | 三次均 `--preset-trajectory1`；host 仅执行一次原始脚本至失败并把完整 stderr 回灌；不提示修法；后续定位、局部 patch、重跑、候选由模型经 OpenCode 完成 |
| 凭证 | 优先 `DASHSCOPE_API_KEY`；否则只在内存读取既有 OpenCode auth 的 `aliyun-bailian` 并注入环境；不复制密钥到仓库、命令、模型或 artifact |

每次预算冻结为 **600,000ms / 40 steps / 20 tool jobs（含 replay）/ 100,000 observable input+output tokens**；三次名义总额 30 分钟 / 120 steps / 60 jobs / 300,000 observable tokens。用量在 OpenCode 完成响应时观测，不能保证 provider 的精确扣费或未报告项；没有货币成本上限承诺，缺失记 `unavailable`，不以 engine cost=0 充当免费。最终预算只依据本批实际数据另行定稿，不倒改本批 manifest。

预检证据在 `docs/gates/m1-opencode-t1-bailian-20261019-b2/preflight.json`：TLS 可达，带认证 models HTTP 200 且列出指定 ID；一次真实 OpenCode 小额请求实际返回 417 输入 / 256 思考 tokens，无 API 错误。256-token 上限耗在思考，标记未返回，原失败探针记录保留；另存 assessment 区分「模型请求可用」和「标记未通过」，不再重复付费探针。**精确剩余额度 unavailable**，不宣称余额足够。预检不含题目、工具或解题，不计正式轨迹 attempt，但其用量单独留存。

新批冻结 manifest 在上述目录 `manifest.json`：覆盖全部生产源、fixture、配置、测试、判分器、runner、依赖与 Node/OpenCode 可执行文件 hash；每次运行前逐项核验，变化即停止。当前 main 为 dirty worktree，以实际文件身份为准，不伪称干净提交。启动前独占保留 `attempt-NN.json`；失败/崩溃照计数、不回收。每次使用新 CLI 进程、workspace、run/challenge/session/lease，既有输出目录禁止复用。原批次累计 12 次不变；新批次独立计数，**绝对上限 12；本次实际授权仅 3 次，第三次后即停，不自动跑到 12**。没有 harness 自动重试；OpenCode 自身的 provider 重试由其引擎管理，仍在同一 attempt 的 wall clock 内，不冒充新独立 run。

执行入口：`node --import tsx docs/gates/m1-td-runner.ts freeze|check|run-next`。只读行为判分器仍为 `m1-t1-acceptance.py grade`；正式 runner 另核对 canonical start 的配置 hash、预算、fixture、Reference、preset、engine 及 checkpoint 预算。保留每次 stdout/stderr、SQLite、递归 artifacts、启动命令和独立结果；三次全部跑完才按 ≥2/3 判定。旧 `check/run-next` 入口继续拒绝旧批次第 13 次。

**执行后定稿：b2 已完成 3/3，正式累计观测 57,632 tokens。** release profile 保持上表已验收预算不变；单次实测最大 21 steps / 4 jobs / 21,227 tokens。完整结果、用量边界及 canonical 证据包见 [T-D results](m1-opencode-t1-bailian-20261019-b2/results.md)。本次三次授权已耗尽，实际第四次入口已拒绝，不再执行外部调用。

---

## 以下为旧批次冻结记录（保留原文）

## 冻结范围与批次

批次 `m1-t1-formal-20261019-b1`；仅轨迹①，本文件不表示六轨迹统一配置已冻结。开发校准 11 次单独保留，v8-3 不计正式分母。正式判定要求 **3 次独立 run，至少 2 次成功**；少于 3 次时标记 incomplete，不能按“当前成功率”宣布通过。

- Profile：`config/release-profile.m1-t1-formal-20261019.json`。
- 可机读冻结清单及全部执行文件 SHA-256：`docs/gates/m1-t1-formal-20261019.json`；包括当前未提交的 resolver、CLI、provider prompt/动作物化、Runtime、Reference、oracle、判分器及依赖清单。基线 HEAD `8d59ccc`；实际执行身份以文件 hash 为准，不伪称干净提交。
- 每次启动前校验冻结文件和 Node runtime；任何变化都停止，不能在同一批次混入修复后的代码或配置。
- 产物：`runs/m1-formal-t1-20261019-b1/run-01` 等，启动前独占创建目录并持久化 attempt；每个进程生成新的 run/challenge/session/lease 与独立 workspace。已有目录不复用。

## 固定模型、工具、Reference 与材料

| 项 | 冻结值 |
| --- | --- |
| 模型 / provider | `deepseek-v4-flash` / `volcano_anthropic` |
| endpoint | `https://ark.cn-beijing.volces.com/api/coding/v1/messages` |
| temperature | `0.2` |
| 其他生成参数 | 不设置 seed/top_p/thinking；沿用当前 provider 默认。每次 max_tokens 按冻结 driver 从剩余预算减去 prompt UTF-8 bytes 和 256 framing reserve；不另改采样参数。 |
| prompt / tools | `solver-action-json/v7` / `m1-tools/v2`，源文件 hash 固定 |
| Reference | `local-recipes-candidate-1` / `1.0.0-candidate` / approved；digest `09bb5085c9fab4892d11403bfc8c5be6a138689a16505855a2c2242b3fbdfc4c`，既有 human approval |
| 材料 | 仅原始 `fixtures/trajectories/t1-script-error/solve.mjs` 和 `payload.txt`；不摄取带修复说明的 README，也不复制前次修复脚本 |
| 执行环境 | Node `v26.3.0`，darwin/arm64；绝对 executable 见 manifest |
| 凭证 | CLI 通过既有本地 `.env` 或进程环境读取 `ARK_API_KEY`；只记录变量名，不复制或记录值 |

## 预算与停止规则

| 项 | 每次上限 | 三次名义总额 |
| --- | ---: | ---: |
| wall clock | 600,000 ms（10 分钟） | 30 分钟 |
| steps | 40 | 120 |
| tool jobs（含验证阶段预留） | 20 | 60 |
| observable input + output tokens | 100,000 | 300,000 |

这是该固定配置的验收上限，沿用 v8-3 并留有余量，不是美元成本保证；缓存或 provider 未报告项不估算为已知用量。v8-1/2/3 分别观测 44,485 / 35,010 / 42,101 tokens；v8-3 steps 13、tools 11、耗时约 371 秒。最终发布预算仍需正式数据，不能用这一条轨迹代替 T11/T12c 的全局预算发布。

**累计 12 次停止规则优先于名义三次额度。** 当前 11 次校准已消耗，故本轮实际可启动 **1 次正式 run（累计第 12 次；最多 100,000 tokens）**。在累计第 13 次 run 的首次 provider 调用前暂停并升级重评；正式 run 2/3 的名义额度不是扩大上限的授权。启动 attempt 即保守占用一次，失败或进程崩溃不删除、不自动重试、不回收次数。不能将 v8-3 补算为正式成功，不能重置计数。后续若用户明确调整上限，须单独记录授权和停止规则，并保持原批次内容身份；不追溯改写已有结果。

“再有三次仍未实际执行脚本”的另一停止条件未触发：v8-1 已执行，v8-3 完整闭环成功。本轮不继续调 prompt 或开新校准。

## 允许的预置与人工介入

CLI 使用 `--preset-trajectory1`：host 只建立同一初始 hypothesis/experiment 并执行一次原始 `node solve.mjs`，产生 raw syntax error。此后读取错误、定位、局部 patch、重跑和提出 candidate 全由真实模型决定；host 不向模型提供修复文本或错误位置之外的新提示。冻结的 provider prompt 保持既有通用工具说明。外部人员不在运行期间编辑 workspace、补动作或重新发起请求。受保护的工程打包、独立 verification 和 oracle 判定由既有 host 自动进行。

## 启动与判分

```sh
python3 docs/gates/m1-t1-acceptance.py check
python3 docs/gates/m1-t1-acceptance.py run-next
python3 docs/gates/m1-t1-acceptance.py grade runs/m1-formal-t1-20261019-b1/run-01
```

判分器只读 canonical SQLite 和递归核验的 immutable artifacts，不以 CLI stdout 单独判分。必须同时具备：同 session 初次失败的完整 raw SyntaxError；provider 决策的一次局部语法修复及其成功 patch receipt；模型重跑同一脚本并保留成功 stdout；engineering→独立 workspace replay verification→受保护 oracle submit 的完整顺序；host replay receipt 绑定 candidate 输出；`candidate.submit` effect confirmed/accepted/completed；最终 solved/finished/solved；冻结模型/Reference/材料/预算绑定及预算内完成。

通过与失败均保留 `attempt.json`、`command.json`、stdout/stderr、SQLite、全部 artifacts 和 `grade.json`。单次失败不修改配置后再混入该批次；配置变更必须新批次。开发历史重算须显式 `grade --calibration <run-dir>`，该模式不能当作正式判分。
