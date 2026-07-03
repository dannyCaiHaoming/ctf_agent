# security-skill-distiller-master 全貌分析

## 项目定位

`pentest-distiller` 是一个安全知识蒸馏器。它的输入是漏洞历史、架构/设计文档、攻击模式表；输出是可被 opencode 加载执行的渗透测试 harness 工程。

它解决的问题是：安全团队有很多文档，但文档不会自动驱动测试。Distiller 把这些文档转成：

- 配置文件。
- Agent。
- Skill。
- Phase。
- References。
- 工具脚本。
- 报告输出结构。

## 输入素材

| 素材 | 目录 | 作用 |
|---|---|---|
| 漏洞历史 | `artifacts/vulnerability-history/` | 识别高频漏洞维度、生成历史漏洞 Agent、影响权重 |
| 设计文档 | `artifacts/design-docs/` | 提取攻击面、技术栈、价值资产、控制点 |
| 攻击模式表 | `artifacts/attack-patterns/` | 生成黑盒/白盒测试步骤和 payload 思路 |

项目设计了素材缺失时的降级策略：即使素材不完整，也生成基线 Agent，不中断流程。

## 输出 harness

生成的 harness 结构大致为：

```text
{product}-pentest-harness/
  AGENT.md
  opencode.json
  references/
  .opencode/
    agents/
    skills/
    phases/
    config/
    tools/
    artifacts/
```

这和本项目目标非常接近：最终不是一份静态文档，而是可执行工程模板。

## 核心特性

| 特性 | 作用 |
|---|---|
| 素材检查 | 启动时检查漏洞历史、设计文档、攻击模式表 |
| 容错降级 | 缺失素材时仍生成 D1-D15 基线 Agent |
| 阶段化解析 | 素材解析、输出验证、知识分类、harness 生成 |
| D 维度映射 | 把漏洞和攻击模式映射到 D1-D15 |
| 自适应权重 | 根据历史漏洞数量给维度 `++`、`+`、`default` |
| 通用 Phase | 6 个 PTES 风格阶段供所有 Agent 共用 |
| Skill 复制 | 复制固定 skill skeleton 到生成工程 |
| References 复制 | 复制 100+ 安全知识文档 |

## 与 code-audit-main 的关系

`security-skill-distiller` 显然复用了大量 `code-audit-main` 的 reference 内容，但它进一步增加了“生成器”：

- `code-audit-main`: 给一个可执行审计 skill。
- `security-skill-distiller`: 读取资料后生成项目专属 harness。

对本项目来说，这说明我们不应只维护通用 Agent，还应支持“项目专属 Agent/Skill 生成”。
