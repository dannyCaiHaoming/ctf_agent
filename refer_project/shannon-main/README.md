# shannon-main 参考项目分析索引

`shannon-main` 是一个白盒 AI Pentester。它读取源码，结合运行中的 Web 应用/API，通过浏览器和命令行工具执行真实利用，最终只报告可证明的漏洞。

## 分析文件

- `00-overview.md`: 项目定位、目录结构、能力范围。
- `01-architecture-and-orchestration.md`: Temporal 流水线、vuln→exploit 并发管线、认证验证、resume。
- `02-lessons-for-pentest-agent.md`: 对本项目动态测试和证明式报告的迁移建议。

## 关键结论

Shannon 最值得学习的是“proof-by-exploitation”：白盒分析只是规划攻击，最终报告必须有动态利用证据。它对本项目的浏览器访问、API 动态验证、多账号认证、断点恢复和报告证据链很有参考价值。
