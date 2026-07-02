# 子 Agent 与 Skill 深度填充 v1 实施计划

> **给 Agent 工作者：** 本计划用于把现有 Agent/Skill 文档补成可执行审计手册。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 填充所有子 Agent 与核心 skills 的具体执行内容，减少空洞描述。

**架构：** 沿用已有 Agent Contract、work queue、agent_result 和 round_evaluation 协议。每个子 Agent 只消费 contract，每个 Skill 说明具体审计路径和证据输出。

**技术栈：** Markdown、JSON artifact 协议、Python 测试入口。

---

### 任务 1：子 Agent 文档

**文件：**
- 修改：`pentest-agent-harness/agents/*.md`

- [ ] **步骤 1：补 intake/browser/playwright/report/feedback**

写明输入、执行步骤、输出 artifact、证据要求、失败条件。

- [ ] **步骤 2：复核 dispatcher/evaluation/static/frontend**

在已有 contract/coverage 内容基础上补充调用 skill 顺序和 agent_result 字段。

### 任务 2：核心 Skill 文档

**文件：**
- 修改：`pentest-agent-harness/skills/*/SKILL.md`

- [ ] **步骤 1：补白盒审计 skills**

重点补 `sink-driven-audit`、`taint-analysis`、`control-driven-audit`、`config-driven-audit`。

- [ ] **步骤 2：补前端/浏览器/API skills**

重点补 `frontend-static-audit`、`frontend-runtime-test`、`nextjs-ssr-audit`、`api-client-correlation`、`api-fuzzing-light`、`auth-session-testing`。

- [ ] **步骤 3：补验证/报告/反馈 skills**

重点补 `finding-verification`、`playwright-poc`、`report-template`、`feedback-distiller`、`regression-*`。

### 任务 3：验证与提交

- [ ] **步骤 1：运行空壳检查**

运行：`rg -n "旧模板标记|占位描述" pentest-agent-harness/skills`

预期：不再出现通用空壳模式。

- [ ] **步骤 2：运行测试**

运行：`python3 pentest-agent-harness/tests/run_all.py`

预期：所有测试通过。

- [ ] **步骤 3：提交并推送**

运行：`git add docs/superpowers/specs/2026-07-02-agent-skill-depth-v1-design.md docs/superpowers/plans/2026-07-02-agent-skill-depth-v1.md pentest-agent-harness && git commit -m "docs: deepen agents and skills" && git push origin main`
