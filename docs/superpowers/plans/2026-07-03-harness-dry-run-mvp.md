# Harness Dry-run MVP 实施计划

> **给 Agent 工作者：** 本计划用于把现有分散工具串成一条可验证的端到端 dry-run 流程。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 新增一个 dry-run runner，让 harness 在没有真实子 Agent 执行器的情况下，也能从 Recon 产物走到 R1 contract、模拟 agent_result、Evaluation 和 R2 queue。

**架构：** 复用现有 Python 工具和 JSON artifact。`run_harness_dry_run.py` 负责准备最小 Recon 产物、调用 contract 生成/校验、写入模拟 Agent 结果、调用 evaluation，并产出 run summary。

**技术栈：** Python 3 标准库、JSON、现有 `tests/run_all.py`。

---

### 任务 1：端到端失败测试

**文件：**
- 新建：`pentest-agent-harness/tests/test_harness_dry_run.py`

- [ ] **步骤 1：写 dry-run 测试**

测试调用 `tools/run_harness_dry_run.py <run_dir>`，断言生成：

- `artifacts/recon-agent/recon_priority_queue.json`
- `artifacts/dispatcher-agent/work_queue_R1.json`
- `artifacts/dispatcher-agent/agent_contracts/R1/static-audit-agent.json`
- `artifacts/static-audit-agent/agent_result_R1.json`
- `artifacts/evaluation-agent/round_evaluation_R1.json`
- `artifacts/dispatcher-agent/work_queue_R2.json`
- `artifacts/dispatcher-agent/dry_run_summary.json`

- [ ] **步骤 2：运行测试确认失败**

运行：`python3 pentest-agent-harness/tests/test_harness_dry_run.py`

预期：失败，因为 runner 尚未存在。

### 任务 2：实现 runner

**文件：**
- 新建：`pentest-agent-harness/tools/run_harness_dry_run.py`

- [ ] **步骤 1：准备最小 Recon 产物**

复用 `init_recon_artifacts.py`，然后写入最小有效 trust boundary、threat、priority queue、coverage。

- [ ] **步骤 2：串联现有工具**

调用内部函数：

- `check_recon_artifacts`
- `build_agent_contracts`
- `check_agent_contracts`
- `evaluate_round`

- [ ] **步骤 3：写入模拟 Agent Result**

根据 R1 work queue 为每个 task 写入 `agent_result_R1.json`，其中 `static-audit-agent` 包含一个 High/shallow coverage gap 和一个 unchecked candidate，用于证明 R2 queue 可生成。

- [ ] **步骤 4：写入 dry-run summary**

输出 tasks、contracts、agent_results、round_evaluation、r2_tasks 数量。

### 任务 3：同步 phase 文档

**文件：**
- 修改：`pentest-agent-harness/phases/01-recon.md`
- 修改：`pentest-agent-harness/phases/04-evaluation.md`
- 修改：`pentest-agent-harness/phases/05-focused-retest.md`
- 修改：`pentest-agent-harness/phases/06-reporting.md`
- 修改：`pentest-agent-harness/README.md`

- [ ] **步骤 1：将旧 artifact 名称替换为当前真实输出**

例如 `attack_surface.json` 改为 `attack_surface_boundaries.json`，`coverage.json/evaluation.json` 改为 `round_evaluation_<round>.json`。

- [ ] **步骤 2：README 增加 dry-run 命令**

写明 `python3 tools/run_harness_dry_run.py runs/demo-dry-run`。

### 任务 4：验证与提交

- [ ] **步骤 1：运行质量门禁**

运行：`python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness`

- [ ] **步骤 2：运行全量测试**

运行：`python3 pentest-agent-harness/tests/run_all.py`

- [ ] **步骤 3：编译新工具**

运行：`PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile pentest-agent-harness/tools/run_harness_dry_run.py`

- [ ] **步骤 4：提交并推送**

运行：`git add ... && git commit -m "feat: add harness dry run" && git push origin main`
