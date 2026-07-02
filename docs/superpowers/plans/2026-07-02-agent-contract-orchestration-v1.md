# Agent Contract 并发编排 v1 实施计划

> **给 Agent 工作者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 为渗透测试 harness 增加第一版可执行的 Agent Contract、并发 work queue 和轮次评估闭环。

**架构：** 采用现有轻量 Python 工具和 JSON artifact 风格。Recon 产物先被转换成 per-agent contract 与 work queue，子 Agent 按 contract 输出 agent_result，Evaluation 再聚合结果生成 round_evaluation 和 R2 focused queue。

**技术栈：** Python 3 标准库、JSON、现有 `tests/run_all.py` 测试入口。

---

### 任务 1：写合约与评估的失败测试

**文件：**
- 新建：`pentest-agent-harness/tests/test_agent_contracts.py`
- 新建：`pentest-agent-harness/tests/test_round_evaluation.py`

- [ ] **步骤 1：编写合约生成与校验测试**

测试创建最小 Recon 产物，调用 `build_agent_contracts.py`，断言生成 `agent_contracts/R1/static-audit-agent.json` 和 `work_queue_R1.json`；再调用 `check_agent_contracts.py` 确认通过，并验证缺失 `owned_paths` 会被拒绝。

- [ ] **步骤 2：运行测试确认失败**

运行：`python3 pentest-agent-harness/tests/test_agent_contracts.py`

预期：失败，因为工具尚未存在。

- [ ] **步骤 3：编写轮次评估测试**

测试写入两个 Agent 的 `agent_result_R1.json`，调用 `evaluate_round.py`，断言高风险覆盖缺口和未完成候选会生成 `work_queue_R2.json`。

- [ ] **步骤 4：运行测试确认失败**

运行：`python3 pentest-agent-harness/tests/test_round_evaluation.py`

预期：失败，因为工具尚未存在。

### 任务 2：实现 schema 与工具

**文件：**
- 新建：`pentest-agent-harness/schemas/agent_contract.schema.json`
- 新建：`pentest-agent-harness/schemas/work_queue.schema.json`
- 新建：`pentest-agent-harness/schemas/agent_result.schema.json`
- 新建：`pentest-agent-harness/schemas/round_evaluation.schema.json`
- 新建：`pentest-agent-harness/tools/build_agent_contracts.py`
- 新建：`pentest-agent-harness/tools/check_agent_contracts.py`
- 新建：`pentest-agent-harness/tools/evaluate_round.py`

- [ ] **步骤 1：新增四个 schema**

Schema 只约束根对象和关键字段，保持与现有 `validate_schema.py` 能力一致。

- [ ] **步骤 2：实现 `build_agent_contracts.py`**

读取 Recon 队列和威胁模型，按 `target_agent` 分组生成 contract。每个 contract 固定写入自己的 artifacts、findings、checkpoint 路径。

- [ ] **步骤 3：实现 `check_agent_contracts.py`**

校验 contract 必须包含 agent、round、inputs、owned_paths、evidence_requirements、budget、completion_criteria、failure_conditions，并校验 work queue 引用的 contract 文件存在。

- [ ] **步骤 4：实现 `evaluate_round.py`**

读取 `artifacts/*/agent_result_<round>.json`，聚合 coverage、findings、unchecked_candidates、conflicts，生成 R2 focused queue。

- [ ] **步骤 5：运行测试确认通过**

运行：`python3 pentest-agent-harness/tests/test_agent_contracts.py`

运行：`python3 pentest-agent-harness/tests/test_round_evaluation.py`

预期：通过。

### 任务 3：更新 Agent 与 Skill 文档

**文件：**
- 修改：`pentest-agent-harness/agents/dispatcher-agent.md`
- 修改：`pentest-agent-harness/agents/evaluation-agent.md`
- 修改：`pentest-agent-harness/agents/static-audit-agent.md`
- 修改：`pentest-agent-harness/agents/frontend-audit-agent.md`
- 修改：`pentest-agent-harness/skills/pentest-harness/SKILL.md`
- 修改：`pentest-agent-harness/skills/coverage-matrix/SKILL.md`
- 修改：`pentest-agent-harness/references/methodology/concurrency.md`

- [ ] **步骤 1：Dispatcher 文档加入状态机**

写明 `INIT -> SAFETY -> RECON -> R1_PLAN -> R1_DISPATCH -> R1_JOIN -> R1_EVALUATE -> R2_PLAN -> R2_DISPATCH -> REPORT`。

- [ ] **步骤 2：Evaluation 文档加入 R2 规则**

写明覆盖缺口、High/Critical 缺动态证据、冲突和未完成候选的处理规则。

- [ ] **步骤 3：静态/前端 Agent 文档加入 contract 消费方式**

明确只能读取 contract 输入，写入 owned paths，输出 `agent_result_<round>.json`。

- [ ] **步骤 4：Skill 文档加入工具调用协议**

让 `pentest-harness` 和 `coverage-matrix` 指向新增工具和 artifact。

### 任务 4：全量验证与提交

**文件：**
- 所有本轮变更文件

- [ ] **步骤 1：运行全量测试**

运行：`python3 pentest-agent-harness/tests/run_all.py`

预期：所有测试通过。

- [ ] **步骤 2：编译 Python 工具**

运行：`PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile pentest-agent-harness/tools/build_agent_contracts.py pentest-agent-harness/tools/check_agent_contracts.py pentest-agent-harness/tools/evaluate_round.py`

预期：无输出且退出码为 0。

- [ ] **步骤 3：查看 git diff**

运行：`git diff --stat`

预期：只包含本轮 schema、tools、tests、docs、agent/skill 文档。

- [ ] **步骤 4：提交**

运行：

```bash
git add docs/superpowers/specs/2026-07-02-agent-contract-orchestration-v1-design.md docs/superpowers/plans/2026-07-02-agent-contract-orchestration-v1.md pentest-agent-harness
git commit -m "feat: add agent contract orchestration"
```
