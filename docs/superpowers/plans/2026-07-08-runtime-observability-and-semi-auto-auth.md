# Runtime Observability And Semi Auto Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前灰白盒渗透测试 Agent 从“文档式 harness”推进到可连续执行、可观察、可恢复、可解释覆盖率和证据链的运行时闭环。

**Architecture:** 采用 Shannon 的 checkpoint/progress 思路和 Strix 的 agent graph/event log/report lifecycle 思路，但保持本项目轻量 JSON artifact 架构。新增运行器负责 phase 编排、事件日志、进度快照、断点状态和完成门禁；报告与覆盖率工具从这些结构化产物读取证据，不绑定任何靶场。

**Tech Stack:** Python 3 标准库、JSON artifact、Markdown/HTML 报告、OpenCode JSON/Markdown agent 配置、本项目直接运行式 Python 测试。

## Global Constraints

- 所有新增文档使用中文。
- 核心 Agent、Skill、工具不得绑定 Juice-Shop 或任何单一靶场。
- 半自动认证只支持授权场景下的人机协作，不绕过验证码或短信 OTP。
- 运行时日志不得输出明文密码、短信验证码、完整 Cookie、完整 Authorization header。
- 保持现有测试兼容，新增能力必须有失败测试先行。

---

## 文件结构

新增文件：

- `pentest-agent-harness/tools/runtime_events.py`：统一事件日志、进度快照、checkpoint 和敏感信息脱敏。
- `pentest-agent-harness/tools/run_pentest_agent.py`：轻量根运行器，串联 init/resume、事件记录、API 覆盖矩阵、报告上下文和 finish gate。
- `pentest-agent-harness/tools/build_api_coverage_matrix.py`：从静态 API、浏览器 runtime API、trace ledger 和动态证据生成接口覆盖矩阵。
- `pentest-agent-harness/tests/test_runtime_events.py`：验证事件日志、脱敏、进度快照和 checkpoint。
- `pentest-agent-harness/tests/test_api_coverage_matrix.py`：验证 API 覆盖矩阵。
- `pentest-agent-harness/tests/test_run_pentest_agent.py`：验证运行器可连续执行并产出关键 artifact。
- `pentest-agent-harness/.opencode/agents/pentest-root.md`：OpenCode root agent 中文提示。
- `pentest-agent-harness/.opencode/agents/recon-agent.md`：OpenCode recon subagent 中文提示。
- `pentest-agent-harness/.opencode/agents/browser-pentest-agent.md`：OpenCode browser subagent 中文提示。
- `pentest-agent-harness/.opencode/agents/report-agent.md`：OpenCode report subagent 中文提示。

修改文件：

- `pentest-agent-harness/opencode.json`：改为 OpenCode 可识别配置，保留中文 agent 工作流。
- `pentest-agent-harness/tools/build_auth_session_plan.py`：增加半自动交互 checkpoint 规划。
- `pentest-agent-harness/tests/test_auth_session_plan.py`：覆盖图片验证码和短信 OTP 等人工介入状态。
- `pentest-agent-harness/tools/generate_report.py`：支持 `--context`，渲染 API 覆盖、source-sink 和人工介入摘要。
- `pentest-agent-harness/templates/pentest-report.md`：增加覆盖率、source-sink、人工介入、测试人员反馈章节。
- `pentest-agent-harness/templates/report.html`：增加同等 HTML 报告章节。
- `pentest-agent-harness/tests/test_generate_report.py`：覆盖增强报告上下文。
- `pentest-agent-harness/AGENT.md`：补充运行时日志、进度、断点、半自动认证的执行约束。
- `pentest-agent-harness/skills/report-template/SKILL.md`：补充 source-sink、覆盖率、blocked 和漏报反馈要求。
- `pentest-agent-harness/skills/auth-session-testing/SKILL.md`：补充验证码/短信 OTP 半自动流程。
- `pentest-agent-harness/skills/runtime-api-capture/SKILL.md`：补充 API 覆盖矩阵输入输出。

## Task 1: 运行时事件日志与进度快照

**Files:**
- Create: `pentest-agent-harness/tests/test_runtime_events.py`
- Create: `pentest-agent-harness/tools/runtime_events.py`

**Interfaces:**
- Produces: `append_event(run_dir: Path, event: dict) -> dict`
- Produces: `write_progress(run_dir: Path, progress: dict) -> dict`
- Produces: `write_checkpoint(run_dir: Path, name: str, payload: dict) -> Path`
- Produces: `redact_secret(value: object) -> object`

- [ ] 写失败测试：事件应追加到 `events.jsonl`，进度写入 `progress.json`，checkpoint 写入 `checkpoints/<name>.json`，敏感字段被脱敏。
- [ ] 运行 `python3 pentest-agent-harness/tests/test_runtime_events.py`，确认因为模块不存在失败。
- [ ] 实现 `runtime_events.py` 的最小行为。
- [ ] 重新运行测试确认通过。

## Task 2: API 覆盖矩阵

**Files:**
- Create: `pentest-agent-harness/tests/test_api_coverage_matrix.py`
- Create: `pentest-agent-harness/tools/build_api_coverage_matrix.py`

**Interfaces:**
- Consumes: `api_inventory.json`、`runtime_api_observations.json`、`test_trace_ledger.json`
- Produces: `artifacts/evaluation-agent/api_coverage_matrix.json`
- Produces: `summary.total/discovered/tested/verified/blocked/untested`

- [ ] 写失败测试：同一 API 从静态和 runtime 来源合并，能标记 role、source、tested、verified、blocked、evidence_refs。
- [ ] 运行单测确认失败。
- [ ] 实现矩阵构建器和 CLI。
- [ ] 重新运行测试确认通过。

## Task 3: 半自动认证 checkpoint

**Files:**
- Modify: `pentest-agent-harness/tests/test_auth_session_plan.py`
- Modify: `pentest-agent-harness/tools/build_auth_session_plan.py`

**Interfaces:**
- Produces: `interaction_required[]`
- Produces: `resume_checkpoints[]`
- Produces: `summary.interaction_required`

- [ ] 写失败测试：当 profile 声明 `captcha.required=true` 和 `otp.required=true` 时，认证计划必须生成 `image_captcha` 与 `sms_otp` 两个交互 checkpoint。
- [ ] 运行单测确认失败。
- [ ] 实现半自动认证计划字段，账号和密码必须保留脱敏语义。
- [ ] 重新运行测试确认通过。

## Task 4: 报告增强

**Files:**
- Modify: `pentest-agent-harness/tests/test_generate_report.py`
- Modify: `pentest-agent-harness/tools/generate_report.py`
- Modify: `pentest-agent-harness/templates/pentest-report.md`
- Modify: `pentest-agent-harness/templates/report.html`

**Interfaces:**
- Consumes: `--context <report_context.json>`
- Produces: 报告章节 `API 覆盖矩阵`、`Source-Sink 证据链`、`半自动与阻塞项`、`测试人员漏报反馈`

- [ ] 写失败测试：传入 context 后 Markdown 和 HTML 都必须包含 API 覆盖、source-sink 和人工介入摘要。
- [ ] 运行单测确认失败。
- [ ] 扩展报告工具并保持旧的两个参数调用兼容。
- [ ] 重新运行测试确认通过。

## Task 5: OpenCode 配置和 Agent 提示

**Files:**
- Modify: `pentest-agent-harness/opencode.json`
- Create: `pentest-agent-harness/.opencode/agents/pentest-root.md`
- Create: `pentest-agent-harness/.opencode/agents/recon-agent.md`
- Create: `pentest-agent-harness/.opencode/agents/browser-pentest-agent.md`
- Create: `pentest-agent-harness/.opencode/agents/report-agent.md`

**Interfaces:**
- Produces: OpenCode schema 风格配置：`$schema`、`default_agent`、`agent`、`steps`、`permission`

- [ ] 写配置结构测试，验证 `opencode.json` 使用 OpenCode 可识别字段，不再使用自定义 `entry/agentsDir/skillsDir` 作为顶层运行字段。
- [ ] 运行单测确认失败。
- [ ] 修改 OpenCode 配置和中文 agent prompt。
- [ ] 重新运行测试确认通过。

## Task 6: 根运行器闭环

**Files:**
- Create: `pentest-agent-harness/tests/test_run_pentest_agent.py`
- Create: `pentest-agent-harness/tools/run_pentest_agent.py`
- Modify: `pentest-agent-harness/AGENT.md`
- Modify: `pentest-agent-harness/skills/report-template/SKILL.md`
- Modify: `pentest-agent-harness/skills/auth-session-testing/SKILL.md`
- Modify: `pentest-agent-harness/skills/runtime-api-capture/SKILL.md`

**Interfaces:**
- Consumes: `--run-dir`、`--target-url`、`--repo-path`、`--scope-hash`、`--config-hash`
- Produces: `run_state.json`、`events.jsonl`、`progress.json`、`api_coverage_matrix.json`、`report_context.json`

- [ ] 写失败测试：运行器必须连续执行到 `waiting_for_evidence` 或 `finished`，并记录“分析、计划、执行、结果、下一步”事件。
- [ ] 运行单测确认失败。
- [ ] 实现最小运行器，复用已有工具，不引入靶场绑定。
- [ ] 重新运行测试确认通过。

## Final Verification

- [ ] 运行 `python3 pentest-agent-harness/tests/test_runtime_events.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_api_coverage_matrix.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_auth_session_plan.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_generate_report.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/test_run_pentest_agent.py`
- [ ] 运行 `python3 pentest-agent-harness/tests/run_all.py`
