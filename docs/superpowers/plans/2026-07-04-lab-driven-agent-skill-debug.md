# 靶场驱动 Agent/Skill 调试闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Juice-Shop 建立可复用的靶场 profile、预期漏洞基准、debug-agent 归因报告和回归学习更新闭环，让每轮调试都能知道哪个 Agent/Skill 需要优化。

**Architecture:** 第一阶段只使用本地 JSON、Markdown 和现有直接运行式 Python 测试，不依赖真实 Juice-Shop 服务在线。新增 `labs/<lab_id>/` 作为可替换靶场配置层，新增 `debug-agent` 与 lab debug 工具作为现有 MVP 闭环之后的归因层，不改变已跑通的 dry-run 主流程。

**Tech Stack:** Python 3 标准库、JSON、Markdown、现有 `validate_schema.py` schema 子集校验、现有 `tests/run_all.py` 测试入口。

---

## 文件结构

新增文件：

- `pentest-agent-harness/labs/juice-shop/lab_profile.json`：Juice-Shop 靶场描述，包含目标 URL、技术栈、入口、安全边界和启用 Agent。
- `pentest-agent-harness/labs/juice-shop/expected_findings.json`：Juice-Shop 第一批预期漏洞基准目录。
- `pentest-agent-harness/labs/juice-shop/scope.json`：允许测试范围和禁止动作。
- `pentest-agent-harness/labs/juice-shop/accounts.example.json`：账号配置模板，只放占位字段。
- `pentest-agent-harness/labs/juice-shop/README.md`：如何把本地 Juice-Shop 接入 harness。
- `pentest-agent-harness/agents/debug-agent.md`：调试归因 Agent 文档。
- `pentest-agent-harness/skills/lab-profile/SKILL.md`：读取和校验靶场 profile 的 Skill。
- `pentest-agent-harness/skills/lab-debug-analysis/SKILL.md`：对比预期漏洞和实际输出、生成归因的 Skill。
- `pentest-agent-harness/schemas/lab_profile.schema.json`
- `pentest-agent-harness/schemas/expected_findings.schema.json`
- `pentest-agent-harness/schemas/lab_debug_report.schema.json`
- `pentest-agent-harness/schemas/agent_issue_log.schema.json`
- `pentest-agent-harness/tools/init_lab_run.py`
- `pentest-agent-harness/tools/compare_lab_expected_findings.py`
- `pentest-agent-harness/tools/update_regression_from_lab_debug.py`
- `pentest-agent-harness/tests/test_lab_profile_fixtures.py`
- `pentest-agent-harness/tests/test_init_lab_run.py`
- `pentest-agent-harness/tests/test_lab_debug_compare.py`
- `pentest-agent-harness/tests/test_update_regression_from_lab_debug.py`

修改文件：

- `pentest-agent-harness/tests/test_validate_schema.py`：加入新 schema 的最小对象校验。
- `pentest-agent-harness/tests/test_agent_skill_doc_quality.py` 或文档质量输入范围保持兼容，确保新增 Agent/Skill 文档通过现有质量门禁。

不修改：

- 不改 `run_harness_dry_run.py`，避免第一阶段把靶场调试层耦合进基础 dry-run。
- 不改真实浏览器自动化逻辑；Juice-Shop 当前打开页面用于后续阶段真实动态调试。

## Task 1: Juice-Shop Lab Fixtures 与 Schemas

**Files:**
- Create: `pentest-agent-harness/tests/test_lab_profile_fixtures.py`
- Create: `pentest-agent-harness/labs/juice-shop/lab_profile.json`
- Create: `pentest-agent-harness/labs/juice-shop/expected_findings.json`
- Create: `pentest-agent-harness/labs/juice-shop/scope.json`
- Create: `pentest-agent-harness/labs/juice-shop/accounts.example.json`
- Create: `pentest-agent-harness/labs/juice-shop/README.md`
- Create: `pentest-agent-harness/schemas/lab_profile.schema.json`
- Create: `pentest-agent-harness/schemas/expected_findings.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_lab_profile_fixtures.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB_DIR = ROOT / "labs" / "juice-shop"


def run_validator(schema_name: str, data_path: Path):
    return subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "validate_schema.py"),
            str(ROOT / "schemas" / schema_name),
            str(data_path),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_juice_shop_lab_profile_fixture_is_valid_and_generic():
    profile_path = LAB_DIR / "lab_profile.json"
    result = run_validator("lab_profile.schema.json", profile_path)

    assert result.returncode == 0, result.stderr
    profile = load_json(profile_path)
    assert profile["lab_id"] == "juice-shop"
    assert profile["mode"] == "graybox-lab"
    assert profile["target_url"] == "http://localhost:3000"
    assert profile["source_repo_path"] == ""
    assert "browser-pentest-agent" in profile["agents_enabled"]
    assert profile["safe_test_policy"]["destructive_allowed"] is False
    assert "payment" in profile["safe_test_policy"]["forbidden_actions"]


def test_juice_shop_expected_findings_fixture_is_valid_and_has_debug_coverage():
    expected_path = LAB_DIR / "expected_findings.json"
    result = run_validator("expected_findings.schema.json", expected_path)

    assert result.returncode == 0, result.stderr
    catalog = load_json(expected_path)
    findings = catalog["findings"]
    categories = {item["category"] for item in findings}
    assert catalog["lab_id"] == "juice-shop"
    assert len(findings) >= 6
    assert {"authentication", "open_redirect", "xss", "authorization", "injection"} <= categories
    assert any(item["requires_browser"] is True for item in findings)
    assert any(item["requires_source"] is True for item in findings)
    assert all(item["safe_reproduction_hint"] for item in findings)


def test_juice_shop_scope_and_accounts_template_do_not_store_real_passwords():
    scope = load_json(LAB_DIR / "scope.json")
    accounts = load_json(LAB_DIR / "accounts.example.json")

    assert scope["target_url"] == "http://localhost:3000"
    assert scope["destructive_allowed"] is False
    assert "http://localhost:3000" in scope["allowed_hosts"]
    assert accounts["accounts"][0]["password_env"].startswith("JUICE_SHOP_")
    assert "password" not in accounts["accounts"][0]


if __name__ == "__main__":
    test_juice_shop_lab_profile_fixture_is_valid_and_generic()
    test_juice_shop_expected_findings_fixture_is_valid_and_has_debug_coverage()
    test_juice_shop_scope_and_accounts_template_do_not_store_real_passwords()
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_profile_fixtures.py
```

Expected: FAIL because `labs/juice-shop/lab_profile.json` and new schemas do not exist.

- [ ] **Step 3: 创建 schemas**

Create `pentest-agent-harness/schemas/lab_profile.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "name", "mode", "target_url", "source_repo_path", "tech_stack", "entrypoints", "safe_test_policy", "agents_enabled"],
  "properties": {
    "lab_id": {"type": "string"},
    "name": {"type": "string"},
    "mode": {"type": "string", "enum": ["graybox-lab", "blackbox-lab", "real-project"]},
    "target_url": {"type": "string"},
    "source_repo_path": {"type": "string"},
    "tech_stack": {"type": "array"},
    "entrypoints": {"type": "array"},
    "safe_test_policy": {"type": "object"},
    "agents_enabled": {"type": "array"}
  }
}
```

Create `pentest-agent-harness/schemas/expected_findings.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "catalog_version", "findings"],
  "properties": {
    "lab_id": {"type": "string"},
    "catalog_version": {"type": "string"},
    "findings": {"type": "array"}
  }
}
```

- [ ] **Step 4: 创建 Juice-Shop fixtures**

Create `pentest-agent-harness/labs/juice-shop/lab_profile.json`:

```json
{
  "lab_id": "juice-shop",
  "name": "OWASP Juice Shop",
  "mode": "graybox-lab",
  "target_url": "http://localhost:3000",
  "source_repo_path": "",
  "tech_stack": ["Angular", "Node.js", "Express", "SQLite", "Sequelize"],
  "entrypoints": [
    "login",
    "search",
    "products",
    "basket",
    "customer-feedback",
    "ai-chat",
    "photo-wall",
    "redirect"
  ],
  "safe_test_policy": {
    "destructive_allowed": false,
    "max_request_rate_per_second": 2,
    "allowed_mutations": ["login", "add_to_basket", "submit_feedback_with_safe_payload"],
    "forbidden_actions": ["payment", "spam_email", "data_deletion", "persistent_payload"]
  },
  "agents_enabled": [
    "recon-agent",
    "static-audit-agent",
    "frontend-audit-agent",
    "browser-pentest-agent",
    "evaluation-agent",
    "report-agent",
    "debug-agent"
  ]
}
```

Create `pentest-agent-harness/labs/juice-shop/expected_findings.json`:

```json
{
  "lab_id": "juice-shop",
  "catalog_version": "2026-07-04",
  "findings": [
    {
      "id": "juice-shop-authentication-001",
      "title": "登录与会话流程需要认证控制验证",
      "category": "authentication",
      "risk": "High",
      "expected_agents": ["browser-pentest-agent", "evaluation-agent"],
      "expected_skills": ["auth-session-testing", "finding-verification"],
      "requires_source": false,
      "requires_browser": true,
      "requires_two_roles": false,
      "safe_reproduction_hint": "只验证登录状态、退出后访问和会话变化，不进行账号爆破",
      "evidence_requirements": ["登录前状态", "登录后状态", "退出后访问结果"]
    },
    {
      "id": "juice-shop-authorization-001",
      "title": "跨用户资源访问需要授权边界验证",
      "category": "authorization",
      "risk": "High",
      "expected_agents": ["static-audit-agent", "browser-pentest-agent", "evaluation-agent"],
      "expected_skills": ["control-driven-audit", "auth-session-testing", "finding-verification"],
      "requires_source": true,
      "requires_browser": true,
      "requires_two_roles": true,
      "safe_reproduction_hint": "只比较两个测试账号对同类资源的访问差异，不修改他人数据",
      "evidence_requirements": ["资源标识", "角色或账号上下文", "请求响应对比", "源码控制点"]
    },
    {
      "id": "juice-shop-injection-001",
      "title": "搜索和登录相关输入需要注入风险验证",
      "category": "injection",
      "risk": "High",
      "expected_agents": ["static-audit-agent", "browser-pentest-agent", "evaluation-agent"],
      "expected_skills": ["sink-driven-audit", "taint-analysis", "api-fuzzing-light"],
      "requires_source": true,
      "requires_browser": true,
      "requires_two_roles": false,
      "safe_reproduction_hint": "使用无害探测字符串观察错误、过滤和查询行为，不进行数据破坏",
      "evidence_requirements": ["输入点", "后端 sink", "错误或响应差异", "安全影响说明"]
    },
    {
      "id": "juice-shop-xss-001",
      "title": "前端可控输入需要 XSS source/sink 验证",
      "category": "xss",
      "risk": "High",
      "expected_agents": ["frontend-audit-agent", "browser-pentest-agent", "evaluation-agent"],
      "expected_skills": ["frontend-static-audit", "frontend-runtime-test", "finding-verification"],
      "requires_source": true,
      "requires_browser": true,
      "requires_two_roles": false,
      "safe_reproduction_hint": "使用安全占位 payload 验证编码和渲染路径，不持久化恶意脚本",
      "evidence_requirements": ["source", "sink", "payload 占位", "浏览器观察"]
    },
    {
      "id": "juice-shop-open-redirect-001",
      "title": "外部跳转入口需要重定向验证",
      "category": "open_redirect",
      "risk": "Medium",
      "expected_agents": ["recon-agent", "browser-pentest-agent", "evaluation-agent"],
      "expected_skills": ["browser-recon", "frontend-runtime-test", "finding-verification"],
      "requires_source": false,
      "requires_browser": true,
      "requires_two_roles": false,
      "safe_reproduction_hint": "只验证跳转目标是否可控，不提交敏感数据",
      "evidence_requirements": ["入口 URL", "跳转参数", "浏览器观察", "安全影响说明"]
    },
    {
      "id": "juice-shop-sensitive-data-001",
      "title": "公开可达资源需要敏感信息泄露验证",
      "category": "sensitive_data_exposure",
      "risk": "Medium",
      "expected_agents": ["recon-agent", "static-audit-agent", "browser-pentest-agent"],
      "expected_skills": ["recon-enumeration", "config-driven-audit", "browser-recon"],
      "requires_source": true,
      "requires_browser": true,
      "requires_two_roles": false,
      "safe_reproduction_hint": "只读取公开响应和静态资源，不下载大文件或抓取个人数据",
      "evidence_requirements": ["公开入口", "响应摘要", "源码或配置位置"]
    }
  ]
}
```

Create `pentest-agent-harness/labs/juice-shop/scope.json`:

```json
{
  "lab_id": "juice-shop",
  "target_url": "http://localhost:3000",
  "allowed_hosts": ["http://localhost:3000"],
  "allowed_paths": ["/", "/#/login", "/#/search", "/#/basket", "/#/contact", "/#/chatbot", "/#/photo-wall", "/redirect"],
  "destructive_allowed": false,
  "max_request_rate_per_second": 2,
  "forbidden_actions": ["payment", "spam_email", "data_deletion", "persistent_payload"]
}
```

Create `pentest-agent-harness/labs/juice-shop/accounts.example.json`:

```json
{
  "lab_id": "juice-shop",
  "accounts": [
    {
      "role": "standard-user",
      "username_env": "JUICE_SHOP_USER_EMAIL",
      "password_env": "JUICE_SHOP_USER_PASSWORD",
      "notes": "使用环境变量提供本地靶场测试账号，不提交真实密码"
    },
    {
      "role": "comparison-user",
      "username_env": "JUICE_SHOP_SECOND_USER_EMAIL",
      "password_env": "JUICE_SHOP_SECOND_USER_PASSWORD",
      "notes": "用于授权和资源归属对比"
    }
  ]
}
```

Create `pentest-agent-harness/labs/juice-shop/README.md`:

```markdown
# Juice-Shop Lab Profile

本目录用于把本地 OWASP Juice Shop 接入 `pentest-agent-harness` 的靶场调试闭环。

默认目标地址是 `http://localhost:3000`。`source_repo_path` 在 `lab_profile.json` 中保持为空，执行灰白盒调试前可以通过 `init_lab_run.py --source-repo-path` 覆盖。

账号不写入仓库。复制 `accounts.example.json` 的字段含义，在本机环境变量中提供测试账号。

第一阶段只做 profile、expected findings 和 debug-agent 归因，不执行破坏性测试。
```

- [ ] **Step 5: 扩展 schema 最小对象测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` in `test_new_mvp_closure_schemas_accept_minimal_objects` and add:

```python
        "lab_profile.schema.json": {
            "lab_id": "juice-shop",
            "name": "OWASP Juice Shop",
            "mode": "graybox-lab",
            "target_url": "http://localhost:3000",
            "source_repo_path": "",
            "tech_stack": [],
            "entrypoints": [],
            "safe_test_policy": {},
            "agents_enabled": [],
        },
        "expected_findings.schema.json": {
            "lab_id": "juice-shop",
            "catalog_version": "2026-07-04",
            "findings": [],
        },
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_profile_fixtures.py
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: both PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add pentest-agent-harness/labs/juice-shop pentest-agent-harness/schemas/lab_profile.schema.json pentest-agent-harness/schemas/expected_findings.schema.json pentest-agent-harness/tests/test_lab_profile_fixtures.py pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: add juice shop lab profile fixtures"
```

## Task 2: Lab Run 初始化工具

**Files:**
- Create: `pentest-agent-harness/tests/test_init_lab_run.py`
- Create: `pentest-agent-harness/tools/init_lab_run.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_init_lab_run.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "init_lab_run.py"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_init_lab_run_copies_lab_inputs_and_writes_run_state(tmp_path):
    run_dir = tmp_path / "runs" / "juice-shop-debug"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--lab",
            "juice-shop",
            "--run-dir",
            str(run_dir),
            "--source-repo-path",
            "/workspace/juice-shop",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "initialized lab run" in result.stdout
    assert (run_dir / "lab_profile.json").exists()
    assert (run_dir / "expected_findings.json").exists()
    assert (run_dir / "scope.json").exists()
    assert (run_dir / "run_state.json").exists()
    assert (run_dir / "artifacts" / "debug-agent").is_dir()

    profile = load_json(run_dir / "lab_profile.json")
    state = load_json(run_dir / "run_state.json")
    assert profile["source_repo_path"] == "/workspace/juice-shop"
    assert state["lab_id"] == "juice-shop"
    assert state["current_phase"] == "lab-initialized"
    assert state["pending_agents"] == ["recon-agent"]
    assert state["debug"] == {
        "expected_findings": 6,
        "found": 0,
        "missed": 0,
        "blocked": 0,
        "false_positive": 0,
    }


def test_init_lab_run_rejects_unknown_lab_without_traceback(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--lab",
            "unknown-lab",
            "--run-dir",
            str(tmp_path / "run"),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert "unknown lab: unknown-lab" in result.stderr
    assert "Traceback" not in result.stderr


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_init_lab_run_copies_lab_inputs_and_writes_run_state(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_init_lab_run_rejects_unknown_lab_without_traceback(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_init_lab_run.py
```

Expected: FAIL because `tools/init_lab_run.py` does not exist.

- [ ] **Step 3: 实现 `init_lab_run.py`**

Create `pentest-agent-harness/tools/init_lab_run.py` with:

```python
#!/usr/bin/env python3
import argparse
import json
import shutil
import sys
from pathlib import Path


class LabRunError(ValueError):
    pass


ROOT = Path(__file__).resolve().parents[1]


def load_json_object(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise LabRunError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise LabRunError(f"cannot read {filename}: {error.strerror}") from error
    if not isinstance(data, dict):
        raise LabRunError(f"{path.name} must contain a JSON object")
    return data


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def lab_dir(lab_id: str) -> Path:
    if not lab_id or "/" in lab_id or "\\" in lab_id or ".." in lab_id:
        raise LabRunError(f"unknown lab: {lab_id}")
    path = ROOT / "labs" / lab_id
    if not path.is_dir():
        raise LabRunError(f"unknown lab: {lab_id}")
    return path


def copy_json(src: Path, dst: Path) -> dict:
    data = load_json_object(src)
    write_json(dst, data)
    return data


def init_lab_run(lab_id: str, run_dir: Path, source_repo_path: str = "") -> dict:
    source = lab_dir(lab_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    profile = copy_json(source / "lab_profile.json", run_dir / "lab_profile.json")
    if source_repo_path:
        profile["source_repo_path"] = source_repo_path
        write_json(run_dir / "lab_profile.json", profile)
    expected = copy_json(source / "expected_findings.json", run_dir / "expected_findings.json")
    copy_json(source / "scope.json", run_dir / "scope.json")
    if (source / "accounts.example.json").exists():
        shutil.copyfile(source / "accounts.example.json", run_dir / "accounts.example.json")

    state = {
        "run_id": run_dir.name,
        "lab_id": profile["lab_id"],
        "target_url": profile["target_url"],
        "repo_path": profile["source_repo_path"],
        "scope_hash": "lab-profile",
        "config_hash": expected["catalog_version"],
        "target_fingerprint": "",
        "current_phase": "lab-initialized",
        "current_round": "R0",
        "status": "running",
        "completed_agents": [],
        "failed_agents": [],
        "pending_agents": ["recon-agent"],
        "debug": {
            "expected_findings": len(expected.get("findings", [])),
            "found": 0,
            "missed": 0,
            "blocked": 0,
            "false_positive": 0,
        },
    }
    write_json(run_dir / "run_state.json", state)
    (run_dir / "artifacts" / "debug-agent").mkdir(parents=True, exist_ok=True)
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lab", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--source-repo-path", default="")
    args = parser.parse_args()
    try:
        state = init_lab_run(args.lab, Path(args.run_dir), args.source_repo_path)
    except (LabRunError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"initialized lab run: {state['run_id']} ({state['lab_id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_init_lab_run.py
```

Expected: PASS with no output.

- [ ] **Step 5: Commit**

```bash
git add pentest-agent-harness/tests/test_init_lab_run.py pentest-agent-harness/tools/init_lab_run.py
git commit -m "feat: initialize lab debug runs"
```

## Task 3: Expected Findings 对比与 Debug Agent 归因

**Files:**
- Create: `pentest-agent-harness/tests/test_lab_debug_compare.py`
- Create: `pentest-agent-harness/tools/compare_lab_expected_findings.py`
- Create: `pentest-agent-harness/schemas/lab_debug_report.schema.json`
- Create: `pentest-agent-harness/schemas/agent_issue_log.schema.json`
- Create: `pentest-agent-harness/agents/debug-agent.md`
- Create: `pentest-agent-harness/skills/lab-debug-analysis/SKILL.md`
- Create: `pentest-agent-harness/skills/lab-profile/SKILL.md`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_lab_debug_compare.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "compare_lab_expected_findings.py"


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_run(run_dir: Path) -> None:
    write_json(
        run_dir / "expected_findings.json",
        {
            "lab_id": "juice-shop",
            "catalog_version": "2026-07-04",
            "findings": [
                {
                    "id": "juice-shop-open-redirect-001",
                    "title": "外部跳转入口需要重定向验证",
                    "category": "open_redirect",
                    "risk": "Medium",
                    "expected_agents": ["browser-pentest-agent"],
                    "expected_skills": ["browser-recon"],
                    "requires_source": False,
                    "requires_browser": True,
                    "requires_two_roles": False,
                    "safe_reproduction_hint": "只验证跳转目标是否可控",
                    "evidence_requirements": ["入口 URL"],
                },
                {
                    "id": "juice-shop-authorization-001",
                    "title": "跨用户资源访问需要授权边界验证",
                    "category": "authorization",
                    "risk": "High",
                    "expected_agents": ["static-audit-agent", "browser-pentest-agent"],
                    "expected_skills": ["auth-session-testing"],
                    "requires_source": True,
                    "requires_browser": True,
                    "requires_two_roles": True,
                    "safe_reproduction_hint": "只比较测试账号访问差异",
                    "evidence_requirements": ["资源标识"],
                },
            ],
        },
    )
    write_json(
        run_dir / "findings" / "browser-pentest-agent" / "findings.json",
        [
            {
                "id": "F-OPEN-REDIRECT",
                "title": "外部跳转入口需要重定向验证",
                "severity": "Medium",
                "category": "open_redirect",
                "expected_finding_id": "juice-shop-open-redirect-001",
                "evidence": ["http://localhost:3000/redirect?to=https://example.com"],
            },
            {
                "id": "F-UNEXPECTED",
                "title": "未在基准目录中的额外发现",
                "severity": "Low",
                "category": "misc",
                "evidence": ["artifacts/browser-pentest-agent/extra.md"],
            },
        ],
    )
    write_json(
        run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence.json",
        {
            "agent": "browser-pentest-agent",
            "mode": "simulated",
            "summary": {"total": 1, "verified": 1, "reproduced": 1, "blocked": 0},
            "items": [
                {
                    "verification_id": "VQ-001",
                    "source_id": "juice-shop-open-redirect-001",
                    "result": "reproduced",
                    "evidence": ["http://localhost:3000/redirect?to=https://example.com"],
                }
            ],
        },
    )


def test_compare_lab_expected_findings_writes_debug_report_and_issue_log(tmp_path):
    run_dir = tmp_path / "run"
    seed_run(run_dir)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "lab debug comparison complete" in result.stdout

    report = load_json(run_dir / "artifacts" / "debug-agent" / "lab_debug_report.json")
    issues = load_json(run_dir / "artifacts" / "debug-agent" / "agent_issue_log.json")
    summary = (run_dir / "reports" / "lab-debug-summary.md").read_text(encoding="utf-8")

    assert report["lab_id"] == "juice-shop"
    assert report["summary"] == {
        "expected": 2,
        "found": 1,
        "missed": 1,
        "blocked": 0,
        "false_positive": 1,
    }
    assert report["found"][0]["expected_finding_id"] == "juice-shop-open-redirect-001"
    assert report["missed"][0]["expected_finding_id"] == "juice-shop-authorization-001"
    assert issues["issues"][0]["root_cause"] == "browser.session_setup_failed"
    assert issues["issues"][0]["affected_agent"] == "browser-pentest-agent"
    assert issues["issues"][0]["affected_skill"] == "auth-session-testing"
    assert "juice-shop-authorization-001" in summary


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_compare_lab_expected_findings_writes_debug_report_and_issue_log(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_debug_compare.py
```

Expected: FAIL because `tools/compare_lab_expected_findings.py` does not exist.

- [ ] **Step 3: 创建 debug schemas**

Create `pentest-agent-harness/schemas/lab_debug_report.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "summary", "found", "missed", "blocked", "false_positive"],
  "properties": {
    "lab_id": {"type": "string"},
    "summary": {"type": "object"},
    "found": {"type": "array"},
    "missed": {"type": "array"},
    "blocked": {"type": "array"},
    "false_positive": {"type": "array"}
  }
}
```

Create `pentest-agent-harness/schemas/agent_issue_log.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "issues"],
  "properties": {
    "lab_id": {"type": "string"},
    "issues": {"type": "array"}
  }
}
```

- [ ] **Step 4: 实现 `compare_lab_expected_findings.py`**

Create `pentest-agent-harness/tools/compare_lab_expected_findings.py` with:

```python
#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


class LabDebugError(ValueError):
    pass


DEFAULT_ROOT_CAUSE = {
    "authentication": ("browser.session_setup_failed", "browser-pentest-agent", "auth-session-testing"),
    "authorization": ("browser.session_setup_failed", "browser-pentest-agent", "auth-session-testing"),
    "injection": ("static.source_sink_missed", "static-audit-agent", "taint-analysis"),
    "xss": ("frontend.api_route_missed", "frontend-audit-agent", "frontend-runtime-test"),
    "open_redirect": ("browser.replay_failed", "browser-pentest-agent", "finding-verification"),
    "sensitive_data_exposure": ("recon.asset_missed", "recon-agent", "recon-enumeration"),
}


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise LabDebugError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise LabDebugError(f"cannot read {filename}: {error.strerror}") from error


def load_expected(run_dir: Path) -> dict:
    data = load_json(run_dir / "expected_findings.json")
    if not isinstance(data, dict) or not isinstance(data.get("findings"), list):
        raise LabDebugError("expected_findings.json must contain findings array")
    return data


def load_reported_findings(run_dir: Path) -> list[dict]:
    findings = []
    findings_dir = run_dir / "findings"
    if not findings_dir.exists():
        return findings
    for path in sorted(findings_dir.glob("*/findings.json")):
        data = load_json(path)
        if isinstance(data, list):
            findings.extend(item for item in data if isinstance(item, dict))
        elif isinstance(data, dict) and isinstance(data.get("findings"), list):
            findings.extend(item for item in data["findings"] if isinstance(item, dict))
    return findings


def matched_expected_ids(findings: list[dict]) -> set[str]:
    return {
        str(item["expected_finding_id"])
        for item in findings
        if item.get("expected_finding_id")
    }


def issue_for_missed(index: int, finding: dict) -> dict:
    root_cause, agent, skill = DEFAULT_ROOT_CAUSE.get(
        finding.get("category", ""),
        ("skill.instruction_too_vague", finding.get("expected_agents", ["evaluation-agent"])[0], finding.get("expected_skills", ["finding-verification"])[0]),
    )
    return {
        "issue_id": f"LAB-DEBUG-{index:03d}",
        "expected_finding_id": finding["id"],
        "status": "missed",
        "root_cause": root_cause,
        "affected_agent": agent,
        "affected_skill": skill,
        "evidence": [f"expected finding not matched: {finding['title']}"],
        "recommended_change": f"增强 {agent} 对 {finding['category']} 的识别、证据采集和验证步骤",
        "regression_case": True,
    }


def render_summary(report: dict, issues: dict) -> str:
    lines = [
        "# Lab Debug Summary",
        "",
        f"- Lab: `{report['lab_id']}`",
        f"- Expected: {report['summary']['expected']}",
        f"- Found: {report['summary']['found']}",
        f"- Missed: {report['summary']['missed']}",
        f"- Blocked: {report['summary']['blocked']}",
        f"- False Positive: {report['summary']['false_positive']}",
        "",
        "## Missed Findings",
        "",
    ]
    if report["missed"]:
        for item in report["missed"]:
            lines.append(f"- `{item['expected_finding_id']}` {item['title']} -> {item['root_cause']}")
    else:
        lines.append("- 无")
    lines.extend(["", "## Agent Issues", ""])
    if issues["issues"]:
        for item in issues["issues"]:
            lines.append(f"- `{item['issue_id']}` {item['affected_agent']} / {item['affected_skill']}: {item['recommended_change']}")
    else:
        lines.append("- 无")
    return "\n".join(lines) + "\n"


def compare_lab_expected_findings(run_dir: Path) -> dict:
    expected = load_expected(run_dir)
    findings = load_reported_findings(run_dir)
    matched = matched_expected_ids(findings)
    expected_by_id = {item["id"]: item for item in expected["findings"] if isinstance(item, dict) and item.get("id")}

    found = [
        {
            "expected_finding_id": finding_id,
            "finding_id": item.get("id", ""),
            "title": item.get("title", ""),
            "category": item.get("category", ""),
            "evidence": item.get("evidence", []),
        }
        for item in findings
        for finding_id in [item.get("expected_finding_id")]
        if finding_id in expected_by_id
    ]
    missed = []
    issues = []
    for expected_item in expected["findings"]:
        if expected_item["id"] in matched:
            continue
        issue = issue_for_missed(len(issues) + 1, expected_item)
        missed.append(
            {
                "expected_finding_id": expected_item["id"],
                "title": expected_item["title"],
                "category": expected_item["category"],
                "risk": expected_item["risk"],
                "root_cause": issue["root_cause"],
                "affected_agent": issue["affected_agent"],
                "affected_skill": issue["affected_skill"],
            }
        )
        issues.append(issue)

    false_positive = [
        {
            "finding_id": item.get("id", ""),
            "title": item.get("title", ""),
            "category": item.get("category", ""),
            "reason": "finding has no expected_finding_id in lab catalog",
        }
        for item in findings
        if not item.get("expected_finding_id") or item.get("expected_finding_id") not in expected_by_id
    ]
    report = {
        "lab_id": expected["lab_id"],
        "summary": {
            "expected": len(expected["findings"]),
            "found": len(found),
            "missed": len(missed),
            "blocked": 0,
            "false_positive": len(false_positive),
        },
        "found": found,
        "missed": missed,
        "blocked": [],
        "false_positive": false_positive,
    }
    issue_log = {"lab_id": expected["lab_id"], "issues": issues}
    write_json(run_dir / "artifacts" / "debug-agent" / "lab_debug_report.json", report)
    write_json(run_dir / "artifacts" / "debug-agent" / "agent_issue_log.json", issue_log)
    summary_path = run_dir / "reports" / "lab-debug-summary.md"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(render_summary(report, issue_log), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    args = parser.parse_args()
    try:
        report = compare_lab_expected_findings(Path(args.run_dir))
    except (LabDebugError, OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"lab debug comparison complete: missed={report['summary']['missed']} false_positive={report['summary']['false_positive']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 新增 debug Agent/Skill 文档**

Create `pentest-agent-harness/agents/debug-agent.md`:

```markdown
# debug-agent

职责：对比靶场预期漏洞目录与本轮 Agent 输出，定位漏报、误报、阻塞项和 Skill 指令缺口，并把问题转成可回放的优化任务。

## 输入

- `lab_profile.json`
- `expected_findings.json`
- `findings/*/findings.json`
- `artifacts/evaluation-agent/verification_queue.json`
- `artifacts/browser-pentest-agent/dynamic_evidence.json`
- `artifacts/report-agent/report_gate.json`

## 执行步骤

1. 读取 expected findings，建立 `expected_finding_id` 索引。
2. 汇总所有 Agent findings，按 `expected_finding_id` 匹配命中项。
3. 对未命中的 expected finding 生成 missed 记录。
4. 对没有基准映射的 finding 生成 false positive 记录。
5. 根据漏洞类别、所需证据和 Agent 输出缺口选择 root cause。
6. 输出 `lab_debug_report.json`、`agent_issue_log.json` 和 `reports/lab-debug-summary.md`。

## 输出要求

- 每个 missed 项必须包含 `root_cause`、`affected_agent`、`affected_skill`。
- 每个 issue 必须包含可执行的 `recommended_change`。
- 可回放问题必须设置 `regression_case=true`。

## 安全限制

- debug-agent 只做离线对比和归因，不执行浏览器操作或网络请求。
```

Create `pentest-agent-harness/skills/lab-profile/SKILL.md`:

```markdown
---
name: lab-profile
description: 读取、校验和初始化靶场 profile，使不同靶场可以复用同一套灰白盒调试流程。
---

# lab-profile

## 目标

把 `labs/<lab_id>/` 下的 profile、scope、账号模板和 expected findings 复制到 run 目录，形成一次可续跑的靶场调试输入。

## 输入

- `labs/<lab_id>/lab_profile.json`
- `labs/<lab_id>/expected_findings.json`
- `labs/<lab_id>/scope.json`
- `labs/<lab_id>/accounts.example.json`

## 执行步骤

1. 校验 lab id 只能使用安全路径片段。
2. 读取 lab profile 和 expected findings。
3. 根据用户传入的源码路径覆盖 `source_repo_path`。
4. 写入 run 目录下的 `lab_profile.json`、`expected_findings.json`、`scope.json`。
5. 初始化 `run_state.json` 的 lab debug 摘要。

## 输出

- `runs/<run_id>/lab_profile.json`
- `runs/<run_id>/expected_findings.json`
- `runs/<run_id>/scope.json`
- `runs/<run_id>/run_state.json`
```

Create `pentest-agent-harness/skills/lab-debug-analysis/SKILL.md`:

```markdown
---
name: lab-debug-analysis
description: 对比靶场预期漏洞和实际 Agent 输出，生成漏报、误报、阻塞项和 Agent/Skill 优化建议。
---

# lab-debug-analysis

## 目标

把每次靶场调试结果变成可执行的产品优化信号，而不是只输出发现数量。

## 输入

- `expected_findings.json`
- `findings/*/findings.json`
- `artifacts/browser-pentest-agent/dynamic_evidence.json`
- `artifacts/report-agent/report_gate.json`

## 执行步骤

1. 按 `expected_finding_id` 对齐 expected findings 与实际 findings。
2. 标记 found、missed、blocked 和 false_positive。
3. 为每个 missed 项选择 root cause。
4. 生成 `agent_issue_log.json`。
5. 生成面向测试人员的 `lab-debug-summary.md`。

## 输出

- `artifacts/debug-agent/lab_debug_report.json`
- `artifacts/debug-agent/agent_issue_log.json`
- `reports/lab-debug-summary.md`
```

- [ ] **Step 6: 扩展 schema 最小对象测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` in `test_new_mvp_closure_schemas_accept_minimal_objects` and add:

```python
        "lab_debug_report.schema.json": {
            "lab_id": "juice-shop",
            "summary": {},
            "found": [],
            "missed": [],
            "blocked": [],
            "false_positive": [],
        },
        "agent_issue_log.schema.json": {
            "lab_id": "juice-shop",
            "issues": [],
        },
```

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_debug_compare.py
python3 pentest-agent-harness/tests/test_validate_schema.py
python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness
```

Expected: tests PASS with no output except `valid agent/skill docs`.

- [ ] **Step 8: Commit**

```bash
git add pentest-agent-harness/tests/test_lab_debug_compare.py pentest-agent-harness/tools/compare_lab_expected_findings.py pentest-agent-harness/schemas/lab_debug_report.schema.json pentest-agent-harness/schemas/agent_issue_log.schema.json pentest-agent-harness/agents/debug-agent.md pentest-agent-harness/skills/lab-profile/SKILL.md pentest-agent-harness/skills/lab-debug-analysis/SKILL.md pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: compare lab expected findings"
```

## Task 4: Regression Cases 与 Lessons 更新

**Files:**
- Create: `pentest-agent-harness/tests/test_update_regression_from_lab_debug.py`
- Create: `pentest-agent-harness/tools/update_regression_from_lab_debug.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_update_regression_from_lab_debug.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "update_regression_from_lab_debug.py"


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_issue_log(run_dir: Path) -> None:
    write_json(
        run_dir / "artifacts" / "debug-agent" / "agent_issue_log.json",
        {
            "lab_id": "juice-shop",
            "issues": [
                {
                    "issue_id": "LAB-DEBUG-001",
                    "expected_finding_id": "juice-shop-authorization-001",
                    "status": "missed",
                    "root_cause": "browser.session_setup_failed",
                    "affected_agent": "browser-pentest-agent",
                    "affected_skill": "auth-session-testing",
                    "evidence": ["expected finding not matched"],
                    "recommended_change": "增强 browser-pentest-agent 的登录状态验证",
                    "regression_case": True,
                }
            ],
        },
    )


def test_update_regression_from_lab_debug_is_deduplicated(tmp_path):
    run_dir = tmp_path / "run"
    knowledge_dir = tmp_path / "knowledge"
    seed_issue_log(run_dir)

    first = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir), str(knowledge_dir)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    second = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir), str(knowledge_dir)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    cases = load_json(knowledge_dir / "regression_cases.json")
    lessons = (knowledge_dir / "lessons_learned.md").read_text(encoding="utf-8")
    assert len(cases) == 1
    assert cases[0]["id"] == "LAB-DEBUG-001"
    assert cases[0]["source"] == "lab_debug"
    assert cases[0]["affected_agent"] == "browser-pentest-agent"
    assert lessons.count("LAB-DEBUG-001") == 1


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_update_regression_from_lab_debug_is_deduplicated(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_update_regression_from_lab_debug.py
```

Expected: FAIL because `tools/update_regression_from_lab_debug.py` does not exist.

- [ ] **Step 3: 实现 `update_regression_from_lab_debug.py`**

Create `pentest-agent-harness/tools/update_regression_from_lab_debug.py` with:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path


class RegressionUpdateError(ValueError):
    pass


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RegressionUpdateError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise RegressionUpdateError(f"cannot read {filename}: {error.strerror}") from error


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ensure_knowledge_files(knowledge_dir: Path) -> None:
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    regression_path = knowledge_dir / "regression_cases.json"
    if not regression_path.exists():
        write_json(regression_path, [])
    lessons_path = knowledge_dir / "lessons_learned.md"
    if not lessons_path.exists():
        lessons_path.write_text("# Lessons Learned\n\n", encoding="utf-8")


def regression_case(issue: dict, lab_id: str) -> dict:
    return {
        "id": issue["issue_id"],
        "source": "lab_debug",
        "lab_id": lab_id,
        "expected_finding_id": issue.get("expected_finding_id", ""),
        "root_cause": issue.get("root_cause", ""),
        "affected_agent": issue.get("affected_agent", ""),
        "affected_skill": issue.get("affected_skill", ""),
        "recommended_change": issue.get("recommended_change", ""),
        "evidence": issue.get("evidence", []),
    }


def append_lesson_once(path: Path, issue: dict) -> None:
    text = path.read_text(encoding="utf-8")
    marker = f"lab-debug-id: {issue['issue_id']}"
    if marker in text:
        return
    entry = (
        f"<!-- {marker} -->\n"
        f"- **{issue['issue_id']}**: {issue.get('affected_agent', '')} / "
        f"{issue.get('affected_skill', '')} 需要优化：{issue.get('recommended_change', '')}\n"
    )
    path.write_text(text.rstrip() + "\n\n" + entry, encoding="utf-8")


def update_regression_from_lab_debug(run_dir: Path, knowledge_dir: Path) -> int:
    issue_log = load_json(run_dir / "artifacts" / "debug-agent" / "agent_issue_log.json")
    if not isinstance(issue_log, dict) or not isinstance(issue_log.get("issues"), list):
        raise RegressionUpdateError("agent_issue_log.json must contain issues array")
    ensure_knowledge_files(knowledge_dir)
    regression_path = knowledge_dir / "regression_cases.json"
    cases = load_json(regression_path)
    if not isinstance(cases, list):
        raise RegressionUpdateError("regression_cases.json must contain a JSON array")
    seen = {item.get("id") for item in cases if isinstance(item, dict)}
    imported = 0
    for issue in issue_log["issues"]:
        if not isinstance(issue, dict) or issue.get("regression_case") is not True:
            continue
        if issue["issue_id"] not in seen:
            cases.append(regression_case(issue, issue_log["lab_id"]))
            seen.add(issue["issue_id"])
            imported += 1
        append_lesson_once(knowledge_dir / "lessons_learned.md", issue)
    write_json(regression_path, cases)
    return imported


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: update_regression_from_lab_debug.py <run_dir> <knowledge_dir>", file=sys.stderr)
        return 2
    try:
        imported = update_regression_from_lab_debug(Path(sys.argv[1]), Path(sys.argv[2]))
    except (RegressionUpdateError, OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"updated {imported} lab regression case(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_update_regression_from_lab_debug.py
```

Expected: PASS with no output.

- [ ] **Step 5: Commit**

```bash
git add pentest-agent-harness/tests/test_update_regression_from_lab_debug.py pentest-agent-harness/tools/update_regression_from_lab_debug.py
git commit -m "feat: update regression cases from lab debug"
```

## Task 5: 全量验证与推送

**Files:**
- Modify only files already touched by earlier tasks if verification exposes a defect.

- [ ] **Step 1: 运行全量测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: every discovered test prints `PASS`.

- [ ] **Step 2: 运行 Agent/Skill 文档质量门禁**

Run:

```bash
python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness
```

Expected:

```text
valid agent/skill docs
```

- [ ] **Step 3: Python 编译检查**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile pentest-agent-harness/tools/init_lab_run.py pentest-agent-harness/tools/compare_lab_expected_findings.py pentest-agent-harness/tools/update_regression_from_lab_debug.py
```

Expected: command exits `0` with no output.

- [ ] **Step 4: 端到端本地样例**

Run:

```bash
python3 pentest-agent-harness/tools/init_lab_run.py --lab juice-shop --run-dir /private/tmp/pentest-agent-lab-debug --source-repo-path /workspace/juice-shop
```

Expected:

```text
initialized lab run: pentest-agent-lab-debug (juice-shop)
```

Then create or reuse a sample finding through the Task 3 test path if needed, and run:

```bash
python3 pentest-agent-harness/tools/compare_lab_expected_findings.py /private/tmp/pentest-agent-lab-debug
```

Expected: command exits `0` and writes `artifacts/debug-agent/lab_debug_report.json`.

- [ ] **Step 5: Commit verification fixes if any**

If Step 1-4 require small fixes, commit them:

```bash
git add pentest-agent-harness
git commit -m "test: verify lab debug loop"
```

If no fixes are needed, do not create an empty commit.

- [ ] **Step 6: Push main**

```bash
git push origin main
```

Expected: `main -> main`.

## Self-Review

Spec coverage:

- Juice-Shop lab profile 与 expected findings：Task 1。
- Debug-agent 与 lab debug skill：Task 3。
- 初始化 lab run：Task 2。
- 对比 found/missed/false_positive 并归因：Task 3。
- regression cases 与 lessons learned 更新：Task 4。
- 全量测试、文档门禁、编译检查和推送：Task 5。

占位扫描:

- 本计划不包含未完成标记或未定义的输入输出。
- 所有新增工具、schema、测试和文档均给出具体路径。

Type consistency:

- `expected_finding_id` 贯穿 finding、debug report、issue log、regression case。
- `lab_id` 在 profile、expected catalog、debug report、issue log 和 regression case 中保持一致。
- `root_cause`、`affected_agent`、`affected_skill` 字段在 Task 3 与 Task 4 中保持一致。
