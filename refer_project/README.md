# 参考项目分析索引

本目录用于沉淀 `参考项目/` 下开源项目的分析资料，服务目标是：为灰白盒渗透测试 Agent 的架构、子 Agent、skills、运行编排、断点续跑、反馈进化和最终模板设计提供可复用经验。

## 项目索引

| 参考项目 | 定位 | 最值得学习的部分 |
|---|---|---|
| `code-audit-main` | Claude Code 白盒代码审计 skill | 状态机、D1-D10 覆盖矩阵、三轨审计、Agent Contract、R2 补漏 |
| `DeepAudit-3.0.0` | 完整前后端 Multi-Agent 代码审计平台 | FastAPI 后端、Agent 树、TaskHandoff、状态持久化、沙箱 PoC 验证、前端审计流 |
| `security-skill-distiller-master` | 安全资料到 pentest harness 的蒸馏器 | 素材解析、维度映射、Agent/Skill/Phase 模板生成、自适应权重 |
| `shannon-main` | 白盒 + 动态利用的 AI Pentester | Temporal 流水线、vuln→exploit 并发管线、认证验证、workspace resume、proof-by-exploitation |
| `strix-main` | CLI 形态的 AI hacker runtime | root/child agent graph、沙箱、proxy/browser/tooling skills、会话恢复、CI/CD 集成 |

## 横向结论

这些项目可以分成四类经验：

1. **审计方法论**：`code-audit-main` 把漏洞类型拆成 sink-driven、control-driven、config-driven 三类，并用覆盖矩阵做报告门控。
2. **产品化运行时**：`DeepAudit-3.0.0` 展示了如何把 Agent、事件流、状态、数据库、前端日志、沙箱验证组合成平台。
3. **知识蒸馏与模板生成**：`security-skill-distiller-master` 展示了如何从漏洞历史、设计文档、攻击模式表生成可执行 harness。
4. **动态验证与工程编排**：`shannon-main` 和 `strix-main` 展示了白盒源码分析如何连接浏览器、代理、容器、真实 PoC 和可恢复工作区。

对本项目的最终建议：不要选择单一项目照搬，而是组合它们的强项：

- 用 `code-audit-main` 的三轨审计和覆盖矩阵定义质量门槛。
- 用 `DeepAudit` 的 Agent 状态、TaskHandoff、事件流和沙箱验证构建平台骨架。
- 用 `security-skill-distiller` 的蒸馏器生成项目专属 agents/skills。
- 用 `Shannon` 的 Temporal 式阶段流水线组织白盒到动态利用。
- 用 `Strix` 的工具型 runtime 支撑浏览器、代理、终端、技能动态加载和 CI/CD。
