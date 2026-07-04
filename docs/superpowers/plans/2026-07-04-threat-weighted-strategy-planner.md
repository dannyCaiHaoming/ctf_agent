# Threat-Weighted Strategy Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `strategy-planner-agent`，把 recon 威胁模型与规则映射按 60/40 权重生成可执行渗透测试策略队列、攻击假设和 recon gap，并让 dispatcher 优先消费策略队列。

**Architecture:** 新增 strategy 层位于 `recon-agent` 与 `dispatcher-agent` 之间。工具 `build_strategy_plan.py` 读取 recon artifacts，输出 `pentest_strategy_queue.json`、`attack_hypotheses.json`、`strategy_coverage.json`；`build_agent_contracts.py` 检测到策略队列时优先按 strategy tasks 分组生成 contracts，缺省时保留旧 recon queue 行为。

**Tech Stack:** Python 3 标准库、现有轻量 JSON schema 校验器、现有脚本式测试框架、Markdown Agent/Skill 文档。

---

## 文件结构

- Create: `pentest-agent-harness/agents/strategy-planner-agent.md`
  - 描述 strategy planner 的职责、输入、输出、安全限制和失败条件。
- Create: `pentest-agent-harness/skills/threat-weighted-strategy/SKILL.md`
  - 描述 60/40 评分、STRIDE+规则映射、任务生成和 recon gap 回流。
- Create: `pentest-agent-harness/schemas/pentest_strategy_queue.schema.json`
  - 策略任务队列 schema。
- Create: `pentest-agent-harness/schemas/attack_hypotheses.schema.json`
  - 攻击假设 schema。
- Create: `pentest-agent-harness/schemas/strategy_coverage.schema.json`
  - strategy coverage 和 recon gap schema。
- Create: `pentest-agent-harness/tools/build_strategy_plan.py`
  - 从 recon artifacts 生成三个 strategy artifacts。
- Modify: `pentest-agent-harness/tools/build_agent_contracts.py`
  - 如果 strategy queue 存在，优先按 strategy tasks 生成 contracts。
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`
  - 新增三个 schema 的最小有效样例。
- Create: `pentest-agent-harness/tests/test_strategy_planner.py`
  - 覆盖评分、skill 映射、recon gap 和输出结构。
- Modify: `pentest-agent-harness/tests/test_agent_contracts.py`
  - 覆盖 dispatcher 优先消费 strategy queue，旧路径继续兼容。

## Task 1: 新增 Strategy Artifacts Schema

**Files:**
- Create: `pentest-agent-harness/schemas/pentest_strategy_queue.schema.json`
- Create: `pentest-agent-harness/schemas/attack_hypotheses.schema.json`
- Create: `pentest-agent-harness/schemas/strategy_coverage.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

在 `test_new_mvp_closure_schemas_accept_minimal_objects` 的 `fixtures` 字典中加入：

```python
        "pentest_strategy_queue.schema.json": {
            "round": "R1",
            "strategy": "threat-weighted",
            "weights": {"threat": 0.6, "rule": 0.4},
            "items": [
                {
                    "task_id": "PT-R1-001",
                    "round": "R1",
                    "target_agent": "browser-pentest-agent",
                    "skills": ["authorization-control"],
                    "source_threat_ids": ["TH-001"],
                    "source_rule_ids": ["RULE-IDOR-RESOURCE-ID"],
                    "target": {"entrypoint_id": "EP-001", "asset": "order"},
                    "threat_score": 80,
                    "rule_score": 70,
                    "attention_score": 76,
                    "priority": "P1",
                    "hypothesis_id": "HYP-001",
                    "hypothesis": "资源归属校验可能缺失",
                    "why_this_matters": "该入口跨越用户资源边界",
                    "required_roles": ["owner", "other_user"],
                    "required_evidence": ["两个角色", "资源 ID", "请求响应"],
                    "safety_limits": ["只读请求"],
                    "stop_conditions": ["账号缺失"],
                    "blocked_root_causes": ["browser.account_missing"],
                }
            ],
            "summary": {"total": 1, "p0": 0, "p1": 1, "p2": 0, "p3": 0, "recon_gaps": 0},
        },
        "attack_hypotheses.schema.json": {
            "hypotheses": [
                {
                    "hypothesis_id": "HYP-001",
                    "status": "planned",
                    "source_threat_ids": ["TH-001"],
                    "source_rule_ids": ["RULE-IDOR-RESOURCE-ID"],
                    "entrypoints": ["EP-001"],
                    "assets": ["order"],
                    "trust_boundaries": ["TB-001"],
                    "attacker": "authenticated_user",
                    "possible_weaknesses": ["IDOR"],
                    "required_evidence": ["两个角色"],
                    "linked_strategy_tasks": ["PT-R1-001"],
                }
            ],
        },
        "strategy_coverage.schema.json": {
            "status": "partial",
            "checked_threats": 1,
            "planned_tasks": 1,
            "gaps": [
                {
                    "gap_id": "STRAT-GAP-001",
                    "type": "threat_model_missing_boundary",
                    "required_by": "authorization-control",
                    "source_threat_id": "TH-002",
                    "message": "威胁缺少边界",
                    "send_back_to": "recon-agent",
                    "recommended_recon_fix": "补充 boundary_id",
                }
            ],
        },
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: FAIL，错误包含 `cannot read pentest_strategy_queue.schema.json`。

- [ ] **Step 3: 新增 schema 文件**

Create `pentest-agent-harness/schemas/pentest_strategy_queue.schema.json`:

```json
{
  "type": "object",
  "required": ["round", "strategy", "weights", "items", "summary"],
  "properties": {
    "round": {"type": "string"},
    "strategy": {"type": "string"},
    "weights": {"type": "object"},
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["task_id", "round", "target_agent", "skills", "source_threat_ids", "source_rule_ids", "target", "threat_score", "rule_score", "attention_score", "priority", "hypothesis_id", "hypothesis", "why_this_matters", "required_roles", "required_evidence", "safety_limits", "stop_conditions", "blocked_root_causes"],
        "properties": {
          "task_id": {"type": "string"},
          "round": {"type": "string"},
          "target_agent": {"type": "string"},
          "skills": {"type": "array"},
          "source_threat_ids": {"type": "array"},
          "source_rule_ids": {"type": "array"},
          "target": {"type": "object"},
          "threat_score": {"type": "number"},
          "rule_score": {"type": "number"},
          "attention_score": {"type": "number"},
          "priority": {"type": "string"},
          "hypothesis_id": {"type": "string"},
          "hypothesis": {"type": "string"},
          "why_this_matters": {"type": "string"},
          "required_roles": {"type": "array"},
          "required_evidence": {"type": "array"},
          "safety_limits": {"type": "array"},
          "stop_conditions": {"type": "array"},
          "blocked_root_causes": {"type": "array"}
        }
      }
    },
    "summary": {"type": "object"}
  }
}
```

Create `pentest-agent-harness/schemas/attack_hypotheses.schema.json`:

```json
{
  "type": "object",
  "required": ["hypotheses"],
  "properties": {
    "hypotheses": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["hypothesis_id", "status", "source_threat_ids", "source_rule_ids", "entrypoints", "assets", "trust_boundaries", "attacker", "possible_weaknesses", "required_evidence", "linked_strategy_tasks"],
        "properties": {
          "hypothesis_id": {"type": "string"},
          "status": {"type": "string"},
          "source_threat_ids": {"type": "array"},
          "source_rule_ids": {"type": "array"},
          "entrypoints": {"type": "array"},
          "assets": {"type": "array"},
          "trust_boundaries": {"type": "array"},
          "attacker": {"type": "string"},
          "possible_weaknesses": {"type": "array"},
          "required_evidence": {"type": "array"},
          "linked_strategy_tasks": {"type": "array"}
        }
      }
    }
  }
}
```

Create `pentest-agent-harness/schemas/strategy_coverage.schema.json`:

```json
{
  "type": "object",
  "required": ["status", "checked_threats", "planned_tasks", "gaps"],
  "properties": {
    "status": {"type": "string"},
    "checked_threats": {"type": "number"},
    "planned_tasks": {"type": "number"},
    "gaps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["gap_id", "type", "required_by", "source_threat_id", "message", "send_back_to", "recommended_recon_fix"],
        "properties": {
          "gap_id": {"type": "string"},
          "type": {"type": "string"},
          "required_by": {"type": "string"},
          "source_threat_id": {"type": "string"},
          "message": {"type": "string"},
          "send_back_to": {"type": "string"},
          "recommended_recon_fix": {"type": "string"}
        }
      }
    }
  }
}
```

- [ ] **Step 4: 验证 schema 测试通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 1**

```bash
git add pentest-agent-harness/schemas/pentest_strategy_queue.schema.json \
  pentest-agent-harness/schemas/attack_hypotheses.schema.json \
  pentest-agent-harness/schemas/strategy_coverage.schema.json \
  pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: add strategy planner schemas"
```

## Task 2: 新增 Strategy Agent 与 Skill 文档

**Files:**
- Create: `pentest-agent-harness/agents/strategy-planner-agent.md`
- Create: `pentest-agent-harness/skills/threat-weighted-strategy/SKILL.md`

- [ ] **Step 1: 新增 Agent 文档**

Create `pentest-agent-harness/agents/strategy-planner-agent.md`:

```markdown
# strategy-planner-agent

职责：读取 recon 威胁模型和规则映射信号，生成后续渗透测试任务队列、攻击假设和 recon gap。它不执行测试，不产出 finding。

## 输入

- `scope.json`
- `artifacts/recon-agent/threat_model.json`
- `artifacts/recon-agent/attack_surface_boundaries.json`
- `artifacts/recon-agent/trust_boundaries.json`
- `artifacts/recon-agent/auth_matrix.json`
- `artifacts/recon-agent/source_sink_seed.json`
- `artifacts/recon-agent/high_risk_assets.json`
- `artifacts/recon-agent/entrypoints.json`
- `artifacts/recon-agent/api_inventory.json`
- 可选：`artifacts/recon-agent/frontend_routes.json`
- 可选：`artifacts/recon-agent/api_client_map.json`
- 可选：`artifacts/browser-pentest-agent/browser_workflow_inventory.json`
- 可选：`knowledge/missed_findings.md`

## 执行步骤

1. 调用 `threat-weighted-strategy` skill，读取威胁模型并校验关键字段。
2. 对每条威胁计算 `threat_score`。
3. 根据入口、source/sink/control、auth matrix、API client 和历史漏报计算 `rule_score`。
4. 按 `attention_score = threat_score * 0.6 + rule_score * 0.4` 排序。
5. 为每个有效威胁生成 `pentest_strategy_queue.json` item。
6. 为每个任务生成对应 `attack_hypotheses.json` hypothesis。
7. 对缺少 entrypoint、boundary、asset 或 skill 映射的威胁生成 `strategy_coverage.json` gap。
8. 写入 checkpoint。

## 输出文件

- `artifacts/strategy-planner-agent/pentest_strategy_queue.json`
- `artifacts/strategy-planner-agent/attack_hypotheses.json`
- `artifacts/strategy-planner-agent/strategy_coverage.json`
- `checkpoints/strategy-planner-agent.json`

## 安全限制

- 不生成超出 `scope.json` 的测试任务。
- 不直接执行浏览器、API、fuzz、PoC 或 payload。
- 不把缺少证据的威胁升级成高优先级任务。
- mutation 不允许时降级为静态检查、只读观察或 blocked。
- 不写入 token、cookie、密码、验证码或个人资料原文。
```

- [ ] **Step 2: 新增 Skill 文档**

Create `pentest-agent-harness/skills/threat-weighted-strategy/SKILL.md`:

```markdown
---
name: threat-weighted-strategy
description: 将 recon 威胁模型和规则映射按 60/40 权重转成可执行渗透测试策略队列。
---

# threat-weighted-strategy

## 目标

把 `threat_model.json` 中的威胁转换为后续 Agent 可执行的渗透测试任务，并用规则映射补漏。

## 输入

- `scope.json`
- `artifacts/recon-agent/threat_model.json`
- `artifacts/recon-agent/attack_surface_boundaries.json`
- `artifacts/recon-agent/trust_boundaries.json`
- `artifacts/recon-agent/auth_matrix.json`
- `artifacts/recon-agent/source_sink_seed.json`
- `artifacts/recon-agent/high_risk_assets.json`
- `artifacts/recon-agent/entrypoints.json`
- `artifacts/recon-agent/api_inventory.json`

## 评分规则

总分：

```text
attention_score = threat_score * 0.6 + rule_score * 0.4
```

priority：

- `P0`：80-100
- `P1`：60-79
- `P2`：40-59
- `P3`：0-39

## Skill 映射

- Spoofing：`auth-validation`、`auth-session-testing`
- Tampering：`authorization-control`、`safe-replay`、`api-fuzzing-light`
- Repudiation：`control-driven-audit`、`finding-verification`
- Information Disclosure：`recon-enumeration`、`runtime-api-capture`、`api-client-correlation`
- Denial of Service：`config-driven-audit`、`api-fuzzing-light` 的安全限速模式
- Elevation of Privilege：`authorization-control`、`auth-session-testing`、`control-driven-audit`

## 输出

- `artifacts/strategy-planner-agent/pentest_strategy_queue.json`
- `artifacts/strategy-planner-agent/attack_hypotheses.json`
- `artifacts/strategy-planner-agent/strategy_coverage.json`

## 失败条件

- 缺少 `scope.json` 时停止。
- 缺少 `threat_model.json` 时停止。
- 威胁缺少 entrypoint、boundary、asset 中任意两项时生成 recon gap。
- 目标超出 scope 时不生成执行任务。
- skill 映射为空时生成 strategy gap。
```

- [ ] **Step 3: 运行文档质量测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_agent_skill_doc_quality.py
python3 pentest-agent-harness/tests/test_no_lab_binding_in_core_agent_skills.py
```

Expected: PASS。

- [ ] **Step 4: 提交 Task 2**

```bash
git add pentest-agent-harness/agents/strategy-planner-agent.md \
  pentest-agent-harness/skills/threat-weighted-strategy/SKILL.md
git commit -m "docs: add threat weighted strategy agent"
```

## Task 3: 实现 Strategy Plan 生成工具

**Files:**
- Create: `pentest-agent-harness/tools/build_strategy_plan.py`
- Create: `pentest-agent-harness/tests/test_strategy_planner.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_strategy_planner.py` with tests that:

1. Seed `scope.json` and recon artifacts.
2. Run `build_strategy_plan.py`.
3. Assert outputs exist.
4. Assert IDOR-like threat creates a browser task with `authorization-control`.
5. Assert missing boundary creates recon gap.

Core assertions:

```python
assert task["target_agent"] == "browser-pentest-agent"
assert "authorization-control" in task["skills"]
assert task["threat_score"] > 0
assert task["rule_score"] > 0
assert task["attention_score"] == round(task["threat_score"] * 0.6 + task["rule_score"] * 0.4, 2)
assert coverage["gaps"][0]["send_back_to"] == "recon-agent"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_strategy_planner.py
```

Expected: FAIL，工具不存在。

- [ ] **Step 3: 实现工具结构**

Create `build_strategy_plan.py` with:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any

THREAT_WEIGHT = 0.6
RULE_WEIGHT = 0.4

class StrategyPlanError(ValueError):
    pass
```

Required helpers:

- `load_json_object(path: Path) -> dict[str, Any]`
- `optional_json_object(path: Path, default: dict[str, Any]) -> dict[str, Any]`
- `write_json(path: Path, payload: object) -> None`
- `priority_from_score(score: float) -> str`
- `threat_id(threat: dict[str, Any], index: int) -> str`
- `threat_score(threat, high_risk_assets, boundaries) -> int`
- `rule_matches(threat, entrypoints, source_sink_seed, auth_matrix, api_inventory) -> list[str]`
- `rule_score(rule_ids: list[str]) -> int`
- `skills_for(threat, rule_ids) -> list[str]`
- `target_agent_for(skills, threat) -> str`
- `gap_for(threat, index, reason) -> dict[str, Any]`
- `task_for(threat, index, scores, skills, rule_ids) -> dict[str, Any]`
- `hypothesis_for(task, threat) -> dict[str, Any]`

- [ ] **Step 4: 实现最低可用评分规则**

Minimum rules:

- threat priority `P0/Critical` gives +25
- threat priority `P1/High` gives +20
- threat with asset gives +15
- threat with boundary_id gives +15
- threat with evidence gives +15
- threat category `Elevation of Privilege` maps to `authorization-control`
- resource/id/ownership wording maps to `RULE-IDOR-RESOURCE-ID`
- source/sink seed with sources and sinks maps to `RULE-INJECTION-SOURCE-SINK`
- missing two of `entrypoint_id`、`boundary_id`、`asset` creates gap

- [ ] **Step 5: 写输出**

Tool writes:

```text
artifacts/strategy-planner-agent/pentest_strategy_queue.json
artifacts/strategy-planner-agent/attack_hypotheses.json
artifacts/strategy-planner-agent/strategy_coverage.json
checkpoints/strategy-planner-agent.json
```

- [ ] **Step 6: 运行 strategy 测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_strategy_planner.py
```

Expected: PASS。

- [ ] **Step 7: 运行 schema 校验测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: PASS。

- [ ] **Step 8: 提交 Task 3**

```bash
git add pentest-agent-harness/tools/build_strategy_plan.py \
  pentest-agent-harness/tests/test_strategy_planner.py
git commit -m "feat: build threat weighted strategy plans"
```

## Task 4: Dispatcher 优先消费 Strategy Queue

**Files:**
- Modify: `pentest-agent-harness/tools/build_agent_contracts.py`
- Modify: `pentest-agent-harness/tests/test_agent_contracts.py`

- [ ] **Step 1: 写失败测试**

Add a test to `test_agent_contracts.py`:

```python
def test_build_agent_contracts_prefers_strategy_queue_when_present(tmp_path):
    run_dir = tmp_path / "run-1"
    prepare_recon(run_dir)
    strategy_dir = run_dir / "artifacts" / "strategy-planner-agent"
    write_json(strategy_dir / "pentest_strategy_queue.json", {
        "round": "R1",
        "strategy": "threat-weighted",
        "weights": {"threat": 0.6, "rule": 0.4},
        "items": [
            {
                "task_id": "PT-R1-001",
                "round": "R1",
                "target_agent": "browser-pentest-agent",
                "skills": ["authorization-control"],
                "source_threat_ids": ["TH-001"],
                "source_rule_ids": ["RULE-IDOR-RESOURCE-ID"],
                "target": {"entrypoint_id": "EP-001", "asset": "订单数据"},
                "threat_score": 80,
                "rule_score": 80,
                "attention_score": 80,
                "priority": "P0",
                "hypothesis_id": "HYP-001",
                "hypothesis": "订单资源可能缺少归属校验",
                "why_this_matters": "跨越用户资源边界",
                "required_roles": ["owner", "other_user"],
                "required_evidence": ["两个角色", "资源 ID"],
                "safety_limits": ["只读请求"],
                "stop_conditions": ["账号缺失"],
                "blocked_root_causes": ["browser.account_missing"],
            }
        ],
        "summary": {"total": 1, "p0": 1, "p1": 0, "p2": 0, "p3": 0, "recon_gaps": 0},
    })

    result = run_build(run_dir)

    assert result.returncode == 0, result.stderr
    contract = load_json(contract_path(run_dir, "browser-pentest-agent"))
    assert contract["priority"] == "P0"
    assert contract["inputs"]["strategy_tasks"][0]["task_id"] == "PT-R1-001"
    assert "两个角色" in contract["evidence_requirements"]
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_agent_contracts.py
```

Expected: FAIL，当前 builder 忽略 strategy queue。

- [ ] **Step 3: 修改 builder**

Implement:

- `load_strategy_queue(run_dir) -> Optional[dict]`
- `group_strategy_inputs(strategy_queue) -> dict`
- If strategy queue exists, group by `target_agent`.
- Contract `inputs` includes `strategy_tasks`.
- Contract priority uses strongest task priority.
- `evidence_requirements` includes unique required evidence from strategy tasks.
- `completion_criteria` includes strategy stop conditions and blocked root causes.
- Old `group_recon_inputs` path remains unchanged when no strategy queue exists.

- [ ] **Step 4: 运行 agent contract 测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_agent_contracts.py
```

Expected: PASS。

- [ ] **Step 5: 运行全量测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 4**

```bash
git add pentest-agent-harness/tools/build_agent_contracts.py \
  pentest-agent-harness/tests/test_agent_contracts.py
git commit -m "feat: dispatch strategy planner tasks"
```

## Task 5: 最终回归与文档门禁

**Files:**
- No new files expected unless previous tasks reveal doc quality fixes.

- [ ] **Step 1: 运行所有测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: PASS。

- [ ] **Step 2: 运行核心文档门禁**

Run:

```bash
python3 pentest-agent-harness/tests/test_agent_skill_doc_quality.py
python3 pentest-agent-harness/tests/test_no_lab_binding_in_core_agent_skills.py
```

Expected: PASS。

- [ ] **Step 3: 检查 git 状态**

Run:

```bash
git status --short --branch
git log --oneline --max-count=8
```

Expected: 工作区干净；本轮任务提交可追踪。

- [ ] **Step 4: 如有必要提交收尾修复**

If Step 1 or Step 2 required small doc/test fixes:

```bash
git add pentest-agent-harness/agents/strategy-planner-agent.md \
  pentest-agent-harness/skills/threat-weighted-strategy/SKILL.md \
  pentest-agent-harness/tools/build_strategy_plan.py \
  pentest-agent-harness/tools/build_agent_contracts.py \
  pentest-agent-harness/tests/test_strategy_planner.py \
  pentest-agent-harness/tests/test_agent_contracts.py \
  pentest-agent-harness/tests/test_validate_schema.py
git commit -m "test: verify threat weighted strategy planner"
```

If no files changed, do not create an empty commit.

## 自检

- Spec 覆盖：
  - strategy-planner-agent：Task 2。
  - 三个 strategy artifacts：Task 1、Task 3。
  - 60/40 评分模型：Task 3。
  - STRIDE + 规则映射到 skills：Task 2、Task 3。
  - recon gap 回流：Task 3。
  - dispatcher 优先消费 strategy queue：Task 4。
  - 不绑定靶场：Task 5。
- 范围控制：
  - 第一版不执行 payload，不做浏览器/API 动态测试。
  - 第一版不做完整攻击链图算法。
  - 第一版不引入外部依赖。
- 占位检查：
  - 本 plan 不包含未展开的占位指令或跨任务省略写法。
