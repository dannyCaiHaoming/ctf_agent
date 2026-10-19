# T-D 正式验收：OpenCode + 百炼 DeepSeek V4 Flash

2026-10-19，批次 `m1-opencode-t1-bailian-20261019-b2`。**3/3 通过**，超过 M1 轨迹①「独立三次 ≥2 次」门槛。只证明当前轨迹①，不覆盖 M1b 或真实 TSecBench。T-A 的真实模型集成证据同时补齐；没有自动 commit/push。

## 先预检，再冻结，后执行

用户明确恢复外部模型验收并授权百炼标准 API 三次正式 run。复用既有 OpenCode 百炼凭证，仅内存注入，不把凭证写入文件/命令/提示。DNS/TLS 可达；认证 models HTTP 200，列出 `deepseek-v4-flash-0731`。

一次小额 OpenCode 探针返回 417 输入 + 256 思考 tokens、无 API 错误。256-token 输出上限耗在思考，未返回要求的标记，故原探针 `passed=false` **原样保留**；[assessment](preflight-assessment.json) 仅据实际推理响应确认请求可用，没有把标记未通过改写成通过，也没有追加隐藏探针。**精确剩余额度 unavailable**，当前可用不等于承诺三次都不会欠费；engine cost=0 不解释为免费。

[输入冻结](../m1-inputs.md) 与 [manifest](manifest.json) 固定 OpenCode 1.19.3、SDK/依赖 lockfile、模型、参数、六项受管工具、Reference=null、原始两份材料、preset 和每次预算，并保存 158 个执行文件及 Node/OpenCode 二进制 hash。每次启动前重验；三次结束后再次核对一致。main 工作区原本为 dirty，以文件 hash 为执行身份，不伪称干净提交。

## 全部正式结果

| Run | 结果 | CLI 总耗时 | canonical steps / jobs（含 replay） | 输入 tokens | 输出+思考 tokens | 合计 | 模型调用 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| [01](result-01.json) | passed / oracle accepted | 14.697s | 17 / 4 | 16,141 | 847 | 16,988 | 6 |
| [02](result-02.json) | passed / oracle accepted | 14.860s | 19 / 4 | 18,454 | 963 | 19,417 | 6 |
| [03](result-03.json) | passed / oracle accepted | 15.729s | 21 / 3 | 20,270 | 957 | 21,227 | 7 |
| 总计 | **3/3** | **45.286s** | — | **54,865** | **2,767** | **57,632** | **19** |

以上均为 OpenCode 实际观测的 provider usage（不是估算价格、不是 stub usage）。加上单独的 673-token 预检，本轮观测总量为 **58,305 tokens / 20 次有用量响应的模型调用**；无 harness 自动重试或配置变更，provider 侧请求/引擎内部重试总数未独立观测。没有遗漏失败的正式 run；唯一标记失败属于留存的预检，不混入三次正式分母。

三次 run/challenge/session 各有 3 个不同 ID，CLI 进程和 workspace 独立；每次只复制原始材料，host 预置止于首次失败。每次都由 canonical SQLite + 递归 artifact hash 重算 11 项行为判据：完整失败 stderr → 实际模型上下文读取 → 合法局部 patch → 同一脚本成功 → 候选绑定真实 stdout → 独立 replay receipt → confirmed/accepted/completed oracle effect → solved checkpoint。全部为 true；另外核对冻结配置/材料/预算/Reference/preset/engine 与 canonical start 绑定、终态预算不超限。未按指定修法或 patch 次数打分。

## 预算定稿

轨迹① release profile 为 `config/release-profile.m1-td-bailian-20261019.json`，**保持验收时的 600,000ms / 40 steps / 20 tool jobs / 100,000 observable tokens 不变并定稿**，不事后缩紧配置并冒称已对新配置做三次验收。实测单次上界为 CLI 15.729s、canonical 21 steps / 4 jobs / 21,227 tokens，全部有余量；样本仅三次，不足以据此下调通用预算。该结论仅适用于轨迹①，非全局 T11/M1b 预算，也不是货币扣费保证。

## 停止与回归

旧批次仍保持累计 12 次、正式 1 次尝试/0 成功、不混并。新批次累计 3/12；本次授权三次已用完。[停止检查](stop-check.json)：实际调用第四次入口，在凭证读取和 provider 边界前拒绝，未创建 attempt-04；12 次绝对上限另有确定性测试（11 可进、12/13 拒绝）。旧批次入口也继续拒绝，不静默重置计数。

- `gate:m0`：28 files / 171 tests 全过。
- `gate:m1`：3/3 全过（完整测试中再次通过）。
- `npm test`：54 files / 299 tests 全过。
- typecheck / build / diff-check 全过。
- 发布证据凭证扫描：74 个公共证据文件、0 个百炼密钥匹配；私有 OpenCode engine 目录不进入证据包。

## Canonical 留存

原始运行目录为仓库下 `runs/m1-opencode-t1-bailian-20261019-b2/run-01` 至 `run-03`。为避免只留指向 ignored runs 的索引，以下证据包同步落入 `docs/gates/`：各含 canonical SQLite、全部 artifacts、solver/verifier workspace、CLI stdout/stderr、命令；**不含私有 OpenCode 配置/engine 数据或密钥**。artifact 内绝对路径对应原始运行位置；归档用于按原路径恢复/审计，不宣称可任意搬移后直接判分。

| 包 | SHA-256 | canonical SQLite SHA-256 |
| --- | --- | --- |
| [run-01](run-01-evidence.tar.gz) | `4edd4c21e1ca3d558f4c11dd782e2247d40753ac1f6296a2e2b8847ea1f1519f` | `75e9fcd334984dc28da8925e6d4130a65479da1f21d2045337fb88753bf1448f` |
| [run-02](run-02-evidence.tar.gz) | `201f8e5ccf5a1adc4b25347456383ef4275f0239fefb018592c60631b33e073f` | `e2b731e14601f0c7fad93d5e9a07f9223c69b0b5afc104ffd6f739a32fd47bde` |
| [run-03](run-03-evidence.tar.gz) | `dadc5f13bb89a9e29f7182f5fe50a116208a950620c0eb5ad513c7bec954805c` | `51c19999605191c1994ed86c6a5b13888fddae5faae86039aed2775556c37cb2` |

## 本轮改动与证据复核（2026-10-19，验收后只读重算）

结论：**未发现当前改动超出最新 M1 的轨迹①垂直切片；3/3 验收结论保持。** 没有新增外部模型请求，没有修改/重冻原 manifest、attempt、result、SQLite 或证据包。审查对象是当前 main dirty worktree 的累计 M1 改动，不把所有未提交文件误称为本次审查新增。

| 范围 | 核查结果 |
| --- | --- |
| T-A OpenCode 底座 | CLI 仅走公开 OpenCode server/session/plugin；模型和内循环归 OpenCode；旧直连 JSON 动作路径在生产目录无符号命中，旧代码只在 tests/legacy 冻结回归，不进入 build |
| T-B 轨迹①最小工具与候选 | 仅六项受管工具；host 注入身份/预算，失败回灌同 Solver；batch stdout/stderr 分流为当前证据链所需；候选只走既有 local replay/独立 verifier/oracle |
| 冻结资产 | domain-web/misc/crypto、domain-candidates、hypotheses、Reference、reporting、compaction、durable watch、平台与 fixture 相对冻结基线 HEAD 无代码变化；candidate-verification 仅 import 类型来源迁移，无新增通用验证能力 |
| T-C 测试 | 实际 OpenCode + 本机 provider 的正向/不同合法修法/反向测试；旧 HTTP/direct-provider CLI 测试改为退役入口拒绝，不把它们算新模型验收 |
| T-D harness | 仅当前批次的预检、冻结、独立 CLI 启动、attempt 计数与判分留存；没有自建模型动作循环、通用调度器、Docker/VPN/TSecBench 接入或其他轨迹运行 |

逐文件核验 158 个冻结执行文件均匹配 manifest；相对基线 HEAD，其中 108 个未变、29 个修改、21 个新增（另有明确退役的生产文件删除）。逐个对三次原始 SQLite 重算 11 项行为判据全部通过，并独立重核 attempt 在 start 前保留、manifest hash、canonical 配置/fixture/preset/Reference/预算绑定、checkpoint 用量与结果一致、预算内完成、三组 run/challenge/session 不重复。三个归档的 SHA-256 及归档内 SQLite 均与表中原件 hash 一致；私有 engine 目录不在包内。

**失败细节也已核对：** run-01、run-02 各有一次 `job.run timeout_ms > 15000` 被拒绝；run-03 有两次 workspace.read 和一次 workspace.list 使用了错误的 workspace-relative 路径而被拒绝。共 5 次工具拒绝都在原 canonical events 中保留并回灌，模型在原 session 中自行修正后完成；这正是「工具错误不终止 run」的现有行为，不是额外独立 attempt，也没有人工修改配置或静默重开 run。无需为这些已正确恢复的观察扩建通用机制或追加付费验收。

本轮重新执行完整测试：54 files / 299 tests 通过；两项独立 gate 与 typecheck/build 复跑结果保持全绿。修正了文档索引的「六轨迹仍属 M1」过期表述，并把 plan 的「实现/验证已完成」与「提交未完成」拆开。剩余仅受授权约束的同一提交收尾；P5 风险重评属于 M1b/M6，非本 M1 待办。没有自动 commit/push。
