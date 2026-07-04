# Juice-Shop 登录态与双账号权限调试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Juice-Shop 靶场建立登录态账号加载、auth session plan、双账号权限矩阵、模拟会话观察和 blocked dynamic evidence 的文件级闭环。

**Architecture:** 第一阶段不直接驱动真实浏览器，而是用本地 JSON 工具把账号、登录计划、会话观察、权限矩阵和动态证据的数据契约打通。新增工具只写 `artifacts/browser-pentest-agent/` 下的可验证产物，并复用上一阶段 `compare_lab_expected_findings.py` 的 blocked/found/missed 归因。

**Tech Stack:** Python 3 标准库、JSON、Markdown、现有递归 `validate_schema.py`、现有直接运行式 `tests/run_all.py`。

---

## 文件结构

新增文件：

- `pentest-agent-harness/schemas/account_inventory.schema.json`：账号加载结果 schema。
- `pentest-agent-harness/schemas/auth_session_plan.schema.json`：登录态测试计划 schema。
- `pentest-agent-harness/schemas/session_observations.schema.json`：登录状态观察 schema。
- `pentest-agent-harness/schemas/auth_matrix.schema.json`：运行时权限矩阵 schema。
- `pentest-agent-harness/schemas/runtime_api_observations.schema.json`：运行时 API 观察 schema。
- `pentest-agent-harness/tools/load_lab_accounts.py`：读取 `accounts.local.json` 或账号模板，解析环境变量，输出脱敏账号 inventory。
- `pentest-agent-harness/tools/build_auth_session_plan.py`：根据 lab profile、scope、account inventory 生成 auth session plan。
- `pentest-agent-harness/tools/write_simulated_auth_session_observations.py`：根据 auth session plan 生成模拟 session/auth matrix/runtime API/dynamic evidence。
- `pentest-agent-harness/tests/test_load_lab_accounts.py`
- `pentest-agent-harness/tests/test_auth_session_plan.py`
- `pentest-agent-harness/tests/test_simulated_auth_session_observations.py`

修改文件：

- `pentest-agent-harness/tests/test_validate_schema.py`：加入新 schema 的最小对象校验。
- `pentest-agent-harness/agents/browser-pentest-agent.md`：补登录态调试输入、步骤、输出和 blocked 规则。
- `pentest-agent-harness/skills/auth-session-testing/SKILL.md`：从通用描述升级为可执行检查清单。

不修改：

- 不改真实 in-app browser 控制代码。
- 不把真实账号、密码、token、cookie 写入仓库。
- 不改 `labs/juice-shop/accounts.example.json` 的占位策略。

## Task 1: Account Inventory Schema 与账号加载工具

**Files:**
- Create: `pentest-agent-harness/tests/test_load_lab_accounts.py`
- Create: `pentest-agent-harness/tools/load_lab_accounts.py`
- Create: `pentest-agent-harness/schemas/account_inventory.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_load_lab_accounts.py` with:

```python
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "load_lab_accounts.py"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_loader(run_dir: Path, env: dict[str, str] | None = None):
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir)],
        cwd=ROOT,
        env=merged_env,
        text=True,
        capture_output=True,
        check=False,
    )


def seed_run(run_dir: Path) -> None:
    write_json(
        run_dir / "lab_profile.json",
        {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "mode": "graybox-lab",
        },
    )
    write_json(
        run_dir / "accounts.local.json",
        {
            "lab_id": "juice-shop",
            "accounts": [
                {
                    "role": "standard-user-a",
                    "email": "user-a@example.test",
                    "password_env": "JUICE_SHOP_USER_PASSWORD",
                },
                {
                    "role": "standard-user-b",
                    "email": "user-b@example.test",
                    "password_env": "JUICE_SHOP_SECOND_USER_PASSWORD",
                },
            ],
        },
    )


def test_load_lab_accounts_resolves_env_and_redacts_secret(tmp_path):
    run_dir = tmp_path / "run"
    seed_run(run_dir)

    result = run_loader(
        run_dir,
        {
            "JUICE_SHOP_USER_PASSWORD": "secret-a",
            "JUICE_SHOP_SECOND_USER_PASSWORD": "secret-b",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "loaded 2 account(s)" in result.stdout
    assert "secret-a" not in result.stdout
    inventory = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "account_inventory.json")
    assert inventory["summary"] == {"total": 2, "ready": 2, "blocked": 0}
    assert inventory["accounts"][0]["password_available"] is True
    assert inventory["accounts"][0]["password_value"] == "<redacted>"
    assert inventory["blocked"] == []


def test_load_lab_accounts_blocks_missing_env_without_traceback(tmp_path):
    run_dir = tmp_path / "run"
    seed_run(run_dir)

    result = run_loader(
        run_dir,
        {
            "JUICE_SHOP_USER_PASSWORD": "",
            "JUICE_SHOP_SECOND_USER_PASSWORD": "",
        },
    )

    assert result.returncode == 0, result.stderr
    inventory = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "account_inventory.json")
    assert inventory["summary"] == {"total": 2, "ready": 0, "blocked": 2}
    assert inventory["blocked"][0]["root_cause"] == "browser.account_missing"
    assert "Traceback" not in result.stderr


def test_load_lab_accounts_rejects_plaintext_password(tmp_path):
    run_dir = tmp_path / "run"
    write_json(run_dir / "lab_profile.json", {"lab_id": "juice-shop", "target_url": "http://localhost:3000"})
    write_json(
        run_dir / "accounts.local.json",
        {
            "lab_id": "juice-shop",
            "accounts": [
                {
                    "role": "standard-user-a",
                    "email": "user-a@example.test",
                    "password": "do-not-store",
                }
            ],
        },
    )

    result = run_loader(run_dir)

    assert result.returncode == 1
    assert "literal password field is not allowed" in result.stderr
    assert "Traceback" not in result.stderr


if __name__ == "__main__":
    import tempfile

    tests = [
        test_load_lab_accounts_resolves_env_and_redacts_secret,
        test_load_lab_accounts_blocks_missing_env_without_traceback,
        test_load_lab_accounts_rejects_plaintext_password,
    ]
    for test in tests:
        with tempfile.TemporaryDirectory() as directory:
            test(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_load_lab_accounts.py
```

Expected: FAIL because `tools/load_lab_accounts.py` does not exist.

- [ ] **Step 3: 创建 `account_inventory.schema.json`**

Create `pentest-agent-harness/schemas/account_inventory.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "source", "accounts", "blocked", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "source": {"type": "string"},
    "accounts": {"type": "array"},
    "blocked": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 4: 实现 `load_lab_accounts.py`**

Create `pentest-agent-harness/tools/load_lab_accounts.py` with:

```python
#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from typing import Any


class AccountLoadError(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise AccountLoadError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise AccountLoadError(f"cannot read {filename}: {error.strerror}") from error


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def require_object(payload: Any, filename: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise AccountLoadError(f"{filename} must contain a JSON object")
    return payload


def accounts_path(run_dir: Path) -> tuple[Path, str]:
    local = run_dir / "accounts.local.json"
    if local.exists():
        return local, "accounts.local.json"
    example = run_dir / "accounts.example.json"
    if example.exists():
        return example, "accounts.example.json"
    raise AccountLoadError("no accounts.local.json or accounts.example.json found")


def validate_account(account: dict[str, Any], index: int) -> None:
    if "password" in account:
        raise AccountLoadError(f"account #{index} literal password field is not allowed")
    for field in ("role", "email", "password_env"):
        value = account.get(field)
        if not isinstance(value, str) or not value:
            raise AccountLoadError(f"account #{index} missing required field: {field}")
    if "\n" in account["role"] or "\n" in account["email"]:
        raise AccountLoadError(f"account #{index} contains unsafe newline")


def account_entry(account: dict[str, Any], password: str) -> dict[str, Any]:
    ready = bool(password)
    return {
        "role": account["role"],
        "email": account["email"],
        "password_env": account["password_env"],
        "password_available": ready,
        "password_value": "<redacted>" if ready else "",
        "status": "ready" if ready else "blocked",
    }


def load_lab_accounts(run_dir: Path) -> dict[str, Any]:
    profile = require_object(load_json(run_dir / "lab_profile.json"), "lab_profile.json")
    account_file, source = accounts_path(run_dir)
    payload = require_object(load_json(account_file), account_file.name)
    accounts = payload.get("accounts")
    if not isinstance(accounts, list):
        raise AccountLoadError(f"{account_file.name} must contain an accounts array")

    entries = []
    blocked = []
    for index, account in enumerate(accounts, start=1):
        if not isinstance(account, dict):
            raise AccountLoadError(f"account #{index} must be an object")
        validate_account(account, index)
        password = os.environ.get(account["password_env"], "")
        entry = account_entry(account, password)
        entries.append(entry)
        if not password:
            blocked.append(
                {
                    "role": account["role"],
                    "root_cause": "browser.account_missing",
                    "reason": f"missing environment variable: {account['password_env']}",
                }
            )

    inventory = {
        "lab_id": str(profile.get("lab_id", payload.get("lab_id", "unknown-lab"))),
        "source": source,
        "accounts": entries,
        "blocked": blocked,
        "summary": {
            "total": len(entries),
            "ready": sum(1 for item in entries if item["status"] == "ready"),
            "blocked": len(blocked),
        },
    }
    write_json(run_dir / "artifacts" / "browser-pentest-agent" / "account_inventory.json", inventory)
    return inventory


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: load_lab_accounts.py <run_dir>", file=sys.stderr)
        return 2
    try:
        inventory = load_lab_accounts(Path(sys.argv[1]))
    except (AccountLoadError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"loaded {inventory['summary']['total']} account(s), ready={inventory['summary']['ready']} blocked={inventory['summary']['blocked']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 扩展 schema 最小对象测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` in `test_new_mvp_closure_schemas_accept_minimal_objects` and add:

```python
        "account_inventory.schema.json": {
            "lab_id": "juice-shop",
            "source": "accounts.local.json",
            "accounts": [],
            "blocked": [],
            "summary": {},
        },
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_load_lab_accounts.py
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: both PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add pentest-agent-harness/tests/test_load_lab_accounts.py pentest-agent-harness/tools/load_lab_accounts.py pentest-agent-harness/schemas/account_inventory.schema.json pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: load lab auth accounts"
```

## Task 2: Auth Session Plan 工具

**Files:**
- Create: `pentest-agent-harness/tests/test_auth_session_plan.py`
- Create: `pentest-agent-harness/tools/build_auth_session_plan.py`
- Create: `pentest-agent-harness/schemas/auth_session_plan.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_auth_session_plan.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "build_auth_session_plan.py"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_run(run_dir: Path, ready: bool = True) -> None:
    write_json(
        run_dir / "lab_profile.json",
        {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "safe_test_policy": {
                "destructive_allowed": False,
                "max_request_rate_per_second": 2,
                "allowed_mutations": ["login", "add_to_basket"],
                "forbidden_actions": ["payment", "data_deletion"],
            },
        },
    )
    write_json(
        run_dir / "scope.json",
        {
            "target_url": "http://localhost:3000",
            "allowed_hosts": ["http://localhost:3000"],
            "allowed_paths": ["/#/login", "/#/basket", "/rest/user/login"],
            "destructive_allowed": False,
        },
    )
    accounts = [
        {
            "role": "standard-user-a",
            "email": "user-a@example.test",
            "status": "ready" if ready else "blocked",
            "password_available": ready,
            "password_value": "<redacted>" if ready else "",
        },
        {
            "role": "standard-user-b",
            "email": "user-b@example.test",
            "status": "ready" if ready else "blocked",
            "password_available": ready,
            "password_value": "<redacted>" if ready else "",
        },
    ]
    write_json(
        run_dir / "artifacts" / "browser-pentest-agent" / "account_inventory.json",
        {
            "lab_id": "juice-shop",
            "source": "accounts.local.json",
            "accounts": accounts,
            "blocked": [] if ready else [{"role": "standard-user-a", "root_cause": "browser.account_missing"}],
            "summary": {"total": 2, "ready": 2 if ready else 0, "blocked": 0 if ready else 2},
        },
    )


def test_build_auth_session_plan_for_two_ready_accounts(tmp_path):
    run_dir = tmp_path / "run"
    seed_run(run_dir, ready=True)

    result = subprocess.run([sys.executable, str(SCRIPT), str(run_dir)], cwd=ROOT, text=True, capture_output=True, check=False)

    assert result.returncode == 0, result.stderr
    plan = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "auth_session_plan.json")
    assert plan["login_url"] == "http://localhost:3000/#/login"
    assert plan["summary"] == {"accounts": 2, "ready_accounts": 2, "blocked_accounts": 0, "authz_checks": 3}
    assert plan["accounts"][0]["role"] == "standard-user-a"
    assert [check["resource_type"] for check in plan["authz_checks"]] == ["basket", "order", "address"]
    assert all(check["status"] == "planned" for check in plan["authz_checks"])


def test_build_auth_session_plan_blocks_without_ready_accounts(tmp_path):
    run_dir = tmp_path / "run"
    seed_run(run_dir, ready=False)

    result = subprocess.run([sys.executable, str(SCRIPT), str(run_dir)], cwd=ROOT, text=True, capture_output=True, check=False)

    assert result.returncode == 0, result.stderr
    plan = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "auth_session_plan.json")
    assert plan["summary"]["ready_accounts"] == 0
    assert plan["blocked"][0]["root_cause"] == "browser.account_missing"
    assert plan["authz_checks"] == []


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_build_auth_session_plan_for_two_ready_accounts(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_build_auth_session_plan_blocks_without_ready_accounts(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_auth_session_plan.py
```

Expected: FAIL because `tools/build_auth_session_plan.py` does not exist.

- [ ] **Step 3: 创建 `auth_session_plan.schema.json`**

Create `pentest-agent-harness/schemas/auth_session_plan.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "target_url", "login_url", "accounts", "authz_checks", "blocked", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "target_url": {"type": "string"},
    "login_url": {"type": "string"},
    "accounts": {"type": "array"},
    "authz_checks": {"type": "array"},
    "blocked": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 4: 实现 `build_auth_session_plan.py`**

Create `pentest-agent-harness/tools/build_auth_session_plan.py` with:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any


class AuthSessionPlanError(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise AuthSessionPlanError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise AuthSessionPlanError(f"cannot read {filename}: {error.strerror}") from error


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def object_json(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AuthSessionPlanError(f"{path.name} must contain a JSON object")
    return payload


def login_url(target_url: str) -> str:
    return target_url.rstrip("/") + "/#/login"


def ready_accounts(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    accounts = inventory.get("accounts")
    if not isinstance(accounts, list):
        raise AuthSessionPlanError("account_inventory.json must contain accounts array")
    return [account for account in accounts if isinstance(account, dict) and account.get("status") == "ready"]


def authz_checks(accounts: list[dict[str, Any]], target_url: str) -> list[dict[str, Any]]:
    if len(accounts) < 2:
        return []
    owner = accounts[0]["role"]
    actor = accounts[1]["role"]
    resources = ["basket", "order", "address"]
    checks = []
    for index, resource in enumerate(resources, start=1):
        checks.append(
            {
                "check_id": f"AUTHZ-{index:03d}",
                "resource_type": resource,
                "owner_role": owner,
                "actor_role": actor,
                "method": "GET",
                "url": f"{target_url.rstrip('/')}/rest/{resource}/<id>",
                "expected": "denied",
                "observed": "not_tested",
                "status": "planned",
                "reason": "resource id discovery pending",
                "evidence": [],
            }
        )
    return checks


def build_auth_session_plan(run_dir: Path) -> dict[str, Any]:
    profile = object_json(run_dir / "lab_profile.json")
    scope = object_json(run_dir / "scope.json")
    inventory = object_json(run_dir / "artifacts" / "browser-pentest-agent" / "account_inventory.json")
    target_url = str(profile.get("target_url") or scope.get("target_url") or "")
    if not target_url:
        raise AuthSessionPlanError("target_url is required")
    accounts = ready_accounts(inventory)
    blocked = list(inventory.get("blocked", [])) if isinstance(inventory.get("blocked", []), list) else []
    checks = authz_checks(accounts, target_url)
    plan = {
        "lab_id": str(profile.get("lab_id", inventory.get("lab_id", "unknown-lab"))),
        "target_url": target_url,
        "login_url": login_url(target_url),
        "allowed_hosts": scope.get("allowed_hosts", [target_url]),
        "safe_test_policy": profile.get("safe_test_policy", {}),
        "accounts": accounts,
        "authz_checks": checks,
        "blocked": blocked,
        "summary": {
            "accounts": len(inventory.get("accounts", [])),
            "ready_accounts": len(accounts),
            "blocked_accounts": len(blocked),
            "authz_checks": len(checks),
        },
    }
    write_json(run_dir / "artifacts" / "browser-pentest-agent" / "auth_session_plan.json", plan)
    return plan


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: build_auth_session_plan.py <run_dir>", file=sys.stderr)
        return 2
    try:
        plan = build_auth_session_plan(Path(sys.argv[1]))
    except (AuthSessionPlanError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"built auth session plan: ready={plan['summary']['ready_accounts']} checks={plan['summary']['authz_checks']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 扩展 schema 最小对象测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` and add:

```python
        "auth_session_plan.schema.json": {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "login_url": "http://localhost:3000/#/login",
            "accounts": [],
            "authz_checks": [],
            "blocked": [],
            "summary": {},
        },
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_auth_session_plan.py
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: both PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add pentest-agent-harness/tests/test_auth_session_plan.py pentest-agent-harness/tools/build_auth_session_plan.py pentest-agent-harness/schemas/auth_session_plan.schema.json pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: build auth session plans"
```

## Task 3: 模拟 Auth Session Observations 与 Dynamic Evidence

**Files:**
- Create: `pentest-agent-harness/tests/test_simulated_auth_session_observations.py`
- Create: `pentest-agent-harness/tools/write_simulated_auth_session_observations.py`
- Create: `pentest-agent-harness/schemas/session_observations.schema.json`
- Create: `pentest-agent-harness/schemas/auth_matrix.schema.json`
- Create: `pentest-agent-harness/schemas/runtime_api_observations.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_simulated_auth_session_observations.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "write_simulated_auth_session_observations.py"
COMPARE = ROOT / "tools" / "compare_lab_expected_findings.py"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_plan(run_dir: Path, ready: bool) -> None:
    write_json(
        run_dir / "expected_findings.json",
        {
            "lab_id": "juice-shop",
            "catalog_version": "2026-07-04",
            "findings": [
                {
                    "id": "juice-shop-authentication-001",
                    "title": "登录流程需要认证控制验证",
                    "category": "authentication",
                    "risk": "High",
                    "requires_browser": True,
                    "requires_source": False,
                    "expected_agents": ["browser-pentest-agent"],
                    "expected_skills": ["auth-session-testing"],
                    "requires_two_roles": False,
                    "safe_reproduction_hint": "只验证测试账号登录状态",
                    "evidence_requirements": ["session_observations"],
                }
            ],
        },
    )
    write_json(
        run_dir / "artifacts" / "browser-pentest-agent" / "auth_session_plan.json",
        {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "login_url": "http://localhost:3000/#/login",
            "accounts": [
                {
                    "role": "standard-user-a",
                    "email": "user-a@example.test",
                    "status": "ready" if ready else "blocked",
                }
            ],
            "authz_checks": [],
            "blocked": [] if ready else [{"role": "standard-user-a", "root_cause": "browser.account_missing", "reason": "missing env"}],
            "summary": {"accounts": 1, "ready_accounts": 1 if ready else 0, "blocked_accounts": 0 if ready else 1, "authz_checks": 0},
        },
    )


def test_simulated_auth_session_observations_for_ready_account(tmp_path):
    run_dir = tmp_path / "run"
    seed_plan(run_dir, ready=True)

    result = subprocess.run([sys.executable, str(SCRIPT), str(run_dir)], cwd=ROOT, text=True, capture_output=True, check=False)

    assert result.returncode == 0, result.stderr
    session = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "session_observations.json")
    matrix = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "auth_matrix.json")
    runtime = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "runtime_api_observations.json")
    evidence = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence.json")
    assert session["accounts"][0]["login_status"] == "authenticated"
    assert matrix["summary"]["blocked"] == 0
    assert runtime["apis"][0]["url"] == "http://localhost:3000/rest/user/login"
    assert evidence["items"][0]["source_id"] == "juice-shop-authentication-001"
    assert evidence["items"][0]["result"] == "verified"


def test_blocked_auth_session_flows_into_lab_debug_blocked(tmp_path):
    run_dir = tmp_path / "run"
    seed_plan(run_dir, ready=False)

    result = subprocess.run([sys.executable, str(SCRIPT), str(run_dir)], cwd=ROOT, text=True, capture_output=True, check=False)
    compare = subprocess.run([sys.executable, str(COMPARE), str(run_dir)], cwd=ROOT, text=True, capture_output=True, check=False)

    assert result.returncode == 0, result.stderr
    assert compare.returncode == 0, compare.stderr
    evidence = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence.json")
    report = load_json(run_dir / "artifacts" / "debug-agent" / "lab_debug_report.json")
    assert evidence["items"][0]["result"] == "blocked"
    assert report["summary"]["blocked"] == 1
    assert report["summary"]["missed"] == 0


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_simulated_auth_session_observations_for_ready_account(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_blocked_auth_session_flows_into_lab_debug_blocked(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_simulated_auth_session_observations.py
```

Expected: FAIL because `tools/write_simulated_auth_session_observations.py` does not exist.

- [ ] **Step 3: 创建 schemas**

Create `pentest-agent-harness/schemas/session_observations.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "target_url", "mode", "accounts", "blocked"],
  "properties": {
    "lab_id": {"type": "string"},
    "target_url": {"type": "string"},
    "mode": {"type": "string"},
    "accounts": {"type": "array"},
    "blocked": {"type": "array"}
  }
}
```

Create `pentest-agent-harness/schemas/auth_matrix.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "resource_types", "checks", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "resource_types": {"type": "array"},
    "checks": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

Create `pentest-agent-harness/schemas/runtime_api_observations.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "source", "apis"],
  "properties": {
    "lab_id": {"type": "string"},
    "source": {"type": "string"},
    "apis": {"type": "array"}
  }
}
```

- [ ] **Step 4: 实现 `write_simulated_auth_session_observations.py`**

Create `pentest-agent-harness/tools/write_simulated_auth_session_observations.py` with:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any


class AuthObservationError(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise AuthObservationError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise AuthObservationError(f"cannot read {filename}: {error.strerror}") from error


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def object_json(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AuthObservationError(f"{path.name} must contain a JSON object")
    return payload


def session_account(account: dict[str, Any], login_url: str, target_url: str) -> dict[str, Any]:
    return {
        "role": account["role"],
        "email": account.get("email", ""),
        "login_status": "authenticated",
        "login_url": login_url,
        "post_login_url": target_url.rstrip("/") + "/#/",
        "storage_observed": {
            "cookies_changed": True,
            "local_storage_keys": ["token", "email"],
            "session_storage_keys": [],
        },
        "logout_status": "not_tested",
        "evidence": [
            f"artifacts/browser-pentest-agent/screenshots/login-{account['role']}.png"
        ],
    }


def blocked_evidence_item(blocked: dict[str, Any]) -> dict[str, Any]:
    return {
        "verification_id": "AUTH-SESSION-BLOCKED",
        "source_id": "juice-shop-authentication-001",
        "skill": "auth-session-testing",
        "result": "blocked",
        "finding_candidate": False,
        "evidence": [blocked.get("reason", "auth session blocked")],
        "notes": blocked.get("root_cause", "browser.account_missing"),
    }


def write_simulated_auth_session_observations(run_dir: Path) -> dict[str, Any]:
    plan = object_json(run_dir / "artifacts" / "browser-pentest-agent" / "auth_session_plan.json")
    out_dir = run_dir / "artifacts" / "browser-pentest-agent"
    lab_id = plan["lab_id"]
    target_url = plan["target_url"]
    blocked = plan.get("blocked", [])
    accounts = plan.get("accounts", [])
    if not isinstance(blocked, list) or not isinstance(accounts, list):
        raise AuthObservationError("auth_session_plan.json accounts and blocked must be arrays")

    if blocked:
        session_accounts = []
        dynamic_items = [blocked_evidence_item(item) for item in blocked if isinstance(item, dict)]
    else:
        session_accounts = [session_account(account, plan["login_url"], target_url) for account in accounts if isinstance(account, dict)]
        dynamic_items = [
            {
                "verification_id": "AUTH-SESSION-001",
                "source_id": "juice-shop-authentication-001",
                "skill": "auth-session-testing",
                "result": "verified",
                "finding_candidate": False,
                "evidence": ["session_observations.json"],
                "notes": "simulated login state verified for ready lab account",
            }
        ]

    auth_checks = plan.get("authz_checks", [])
    if not isinstance(auth_checks, list):
        raise AuthObservationError("auth_session_plan.json authz_checks must be an array")
    matrix_checks = []
    for check in auth_checks:
        if isinstance(check, dict):
            item = dict(check)
            item["status"] = "blocked"
            item["observed"] = "not_tested"
            item["reason"] = "resource id not discovered in simulated phase"
            matrix_checks.append(item)

    session = {
        "lab_id": lab_id,
        "target_url": target_url,
        "mode": "browser-auth-session-simulated",
        "accounts": session_accounts,
        "blocked": blocked,
    }
    matrix = {
        "lab_id": lab_id,
        "resource_types": ["basket", "order", "address"],
        "checks": matrix_checks,
        "summary": {
            "total": len(matrix_checks),
            "allowed": 0,
            "denied": 0,
            "blocked": len(matrix_checks),
            "suspicious": 0,
        },
    }
    runtime = {
        "lab_id": lab_id,
        "source": "browser-network-simulated",
        "apis": [
            {
                "method": "POST",
                "url": target_url.rstrip("/") + "/rest/user/login",
                "trigger": "login",
                "actor_role": session_accounts[0]["role"] if session_accounts else "",
                "status": 200 if session_accounts else 0,
                "request_fields": ["email", "password"],
                "response_fields": ["authentication"],
                "sensitive_fields_redacted": True,
            }
        ],
    }
    dynamic = {
        "agent": "browser-pentest-agent",
        "mode": "simulated-auth-session",
        "summary": {
            "total": len(dynamic_items),
            "verified": sum(1 for item in dynamic_items if item["result"] == "verified"),
            "reproduced": 0,
            "blocked": sum(1 for item in dynamic_items if item["result"] == "blocked"),
        },
        "items": dynamic_items,
    }
    write_json(out_dir / "session_observations.json", session)
    write_json(out_dir / "auth_matrix.json", matrix)
    write_json(out_dir / "runtime_api_observations.json", runtime)
    write_json(out_dir / "dynamic_evidence.json", dynamic)
    return dynamic


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: write_simulated_auth_session_observations.py <run_dir>", file=sys.stderr)
        return 2
    try:
        dynamic = write_simulated_auth_session_observations(Path(sys.argv[1]))
    except (AuthObservationError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"wrote simulated auth session observations: total={dynamic['summary']['total']} blocked={dynamic['summary']['blocked']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 扩展 schema 最小对象测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` and add:

```python
        "session_observations.schema.json": {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "mode": "browser-auth-session",
            "accounts": [],
            "blocked": [],
        },
        "auth_matrix.schema.json": {
            "lab_id": "juice-shop",
            "resource_types": [],
            "checks": [],
            "summary": {},
        },
        "runtime_api_observations.schema.json": {
            "lab_id": "juice-shop",
            "source": "browser-network",
            "apis": [],
        },
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
python3 pentest-agent-harness/tests/test_simulated_auth_session_observations.py
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: both PASS with no output.

- [ ] **Step 7: Commit**

```bash
git add pentest-agent-harness/tests/test_simulated_auth_session_observations.py pentest-agent-harness/tools/write_simulated_auth_session_observations.py pentest-agent-harness/schemas/session_observations.schema.json pentest-agent-harness/schemas/auth_matrix.schema.json pentest-agent-harness/schemas/runtime_api_observations.schema.json pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: simulate auth session observations"
```

## Task 4: Agent 与 Skill 文档增强

**Files:**
- Modify: `pentest-agent-harness/agents/browser-pentest-agent.md`
- Modify: `pentest-agent-harness/skills/auth-session-testing/SKILL.md`
- Test: `pentest-agent-harness/tests/test_agent_skill_doc_quality.py`

- [ ] **Step 1: 增强 `browser-pentest-agent.md`**

Modify `pentest-agent-harness/agents/browser-pentest-agent.md` to include these concrete additions:

```markdown
## 登录态调试输入

- `artifacts/browser-pentest-agent/account_inventory.json`
- `artifacts/browser-pentest-agent/auth_session_plan.json`
- `labs/juice-shop/scope.json` 或 run 目录 `scope.json`
- `accounts.local.json` 中的测试账号引用，密码只从环境变量解析。

## Juice-Shop 登录态执行步骤

1. 先调用 `load_lab_accounts.py <run_dir>`，确认账号是否 ready。
2. 再调用 `build_auth_session_plan.py <run_dir>`，生成登录 URL 和双账号矩阵候选。
3. 真实浏览器阶段先记录匿名 baseline：菜单、购物车数量、storage、cookie。
4. 对 `standard-user-a` 登录，记录登录前后 storage/cookie key 差异，不记录 token 值。
5. 对 `standard-user-b` 登录，重复记录会话状态。
6. 对 basket/order/address 检查项，只有发现资源 id 后才执行跨账号访问。
7. 任何账号、selector、网络采集或资源 id 缺失都写入 blocked，不写入 found。

## 登录态输出文件

- `artifacts/browser-pentest-agent/account_inventory.json`
- `artifacts/browser-pentest-agent/auth_session_plan.json`
- `artifacts/browser-pentest-agent/session_observations.json`
- `artifacts/browser-pentest-agent/auth_matrix.json`
- `artifacts/browser-pentest-agent/runtime_api_observations.json`
- `artifacts/browser-pentest-agent/dynamic_evidence.json`
```

Keep existing sections and safety restrictions.

- [ ] **Step 2: 增强 `auth-session-testing/SKILL.md`**

Modify `pentest-agent-harness/skills/auth-session-testing/SKILL.md` to include concrete checklist:

```markdown
## 账号加载规则

1. 优先读取 run 目录 `accounts.local.json`。
2. 只允许 `password_env` 引用密码，不允许明文 `password`。
3. 缺少环境变量时输出 `browser.account_missing` blocked。
4. 输出 `artifacts/browser-pentest-agent/account_inventory.json`，只记录 `<redacted>`。

## 登录成功判定

1. URL 或页面状态从 `/#/login` 返回主界面。
2. Account 菜单从登录入口变为已登录状态。
3. storage/cookie key 发生变化。
4. 捕获到 `/rest/user/login` 或同类登录 API 的 2xx 响应。

## 双账号矩阵规则

1. 至少需要两个 ready 账号。
2. owner_role 与 actor_role 必须不同。
3. basket/order/address 的 resource id 未发现时，矩阵项必须是 blocked。
4. 跨账号访问返回 2xx 且内容属于 owner 时标记 suspicious。
5. 返回 401/403/404 或空授权结果时标记 denied。

## Blocked 条件

- `browser.account_missing`
- `browser.login_failed`
- `browser.selector_changed`
- `browser.resource_id_missing`
- `browser.network_capture_missing`
```

Ensure the skill still has front matter, `## 目标`, `## 输入`, `## 输出`, executable steps, concrete artifact paths, and evidence markers.

- [ ] **Step 3: 运行文档质量测试**

Run:

```bash
python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness
python3 pentest-agent-harness/tests/test_agent_skill_doc_quality.py
```

Expected:

```text
valid agent/skill docs
```

and test exits `0`.

- [ ] **Step 4: Commit**

```bash
git add pentest-agent-harness/agents/browser-pentest-agent.md pentest-agent-harness/skills/auth-session-testing/SKILL.md
git commit -m "docs: deepen auth session testing workflow"
```

## Task 5: 集成验证与推送

**Files:**
- Modify only files already touched by earlier tasks if verification exposes a defect.

- [ ] **Step 1: 运行全量测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: every discovered test prints `PASS`.

- [ ] **Step 2: 运行文档质量门禁**

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
PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile pentest-agent-harness/tools/load_lab_accounts.py pentest-agent-harness/tools/build_auth_session_plan.py pentest-agent-harness/tools/write_simulated_auth_session_observations.py
```

Expected: command exits `0` with no output.

- [ ] **Step 4: 端到端样例**

Run:

```bash
python3 pentest-agent-harness/tools/init_lab_run.py --lab juice-shop --run-dir /private/tmp/pentest-agent-auth-session --source-repo-path /workspace/juice-shop
```

Create `/private/tmp/pentest-agent-auth-session/accounts.local.json` with two accounts that use environment variable names, then run with environment variables:

```bash
JUICE_SHOP_USER_PASSWORD=secret-a JUICE_SHOP_SECOND_USER_PASSWORD=secret-b python3 pentest-agent-harness/tools/load_lab_accounts.py /private/tmp/pentest-agent-auth-session
python3 pentest-agent-harness/tools/build_auth_session_plan.py /private/tmp/pentest-agent-auth-session
python3 pentest-agent-harness/tools/write_simulated_auth_session_observations.py /private/tmp/pentest-agent-auth-session
python3 pentest-agent-harness/tools/compare_lab_expected_findings.py /private/tmp/pentest-agent-auth-session
```

Expected:

- `account_inventory.json` has `ready=2`
- `auth_session_plan.json` has `authz_checks=3`
- `session_observations.json` exists
- `auth_matrix.json` exists
- `runtime_api_observations.json` exists
- `dynamic_evidence.json` exists

- [ ] **Step 5: Commit verification fixes if any**

If Step 1-4 require small fixes, commit them:

```bash
git add pentest-agent-harness
git commit -m "test: verify auth session debug loop"
```

If no fixes are needed, do not create an empty commit.

- [ ] **Step 6: Push main**

```bash
git push origin main
```

Expected: `main -> main`.

## Self-Review

Spec coverage:

- 账号来源策略：Task 1。
- `session_observations.json`：Task 3。
- `auth_matrix.json`：Task 3。
- `runtime_api_observations.json`：Task 3。
- auth session plan：Task 2。
- `browser-pentest-agent` 和 `auth-session-testing` 文档增强：Task 4。
- blocked dynamic evidence 对接 debug-agent：Task 3。
- 全量验证与推送：Task 5。

占位扫描：

- 本计划没有未完成标记或未定义的输入输出。
- 所有新增工具、schema、测试和文档均给出具体路径。

类型一致性：

- 账号状态统一使用 `ready` / `blocked`。
- 登录状态统一使用 `authenticated` / `failed` / `blocked` / `not_tested`。
- auth matrix 状态统一使用 `planned` / `allowed` / `denied` / `blocked` / `suspicious`。
- dynamic evidence 对 auth session 使用 `source_id = juice-shop-authentication-001`，使 `compare_lab_expected_findings.py` 可以归因 blocked 或 verified。
