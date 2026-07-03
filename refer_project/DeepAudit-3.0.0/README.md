# DeepAudit-3.0.0 参考项目分析索引

`DeepAudit-3.0.0` 是一个完整的 AI 代码安全审计平台，包含 FastAPI 后端、React 前端、数据库模型、LLM 适配器、RAG、Multi-Agent 编排、事件流、状态持久化、Docker 沙箱和报告生成。

## 分析文件

- `00-overview.md`: 项目全貌、目录结构和核心能力。
- `01-architecture-and-orchestration.md`: Multi-Agent 架构、Agent 树、TaskHandoff、状态/断点和沙箱验证。
- `02-lessons-for-pentest-agent.md`: 对本项目灰白盒渗透测试 Agent 的迁移建议。

## 关键结论

DeepAudit 最值得学习的是“平台化”：它不是只给 agent 写提示词，而是把 Agent 运行、事件、状态、配置、工具、前端展示和数据库持久化都做成系统组件。对本项目来说，它可以作为产品后端和多 Agent 控制面的参考。
