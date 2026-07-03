# Shannon 全貌分析

## 项目定位

Shannon 是一个自主白盒 AI 渗透测试工具，面向 Web 应用和 API。它的核心工作方式是：

1. 读取源码。
2. 识别攻击路径。
3. 运行目标应用。
4. 用浏览器和命令行工具执行真实 exploit。
5. 只在最终报告中写入可证明漏洞。

它比 `code-audit-main` 和 DeepAudit 更偏动态渗透测试，特别强调“不是猜测，而是利用成功后报告”。

## 目录结构

| 目录 | 作用 |
|---|---|
| `apps/cli/` | CLI 命令，setup/start/status/logs/workspaces 等 |
| `apps/worker/` | 核心 worker，Agent 执行、Temporal 工作流、Prompt、报告、容器 |
| `apps/worker/prompts/` | pre-recon、recon、vuln、exploit、report 等 prompt |
| `apps/worker/src/temporal/` | Temporal workflow、activities、checkpoint、summary |
| `apps/worker/src/services/` | Agent 执行、配置、容器、preflight、reporting、authentication validation |
| `apps/worker/src/mcp-server/` | recon/vuln/exploit collector |
| `docs/` | 配置、AI provider、安全、workspace、coverage roadmaps |
| `sample-reports/` | Juice Shop、crAPI 等报告样例 |

## 能力范围

README 描述的重点能力：

- 源码辅助的攻击规划。
- 浏览器自动化和命令行工具执行真实 exploit。
- 已认证测试，支持登录流程、凭证、TOTP、邮件登录、规则约束。
- OWASP 风险聚焦：Injection、XSS、SSRF、Broken Authentication、Broken Authorization。
- 可恢复 workspace。
- 本地 Docker worker 执行。
- 最终报告只包含可复现 PoC 的漏洞。

## 与本项目目标的契合点

用户希望我们的 Agent：

- 输入测试项目代码。
- 输入架构文档、账号、权限信息。
- 白盒检查代码漏洞。
- 扫描 API 列表。
- 通过浏览器全量访问测试网页。
- 输出渗透测试报告和漏报反馈。

Shannon 正好覆盖了其中“源码 + 运行应用 + 浏览器/命令行真实利用 + 可恢复 workspace + 报告”的主线。

## 局限

- 开源版聚焦固定几类漏洞：Injection、XSS、SSRF、Authentication、Authorization。
- 更偏 Web/API；供应链、配置、云、移动等不是开源版主线。
- 依赖 Temporal、Docker、Node/TS worker，工程复杂度较高。
- 需要运行目标应用，无法替代纯白盒审计。

## 对本项目的定位

Shannon 应作为“动态验证流水线”参考：

- 白盒发现用于生成动态测试任务。
- 浏览器和 API 运行结果用于证明漏洞。
- 报告以可复现证据为核心。
- workspace 支持断点恢复。
