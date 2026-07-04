# Juice-Shop 运行时调试与 Agent/Skill 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于本地 Juice-Shop 调试当前灰白盒渗透测试 Agent，补齐运行时浏览器产物、blocked 归因和具体 Skill 优化项，同时保持核心 Agent/Skill 不绑定任何靶场。

**Architecture:** 先把运行时浏览器调试产物抽象成通用 schema 和通用写入工具，再让 debug-agent 从动态证据中读取真实 blocked root_cause，最后用 Juice-Shop 作为 profile 驱动的调试输入产出 `browser_workflow_inventory`、`auth_validation`、`runtime_api_observations` 和 `skill_improvement_candidates`。Juice-Shop 细节只能存在于 `labs/juice-shop/`、测试 fixture 或一次性 run 目录，不进入通用 Agent/Skill 的固定逻辑。

**Tech Stack:** Python 3 标准库、JSON schema 子集校验器、现有 `pentest-agent-harness/tests/run_all.py`、Codex in-app browser。

---

## 文件结构

- Create: `pentest-agent-harness/schemas/browser_workflow_inventory.schema.json`
  - 浏览器页面、菜单、表单、链接、搜索、上传下载、外部跳转和 blocked workflow 的通用结构。
- Create: `pentest-agent-harness/schemas/auth_validation.schema.json`
  - 动态测试前认证可用性验证结构，记录账号状态、登录入口、storage/cookie key 差异和 blocked 原因。
- Create: `pentest-agent-harness/schemas/skill_improvement_candidates.schema.json`
  - 每轮调试后反推的 Agent/Skill 优化项结构。
- Modify: `pentest-agent-harness/schemas/runtime_api_observations.schema.json`
  - 从薄 schema 扩展为包含 `method/path/status/trigger/actor_role/source_workflow` 的运行时 API 观察结构。
- Create: `pentest-agent-harness/tools/write_browser_runtime_debug_artifacts.py`
  - 读取通用浏览器观察输入，写出浏览器工作流、认证验证、运行时 API、动态证据和 Skill 优化候选。
- Modify: `pentest-agent-harness/tools/compare_lab_expected_findings.py`
  - blocked expected finding 优先使用动态证据里的 `root_cause`、`skill` 和 `agent`，而不是只按 finding category 归因。
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`
  - 增加新增 schema 的最小有效样例。
- Create: `pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py`
  - 覆盖运行时调试产物写入工具。
- Modify: `pentest-agent-harness/tests/test_lab_debug_compare.py`
  - 覆盖 blocked dynamic evidence root_cause 透传。
- Modify: `pentest-agent-harness/agents/browser-pentest-agent.md`
  - 增加运行时调试闭环、产物写入和 blocked 规则。
- Modify: `pentest-agent-harness/agents/debug-agent.md`
  - 增加从动态证据归因、输出 skill improvement candidates 的职责。
- Modify: `pentest-agent-harness/skills/browser-workflow-recon/SKILL.md`
  - 补可执行枚举步骤、字段约束和 blocked 分类。
- Modify: `pentest-agent-harness/skills/runtime-api-capture/SKILL.md`
  - 补 HAR/代理/浏览器事件三类输入、脱敏规则和 network capture blocked。
- Modify: `pentest-agent-harness/skills/auth-validation/SKILL.md`
  - 补登录前置验证的具体输入输出和状态机。
- Create at runtime only: `runs/<run_id>/browser_observations.json`
  - 当前本地 Juice-Shop 的一次性浏览器观察输入。不要提交 run 目录。

## Task 1: 补运行时调试 Schema

**Files:**
- Create: `pentest-agent-harness/schemas/browser_workflow_inventory.schema.json`
- Create: `pentest-agent-harness/schemas/auth_validation.schema.json`
- Create: `pentest-agent-harness/schemas/skill_improvement_candidates.schema.json`
- Modify: `pentest-agent-harness/schemas/runtime_api_observations.schema.json`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 写失败测试**

在 `pentest-agent-harness/tests/test_validate_schema.py` 的 `test_new_mvp_closure_schemas_accept_minimal_objects` fixture 字典中追加以下 schema 样例：

```python
        "browser_workflow_inventory.schema.json": {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "source": "manual-browser-observation",
            "workflows": [
                {
                    "workflow_id": "wf-home-products",
                    "route": "/#/",
                    "role": "anonymous",
                    "action_type": "navigation",
                    "trigger": "initial page load",
                    "coverage_status": "checked",
                    "api_refs": [],
                    "blocked": [],
                }
            ],
            "blocked": [],
            "summary": {
                "total": 1,
                "checked": 1,
                "blocked": 0,
                "unknown": 0,
            },
        },
        "auth_validation.schema.json": {
            "lab_id": "juice-shop",
            "target_url": "http://localhost:3000",
            "status": "blocked",
            "accounts": [],
            "blocked": [
                {
                    "root_cause": "browser.account_missing",
                    "reason": "no ready account was available",
                    "role": "standard-user",
                }
            ],
            "summary": {
                "accounts": 0,
                "authenticated": 0,
                "blocked": 1,
            },
        },
        "skill_improvement_candidates.schema.json": {
            "lab_id": "juice-shop",
            "source_run_id": "manual-runtime-debug",
            "items": [
                {
                    "id": "runtime-api-capture-001",
                    "affected_agent": "browser-pentest-agent",
                    "affected_skill": "runtime-api-capture",
                    "root_cause": "browser.network_capture_missing",
                    "observed_gap": "browser workflow was observed but no API event source was available",
                    "required_change": "add HAR or network event input support",
                    "acceptance_check": "API observations include method, path, status and trigger",
                }
            ],
            "summary": {
                "total": 1,
            },
        },
        "runtime_api_observations.schema.json": {
            "lab_id": "juice-shop",
            "source": "browser-network-observation",
            "apis": [
                {
                    "method": "GET",
                    "path": "/rest/products/search",
                    "status": 200,
                    "trigger": "home product list",
                    "actor_role": "anonymous",
                    "source_workflow": "wf-home-products",
                    "request_field_names": [],
                    "response_field_names": ["data"],
                    "sensitive_fields_redacted": True,
                }
            ],
            "blocked": [],
            "summary": {
                "total": 1,
                "blocked": 0,
            },
        },
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: FAIL，错误包含 `cannot read browser_workflow_inventory.schema.json` 或缺少新增 schema。

- [ ] **Step 3: 新增 `browser_workflow_inventory` schema**

Create `pentest-agent-harness/schemas/browser_workflow_inventory.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "target_url", "source", "workflows", "blocked", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "target_url": {"type": "string"},
    "source": {"type": "string"},
    "workflows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["workflow_id", "route", "role", "action_type", "trigger", "coverage_status", "api_refs", "blocked"],
        "properties": {
          "workflow_id": {"type": "string"},
          "route": {"type": "string"},
          "role": {"type": "string"},
          "action_type": {"type": "string"},
          "trigger": {"type": "string"},
          "coverage_status": {"type": "string"},
          "api_refs": {"type": "array"},
          "blocked": {"type": "array"}
        }
      }
    },
    "blocked": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 4: 新增 `auth_validation` schema**

Create `pentest-agent-harness/schemas/auth_validation.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "target_url", "status", "accounts", "blocked", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "target_url": {"type": "string"},
    "status": {"type": "string"},
    "accounts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["role", "login_status", "login_url", "post_login_url", "storage_observed", "evidence"],
        "properties": {
          "role": {"type": "string"},
          "email": {"type": "string"},
          "login_status": {"type": "string"},
          "login_url": {"type": "string"},
          "post_login_url": {"type": "string"},
          "storage_observed": {"type": "object"},
          "evidence": {"type": "array"}
        }
      }
    },
    "blocked": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 5: 新增 `skill_improvement_candidates` schema**

Create `pentest-agent-harness/schemas/skill_improvement_candidates.schema.json`:

```json
{
  "type": "object",
  "required": ["lab_id", "source_run_id", "items", "summary"],
  "properties": {
    "lab_id": {"type": "string"},
    "source_run_id": {"type": "string"},
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "affected_agent", "affected_skill", "root_cause", "observed_gap", "required_change", "acceptance_check"],
        "properties": {
          "id": {"type": "string"},
          "affected_agent": {"type": "string"},
          "affected_skill": {"type": "string"},
          "root_cause": {"type": "string"},
          "observed_gap": {"type": "string"},
          "required_change": {"type": "string"},
          "acceptance_check": {"type": "string"}
        }
      }
    },
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 6: 扩展 `runtime_api_observations` schema**

Replace `pentest-agent-harness/schemas/runtime_api_observations.schema.json` with:

```json
{
  "type": "object",
  "required": ["lab_id", "source", "apis"],
  "properties": {
    "lab_id": {"type": "string"},
    "source": {"type": "string"},
    "apis": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["method", "path", "status", "trigger", "actor_role", "source_workflow", "request_field_names", "response_field_names", "sensitive_fields_redacted"],
        "properties": {
          "method": {"type": "string"},
          "url": {"type": "string"},
          "path": {"type": "string"},
          "status": {"type": "number"},
          "trigger": {"type": "string"},
          "actor_role": {"type": "string"},
          "source_workflow": {"type": "string"},
          "request_field_names": {"type": "array"},
          "response_field_names": {"type": "array"},
          "sensitive_fields_redacted": {"type": "boolean"},
          "auth_required": {"type": "boolean"},
          "csrf_observed": {"type": "boolean"},
          "cors_observed": {"type": "boolean"}
        }
      }
    },
    "blocked": {"type": "array"},
    "summary": {"type": "object"}
  }
}
```

- [ ] **Step 7: 运行 schema 测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: PASS，输出包含 schema fixture 全部 valid。

- [ ] **Step 8: 提交 Task 1**

```bash
git add pentest-agent-harness/schemas/browser_workflow_inventory.schema.json \
  pentest-agent-harness/schemas/auth_validation.schema.json \
  pentest-agent-harness/schemas/skill_improvement_candidates.schema.json \
  pentest-agent-harness/schemas/runtime_api_observations.schema.json \
  pentest-agent-harness/tests/test_validate_schema.py
git commit -m "feat: add runtime debug artifact schemas"
```

## Task 2: 新增浏览器运行时调试产物写入工具

**Files:**
- Create: `pentest-agent-harness/tools/write_browser_runtime_debug_artifacts.py`
- Create: `pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py`:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "write_browser_runtime_debug_artifacts.py"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_run(run_dir: Path) -> Path:
    write_json(
        run_dir / "lab_profile.json",
        {
            "lab_id": "generic-lab",
            "target_url": "http://localhost:3000",
            "auth_surface": {
                "login": {
                    "page_url": "/#/login",
                    "api_candidates": [{"method": "POST", "path": "/rest/user/login"}],
                }
            },
        },
    )
    write_json(
        run_dir / "browser_observations.json",
        {
            "source": "manual-browser-observation",
            "current_url": "http://localhost:3000/#/",
            "workflows": [
                {
                    "workflow_id": "wf-home",
                    "route": "/#/",
                    "role": "anonymous",
                    "action_type": "navigation",
                    "trigger": "home page",
                    "coverage_status": "checked",
                    "api_refs": ["GET /rest/products/search"],
                }
            ],
            "auth": {
                "status": "blocked",
                "accounts": [],
                "blocked": [
                    {
                        "root_cause": "browser.account_missing",
                        "reason": "no ready account was provided",
                        "role": "standard-user",
                    }
                ],
            },
            "network": {
                "source": "browser-network-unavailable",
                "apis": [],
                "blocked": [
                    {
                        "root_cause": "browser.network_capture_missing",
                        "reason": "in-app observation did not include HAR or network events",
                    }
                ],
            },
        },
    )
    return run_dir / "browser_observations.json"


def test_write_browser_runtime_debug_artifacts_from_observations(tmp_path):
    run_dir = tmp_path / "run"
    observations = seed_run(run_dir)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir), str(observations)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "wrote browser runtime debug artifacts" in result.stdout
    out_dir = run_dir / "artifacts" / "browser-pentest-agent"
    workflow = load_json(out_dir / "browser_workflow_inventory.json")
    auth = load_json(out_dir / "auth_validation.json")
    runtime = load_json(out_dir / "runtime_api_observations.json")
    evidence = load_json(out_dir / "dynamic_evidence.json")
    candidates = load_json(out_dir / "skill_improvement_candidates.json")
    assert workflow["summary"]["checked"] == 1
    assert auth["blocked"][0]["root_cause"] == "browser.account_missing"
    assert runtime["blocked"][0]["root_cause"] == "browser.network_capture_missing"
    assert evidence["items"][0]["result"] == "blocked"
    assert candidates["items"][0]["affected_skill"] == "runtime-api-capture"


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_write_browser_runtime_debug_artifacts_from_observations(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py
```

Expected: FAIL，错误包含 `write_browser_runtime_debug_artifacts.py` 不存在。

- [ ] **Step 3: 实现工具**

Create `pentest-agent-harness/tools/write_browser_runtime_debug_artifacts.py`:

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class RuntimeDebugError(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeDebugError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise RuntimeDebugError(f"cannot read {filename}: {error.strerror}") from error


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def object_payload(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise RuntimeDebugError(f"{path.name} must contain a JSON object")
    return payload


def string_value(payload: dict[str, Any], key: str, default: str = "") -> str:
    value = payload.get(key)
    return value if isinstance(value, str) else default


def list_value(payload: dict[str, Any], key: str) -> list[Any]:
    value = payload.get(key)
    return value if isinstance(value, list) else []


def api_path(api: dict[str, Any]) -> str:
    value = string_value(api, "path") or string_value(api, "url")
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        return parsed.path or "/"
    return value


def normalize_workflows(observations: dict[str, Any]) -> list[dict[str, Any]]:
    workflows = []
    for index, item in enumerate(list_value(observations, "workflows"), start=1):
        if not isinstance(item, dict):
            continue
        blocked = list_value(item, "blocked")
        workflows.append(
            {
                "workflow_id": string_value(item, "workflow_id", f"workflow-{index:03d}"),
                "route": string_value(item, "route", string_value(observations, "current_url")),
                "role": string_value(item, "role", "anonymous"),
                "action_type": string_value(item, "action_type", "unknown"),
                "trigger": string_value(item, "trigger", "manual observation"),
                "coverage_status": string_value(item, "coverage_status", "unknown"),
                "api_refs": list_value(item, "api_refs"),
                "blocked": blocked,
            }
        )
    return workflows


def normalize_auth(observations: dict[str, Any], lab_id: str, target_url: str) -> dict[str, Any]:
    auth = observations.get("auth")
    auth = auth if isinstance(auth, dict) else {}
    accounts = list_value(auth, "accounts")
    blocked = list_value(auth, "blocked")
    authenticated = sum(1 for item in accounts if isinstance(item, dict) and item.get("login_status") == "authenticated")
    return {
        "lab_id": lab_id,
        "target_url": target_url,
        "status": string_value(auth, "status", "ready" if authenticated else "blocked"),
        "accounts": accounts,
        "blocked": blocked,
        "summary": {
            "accounts": len(accounts),
            "authenticated": authenticated,
            "blocked": len(blocked),
        },
    }


def normalize_runtime(observations: dict[str, Any], lab_id: str) -> dict[str, Any]:
    network = observations.get("network")
    network = network if isinstance(network, dict) else {}
    apis = []
    for item in list_value(network, "apis"):
        if not isinstance(item, dict):
            continue
        apis.append(
            {
                "method": string_value(item, "method", "GET"),
                "url": string_value(item, "url"),
                "path": api_path(item),
                "status": item.get("status") if isinstance(item.get("status"), (int, float)) else 0,
                "trigger": string_value(item, "trigger", "manual observation"),
                "actor_role": string_value(item, "actor_role", "anonymous"),
                "source_workflow": string_value(item, "source_workflow"),
                "request_field_names": list_value(item, "request_field_names"),
                "response_field_names": list_value(item, "response_field_names"),
                "sensitive_fields_redacted": item.get("sensitive_fields_redacted") is not False,
                "auth_required": item.get("auth_required") is True,
                "csrf_observed": item.get("csrf_observed") is True,
                "cors_observed": item.get("cors_observed") is True,
            }
        )
    blocked = list_value(network, "blocked")
    return {
        "lab_id": lab_id,
        "source": string_value(network, "source", "manual-browser-observation"),
        "apis": apis,
        "blocked": blocked,
        "summary": {"total": len(apis), "blocked": len(blocked)},
    }


def improvement_for_blocked(index: int, blocked: dict[str, Any]) -> dict[str, str]:
    root_cause = string_value(blocked, "root_cause", "browser.runtime_debug_blocked")
    skill = "runtime-api-capture" if root_cause == "browser.network_capture_missing" else "browser-workflow-recon"
    if root_cause.startswith("browser.account") or root_cause.startswith("browser.login") or root_cause == "browser.auth_surface_missing":
        skill = "auth-validation"
    return {
        "id": f"{skill}-{index:03d}",
        "affected_agent": "browser-pentest-agent",
        "affected_skill": skill,
        "root_cause": root_cause,
        "observed_gap": string_value(blocked, "reason", "runtime debug step was blocked"),
        "required_change": f"补强 {skill} 对 {root_cause} 的输入检查、blocked 记录和回归验证。",
        "acceptance_check": f"下一轮运行能稳定输出 {root_cause} 的结构化证据或消除该 blocked。",
    }


def dynamic_items(auth: dict[str, Any], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for index, blocked in enumerate(auth.get("blocked", []) + runtime.get("blocked", []), start=1):
        if not isinstance(blocked, dict):
            continue
        root_cause = string_value(blocked, "root_cause", "browser.runtime_debug_blocked")
        items.append(
            {
                "verification_id": f"BROWSER-RUNTIME-BLOCKED-{index:03d}",
                "source_id": string_value(blocked, "expected_finding_id"),
                "evidence_type": "browser_runtime_debug",
                "agent": "browser-pentest-agent",
                "skill": improvement_for_blocked(index, blocked)["affected_skill"],
                "result": "blocked",
                "root_cause": root_cause,
                "finding_candidate": False,
                "evidence": [string_value(blocked, "reason", root_cause)],
                "notes": root_cause,
            }
        )
    return items


def write_browser_runtime_debug_artifacts(run_dir: Path, observations_path: Path) -> dict[str, Any]:
    profile = object_payload(run_dir / "lab_profile.json")
    observations = object_payload(observations_path)
    lab_id = string_value(profile, "lab_id", "unknown-lab")
    target_url = string_value(profile, "target_url", string_value(observations, "current_url"))
    out_dir = run_dir / "artifacts" / "browser-pentest-agent"
    workflows = normalize_workflows(observations)
    blocked_workflows = [blocked for workflow in workflows for blocked in workflow["blocked"] if isinstance(blocked, dict)]
    workflow_inventory = {
        "lab_id": lab_id,
        "target_url": target_url,
        "source": string_value(observations, "source", "manual-browser-observation"),
        "workflows": workflows,
        "blocked": blocked_workflows,
        "summary": {
            "total": len(workflows),
            "checked": sum(1 for workflow in workflows if workflow["coverage_status"] == "checked"),
            "blocked": len(blocked_workflows),
            "unknown": sum(1 for workflow in workflows if workflow["coverage_status"] == "unknown"),
        },
    }
    auth = normalize_auth(observations, lab_id, target_url)
    runtime = normalize_runtime(observations, lab_id)
    items = dynamic_items(auth, runtime)
    candidates = {
        "lab_id": lab_id,
        "source_run_id": run_dir.name,
        "items": [improvement_for_blocked(index, item) for index, item in enumerate(auth["blocked"] + runtime["blocked"], start=1) if isinstance(item, dict)],
        "summary": {"total": len(auth["blocked"]) + len(runtime["blocked"])},
    }
    dynamic = {
        "agent": "browser-pentest-agent",
        "mode": "browser-runtime-debug",
        "summary": {
            "total": len(items),
            "verified": 0,
            "reproduced": 0,
            "blocked": len(items),
        },
        "items": items,
    }
    write_json(out_dir / "browser_workflow_inventory.json", workflow_inventory)
    write_json(out_dir / "auth_validation.json", auth)
    write_json(out_dir / "runtime_api_observations.json", runtime)
    write_json(out_dir / "dynamic_evidence.json", dynamic)
    write_json(out_dir / "skill_improvement_candidates.json", candidates)
    return {"workflows": len(workflows), "blocked": len(items), "candidates": len(candidates["items"])}


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: write_browser_runtime_debug_artifacts.py <run_dir> <browser_observations.json>", file=sys.stderr)
        return 2
    try:
        summary = write_browser_runtime_debug_artifacts(Path(sys.argv[1]), Path(sys.argv[2]))
    except (RuntimeDebugError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(
        "wrote browser runtime debug artifacts: "
        f"workflows={summary['workflows']} blocked={summary['blocked']} candidates={summary['candidates']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行工具测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py
```

Expected: PASS。

- [ ] **Step 5: 接入全量测试入口**

Modify `pentest-agent-harness/tests/run_all.py`，在测试列表中加入：

```python
    "test_browser_runtime_debug_artifacts.py",
```

保持列表按现有风格排列。

- [ ] **Step 6: 运行全量测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: PASS，数量比当前增加一个测试文件。

- [ ] **Step 7: 提交 Task 2**

```bash
git add pentest-agent-harness/tools/write_browser_runtime_debug_artifacts.py \
  pentest-agent-harness/tests/test_browser_runtime_debug_artifacts.py \
  pentest-agent-harness/tests/run_all.py
git commit -m "feat: write browser runtime debug artifacts"
```

## Task 3: 让 Debug Agent 使用动态证据里的 blocked root_cause

**Files:**
- Modify: `pentest-agent-harness/tools/compare_lab_expected_findings.py`
- Modify: `pentest-agent-harness/tests/test_lab_debug_compare.py`

- [ ] **Step 1: 写失败测试**

Append this test to `pentest-agent-harness/tests/test_lab_debug_compare.py`:

```python
def test_blocked_dynamic_evidence_root_cause_drives_issue_assignment(tmp_path):
    run_dir = tmp_path / "run"
    write_json(
        run_dir / "expected_findings.json",
        {
            "lab_id": "juice-shop",
            "findings": [
                {
                    "expected_finding_id": "juice-shop-authentication-001",
                    "title": "Authentication browser validation",
                    "category": "authentication",
                    "requires_browser": True,
                },
            ],
        },
    )
    write_json(
        run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence.json",
        {
            "agent": "browser-pentest-agent",
            "items": [
                {
                    "source_id": "juice-shop-authentication-001",
                    "result": "blocked",
                    "root_cause": "browser.network_capture_missing",
                    "agent": "browser-pentest-agent",
                    "skill": "runtime-api-capture",
                    "evidence": ["network event source was unavailable"],
                },
            ],
        },
    )

    result = run_compare(run_dir)

    assert result.returncode == 0, result.stderr
    issues = json.loads(
        (run_dir / "artifacts" / "debug-agent" / "agent_issue_log.json").read_text(
            encoding="utf-8"
        )
    )
    issue = issues["issues"][0]
    assert issue["status"] == "blocked"
    assert issue["root_cause"] == "browser.network_capture_missing"
    assert issue["affected_agent"] == "browser-pentest-agent"
    assert issue["affected_skill"] == "runtime-api-capture"
    assert "network event source was unavailable" in issue["evidence"][0]
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_debug_compare.py
```

Expected: FAIL，当前 issue 仍使用 `browser.session_setup_failed` 或默认 evidence。

- [ ] **Step 3: 增加 blocked evidence 详情收集**

In `pentest-agent-harness/tools/compare_lab_expected_findings.py`, add:

```python
def blocked_dynamic_details(run_dir: Path) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    for path in sorted((run_dir / "artifacts").glob("*/dynamic_evidence.json")):
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise LabDebugError(f"{path.name} must contain an object")
        items = payload.get("items", [])
        if not isinstance(items, list):
            raise LabDebugError(f"{path.name} must contain an items array")
        for item in items:
            if not isinstance(item, dict):
                continue
            status = str(item.get("result") or item.get("status") or "").strip().lower()
            if status not in BLOCKED_DYNAMIC_STATUSES:
                continue
            finding_id = item.get("source_id") or item.get("expected_finding_id") or item.get("expected_id")
            if finding_id:
                details[str(finding_id)] = item
    return details
```

- [ ] **Step 4: 修改 `issue_for_finding` 签名和 blocked 逻辑**

Replace the function signature and first block with:

```python
def issue_for_finding(
    index: int,
    finding: dict[str, Any],
    status: str,
    blocked_detail: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    root_cause, affected_agent, affected_skill = root_cause_for(finding)
    finding_id = expected_finding_id(finding)
    if status == "blocked" and blocked_detail:
        root_cause = str(blocked_detail.get("root_cause") or blocked_detail.get("notes") or root_cause)
        affected_agent = str(blocked_detail.get("agent") or affected_agent)
        affected_skill = str(blocked_detail.get("skill") or affected_skill)
        evidence_value = blocked_detail.get("evidence")
        if isinstance(evidence_value, list) and evidence_value:
            evidence = [str(item) for item in evidence_value]
        else:
            evidence = [f"Expected finding {finding_id} was blocked by {root_cause}."]
    elif status == "blocked":
        evidence = [f"Expected finding {finding_id} was blocked by dynamic evidence."]
    else:
        evidence = [f"Expected finding {finding_id} was not matched by reported findings."]
```

Keep the returned object shape unchanged, but use the new `evidence` list variable directly:

```python
        "evidence": evidence,
```

- [ ] **Step 5: 在 compare 中传入 blocked details**

Inside `compare(run_dir: Path)`, after computing blocked ids, add:

```python
    blocked_details = blocked_dynamic_details(run_dir)
```

When creating blocked issues, call:

```python
issue_for_finding(issue_index, finding, "blocked", blocked_details.get(expected_finding_id(finding)))
```

When creating missed issues, call:

```python
issue_for_finding(issue_index, finding, "missed")
```

- [ ] **Step 6: 运行 lab debug 测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_lab_debug_compare.py
```

Expected: PASS。

- [ ] **Step 7: 运行全量测试**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
```

Expected: PASS。

- [ ] **Step 8: 提交 Task 3**

```bash
git add pentest-agent-harness/tools/compare_lab_expected_findings.py \
  pentest-agent-harness/tests/test_lab_debug_compare.py
git commit -m "fix: preserve blocked dynamic root causes"
```

## Task 4: 补具体 Agent/Skill 指令

**Files:**
- Modify: `pentest-agent-harness/agents/browser-pentest-agent.md`
- Modify: `pentest-agent-harness/agents/debug-agent.md`
- Modify: `pentest-agent-harness/skills/browser-workflow-recon/SKILL.md`
- Modify: `pentest-agent-harness/skills/runtime-api-capture/SKILL.md`
- Modify: `pentest-agent-harness/skills/auth-validation/SKILL.md`

- [ ] **Step 1: 补 browser-pentest-agent 的运行时调试步骤**

In `pentest-agent-harness/agents/browser-pentest-agent.md`, add a section before `## 输出文件`:

```markdown
## 运行时调试闭环

1. 先读取 `auth_session_plan.json` 和 `scope.json`，确认本轮允许访问的 host、path、账号角色和 mutation 限制。
2. 真实浏览器阶段先执行匿名 baseline，记录 URL、标题、可见导航、菜单、表单、按钮、外部链接和弹窗状态。
3. 把每个浏览器入口写成 workflow：`workflow_id`、`route`、`role`、`action_type`、`trigger`、`api_refs`、`coverage_status`、`blocked`。
4. 登录前置验证只记录账号角色、登录状态、URL 变化、storage/cookie key 差异和截图路径，不记录密钥值。
5. 运行时 API 只有来自 HAR、代理日志或浏览器网络事件时才写入 `apis`；没有网络事件时写 `browser.network_capture_missing`。
6. 对账号缺失、登录失败、selector 变化、资源 ID 缺失、网络捕获缺失分别写 blocked，不把 blocked 写成漏洞 finding。
7. 每个 blocked 都必须能映射到一个具体 Skill 优化项，并写入 `skill_improvement_candidates.json`。
```

- [ ] **Step 2: 补 debug-agent 的动态证据归因规则**

In `pentest-agent-harness/agents/debug-agent.md`, add:

```markdown
## 动态证据归因优先级

当 expected finding 需要浏览器证据时，debug-agent 按以下顺序归因：

1. `dynamic_evidence.json` 中 `result/status = blocked` 且 `source_id` 命中 expected finding 时，优先使用 evidence item 的 `root_cause`、`agent`、`skill` 和 `evidence`。
2. 没有 blocked detail 时，才按 expected finding 的 category 使用默认 root cause。
3. blocked 不计入 missed；只有环境和前置条件可用但 Agent 未覆盖时才计入 missed。
4. 每个 blocked 或 missed issue 都必须能转成 regression case 或 skill improvement candidate。
```

- [ ] **Step 3: 补 browser-workflow-recon 的字段级清单**

Append to `pentest-agent-harness/skills/browser-workflow-recon/SKILL.md`:

```markdown
## Workflow 字段约束

每个 workflow 必须包含：

- `workflow_id`：稳定 ID，格式建议 `<role>-<route-or-action>`。
- `route`：前端 route 或当前 URL path。
- `role`：`anonymous`、测试账号角色或 `unknown`。
- `action_type`：`navigation`、`form`、`search`、`upload`、`download`、`redirect`、`auth`、`business_action`。
- `trigger`：用户动作，例如 `click Login nav item`。
- `api_refs`：已观察到的 API 摘要；没有网络证据时为空数组。
- `coverage_status`：`checked`、`blocked`、`skipped`、`unknown`。
- `blocked`：数组，每项包含 `root_cause` 和 `reason`。

禁止把页面猜测写成已覆盖。看不到入口、登录被阻塞或 selector 不稳定时，写 blocked。
```

- [ ] **Step 4: 补 runtime-api-capture 的输入适配和 blocked**

Append to `pentest-agent-harness/skills/runtime-api-capture/SKILL.md`:

```markdown
## 输入适配顺序

1. 优先读取浏览器网络事件或 HAR。
2. 其次读取代理日志。
3. 最后读取用户提供的脱敏请求摘要。
4. 如果三者都没有，只能写 `browser.network_capture_missing`，不能根据页面按钮或源码猜测 API 已发生。

每条 API 观察必须包含 `method`、`path`、`status`、`trigger`、`actor_role`、`source_workflow`、`request_field_names`、`response_field_names` 和 `sensitive_fields_redacted`。
```

- [ ] **Step 5: 补 auth-validation 的状态机**

Append to `pentest-agent-harness/skills/auth-validation/SKILL.md`:

```markdown
## 状态机

- `ready`：至少一个账号登录成功，且已记录登录前后 storage/cookie key 差异。
- `partial`：部分账号成功，部分账号 blocked。
- `blocked`：没有任何账号可用于后续权限或会话测试。

blocked root cause 必须使用固定值：

- `browser.auth_surface_missing`
- `browser.account_missing`
- `browser.login_failed`
- `browser.mfa_required`
- `browser.selector_changed`
- `browser.network_capture_missing`

账号缺失时停止认证测试，不允许爆破、撞库或使用非用户授权账号。
```

- [ ] **Step 6: 运行文档质量和禁止靶场绑定测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_agent_skill_doc_quality.py
python3 pentest-agent-harness/tests/test_no_lab_binding_in_core_agent_skills.py
```

Expected: PASS。若禁止靶场绑定测试失败，删除通用 Agent/Skill 中的具体靶场名、固定路由或固定 API。

- [ ] **Step 7: 提交 Task 4**

```bash
git add pentest-agent-harness/agents/browser-pentest-agent.md \
  pentest-agent-harness/agents/debug-agent.md \
  pentest-agent-harness/skills/browser-workflow-recon/SKILL.md \
  pentest-agent-harness/skills/runtime-api-capture/SKILL.md \
  pentest-agent-harness/skills/auth-validation/SKILL.md
git commit -m "docs: specify browser runtime debug skills"
```

## Task 5: 用本地 Juice-Shop 跑一次安全调试闭环

**Files:**
- Runtime only: `/private/tmp/pentest-agent-juice-runtime-debug-<timestamp>/`
- Do not commit: run artifacts under `/private/tmp` or `runs/`

- [ ] **Step 1: 读取 browser skill**

Before controlling the in-app browser, read:

```bash
sed -n '1,260p' /Users/caihaoming/.codex/plugins/cache/openai-bundled/browser/26.623.101652/skills/control-in-app-browser/SKILL.md
```

Expected: understand available in-app browser inspection actions.

- [ ] **Step 2: 初始化 Juice-Shop run**

Run:

```bash
RUN_DIR="/private/tmp/pentest-agent-juice-runtime-debug-$(date +%Y%m%d%H%M%S)"
python3 pentest-agent-harness/tools/init_lab_run.py pentest-agent-harness/labs/juice-shop "$RUN_DIR"
printf '%s\n' "$RUN_DIR"
```

Expected: `lab_profile.json`、`scope.json`、`expected_findings.json` copied into run dir。

- [ ] **Step 3: 跑文件级基线闭环**

Run:

```bash
python3 pentest-agent-harness/tools/load_lab_accounts.py "$RUN_DIR"
python3 pentest-agent-harness/tools/build_auth_session_plan.py "$RUN_DIR"
python3 pentest-agent-harness/tools/write_simulated_auth_session_observations.py "$RUN_DIR"
python3 pentest-agent-harness/tools/compare_lab_expected_findings.py "$RUN_DIR"
```

Expected: commands exit 0。若账号环境变量缺失，输出 blocked，不视为失败。

- [ ] **Step 4: 用 in-app browser 做只读观察**

Inspect current page at `http://localhost:3000/#/` and record:

```json
{
  "source": "manual-browser-observation",
  "current_url": "http://localhost:3000/#/",
  "workflows": [
    {
      "workflow_id": "anonymous-home-products",
      "route": "/#/",
      "role": "anonymous",
      "action_type": "navigation",
      "trigger": "initial page load",
      "coverage_status": "checked",
      "api_refs": [],
      "blocked": []
    }
  ],
  "auth": {
    "status": "blocked",
    "accounts": [],
    "blocked": [
      {
        "root_cause": "browser.account_missing",
        "reason": "no ready local test account was available in this run",
        "role": "standard-user"
      }
    ]
  },
  "network": {
    "source": "browser-network-unavailable",
    "apis": [],
    "blocked": [
      {
        "root_cause": "browser.network_capture_missing",
        "reason": "current in-app observation did not provide HAR or network event summaries"
      }
    ]
  }
}
```

Adjust `workflows` to match the actual observed page. Do not add Juice-Shop-specific logic to core files; this JSON lives only in the run dir.

- [ ] **Step 5: 写入浏览器运行时调试产物**

Run:

```bash
python3 pentest-agent-harness/tools/write_browser_runtime_debug_artifacts.py "$RUN_DIR" "$RUN_DIR/browser_observations.json"
python3 pentest-agent-harness/tools/compare_lab_expected_findings.py "$RUN_DIR"
```

Expected:

- `artifacts/browser-pentest-agent/browser_workflow_inventory.json` exists.
- `artifacts/browser-pentest-agent/auth_validation.json` exists.
- `artifacts/browser-pentest-agent/runtime_api_observations.json` exists.
- `artifacts/browser-pentest-agent/skill_improvement_candidates.json` exists.
- `artifacts/debug-agent/agent_issue_log.json` uses `browser.network_capture_missing` for network blocked items.

- [ ] **Step 6: 校验产物 schema**

Run:

```bash
python3 pentest-agent-harness/tools/validate_schema.py pentest-agent-harness/schemas/browser_workflow_inventory.schema.json "$RUN_DIR/artifacts/browser-pentest-agent/browser_workflow_inventory.json"
python3 pentest-agent-harness/tools/validate_schema.py pentest-agent-harness/schemas/auth_validation.schema.json "$RUN_DIR/artifacts/browser-pentest-agent/auth_validation.json"
python3 pentest-agent-harness/tools/validate_schema.py pentest-agent-harness/schemas/runtime_api_observations.schema.json "$RUN_DIR/artifacts/browser-pentest-agent/runtime_api_observations.json"
python3 pentest-agent-harness/tools/validate_schema.py pentest-agent-harness/schemas/skill_improvement_candidates.schema.json "$RUN_DIR/artifacts/browser-pentest-agent/skill_improvement_candidates.json"
```

Expected: all commands print `valid: <file>`.

- [ ] **Step 7: 运行最终回归**

Run:

```bash
python3 pentest-agent-harness/tests/run_all.py
python3 pentest-agent-harness/tests/test_no_lab_binding_in_core_agent_skills.py
```

Expected: PASS。

- [ ] **Step 8: 提交 Task 5 代码状态**

如果 Task 5 只产生 `/private/tmp` run artifacts，不提交 run 目录。只提交必要代码或文档修复：

```bash
git status --short
git add <only-source-files-if-any>
git commit -m "test: verify juice shop runtime debug loop"
```

如果没有源码变化，不创建空提交。

## 自检

- Spec 覆盖：
  - 文件级基线闭环：Task 5 Step 2-3。
  - 真实浏览器只读侦查：Task 5 Step 1 和 Step 4。
  - 认证前置验证产物：Task 1、Task 2。
  - 运行时 API 捕获 blocked：Task 1、Task 2、Task 4。
  - Expected findings blocked/missed 区分：Task 3。
  - Agent/Skill 优化候选：Task 1、Task 2、Task 5。
  - 多 Agent 协调文档：Task 4。
  - 断点续跑没有新增实现，本轮依赖现有 `run_state`/checkpoint；如果后续需要把新阶段接入 `resume_run.py`，另开计划。
- 占位词扫描：
  - 本 plan 不包含未展开的占位指令或跨任务省略写法。
- 类型一致性：
  - `browser_workflow_inventory.json`、`auth_validation.json`、`runtime_api_observations.json`、`skill_improvement_candidates.json` 字段名在 schema、测试和工具中保持一致。
