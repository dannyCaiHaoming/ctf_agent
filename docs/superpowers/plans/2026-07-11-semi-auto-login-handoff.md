# 半自动登录人工交接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 Codex 与 OpenCode 的浏览器适配器中提供页内人工登录交接，且只有登录态校验通过后才恢复认证后渗透测试。

**Architecture:** 新增纯 Python 的 `browser_session_bridge`：识别登录面、生成隔离 Shadow DOM 控件脚本、写入脱敏 `login_handoff` artifact。浏览器适配器执行脚本并回传 bridge result；`validate_login_handoff` 将结果转换为会话验证、事件、checkpoint 和恢复状态，`run_pentest_agent` 以此作为认证后任务的唯一放行条件。

**Tech Stack:** Python 3 标准库、JSON Schema、现有 JSON artifact / `events.jsonl` / checkpoint 机制、浏览器 evaluate 适配器接口、Shadow DOM JavaScript 字符串。

## Global Constraints

- 新增或维护的文档、Agent 和 Skill 使用中文；代码标识符、JSON 字段名和命令保持原文。
- 仅在 `scope.json.allowed_hosts` 与 `scope.json.allowed_paths` 内生成控件注入任务。
- 不读取、保存、传输或打印密码、图形验证码、短信验证码、Cookie/Token 原值、Authorization 或完整敏感响应体。
- 登录确认不等于认证成功；只有 `session_validation.status == "authenticated"` 才能放行认证后任务。
- Cookie 缺失、过期、域/路径不匹配、重定向回登录、401、403、身份不一致或无验证能力时不得继续认证后测试。
- 只用项目配置或运行时发现的 scope 内低风险 `GET` / `HEAD` 认证入口验证会话。
- bridge 不启动本地 HTTP 服务；页面按钮只派发浏览器内 `CustomEvent`，由 Codex/OpenCode 适配器回传脱敏结果。
- 每次行为变化遵循 Red-Green-Refactor；全量回归前不得声称功能完成。

## 实施补充

- `login_handoff.json` 为闭合 schema；scope 外阻塞原因使用可选 `blocked_reason`，不污染 `detection_signals`。
- `session_validation.json` 的嵌套受保护入口结果使用 `protected_entry_validation.result`，不使用嵌套 `status`。
- `protected_entry_result.status` 为 2xx 时，必须同时提供可用 `final_url` 才能认证成功；缺失 `final_url` 保持 `waiting_for_user`。
- 持久化 `final_url` 前必须移除 userinfo、query 和 fragment，只保留 scheme、host、path。
- Cookie path match 必须有边界：`/api` 可匹配 `/api` 与 `/api/me`，不能匹配 `/apix`。
- 只要存在 `login_handoff.json` 或 `session_validation.json`，runner 必须启用认证门禁；缺少 `authenticated` validation 时不得继续认证后测试。

---

## 文件结构

- Create: `pentest-agent-harness/tools/browser_session_bridge.py`：登录面识别、scope 判断、overlay 脚本、handoff artifact。
- Create: `pentest-agent-harness/tools/validate_login_handoff.py`：消费 bridge result，输出会话验证、checkpoint、事件与进度。
- Create: `pentest-agent-harness/schemas/login_handoff.schema.json`：人工交接 artifact 契约。
- Create: `pentest-agent-harness/schemas/session_validation.schema.json`：会话验证 artifact 契约。
- Create: `pentest-agent-harness/tests/test_browser_session_bridge.py`：bridge 行为测试。
- Create: `pentest-agent-harness/tests/test_validate_login_handoff.py`：验证、暂停、恢复与脱敏测试。
- Modify: `pentest-agent-harness/tools/build_auth_session_plan.py`：将验证码/OTP 计划归一为单个 `login_handoff`。
- Modify: `pentest-agent-harness/tools/run_pentest_agent.py`：认证放行和报告上下文。
- Modify: `pentest-agent-harness/schemas/auth_session_plan.schema.json`：交接配置。
- Modify: `pentest-agent-harness/tests/test_auth_session_plan.py`、`pentest-agent-harness/tests/test_run_pentest_agent.py`：回归。
- Modify: `pentest-agent-harness/agents/browser-pentest-agent.md`、`skills/auth-session-testing/SKILL.md`、`AGENT.md`、`opencode.json`：跨浏览器 adapter contract。

## Task 1: 定义 artifact 契约

**Files:**

- Create: `pentest-agent-harness/schemas/login_handoff.schema.json`
- Create: `pentest-agent-harness/schemas/session_validation.schema.json`
- Modify: `pentest-agent-harness/schemas/auth_session_plan.schema.json`
- Test: `pentest-agent-harness/tests/test_validate_schema.py`

**Interfaces:**

- Produces `login_handoff.json`，必有 `handoff_id`、`status`、`page_url`、`detection_signals`、`ui`、`user_confirmation`、`sensitive_values_persisted`。
- Produces `session_validation.json`，必有 `handoff_id`、`status`、`cookie_observation`、`protected_entry_validation`、`sensitive_values_persisted`。

- [x] **Step 1: 写失败的 schema 回归测试**

在 `test_validate_schema.py` 加入有效 handoff 样本和缺少 `handoff_id` 的无效样本。

~~~python
valid_handoff = {
    "handoff_id": "auth-login-handoff",
    "status": "waiting_for_user",
    "page_url": "https://crm.example.test/signin",
    "detection_signals": ["password_form", "image_captcha"],
    "ui": {"injected": True, "isolation": "shadow_dom"},
    "user_confirmation": {"received": False, "confirmed_at": ""},
    "sensitive_values_persisted": False,
}
~~~

- [x] **Step 2: 运行测试确认失败**

Run: `python3 pentest-agent-harness/tests/test_validate_schema.py`

Expected: FAIL，提示两个 schema 文件不存在。

- [x] **Step 3: 实现最小 schema**

`login_handoff.schema.json` 的 `status` 枚举为 `waiting_for_user`、`authenticated`、`blocked`，并将 `sensitive_values_persisted` 限制为 `false`。对 `session_validation.schema.json` 施加同样的状态和敏感值限制；在 `auth_session_plan.schema.json` 增加 `interaction_required`、`resume_checkpoints`、`handoff` 属性。

~~~json
{
  "type": "object",
  "required": ["handoff_id", "status", "page_url", "detection_signals", "ui", "user_confirmation", "sensitive_values_persisted"],
  "properties": {
    "handoff_id": {"type": "string"},
    "status": {"enum": ["waiting_for_user", "authenticated", "blocked"]},
    "sensitive_values_persisted": {"const": false}
  }
}
~~~

- [x] **Step 4: 运行测试确认通过**

Run: `python3 pentest-agent-harness/tests/test_validate_schema.py`

Expected: PASS。

- [x] **Step 5: 提交 schema 契约**

~~~bash
git add pentest-agent-harness/schemas/login_handoff.schema.json pentest-agent-harness/schemas/session_validation.schema.json pentest-agent-harness/schemas/auth_session_plan.schema.json pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: define semi-auto login artifacts"
~~~

## Task 2: 实现登录面识别和页内控件脚本

**Files:**

- Create: `pentest-agent-harness/tools/browser_session_bridge.py`
- Create: `pentest-agent-harness/tests/test_browser_session_bridge.py`

**Interfaces:**

- Consumes: `build_login_handoff(run_dir: Path, observation: dict[str, Any]) -> dict[str, Any]`，observation 含 `page_url`、`forms`、`elements`、`network_requests`。
- Produces: `artifacts/browser-pentest-agent/login_handoff.json` 与 `login_handoff_injection.json`。
- Produces: `build_overlay_script(handoff_id: str) -> str`；脚本只派发 `pentest-agent:login-confirmed`，detail 只含 `handoffId`。

- [x] **Step 1: 写失败的 bridge 测试**

~~~python
def test_build_login_handoff_detects_captcha_and_emits_isolated_overlay(tmp_path):
    handoff = build_login_handoff(tmp_path, {
        "page_url": "https://crm.example.test/signin",
        "forms": [{"inputs": [{"type": "password", "name": "password"}]}],
        "elements": [{"kind": "image_captcha"}],
        "network_requests": [],
    })
    assert handoff["status"] == "waiting_for_user"
    assert handoff["detection_signals"] == ["password_form", "image_captcha"]
    script = build_overlay_script(handoff["handoff_id"])
    assert "attachShadow" in script
    assert "pentest-agent:login-confirmed" in script
    assert "document.cookie" not in script
    assert "fetch(" not in script
~~~

增加 scope 外 URL、重复注入宿主标记、OTP/SSO/login API 信号的测试。

- [x] **Step 2: 运行测试确认失败**

Run: `python3 pentest-agent-harness/tests/test_browser_session_bridge.py`

Expected: FAIL，无法导入 `browser_session_bridge`。

- [x] **Step 3: 实现最小 bridge 和 CLI**

实现下列函数：

~~~python
def detect_login_signals(observation: dict[str, Any]) -> list[str]: ...
def url_allowed(scope: dict[str, Any], page_url: str) -> bool: ...
def build_overlay_script(handoff_id: str) -> str: ...
def build_login_handoff(run_dir: Path, observation: dict[str, Any]) -> dict[str, Any]: ...
~~~

`detect_login_signals` 只根据输入类型/名称、元素 kind、SSO URL 和认证网络请求名称推导 `password_form`、`image_captcha`、`sms_otp`、`sso_redirect`、`login_api`。`url_allowed` 同时校验 host 和 path 前缀；失败产出 `browser.login_handoff_out_of_scope` blocked。

控件脚本使用唯一 `data-pentest-login-handoff` 宿主，先移除旧宿主，再使用 `attachShadow({mode: "closed"})`。点击处理仅执行：

~~~javascript
window.dispatchEvent(new CustomEvent("pentest-agent:login-confirmed", {
  detail: { handoffId: handoffId }
}))
~~~

禁止脚本出现 `fetch(`、`XMLHttpRequest`、`document.cookie`、`localStorage`、表单 value 读取。CLI 为 `python3 tools/browser_session_bridge.py <run_dir> <browser_login_observation.json>`。

- [x] **Step 4: 运行 bridge 测试确认通过**

Run: `python3 pentest-agent-harness/tests/test_browser_session_bridge.py`

Expected: PASS。

- [x] **Step 5: 提交 bridge**

~~~bash
git add pentest-agent-harness/tools/browser_session_bridge.py pentest-agent-harness/tests/test_browser_session_bridge.py
git commit -m "feat: add browser login handoff bridge"
~~~

## Task 3: 归一认证计划并生成 bridge 注入任务

**Files:**

- Modify: `pentest-agent-harness/tools/build_auth_session_plan.py`
- Modify: `pentest-agent-harness/tests/test_auth_session_plan.py`

**Interfaces:**

- Consumes: `profile.auth_surface.login` 的 `page_url`、`captcha`、`otp`、`api_candidates`、可选 `handoff`。
- Produces: 单个 `interaction_required` 项，`kind="login_handoff"`、`checkpoint_id="auth-login-handoff"`，及 `handoff.protected_entry`。

- [x] **Step 1: 写失败的计划测试**

将验证码/短信双交互断言替换为单一通用交接：

~~~python
assert plan["interaction_required"] == [{
    "kind": "login_handoff",
    "status": "waiting_for_user",
    "checkpoint_id": "auth-login-handoff",
    "prompt": "请在页面中完成登录后点击“已完成登录，继续测试”。",
    "detection_hints": ["image_captcha", "sms_otp"],
}]
assert plan["resume_checkpoints"][0]["path"] == "checkpoints/auth-login-handoff.json"
~~~

- [x] **Step 2: 运行测试确认失败**

Run: `python3 pentest-agent-harness/tests/test_auth_session_plan.py`

Expected: FAIL，因为现有计划会产生两个旧式交互项。

- [x] **Step 3: 修改认证计划**

重构 `auth_interactions` 为单个 handoff：验证码映射 `image_captcha`、OTP 映射 `sms_otp`、存在 `page_url` 映射 `login_page`。设置 `auth_surface.login.handoff.enabled` 默认 true，保留 `force_manual`。

保护入口优先级：`handoff.protected_entry`，第一个只读 `api_candidates`，第一个 `scope.protected_resources` 的 `GET`/ `HEAD`；无候选时写 `{"result": "unavailable"}`。

~~~python
"handoff": {
    "enabled": True,
    "checkpoint_id": "auth-login-handoff",
    "protected_entry": protected_entry,
    "detection_hints": hints,
}
~~~

- [x] **Step 4: 运行认证计划测试确认通过**

Run: `python3 pentest-agent-harness/tests/test_auth_session_plan.py`

Expected: PASS。

- [x] **Step 5: 提交计划迁移**

~~~bash
git add pentest-agent-harness/tools/build_auth_session_plan.py pentest-agent-harness/tests/test_auth_session_plan.py
git commit -m "feat: unify auth prompts into login handoff"
~~~

## Task 4: 实现会话验证、暂停和恢复

**Files:**

- Create: `pentest-agent-harness/tools/validate_login_handoff.py`
- Create: `pentest-agent-harness/tests/test_validate_login_handoff.py`
- Modify: `pentest-agent-harness/tools/run_pentest_agent.py`
- Modify: `pentest-agent-harness/tests/test_run_pentest_agent.py`

**Interfaces:**

- Consumes: `validate_login_handoff(run_dir: Path, bridge_result: dict[str, Any]) -> dict[str, Any]`。
- `bridge_result` 必有 `handoff_id`、`page_url`、`user_confirmation`、`cookies`、`protected_entry_result`；cookies 仅允许名称、域、路径、标志、过期时间和不可逆指纹。
- Produces: `session_validation.json`、`checkpoints/auth-login-handoff.json`、`progress.json`、`events.jsonl`。

- [x] **Step 1: 写失败的验证器测试**

~~~python
def test_validated_handoff_authenticates_and_allows_resume(tmp_path):
    result = validate_login_handoff(tmp_path, confirmed_result(
        cookies=[valid_cookie()],
        protected_entry_result={
            "method": "GET",
            "status": 200,
            "final_url": "https://crm.example.test/api/me",
            "identity_match": True,
        },
    ))
    assert result["status"] == "authenticated"
    assert load_json(tmp_path / "checkpoints/auth-login-handoff.json")["status"] == "authenticated"
~~~

再覆盖未确认、过期 Cookie、域不匹配、401、403、回到登录页、身份不匹配、保护入口不可用和敏感原值脱敏。

- [x] **Step 2: 运行测试确认失败**

Run: `python3 pentest-agent-harness/tests/test_validate_login_handoff.py`

Expected: FAIL，无法导入 `validate_login_handoff`。

- [x] **Step 3: 实现验证器和 CLI**

实现：

~~~python
def cookie_status(cookies: list[dict[str, Any]], page_url: str, now: datetime) -> str: ...
def protected_entry_status(result: dict[str, Any], login_url: str) -> str: ...
def validate_login_handoff(run_dir: Path, bridge_result: dict[str, Any]) -> dict[str, Any]: ...
~~~

未确认返回 `waiting_for_user`；Cookie 合格且入口为 2xx、最终 URL 存在且未回登录页、`identity_match is not False` 时返回 `authenticated`；Cookie 缺失可继续由入口判断；Cookie 过期或 host/path 不匹配、入口 401/403、回登录页、缺失最终 URL 或身份不一致返回 `waiting_for_user`；无保护入口、适配器不支持会话观察或跨域限制返回 `blocked`。调用 `append_event`、`write_checkpoint`、`write_progress`，且事件具备 `analysis`、`plan`、`how`、`result`、`next_action`。

CLI：`python3 tools/validate_login_handoff.py <run_dir> <bridge_result.json>`。

- [x] **Step 4: 接入运行器放行条件**

在 `run_pentest_agent.py` 新增 `auth_handoff_context(run_dir)`，读取 `login_handoff.json`、`session_validation.json` 和 `auth_session_plan.json`。validation 为 `authenticated` 时，报告上下文的 `interaction_required` 必须为空；其他状态时 handoff 是唯一人工 blocker。对 `blocked` 添加 `auth_handoff_blocked` tester feedback，对 `waiting_for_user` 添加 `auth_handoff_pending`。旧 captcha/OTP 项不再单独作为 blocker 重建。

- [x] **Step 5: 运行局部回归确认通过**

Run: `python3 pentest-agent-harness/tests/test_validate_login_handoff.py && python3 pentest-agent-harness/tests/test_run_pentest_agent.py`

Expected: PASS；authenticated 场景没有人工 blocker。

- [x] **Step 6: 提交验证与恢复**

~~~bash
git add pentest-agent-harness/tools/validate_login_handoff.py pentest-agent-harness/tools/run_pentest_agent.py pentest-agent-harness/tests/test_validate_login_handoff.py pentest-agent-harness/tests/test_run_pentest_agent.py
git commit -m "feat: validate login handoff before resuming tests"
~~~

## Task 5: 固化 Agent/Skill adapter contract 和全量验证

**Files:**

- Modify: `pentest-agent-harness/agents/browser-pentest-agent.md`
- Modify: `pentest-agent-harness/skills/auth-session-testing/SKILL.md`
- Modify: `pentest-agent-harness/AGENT.md`
- Modify: `pentest-agent-harness/opencode.json`
- Modify: `pentest-agent-harness/tests/test_agent_contracts.py`
- Modify: `pentest-agent-harness/tests/test_opencode_config.py`
- Test: `pentest-agent-harness/tests/run_all.py`

**Interfaces:**

- Adapter 输入：`login_handoff_injection.json.script`。
- Adapter 输出：脱敏 `bridge_result.json`，字段与 Task 4 相同。
- 统一 checkpoint ID：`auth-login-handoff`。

- [x] **Step 1: 写失败的文档和配置质量测试**

在 `test_agent_contracts.py` 断言 browser Agent 包含 `browser_session_bridge.py`、`validate_login_handoff.py`、`pentest-agent:login-confirmed`、`auth-login-handoff` 和“不读取 Cookie 原值”。在 `test_opencode_config.py` 断言 browser 子 Agent prompt 包含“执行 bridge script、等待用户点击、输出 bridge result、认证成功前不继续”。

- [x] **Step 2: 运行测试确认失败**

Run: `python3 pentest-agent-harness/tests/test_agent_contracts.py && python3 pentest-agent-harness/tests/test_opencode_config.py`

Expected: FAIL，因为现有文档未定义 bridge adapter contract。

- [x] **Step 3: 写入强制执行顺序**

在 browser Agent、Skill、根 `AGENT.md` 和 OpenCode prompt 中写入：读取 `login_handoff_injection.json`；用当前浏览器 adapter 的 evaluate 执行 `script`；捕获 `pentest-agent:login-confirmed`；用户点击后读取受限 Cookie 元数据和 scope 内认证入口结果；写入脱敏 `bridge_result.json`；调用 `validate_login_handoff.py`；只有 `authenticated` 才恢复工作队列。适配器能力缺失分别写 `browser.bridge_injection_unsupported` 或 `browser.session_observation_unsupported`，状态为 `blocked`。

- [x] **Step 4: 运行文档检查和全量回归**

Run: `python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness && python3 pentest-agent-harness/tests/run_all.py`

Expected: 先输出 `valid agent/skill docs`，后续所有发现的 `test_*.py` 均 PASS。

- [x] **Step 5: 审查敏感性和提交**

Run: `git diff --check && rg -n 'document\\.cookie|fetch\\(|XMLHttpRequest|password_value|"cookie"\\s*:' pentest-agent-harness/tools/browser_session_bridge.py pentest-agent-harness/tools/validate_login_handoff.py`

Expected: diff 无空白错误；bridge 脚本不读取 Cookie 或发网络请求；验证器没有敏感原值写入。

~~~bash
git add pentest-agent-harness/agents/browser-pentest-agent.md pentest-agent-harness/skills/auth-session-testing/SKILL.md pentest-agent-harness/AGENT.md pentest-agent-harness/opencode.json pentest-agent-harness/tests/test_agent_contracts.py pentest-agent-harness/tests/test_opencode_config.py
git commit -m "docs: document browser login handoff workflow"
~~~

## 实施后验收

1. 临时 CRM profile 的浏览器观察含密码字段和验证码元素时，bridge 生成只含结构性信号的 handoff 与 Shadow DOM 脚本。
2. 用户点击控件后，bridge result 只含 Cookie 元数据和认证入口摘要；有效会话得到 `authenticated` 并清空 `interaction_required`。
3. Cookie 异常、认证入口重定向/401/403 或身份不一致时，运行保持 `waiting_for_user`，认证后任务不运行。
4. 浏览器适配器不支持 evaluate 或会话观察时，运行进入 `blocked`，报告上下文包含可行动的测试人员反馈。
5. `events.jsonl`、checkpoint、progress、artifact、报告上下文和控制台输出均不含密码、验证码、Cookie/Token 原值。
