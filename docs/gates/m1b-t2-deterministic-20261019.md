# M1b 轨迹② T2-A / T2-B 确定性验证记录

记录时间：2026-10-19T14:14:43Z。基线：`main@7687a2b9c4bd401e50c38de6a4dfdbc04fe1c6bb`；本轮改动尚未提交。

结论：**T2-A、T2-B 的工程实现与确定性集成完成。轨迹②真实模型验收尚未开始，M1b 未完成。** 外部模型调用 / 正式 attempt 均为 0；未 commit 或 push。

> **复核修复更新（2026-10-19T14:32:09Z）：** 结论登记前重试漏判、合法括号表达式误拒两项均已修复；当前②测试 33/33、全量 269/269，M0/M1 gate、typecheck/build 全通过。下方保留首轮实现、验证结果与 hash；当前修复明细和四项新 hash 见文末，首轮通过结果不代表当时已覆盖这两个边界。

## 首轮实现与判据（复核修复前）

- CLI 增加 `--trajectory t2`，本地 fixture oracle 由 host 选择；原①保留默认入口。模型收到题目描述与三个材料，不收到 fixture README 或 oracle 答案。
- 仅②暴露 `hypothesis.propose` / `hypothesis.conclude`。模型提交 claim、falsifier、prediction、命令和换路理由；host 生成身份、ref、预算和规范化 fingerprint。OpenCode 仍管理会话与内循环。
- `prediction=expression_evaluates` 是模型选择的可机械核查谓词；`other` 不预告替代路线。当前 fixture validator 支持有区分性的双操作数算术 probe，核对实际成功输出中的 literal mode 与原参数。自然语言理由及模型自主性仍须在 T2-C 审查，不声称有通用语义判分器。
- HypothesisManager 从同 run/challenge/task/session 的 canonical receipt 读取事实；成功工具执行可以形成 rejected 机制结论，失败工具执行不能。完整 stdout 必须在实际 OpenCode tool part 中送入模型输入；文本复制、外部 session、伪造 receipt、改写/不完整输出均不授予送达证明。
- 反证引用、结论、完整 HypothesisManager snapshot 均落入 canonical artifact/event，否定 fingerprint 写入 checkpoint；新路线须有模型理由及实际执行。②未修改①的 stderr/patch 准入规则。
- [②行为判分器](m1b-t2-acceptance.py) 只读 SQLite/artifact；复用原①判分器已有的 artifact/oracle/current-verification 检查，并增加②的时序、反证状态、实际换路、重复尝试和独立 replay 检查。原①判分器未修改。

判据顺序：模型声明前提 → 实际 probe 成功 → 原始输出送达 → 模型提交反证结论 → 保存否定状态 → 提出不同路线及理由 → 执行 → 成功 stdout 绑定候选 → 独立 replay → 权威 oracle accepted。

直接 decode 并 accepted 缺少上述证伪链，不能判②通过；被 host 阻止的原实验重试（同参数或换算术参数）也不能判模型自主换路成功。判据不固定 `2+2`、脚本修补次数或修补字节；正向覆盖 `7*6` 与 `11-3`，并覆盖 Node 路径和相对脚本别名。

## 首轮验证结果（复核修复前）

| 检查 | 结果 |
| --- | --- |
| 最初新增控制层测试（实现前） | 10 项中 9 失败、1 通过；缺少语义工具、送达绑定及前提约束，符合预期 |
| 最终②控制层测试 | 17/17，含 run/challenge/task/session 四项 receipt 隔离 |
| 最终②真实 OpenCode 接口 + 固定本地 provider | 5/5，包含 7 个证据篡改子场景；是确定性集成证据 |
| `npm run gate:m0` | 27 files / 163 tests 全通过 |
| `npm run gate:m1` | 1 file / 3 tests 全通过，原①正反断言保留 |
| `npm test` | 47 files / 258 tests 全通过（基线 236，新增 22） |
| `npm run typecheck` / `npm run build` / `git diff --check` | 全通过 |

独立 M0/M1 gate 检查分别开始于本地 23:06:29、23:06:39；补齐四项 receipt 隔离测试后，全量最后通过于 23:14:23 开始的一轮，其中原 gate 测试也全部通过。测试使用已安装的 OpenCode 1.19.3 与现有依赖；未安装依赖。provider 是测试代码启动的 `127.0.0.1` 固定响应服务，usage 为 fixture 数据，不代表外部模型用量或能力。fixture 临时运行目录在测试结束后清理；本文件记录可复跑的测试结果，不冒充保留了正式模型 run。

复跑②：`npx vitest run tests/integration/opencode-t2.test.ts tests/gates/m1b-t2.gate.ts`。宿主须允许本机回环服务监听。

## 过程中实际遇到的问题

1. 沙箱拒绝 `127.0.0.1` 监听，4 个接口测试报 EPERM；使用获准的宿主测试权限后执行本地 fixture，没有更换为外部 provider。
2. 初次接口接线中，3 个带假设记录的流程未能完成 replay：`/var` 与 `/private/var` 别名混用，产生带 `..` 的错误相对脚本路径。改为两端均取 realpath，增加 snapshot command 回归断言。
3. 判分器最初尚不存在，随后初版把非 JSON 的原始 stdout 也当 receipt 解码，导致两项正向判分失败。修正为只解析结构化 receipt；最终正反测试全绿。
4. 最后补充跨作用域测试时，跨 run 一项最初错误地预期 host receipt resolver 报错；实际 SQLite 外键已提前拒绝该写入。修正测试以断言这个更早的拒绝层；其余 challenge/task/session 项仍断言 resolver 拒绝。该轮为 257 通过 / 1 失败，最终重跑 258/258。

这些均为确定性开发/测试失败，不是正式模型 attempt；没有隐藏重试后挑选成绩。

## 首轮受检源码身份（SHA-256，复核修复前）

| 文件 | SHA-256 |
| --- | --- |
| `apps/cli/src/commands/openCodeTask.ts` | `f7271f98bd0b08b4ac1a05f438483309bbea0a51884c46d7c4e9e2ef829747a9` |
| `apps/cli/src/commands/solveM1.ts` | `d10191cf99b28a5872e7785fb924cd9d630d1c921e497a58daed57e3dc281c10` |
| `apps/cli/src/main.ts` | `77f1ccf93cbbf7ee54089854c5c32cc7ae4f9547703aa2c4b35a79cb3b8e6add` |
| `apps/opencode-plugin/src/index.ts` | `6ff11e74194296de921897d4f3a3a103908917a33380f72269e889157db7732a` |
| `tests/integration/opencode-fixture.ts` | `71cf9a6138e17f55b35885a4fb73af38f46a391a50cc6bed21a1eaf0e3a2c8a8` |
| `tests/integration/opencode-t2.test.ts` | `a0fcc3796fc42c4edb169609a131c3408fb47667756295afc09c035da8380e3d` |
| `tests/gates/m1b-t2.gate.ts` | `389cdb7d9aa3c64b65bc7c53296b806ab4a0b30a31b8447d90fbec8bee579c93` |
| `docs/gates/m1b-t2-acceptance.py` | `1c21ad9972d1c99aea8a03c9c054b4924d207f7cacae672cb9c926e182c1fa38` |
| `docs/gates/m1-t1-acceptance.py`（未修改） | `aa4844b9f9ac14744d0f6115aba6df65ef0600500023f82c068dce67d6af05f0` |

生产 packages、冻结 fixture、退役归档及旧验收文件未改。既有无关改动 `AGENTS.md`、M0 plan 与 `.m1-verification-replay/` 的文件 hash 与开工时相同。③–⑥无实施改动。

## 复核修复：结论登记前重试与合法括号表达式

用户授权范围仍限轨迹②的确定性工程修复，不跑外部模型、不 commit/push。

1. **重试判分起点**：从 rejected 结论事件提前到原始反证的 `delivered_to_model` 事件。模型已读到反证后，无论是否登记结论，重复原实验或重试同 parser 的算术输入，都不能被算作自主换路。host 的重复实验拦截继续保留；没有用拦截结果替代模型行为判据。
2. **合法表达式**：移除只支持双操作数的格式规则，改为限定数字、算术运算符、括号和空白，再使用 Node 自带语法检查。host 只构造 `vm.Script`，判分器仅调用 `node --check`，均不执行表达式；没有新增通用解析库或模型循环。原始 literal mode、原参数、成功 receipt、真实送达、候选与独立 replay 绑定继续校验。

新增 11 项回归，既有 22 项②测试与①断言全部保留：

- 结论登记前重试 3 项：原参数 `7*6`、括号形式 `(7*6)`、换参数 `9+3`；断言“反证送达 → 重试被拒 → 登记结论”的实际时序，最终即便 oracle accepted，②也必须判失败。
- 控制层合法括号 3 项：`(7*6)`、`((7)*(6))`、`(11 - (3 + 2))`；必须成功登记反证并实际执行新路线。
- OpenCode 接口完整链 2 项：外层括号与嵌套括号，均走真实 session、独立 replay 和 oracle accepted，并通过②判分。
- 非法或非算术输入 3 项：括号不闭合、非法操作符结构、`process.exit(99)`；不能登记为有效反证，未通过删除校验放行。

| 本轮检查 | 实测结果 |
| --- | --- |
| 先加回归、修复前 | 33 项中 8 失败 / 25 通过；5 个括号案例误拒、3 个结论前重试误判，开始于 23:29:11 |
| 修复后的②针对性测试 | 2 files / 33 tests 全通过，开始于 23:30:16 |
| `npm run gate:m0` | 27 files / 163 tests 全通过，开始于 23:31:18 |
| `npm run gate:m1` | 1 file / 3 tests 全通过，开始于 23:31:27 |
| `npm test` | 47 files / 269 tests 全通过，开始于 23:31:33（基线 236，②累计新增 33） |
| `npm run typecheck` / `npm run build` / `git diff --check` | 全通过 |

时间为本地 Asia/Tokyo；模型 provider 全部为本机固定 fixture，正式 attempt 仍为 0。运行不安装依赖，未改变预算、停止规则或 T2-C 的未授权状态。

本轮受检文件的 SHA-256 如下，覆盖上方首轮表中的同名四项；其余五项 hash 不变，首轮表作为历史保留：

| 文件 | SHA-256 |
| --- | --- |
| `apps/cli/src/commands/openCodeTask.ts` | `0886f07658d0b4b2e35e823cbb83715edeebdc69301d1c6346f95f415a8186e4` |
| `docs/gates/m1b-t2-acceptance.py` | `accaa7132332bfd458e435b203d63d0e43a012e245a98556ddf420c7b1376ac3` |
| `tests/integration/opencode-t2.test.ts` | `9892e1e22983a23adc54f94972eabc33d8e300aa3f40e38382720c533061b5dc` |
| `tests/gates/m1b-t2.gate.ts` | `4175dfe5aeab85339992e4672f7e1362fe585a515fcd05edb35f6013b21f5c60` |

本轮自检未引入新 provider、Agent 内循环、轨迹③–⑥实现或冻结资产改动；无关文件 hash 与首轮记录一致。T2-C 仍待另行授权和真实模型验收。

## 提交前再复核（2026-10-20，Asia/Tokyo）

用户授权复核通过后仅提交本轮轨迹②改动，不 push，不跑外部模型；前文“未提交/不 commit”为各历史执行阶段当时的状态。

复核结论：两项修复没有放宽原始反证、真实送达、同作用域 receipt、候选 stdout 或独立 replay/oracle 的判据。新增括号支持仅去掉探测格式误限，保留非法/非算术输入拒绝；重试检查覆盖反证送达后的结论登记前后。原①正反测试未改，未引入 provider 直连、自建模型内循环或③–⑥实现。

| 本次重新运行 | 结果 |
| --- | --- |
| `npm run gate:m0` | 27 files / 163 tests 通过，09:40:25 开始 |
| `npm run gate:m1` | 1 file / 3 tests 通过，09:40:35 开始 |
| `npm test` | 47 files / 269 tests 通过，09:40:41 开始；含②的 33 项回归 |
| `npm run typecheck` / `npm run build` / `git diff --check` | 通过 |
| 当前受检源码 hash | 上述首轮表与修复覆盖表合计 9 项全部匹配 |

限定提交路径：`apps/cli/src/commands/openCodeTask.ts`、`apps/cli/src/commands/solveM1.ts`、`apps/cli/src/main.ts`、`apps/opencode-plugin/src/index.ts`、`tests/integration/opencode-fixture.ts`、`tests/integration/opencode-t2.test.ts`、`tests/gates/m1b-t2.gate.ts`、本②判分器、本验证记录、M1b ②计划及 `docs/superpowers/README.md`，共 11 项。

M0 plan 的既有修改、AGENTS.md 与 `.m1-verification-replay/` 的文件 hash 与开工前相同，均排除在本轮提交范围外。③–⑥仍只有组件和缺口盘点，当前 M1b 未完成；此轮只说明后续顺序，不新建其实施计划。全部测试仍为本机固定 provider，真实模型 attempt 为 0。
