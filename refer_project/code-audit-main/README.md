# code-audit-main 参考项目分析索引

本目录用于沉淀 `参考项目/code-audit-main` 的分析资料，目标不是复述开源项目文档，而是提炼可迁移到本项目灰白盒渗透测试 Agent 的工程经验。

## 分析文件

- `00-overview.md`: 全貌浏览，说明项目定位、目录分层、核心能力与运行入口。
- `01-architecture-and-orchestration.md`: 架构与多 Agent 编排分析，重点拆解状态机、Agent Contract、并发协调、跨轮补漏和报告门控。
- `02-module-implementation-map.md`: 模块实现地图，按 `core`、`checklists`、`languages`、`frameworks`、`security`、`adapters`、`wooyun`、`reporting` 归纳每类模块的作用和实现方式。
- `03-lessons-for-pentest-agent.md`: 对本项目的迁移建议，给出从 MVP 到迭代版本再到最终模板的落地路线。

## 关键结论

`code-audit-main` 的核心价值不在于某个漏洞清单，而在于它把代码审计拆成了可执行的控制面：

1. `SKILL.md` 是外层执行控制器，规定模式选择、加载规则、侦察输出、计划暂停和报告门控。
2. `agent.md` 是深度模式的权威状态机，规定 Phase 1 侦察、R1/R2/R3 多轮 Agent 执行、覆盖率评估和最终报告条件。
3. `references/` 是按运行时职责分层的知识库，不是散装资料；其中 `core` 给方法论，`checklists` 给覆盖矩阵，`adapters` 把通用安全控制映射到语言/框架检测模式。
4. 多 Agent 的协作不是“多开几个审计员”，而是通过搜索路径、排除目录、审计策略、工具预算、输出模板、跨轮传递结构来强约束。
5. 对本项目最值得迁移的是：攻击面地图、端点-权限矩阵、三轨审计策略、覆盖率门控、R2 增量补漏、结构化 Agent 输出、截断恢复和报告前置条件。
