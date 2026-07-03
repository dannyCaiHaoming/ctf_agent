# Strix 全貌分析

## 项目定位

Strix 是一个开源 AI hacker 工具，目标是运行代码、发现漏洞、生成 PoC、输出报告，并支持 CLI/CI/CD。

它的核心能力：

- 多 Agent 团队协作。
- 沙箱运行目标。
- 浏览器自动化。
- HTTP proxy。
- 终端和 Python runtime。
- skill 动态加载。
- finding/report 工具。
- agent graph。
- 会话恢复。

## 目录结构

| 目录 | 作用 |
|---|---|
| `strix/core/` | runner、execution、inputs、sessions、agent coordination |
| `strix/agents/` | agent factory、prompt 渲染、system prompt |
| `strix/tools/` | browser/proxy/reporting/notes/todo/finish/load_skill/shell 等工具 |
| `strix/skills/` | 漏洞、框架、协议、云、工具、扫描模式 skills |
| `strix/runtime/` | Docker/session manager/caido bootstrap |
| `strix/report/` | dedupe、state、usage、writer |
| `strix/interface/` | CLI 和 TUI |
| `docs/` | 使用、配置、scan modes、tools、LLM providers、CI/CD |
| `tests/` | execution、hooks、local sources、session entries |

## Skill 分类

`strix/skills/README.md` 定义了技能类别：

| 类别 | 示例 |
|---|---|
| vulnerabilities | JWT、IDOR、SQLi、SSRF、XSS、Race、Business Logic |
| frameworks | FastAPI、NestJS、Next.js |
| technologies | Supabase、Firebase/Firestore |
| protocols | GraphQL |
| tooling | nmap、nuclei、httpx、ffuf、katana、sqlmap、semgrep |
| cloud | Kubernetes |
| coordination | root_agent、source_aware_whitebox |
| scan_modes | quick、standard、deep |

这说明 Strix 把 skill 分成了“漏洞知识”和“工具 playbook”两类，后者对真实渗透测试很关键。

## 工具系统

Strix agent factory 注入了大量工具：

- agent graph：create_agent、send_message_to_agent、wait_for_message、view_agent_graph、stop_agent。
- finish：finish_scan。
- load_skill：动态加载技能。
- notes/todo：长期记录和任务管理。
- proxy：list_requests、view_request、repeat_request、sitemap。
- reporting：create_vulnerability_report。
- shell/filesystem：沙箱文件系统和终端。
- web_search：外部信息搜索。

对本项目来说，这比“Agent 角色文档”更重要：灰白盒渗透测试 Agent 必须有工具箱。

## 运行模式

Strix 支持：

- local codebase whitebox。
- GitHub repo。
- blackbox web target。
- greybox authenticated testing。
- 多 target。
- scan-mode quick/standard/deep。
- non-interactive CI 模式。
- PR diff scope。

这与我们“能在 opencode、codex 中使用”的目标相符：既要命令行可运行，也要作为 agent skill 可嵌入。

## 局限

- 更偏通用 runtime，具体审计质量依赖 skills 和模型执行。
- 开源项目中 skill 多为 playbook，覆盖矩阵和报告门控不如 `code-audit-main` 严格。
- 复杂工具和沙箱集成会增加本项目实施成本。

## 对本项目的定位

Strix 适合作为“CLI runtime + 工具系统 + skill 组织方式”的参考。它可以补齐我们项目中的：

- browser/proxy 工具。
- agent graph。
- notes/todo。
- dynamic skill loading。
- run/resume。
- CI/CD 非交互模式。
