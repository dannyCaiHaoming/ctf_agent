# M1b observation 分页后 DVGA 真实复跑（2026-10-20）

## 配置与结果

- 目标：用户提供并授权的 `http://localhost:5013/`；与侦察 run 使用相同 DVGA、OpenCode 1.19.3、`bailian/deepseek-v4-flash-0731`。
- 本次预算：`maxObservableTokens=100000`、`maxSteps=40`、`maxToolJobs=20`、wall clock 600 秒。仅执行一次真实 solve run。
- 结果：`resource_exhausted / inconclusive / paused`；41.6 秒，9 次模型调用，104,573 input、3,201 output，checkpoint observable 总量 107,774。共享预算于一次模型响应完成后被跨过 7,774；无 candidate、无 oracle result、无最终模型答复。
- run ID：`run_6bf12623-baba-499d-90a2-407d32ec8cd4`；OpenCode session：`ses_ea79b5136ffe1Gt3so0UxjwsIp`。
- 原始运行结果与 canonical 事件在 [`run-2/runtime/`](run-2/runtime/)。本次 release profile 与 OpenCode 配置为 [`release-profile.json`](run-2/release-profile.json) 和 [`opencode.json`](run-2/opencode.json)。配置只含 `{env:DASHSCOPE_API_KEY}` 引用；凭据仅从既有 OpenCode 登录文件取入子进程环境，没有写入配置、canonical artifact 或日志。OpenCode DB 的 credential 表为空。
- canonical SQLite SHA-256：`3598b2db39329a42bd3ab136c16f4aff4a86b52b4e9c0b5637ff461cfc210102`。

## Input-token 增长曲线

这里的每次 input 计数按 OpenCode usage 的 `input + cache.read + cache.write` 计算，与 run checkpoint 的 `input_tokens` 一致。累计值不包含 output。

| 调用 | 上次全量响应累计 input | 分页后累计 input |
| ---: | ---: | ---: |
| 1 | 1,025 | 1,170 |
| 2 | 5,752 | 3,863 |
| 3 | 13,972 | 8,933 |
| 4 | 38,264 | 17,166 |
| 5 | 66,108 | 28,676 |
| 6 | 97,111 | 42,936 |
| 7 | — | 60,066 |
| 8 | — | 80,697 |
| 9 | — | 104,573 |

前 6 次调用时，分页后累计 input 低 54,175（55.8%）。分页后的单次 input 仍随会话增长，调用 9 时累计 input 越过 100k；加上 output 后 observable 为 107,774。本次相较上次运行到 6 次调用，本次多完成 3 次模型调用。该比较是相同题目、模型和配置预算下的实际 usage 曲线；两次模型动作轨迹不同，不把 token 降幅等同为解题阶段等价。

## 模型推进情况与真实卡点

- 模型使用 `http.request` 取得大响应的 2 KiB preview，并通过 `observation.read` 回取范围；完整 8,136、9,232、10,071、46,884、14,311 byte 响应留在本机 artifact，没有整段回灌。共出现 9 次 HTTP 请求和 8 次 observation.read 调用。
- 相比前次 6 次调用、19 次 HTTP 请求，本次推进到更多定向 Web/GraphQL 查询，但仍处于侦察探索，没有形成候选或进入 oracle 阶段。因此「分页后能推进到探索之后」的成功判据**未达到**。
- 最后一次工具调用要求 `observation.read(cursor=6144)`，但其 observation ref 当前预期 cursor 为 `2048`，canonical tool result 明确拒绝该调用。run 随后在共享 token budget 用尽，未再给模型一次纠正机会。
- 证据指向两个尚未解决的限制：分页避免单个大 HTTP body 注入，却不能阻止 OpenCode 后续请求携带增长中的会话上下文；此外，本次模型把不匹配的 observation ref 与 cursor 配对，发生读取错误，且无预算恢复。现在停在记录，不自动修复或重跑。

## 验收前置

- DVGA 可达：HTTP 200。
- `npm run gate:m0`：29 files / 167 tests passed。
- `npm run gate:m1`：3/3 passed。
- `npx vitest run tests/integration/cli-m1-http-solve.test.ts`：3/3 passed。

## 对照基线

前次全量响应 run 证据见 [`scout-record.md`](../m1b-real-web-scout-20261020/scout-record.md)，实际 usage 是 6 次调用、97,111 input、4,542 output、101,653 observable tokens。账户余额与费用均未查询；token 不代表费用。
