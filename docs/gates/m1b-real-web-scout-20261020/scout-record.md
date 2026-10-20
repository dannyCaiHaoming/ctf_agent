# M1b 真实 Web 侦察记录（2026-10-20）

## 目标与授权

- 目标：用户提供并授权的本机练习站 `http://localhost:5013/`。
- 页面自述为 Damn Vulnerable GraphQL Application（DVGA）。本轮不含输入目录或额外题面。
- 用户授权 1 次真实模型 run；实际只发起 1 次 run。启动前的首次命令因 CLI 进程缺少 `DASHSCOPE_API_KEY` 在 provider dispatch 前失败，没有访问目标或发送模型请求；随后从既有 OpenCode 登录文件把凭据仅注入进程内存，再运行一次。凭据未写入记录或运行产物。
- 执行路径：产品 CLI → OpenCode 1.19.3 → `bailian/deepseek-v4-flash-0731`；使用 `--target` 通用 HTTP 路径，无 `--trajectory`、无 fixture、无独立验收框架。
- 目标访问由模型经受管工具完成；策略只开放 `http://localhost:5013` 同源 GET/POST 和空 workspace 的读取。

## 结果

- run：`run_e832287c-b1f7-4b72-a771-54ad98ce0824`；OpenCode session：`ses_ea7dbde13ffeHu6sFR1kX4oLhN`。
- 终态：`resource_exhausted / inconclusive / paused`，原因是共享 run token budget 用尽；没有候选，没有最终模型答复，也没有权威 oracle，因此**不记为解出**。
- 模型用量：6 次模型调用，97,111 input tokens、4,542 output tokens；observable 共 101,653，超过配置的 100,000 上限。run 在约 102 秒停止，未触及 600 秒 wall-clock 上限。
- 账户余额／实际费用未查询，记为 unavailable；token 数不等同于费用。
- canonical state 共 48 个事件：1 `started`、6 `driver.call`、20 个 tool started/result 配对、1 `checkpoint`。工具为 19 次同源 `http.request`、1 次 `workspace.list`；没有 `candidate.register`、候选验证、oracle 拒绝/接受或 partial 事件。
- 实际观察：根页面与 `/audit` 均返回 200；GraphQL introspection 成功，`users` 返回用户名但密码被遮蔽；`systemHealth` 与 `systemUpdate` 返回响应；公开及非公开 paste 查询返回数据；尝试的登录凭据失败，GraphQL 字段冲突查询返回 400。run 在继续枚举 GraphQL 行为时耗尽 token 预算，未得到解法或最终诊断。

## 对轨迹③–⑥的信号

本次没有自然出现长作业释放/续跑（③）、新 session 或 compaction 后恢复（④）、本地验证通过后被 oracle 拒绝并诊断改做（⑤）、或 partial 后继续剩余 slot（⑥）。这是因为本次没有候选或 oracle，且 run 在探索阶段耗尽 token；不能据此判断产品是否具备这些能力，也不改变四条轨迹的 fixture/取证设计。按计划停止，不自动重试；若要继续本题侦察，需用户另行授权。

## 证据定位

- canonical SQLite 与原始 HTTP 响应 artifacts：本目录的 [`run-1/`](run-1/)。
- SQLite SHA-256：`7297b95529c405cb34060c04fada5553b6ce74cd9a5108284db43574e699f04b`。
- CLI 汇总输出记录的模型答复为空，候选为 null；没有把模型自述或 HTTP 200 当作成功判据。
