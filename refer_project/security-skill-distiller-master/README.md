# security-skill-distiller-master 参考项目分析索引

`security-skill-distiller-master` 的核心是 `pentest-distiller`：把漏洞历史、设计文档、攻击模式表等静态安全素材蒸馏成可执行的 pentest harness 工程。

## 分析文件

- `00-overview.md`: 项目定位、输入输出和生成结果。
- `01-architecture-and-generation.md`: 蒸馏流程、模板生成、D1-D15 Agent、skills 和 phases。
- `02-lessons-for-pentest-agent.md`: 对本项目知识进化、漏报反馈和模板生成的迁移建议。

## 关键结论

这个项目最值得学习的是“从资料到工程”的转换链路：资料不是只放进知识库，而是被解析成配置、权重、Agent、Skill、Phase、References 和工具。它正好对应你希望 Agent 能“依据用户输入文档学习、依据靶场反馈继续进化”的目标。
