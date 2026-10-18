# M1 Task 3b — CLI ingress and shared deadline/budget

日期：2026-10-18。状态：PARTIAL。完成正常 M1 `solve` 入口、provider stub 确定性接线、共享 resolver deadline/budget 边界验证，以及 M1 可用的交互 PTY/TCP/channel action route；未运行真实模型，未做 Git 提交/推送。本地 oracle 的 accepted submit 见后续增量。实现位于 `codex/m1-task1-responsibilities` 工作区，尚未整合进 `main`。

## 后续增量：受限 progress adjudication 与 HTTP 确定性 CLI 闭环

本节补充本工作区后续实现与实测；下文原有记录保留为先前阶段快照，不能再据其“未配置”描述推断当前增量仍缺失。T3b、T9仍为 PARTIAL；本次只证明有限的 local HTTP literal 命题路径，不代表通用 CTF 语义能力或完整 T9/T9a。

- 新增 `createHttpLiteralProgressAdjudicator`：只接受预声明的精确 literal HTTP body contains/absent 命题，并绑定 hypothesis claim、experiment/hypothesis IDs、成功 canonical HTTP observation、完整且同 run/challenge/task/session 的 raw body artifact refs。未知语义、伪造/跨题/不完整证据均 inconclusive；工具失败及非成功 HTTP 响应不构成反证。正反向及越界用例在 `tests/contract/http-progress-adjudicator.test.ts`。
- 正常 CLI 从 `apps/cli/src/main.ts solve` 接入该 adjudicator；host resolver 仅在受支持的 local HTTP target 存在时组装 Engineer、独立 Verifier task/session/workspace/lease、VerifiedCoordinator 和 host-only LocalFlagOracle。candidate bytes 从 canonical Runtime observation 提取；候选提交仍经过完整独立验证和受保护 submit。Verifier 对同一 origin 发起固定 GET 的真实重放，直接执行发布的 immutable script artifact；canonical runtime receipt issuer 和 State event lineage 验证阻止手工 JSON receipt 进入此可信路径。共享预算、deadline、取消与 lease 约束继续生效。
- 确定性 CLI 正例真实启动 `apps/cli/src/main.ts solve`，provider 由本地 HTTP stub 替代；stub只根据 Solver 实际收到的 robots/hidden-path observation 选择下一步和候选，不持有或接收 oracle flag。run `run_8b47d43c-2570-474e-8562-8e53264906d9` 保存在忽略目录 `runs/m1-cli-http-audit-20261018-v2/`，含 canonical State SQLite、content-addressed artifacts、脱敏 `profile.snapshot.json` 和 `audit-summary.json`；测试核对两次 HTTP tool result、两次 accepted progress adjudication、engineering→verification→oracle_submit completed events、单一 confirmed/accepted authoritative effect、candidate artifact ref 与 solved checkpoint。
- 同一正常 CLI 测试另跑错候选负例：stub 从实际 observation 生成后篡改候选字节；断言 CLI 未 solved 且 `candidate.submit` effect 为零。进展裁决另有无关 claim、错误 experiment/hypothesis identity、无来源/不完整/跨题 evidence、工具错误和成功但确实 absent 的反证覆盖。

### 本增量验证

- `npx vitest run tests/integration/cli-m1-http-solve.test.ts`：1 项通过，包含正常 accepted/solved 正例及错候选未提交负例。
- `npm test`：49 个测试文件、276 项通过；包含 M0 gate 的 149 项 deterministic contract tests 和 gate 检查。
- `npm run typecheck -- --pretty false`、`npm run build`、`git diff --check`：通过。
- 没有真实模型、外网、远程 provider API 或真实 benchmark/VPN 调用。未跑六轨迹验收。HTTP literal adjudicator 不理解任意漏洞机理；resolver只支持受限 local HTTP GET 范围，其他候选/执行模式 fail closed。T9/T9a的通用执行来源证明、其余操作模式及完整组合仍未完成。

## 先前阶段快照（本报告增量实现之前）

- 正常 `solve` 入口按 M1 profile 路由到 SolverLoop，创建 run/challenge/session/task 身份与受限责任；将 profile、model、temperature、prompt/template、tool manifest、Reference snapshot、预算及 deadline 绑定到 run。
- 通过真实 CLI 命令与 deterministic provider stub 验证入口；stub 路径覆盖 Reference search、Skill load、候选停止及 canonical 输出。没有网络模型调用。
- 在同一 SolverLoop/CLI 工具 action manifest 中接入 PTY/TCP session 与 channel open/read/write/status/list/cancel/close。资源操作必须使用当前 session lease；host 未授权的 TCP endpoint 在打开 socket 前拒绝，M1 CLI 仅授权 challenge origin 的精确 host/port。流数据显式 bytes/base64 编码并使用 monotonic cursor，写入没有自动重试。
- task/lease transfer 保留为 host-owned Coordinator 操作，没有暴露模型自行选择新 lease 的 action。
- Provider driver 支持 OpenAI-compatible Chat Completions 与 Anthropic-compatible Messages；取消信号传递、provider usage 可观测性、无效 JSON/缺 usage 失败关闭均有契约测试。
- SolverLoop/Resolver 使用共享 deadline、动态剩余预算和分阶段 admission；工程、验证与 submit 前预留 step/tool budget，Runtime/driver 可取消请求受控传播取消信号。
- State canonical effect ledger 持久化 effect prepared/dispatch 时间戳和权威回执。迟到 resolver 结果先校验 evidence artifacts，再核验期限前 dispatch 与匹配权威 oracle receipt；没有匹配 canonical receipt 不得由迟回调转成 solved。迟到结果只保留可证明事实并停止后续动作，期限后 submit 在 dispatch 前拒绝。
- 当时阶段记录：M1 CLI 尚未配置通用 semantic progress adjudicator，也尚未接入本次记录的 local HTTP resolver 子集；模型自述不能推进语义进度或制造候选接受状态。此处是增量实现前快照。

## 确定性验证

- `npm test`：47 个测试文件、270 项通过。
- `npm run gate:m0`：23 个测试文件、149 项通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- 交互工具专项：`tests/integration/solver-loop-interactive-tools.test.ts` 5 项通过，覆盖 PTY、scoped TCP session/channel 往返、租约资源访问与 endpoint deny；正常 CLI stub 另调用 `job.list` 并验证 `m1-tools/v2` manifest binding。
- 其他关键专项：`tests/integration/cli-m1-solve.test.ts`、`tests/integration/solver-loop-deadline-reconciliation.test.ts`、`tests/contract/provider-solver-driver.test.ts`。

## 先前阶段当时未完成的事项（不覆盖本报告的后续增量）

- Coordinator handoff 的 `job.transfer`/`channel.transfer` 尚未由正常 CLI 组合触发；模型不能自行创建或选择目标 lease。
- T1–T7 全量工具入口未闭合，T3b 产品组合仍受 trusted progress adjudicator 与 T9 resolver 闭环约束。
- 当时尚无可信 semantic-progress adjudicator；当前增量只覆盖报告开头描述的有界 HTTP literal 规则，不代表有通用 canonical progress 派生能力。
- 当时 CLI 尚未组合 T9 resolver、Engineer/Verifier 与受保护 submit；当前只证明 local HTTP 子集，shared budget/deadline 的全范围产品组合仍未验收。
- 六轨迹确定性 harness 与真实模型验收仍在 T12；本增量没有真实模型、远程 provider API 或 benchmark 调用；本地 oracle accepted 提交已在增量段记录。
