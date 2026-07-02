# Recon 边界与威胁分析实现计划

> **给 Agent 工作者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用 checkbox（`- [ ]`）跟踪进度。

**目标：** 将 recon-agent 的攻击面边界、信任边界和威胁分析从文档要求落成可初始化、可校验、可测试的本地工具与 schema。

**架构：** 新增 recon artifacts 的 schema、初始化工具和质量检查工具。初始化工具负责创建 `runs/<run_id>/artifacts/recon-agent/` 下的标准 JSON 文件；质量检查工具负责验证必需文件、核心字段、coverage 的 checked/skipped/unknown 语义、信任边界字段、威胁项字段和优先队列字段。

**技术栈：** Python 3 标准库、JSON、Markdown、现有直接运行式测试框架。

---

## 文件结构

新增文件：

- `pentest-agent-harness/tools/init_recon_artifacts.py`：初始化 recon artifacts 标准文件。
- `pentest-agent-harness/tools/check_recon_artifacts.py`：检查 recon artifacts 完整性和质量门禁。
- `pentest-agent-harness/tests/test_recon_artifacts.py`：覆盖初始化、检查成功、缺文件、坏 coverage、坏威胁项等行为。
- `pentest-agent-harness/schemas/attack_surface_boundaries.schema.json`
- `pentest-agent-harness/schemas/trust_boundaries.schema.json`
- `pentest-agent-harness/schemas/threat_model.schema.json`
- `pentest-agent-harness/schemas/recon_priority_queue.schema.json`
- `pentest-agent-harness/schemas/coverage_recon.schema.json`
- `pentest-agent-harness/schemas/source_sink_seed.schema.json`

修改文件：

- `pentest-agent-harness/agents/recon-agent.md`：补充工具入口。
- `pentest-agent-harness/skills/recon-enumeration/SKILL.md`：补充初始化和校验命令。

## 任务 1：测试驱动定义 recon artifacts 行为

**文件：**

- Create: `pentest-agent-harness/tests/test_recon_artifacts.py`

- [ ] 写失败测试：`init_recon_artifacts.py` 应创建 recon-agent artifact 文件。
- [ ] 写失败测试：`check_recon_artifacts.py` 应接受完整 artifacts。
- [ ] 写失败测试：缺少 `trust_boundaries.json` 时检查失败且无 traceback。
- [ ] 写失败测试：`coverage_recon.json.skipped` 缺 reason 时检查失败。
- [ ] 写失败测试：`threat_model.json` 缺 `next_agent` 时检查失败。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_recon_artifacts.py`，预期失败，因为工具尚不存在。

## 任务 2：实现 recon artifacts 初始化工具

**文件：**

- Create: `pentest-agent-harness/tools/init_recon_artifacts.py`

- [ ] 实现 CLI：`python3 tools/init_recon_artifacts.py <run_dir>`。
- [ ] 创建 `artifacts/recon-agent/` 和标准 JSON 文件。
- [ ] 所有文件使用确定性空结构，便于 Agent 后续补写。
- [ ] CLI 捕获 `OSError` 和 `ValueError`，返回 1，stderr 不输出 traceback。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_recon_artifacts.py`，预期仍失败在质量检查工具缺失。

## 任务 3：实现 recon artifacts 质量检查工具

**文件：**

- Create: `pentest-agent-harness/tools/check_recon_artifacts.py`

- [ ] 实现 CLI：`python3 tools/check_recon_artifacts.py <run_dir>`。
- [ ] 检查必需文件存在且为 JSON object。
- [ ] 检查 `trust_boundaries.json.boundaries[]` 字段：`id`、`from`、`to`、`protocol`、`data_types`、`auth_context`、`trust_assumption`、`primary_threats`、`evidence`。
- [ ] 检查 `threat_model.json.threats[]` 字段：`entrypoint_id`、`boundary_id`、`asset`、`attacker`、`threat_category`、`why_relevant`、`next_agent`、`priority`、`evidence`。
- [ ] 检查 `coverage_recon.json.checked/skipped/unknown[]` 均有 `area`、`reason`、`evidence`；其中 skipped/unknown 的 reason 不能为空。
- [ ] 检查 `recon_priority_queue.json.items[]` 字段：`target_agent`、`priority`、`reason`、`evidence`。
- [ ] CLI 捕获坏 JSON、缺文件、结构错误，返回 1，stderr 不输出 traceback 和绝对路径。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_recon_artifacts.py`，预期通过。

## 任务 4：新增 schema 和文档入口

**文件：**

- Create: `pentest-agent-harness/schemas/*.schema.json`
- Modify: `pentest-agent-harness/agents/recon-agent.md`
- Modify: `pentest-agent-harness/skills/recon-enumeration/SKILL.md`

- [ ] 创建 6 个 recon artifact schema，至少约束根对象和核心属性类型。
- [ ] 在 `recon-agent.md` 中说明初始化和检查命令。
- [ ] 在 `recon-enumeration/SKILL.md` 中说明执行前先初始化、结束前必须检查。
- [ ] 运行 `python3 pentest-agent-harness/tests/run_all.py`。
- [ ] 运行 Python 编译检查。

## 任务 5：最终验证与提交

- [ ] 运行 `python3 pentest-agent-harness/tests/run_all.py`。
- [ ] 运行 `PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile` 覆盖新增工具。
- [ ] 检查 `git status --short`。
- [ ] 提交：`git commit -m "feat: implement recon boundary artifact checks"`。
