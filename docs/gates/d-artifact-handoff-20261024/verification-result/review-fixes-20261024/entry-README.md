# D 第四接口无模型验证证据

工作树：`/Users/caihaoming/.codex/worktrees/3e07/pentest-agent`，detached `639782bed2fd1fe3507c8876c10dcca78a3a8a38`。只改子区；没有 commit/push、新 Codex session、第五接口或真实模型。保留 plan/session/worktree 等待主 session 独立核对。本次是作者自查，不能替代主 session 核对。

## 结论与边界

- Q1：真实公开 runtime 首份报告及 Coordinator 指定读回成立，身份/版本/execution 来自 C；错角色/身份/版本/题目/job/旧 execution 由 contract 拒绝。
- Q2：部分成立。真实计算及原 bytes 支持固定版本的报告契约；语义仍由 Verifier 判断。最终反证固定 `INCORRECT` 候选，实际独立重算得到正确 9 bytes。echo、错输入相同输出、audit 字串反例保留；蓄意虚假完整 echo 报告依然可过机械检查（包括 currentAvailability.usable），不能声称宿主解决了语义充分性。
- Q3：部分成立。必要截断/unknown/已知改写阻挡；相关固定/准备依赖改变失效、无关 work 不失效；旧版本/回报 rebind 竞争拒绝。V3 中途改写后恢复、未声明读取的原反例保留 unknown。外部实例状态、连续完整性、任意未声明依赖、任意同 uid 写入没有持续证明；assumed 前提不清除 unknown。大型报告的原生工具截断后完整下游阅读尚未验证。
- Q4：已测本地生命周期成立。保存/回复/接收分开；停止先胜零登记，保存先胜保留事实；丢回复不自动重试，迟到回复实际未送达；预算拒绝。重复/冲突及并发为 contract 证明，不是恢复系统。unknown/暂停/不重试是替身预定选择，未验模型行为。

## 最终可复核批次

使用 `native-accepted/`，七案都是各自从空 run 的同入口 E→Solver→Engineer→Verifier→Coordinator 链；不拼接各批。Node v26.3.0，OpenCode 1.19.3，SDK/plugin 1.19.0；loopback scripted provider，真实模型 0，真实 usage unavailable。

| case | provider 请求 | 已保存报告 | 运行终态 |
| --- | ---: | ---: | --- |
| control | 43 | 1 | completed |
| rejected | 43 | 1 | completed |
| missing | 43 | 1 | completed |
| lost | 42 | 1 | completed |
| stop | 45 | 0 | completed |
| late | 45 | 1 | completed |
| budget | 39 | 0 | budget_exceeded（内层 code=1，probe exit=0） |

每案：`provider.json` 原始请求，`loadedContext.json` 实际角色正文/工具权限及描述，`events.json`/`observations.json` 时序，`wire.json` 真 plugin/C RPC，`evidence/` 含 messages/bindings/executions/admissions/resources/verification-results，`workspace/` 和 `state/jobs/` 原始 bytes。`summary.json` 提取判据，不能替代原始证据。stop/late 由原生 sibling 完成通知唤醒父任务，没有 SDK resume child。

## 命令与退出码

完整索引见 `commands.json`，最终验收：

```sh
npm run typecheck                 # exit 0: delivery-typecheck.log
npm run build                     # exit 0: delivery-build.log
npm test                          # exit 0: delivery-test.log; 47 files / 384 tests
npx tsx tests/manual/d-verification-result.ts native-accepted # exit 0; 7 scenarios
```

必要定向回归 exit 0（9 files / 106 tests；targeted.log）：

```sh
npx vitest run tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts tests/contract/d-candidate-package.test.ts tests/contract/d-verifier-handoff.test.ts tests/contract/d-verification-result.test.ts tests/contract/control-service.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/g-team-integration.test.ts tests/contract/opencode-config.test.ts
```

最后全套同时设置 `D_RESULT_EVIDENCE_DIR=.../contract-accepted`、`D_VERIFIER_EVIDENCE_DIR=.../third-interface-accepted` 保存原始 V3 反例及 12 个新增契约场景。`contract-accepted/judgments/` 中 fixed wrong candidate、manifest、正确重算 bytes 可直接比对；`dishonest-echo-boundary/` 则是语义缺口，不能记为防伪通过。`third-interface-accepted/mid-job-restore/` 中 CHANGEDUNDECLARED 与前后 matched/unknown 同时成立。

## 失败、来源及指纹

`baseline/` 保存进入时 HEAD/status/diff、已有产品/角色/测试源文件及 hash；两份指定 design/plan 进入时与主区 byte-identical。`final-source/`、`final-source-hashes.json`、`own-entry-diff.patch` 是本次修改相对进入状态的精确 bytes；`git-diff.patch` 还包含进入时已有 design 修改，不能据此误认为全由本次产生。`runtime-final-source-check.json` 确认 native-accepted 捕获的所有运行源文件与最终源文件 hash 一致。`evidence-manifest.json` 覆盖全部保留文件（不含自身），用于主 session 独立核对。

初始 `baseline/RED.log` 9 failures 为缺少入口，原样保留；当时新测试即时快照未捕获，不能提供它当时的在盘 hash。补充 `red-replay/` 保存“已固定基线＋最终测试”的完整源码/hash/失败日志，12 failed（包括不存在入口导致 race barrier 超时），只是独立重放，不回填成初始快照。首次 typecheck 有 plugin Zod4 与 host Zod3 schema 类型差异，改用 plugin 原生 shape；初版契约一个字段期待写成 verifier.execution 而 host 填在 execution，修正期待。初次 final-build exit 1 是公开 snapshot 暴露未 export 的 Stored；只导出类型后构建通过。所有失败日志留存。

native-first/native-final 的 rejected 样例只是错检查器输出，不构成候选反证，旧 passed 只表明当时机械装配断言通过；不能用于 Q2。最终 native-accepted 改为固定错候选＋正确独立重算，并同批复跑全部七案。相关原始来源及 hash 都保留，没有改写旧样例。

`main-readonly-check.json` 依据存在的 `/tmp/d-verification-result-main-baseline.json` 逐项核对主区，changed=[]；未写主区。尚未做主 session 独立验收。语义模型能力、外部实例动态条件、OS 隔离、restart recovery、通用 replay、第五接口与 solved 均未验证。
