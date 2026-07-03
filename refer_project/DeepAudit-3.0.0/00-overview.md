# DeepAudit-3.0.0 全貌分析

## 项目定位

`DeepAudit-3.0.0` 是一个基于 Multi-Agent 协作的代码安全审计平台。它的目标不是单纯静态扫描，而是通过 Orchestrator、Recon、Analysis、Verification 等 Agent 形成自动化审计闭环：

1. 导入项目。
2. 识别技术栈和攻击面。
3. 深度代码审计。
4. 生成 PoC。
5. 在沙箱中验证。
6. 输出报告。

它和 `code-audit-main` 的差异在于：`code-audit-main` 更像一个可被 Codex/Claude 加载的审计 skill；DeepAudit 更像一个完整 Web 产品和后端运行平台。

## 顶层结构

| 目录 | 作用 | 对本项目的启发 |
|---|---|---|
| `backend/` | FastAPI 后端、Agent 运行时、RAG、LLM、数据库、API | 可参考后端服务化架构 |
| `frontend/` | React/TypeScript 前端，展示项目、任务、审计流、报告 | 可参考审计过程可视化 |
| `rules/` | 审计规则和安全规则 | 可沉淀为本项目 references/adapters |
| `docker/` | Docker 运行配置 | 可参考沙箱与部署隔离 |
| `docs/` | 使用与设计文档 | 可参考产品化说明 |
| `supabase/` | 数据库/服务配置 | 可参考项目管理和存储 |

## 后端模块

| 模块 | 作用 |
|---|---|
| `app/api/v1/endpoints/` | 项目、任务、扫描、规则、Prompt、用户、SSH key 等 API |
| `app/models/` | SQLAlchemy 模型，包括项目、审计任务、Agent 任务、规则、用户 |
| `app/services/agent/agents/` | Orchestrator、Recon、Analysis、Verification 等 Agent |
| `app/services/agent/core/` | 状态、执行器、注册表、图控制、持久化、熔断、重试、限流 |
| `app/services/agent/tools/` | 文件、代码分析、RAG、Kunlun、沙箱、报告、finish、thinking 等工具 |
| `app/services/agent/knowledge/` | 框架知识、漏洞知识、RAG knowledge loader |
| `app/services/llm/` | 多 LLM provider 适配、prompt cache、tokenizer、memory compressor |
| `app/services/rag/` | embedding、indexer、retriever、splitter |
| `app/services/report_generator.py` | 报告生成 |
| `tests/` | Agent、工具、API、状态、持久化等测试 |

## Agent 分类

DeepAudit 的主要 Agent 类型：

| Agent | 职责 |
|---|---|
| Orchestrator | 审计大脑，动态决定调度 recon/analysis/verification |
| Recon | 项目结构、技术栈、入口点和攻击面识别 |
| Analysis | 代码审计和漏洞发现 |
| Verification | PoC 生成和沙箱验证 |

与 `code-audit-main` 相比，DeepAudit 的 Agent 更偏“运行时对象”，不是纯文档角色。它有基类、状态、事件、工具、handoff、消息总线、取消和持久化。

## 工程优点

- 有完整 Web 产品形态，适合学习平台化。
- Agent 不是散装 prompt，而是类、状态、结果、事件和工具的组合。
- `TaskHandoff` 提供结构化跨 Agent 交接。
- 有 checkpoint、Agent tree node、状态持久化和数据库表设计。
- 有沙箱 PoC 验证思路，能降低误报。
- 有 LLM provider 抽象，便于支持本地模型和云模型。
- 有 RAG 与知识库模块，便于把安全知识动态注入。

## 局限

- Orchestrator 很依赖 LLM 自主决策，硬门控和覆盖矩阵不如 `code-audit-main` 明确。
- 子 Agent 粒度较粗，主要是 recon/analysis/verification，不如 D1-D10 或漏洞类型 Agent 易于并行覆盖。
- 动态浏览器/代理渗透测试不是主线，更多是代码审计和沙箱验证。
- 产品模块较重，如果直接照搬会增加本项目复杂度。

## 对本项目的定位

DeepAudit 适合作为“产品化运行时”参考，而不是作为 skill 文档参考。我们可以迁移它的：

- Agent 状态对象。
- Agent registry。
- TaskHandoff。
- checkpoint 表。
- 事件流和前端审计日志。
- LLM provider 抽象。
- 沙箱验证。

同时保留 `code-audit-main` 的覆盖矩阵和三轨审计作为质量门槛。
