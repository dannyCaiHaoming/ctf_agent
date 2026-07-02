# 子 Agent 与 Skill 深度填充 v1 设计

## 背景

当前 harness 已具备 Recon、Agent Contract、work queue 和 R1/R2 evaluation 骨架，但多数子 Agent 与 Skill 仍是 40 行左右的通用模板。用户要求参考开源项目，把这些内容补成可以指导 Codex/opencode 执行的具体实现。

## 目标

- 所有子 Agent 明确：输入 contract、执行阶段、调用 skills、输出文件、证据门槛、失败条件。
- 核心 skills 明确：适用场景、输入 artifact、具体搜索/审计步骤、技术栈提示、输出 JSON/Markdown、误报过滤。
- 参考开源项目中的三类策略：`sink-driven`、`control-driven`、`config-driven`，以及 `coverage -> R2 focused retest` 收敛方式。
- 保持全部项目文档为中文，代码字段名和工具名保留英文。

## 范围

本轮修改 Agent/Skill/Reference 文档，不改 Python 调度器行为。调度器已经能生成 contract 和 R2 queue；本轮让子 Agent 和 Skill 有足够具体的执行内容去消费这些 contract。

## 验收

- 不再出现核心 Skill 只有通用“专项步骤”的空壳内容。
- `agents/*.md` 中的非 Recon Agent 也具备 contract 消费、产物路径和证据要求。
- `python3 pentest-agent-harness/tests/run_all.py` 通过。
- 工作区变更提交并推送。
