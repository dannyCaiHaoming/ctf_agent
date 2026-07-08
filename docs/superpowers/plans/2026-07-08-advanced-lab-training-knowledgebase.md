# Advanced Lab Training Knowledgebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入高于 Juice-Shop 难度的训练靶场 catalog、方法论知识库、训练计划/结果/经验蒸馏工具，并把经验固化为通用 Skill 候选而不是靶场专用解法。

**Architecture:** 继续采用本项目文件化 artifact 架构：`labs/catalog.json` 登记训练目标，`knowledge/sources/*.json` 保存可检索知识源，`tools/build_training_plan.py`、`tools/record_training_outcome.py`、`tools/distill_training_lessons.py` 串起训练闭环。Skill 文档只沉淀通用能力，所有靶场专用答案保留在 outcome 中并由蒸馏工具拒绝进入 backlog。

**Tech Stack:** Python 3 标准库、JSON、Markdown、现有直接运行式 Python 测试、`check_agent_skill_docs.py` 质量门禁。

## Global Constraints

- 只引入高于 Juice-Shop 难度或复杂度的训练目标，不新增 DVWA/WebGoat 等入门靶场。
- Juice-Shop 保留为历史回归基线，不计入本轮三靶场训练目标。
- 不下载、启动或攻击外部目标；本轮只建立训练目录、知识库和训练闭环工具。
- 训练经验进入 Skill 前必须泛化，禁止保存具体题目答案、flag、固定 token、固定 challenge endpoint。
- 高风险 payload 必须按 `read_only`、`low_risk_validation`、`confirmation_required`、`forbidden` 分级。
- 所有新增文档默认中文。

---

## Task 1: Lab Catalog 与高难度靶场 Profile

**Files:**
- Create: `pentest-agent-harness/tests/test_lab_training_catalog.py`
- Create: `pentest-agent-harness/labs/catalog.json`
- Create: `pentest-agent-harness/labs/crapi/lab_profile.json`
- Create: `pentest-agent-harness/labs/crapi/scope.json`
- Create: `pentest-agent-harness/labs/crapi/expected_capabilities.json`
- Create: `pentest-agent-harness/labs/dvga/lab_profile.json`
- Create: `pentest-agent-harness/labs/dvga/scope.json`
- Create: `pentest-agent-harness/labs/dvga/expected_capabilities.json`
- Create: `pentest-agent-harness/labs/portswigger-academy/lab_profile.json`
- Create: `pentest-agent-harness/labs/portswigger-academy/scope.json`
- Create: `pentest-agent-harness/labs/portswigger-academy/expected_capabilities.json`

**Interfaces:**
- Produces: catalog entry fields `lab_id/name/difficulty_tier/baseline_comparison/source_url/local_only/training_focus/knowledge_sources/expected_skill_targets/forbidden_actions`
- Produces: per-lab `expected_capabilities.json` fields `capabilities[]` and `success_criteria[]`

- [ ] 写失败测试：catalog 必须包含 `crapi`、`dvga`、`portswigger-academy`，不能包含 `dvwa`、`webgoat`，每个 lab 的 `baseline_comparison` 必须是 `above_juice_shop`。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_lab_training_catalog.py`，确认缺少 catalog 时失败。
- [ ] 创建 catalog 和三个 lab profile/scope/capabilities。
- [ ] 重新运行测试确认通过。

## Task 2: Knowledge Sources

**Files:**
- Create: `pentest-agent-harness/tests/test_knowledge_sources.py`
- Create: `pentest-agent-harness/knowledge/sources/owasp-wstg.json`
- Create: `pentest-agent-harness/knowledge/sources/owasp-asvs.json`
- Create: `pentest-agent-harness/knowledge/sources/owasp-api-top10-2023.json`
- Create: `pentest-agent-harness/knowledge/sources/cwe-top25.json`

**Interfaces:**
- Produces: source fields `source_id/name/source_url/version_hint/retrieved_at/applies_to/categories/mappings`

- [ ] 写失败测试：四个 knowledge sources 必须有来源 URL、版本提示、适用能力和映射类别。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_knowledge_sources.py`，确认缺少 sources 时失败。
- [ ] 创建四个知识源 JSON。
- [ ] 重新运行测试确认通过。

## Task 3: Training Plan Builder

**Files:**
- Create: `pentest-agent-harness/tests/test_training_plan.py`
- Create: `pentest-agent-harness/tools/build_training_plan.py`

**Interfaces:**
- Consumes: `labs/catalog.json`、`labs/<lab>/lab_profile.json`、`labs/<lab>/expected_capabilities.json`、`knowledge/sources/*.json`
- Produces: `artifacts/training-agent/training_plan.json`

- [ ] 写失败测试：crAPI 必须映射到 API Top 10 和 `api-object-authorization-analysis`；DVGA 必须映射到 `graphql-security-recon`；PortSwigger 必须映射到黑盒假设管理。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_plan.py`，确认工具不存在时失败。
- [ ] 实现 `build_training_plan.py <run_dir> --lab <lab_id> --harness-root <root>`。
- [ ] 重新运行测试确认通过。

## Task 4: Training Outcome Recorder

**Files:**
- Create: `pentest-agent-harness/tests/test_training_outcome.py`
- Create: `pentest-agent-harness/tools/record_training_outcome.py`

**Interfaces:**
- Consumes: training plan、CLI outcome fields
- Produces: `artifacts/training-agent/training_outcome.json`

- [ ] 写失败测试：outcome 必须记录完成情况、失败模式、覆盖缺口、可泛化经验和靶场专用限制。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_outcome.py`，确认工具不存在时失败。
- [ ] 实现 outcome recorder，并对敏感/专用字段执行结构化标记。
- [ ] 重新运行测试确认通过。

## Task 5: Lesson Distiller

**Files:**
- Create: `pentest-agent-harness/tests/test_training_lesson_distiller.py`
- Create: `pentest-agent-harness/tools/distill_training_lessons.py`
- Create: `pentest-agent-harness/knowledge/training_lessons.json`
- Create: `pentest-agent-harness/knowledge/skill_improvement_backlog.json`

**Interfaces:**
- Consumes: `artifacts/training-agent/training_outcome.json`
- Produces: `knowledge/training_lessons.json`
- Produces: `knowledge/skill_improvement_backlog.json`

- [ ] 写失败测试：含 `flag`、`challenge`、固定答案或靶场专用 endpoint 的 lesson 必须被拒绝进入 skill backlog。
- [ ] 写失败测试：通用 lesson 必须进入 backlog，并保留 source lab、knowledge refs、泛化理由和 skill target。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_lesson_distiller.py`，确认工具不存在时失败。
- [ ] 实现 distiller 和靶场绑定检测。
- [ ] 重新运行测试确认通过。

## Task 6: 通用 Skills 与文档约束

**Files:**
- Create: `pentest-agent-harness/skills/lab-training-loop/SKILL.md`
- Create: `pentest-agent-harness/skills/knowledge-grounded-strategy/SKILL.md`
- Create: `pentest-agent-harness/skills/graphql-security-recon/SKILL.md`
- Create: `pentest-agent-harness/skills/api-object-authorization-analysis/SKILL.md`
- Create: `pentest-agent-harness/skills/lesson-to-skill-distillation/SKILL.md`
- Modify: `pentest-agent-harness/AGENT.md`
- Modify: `pentest-agent-harness/README.md`
- Test: `pentest-agent-harness/tests/test_agent_skill_doc_quality.py`

**Interfaces:**
- Produces: 每个 skill 包含输入、执行步骤、检测模式、覆盖指标、输出、R2 规则和禁止项。

- [ ] 新增五个 Skill 文档，内容必须是通用能力，不包含靶场专用答案。
- [ ] 修改 `AGENT.md` 和 `README.md`，说明训练闭环和知识库使用方式。
- [ ] 运行 `python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness`。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_no_lab_binding_in_core_agent_skills.py`。

## Final Verification

- [ ] 运行 `python3 pentest-agent-harness/tests/test_lab_training_catalog.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_knowledge_sources.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_plan.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_outcome.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_training_lesson_distiller.py`
- [ ] 运行 `python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness`
- [ ] 运行 `python3 pentest-agent-harness/tests/run_all.py`
