# strix-main 参考项目分析索引

`strix-main` 是一个 CLI 形态的 AI hacker runtime。它把 root agent、动态子 agent、技能加载、浏览器、代理、终端、沙箱、报告、TUI、会话恢复和 CI/CD 集成做成一个统一工具。

## 分析文件

- `00-overview.md`: 项目定位、目录结构和能力范围。
- `01-architecture-and-runtime.md`: root/child agent graph、skills、tools、sandbox、session/resume。
- `02-lessons-for-pentest-agent.md`: 对本项目工具系统、skill 结构和 CLI runtime 的迁移建议。

## 关键结论

Strix 最值得学习的是“工具型 Agent runtime”：Agent 不是只会读代码，而是有 browser、proxy、terminal、notes、todo、reporting、load_skill、agent graph 等工具。它对我们要做“可在 opencode/codex 中使用”的渗透测试 Agent 很有参考价值。
