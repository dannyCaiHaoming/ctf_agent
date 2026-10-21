# Throwback 第五次误启动记录（2026-10-22）

## 结果

我把用户对 token 限制的澄清错误理解成重新运行许可，启动了本次 run。用户之后明确指出并未要求重跑；因此这份记录只是保存错误操作的证据，**不计为获授权的解题验证**。run `run_33a5e7fa-4dec-4370-85b8-815f434924e1` 在 73.4 秒后因服务商错误停止：HTTP 429、`AccountQuotaExceeded` / `TooManyRequests`。Observable tokens 为 0；服务商记录的额度重置时间为 2026-10-22 02:00:29 +0800 CST。

- 本地 profile 设置 10,000,000 observable-token 门槛；时间、steps 和 tool jobs 没有较低上限。此配置事实不构成本次运行授权。
- 6 次模型调用被 host 准入；provider usage 汇总不可用。
- 无 candidate、无 oracle submission，不能算作题目解出。
- 事件记录仅有 run 启动、模型调用及最终 checkpoint，没有 HTTP/tool job 事件；模型失败前未对靶场发请求。
- 本次错误已由独立读取 OpenCode 本地数据库中的错误字段确认。仅保存状态、错误码与归一化原因；未保存原始响应正文、headers、凭据或 request id。

## 证据

- [结果 JSON](result.json)
- [Canonical events](canonical-events.jsonl)
- [Release profile](release-profile.json)
- 原始运行状态库：`runtime/state/run_33a5e7fa-4dec-4370-85b8-815f434924e1.sqlite`
- 原始 OpenCode 会话库：`runtime/.opencode-control/run_33a5e7fa-4dec-4370-85b8-815f434924e1/data/opencode/opencode.db`

此误启动 run 已结束；不再重试。
