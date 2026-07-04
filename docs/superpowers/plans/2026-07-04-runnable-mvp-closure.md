# Runnable MVP Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 harness dry-run 升级为可运行闭环 MVP，生成 run_state、agent_graph、verification_queue、dynamic_evidence、report_gate，并保持全量测试通过。

**Architecture:** 采用本地 JSON artifact 串联，不引入真实浏览器、HTTP proxy、数据库或 Temporal。新增工具保持单一职责：初始化运行状态、构建验证队列、写入模拟动态证据、执行报告门控；`run_harness_dry_run.py` 只负责按顺序编排这些工具。

**Tech Stack:** Python 3 标准库、JSON Schema 子集校验器、现有直接运行式测试框架、Markdown 文档。

---

## 文件结构

新增文件：

- `pentest-agent-harness/tools/init_run_state.py`：创建 `run_state.json`、`artifacts/dispatcher-agent/agent_graph.json` 和 `checkpoints/`。
- `pentest-agent-harness/tools/build_verification_queue.py`：从 `round_evaluation_<round>.json` 和 agent result 构建 `verification_queue_<round>.json`。
- `pentest-agent-harness/tools/write_simulated_dynamic_evidence.py`：从 verification queue 生成模拟 `dynamic_evidence_<round>.json`。
- `pentest-agent-harness/tools/report_gate.py`：读取 evaluation、verification queue、dynamic evidence，生成 `report_gate_<round>.json` 并更新 `run_state.json`。
- `pentest-agent-harness/schemas/agent_graph.schema.json`
- `pentest-agent-harness/schemas/verification_queue.schema.json`
- `pentest-agent-harness/schemas/dynamic_evidence.schema.json`
- `pentest-agent-harness/schemas/report_gate.schema.json`
- `pentest-agent-harness/tests/test_run_state_and_agent_graph.py`
- `pentest-agent-harness/tests/test_verification_queue.py`
- `pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py`

修改文件：

- `pentest-agent-harness/schemas/run_state.schema.json`：追加 `verification_queue`、`report_gate`、`resume` 字段。
- `pentest-agent-harness/tools/run_harness_dry_run.py`：串联新增闭环工具并扩展 summary。
- `pentest-agent-harness/tests/test_harness_dry_run.py`：断言新增闭环产物。

不修改：

- 本轮不修改真实 Agent/Skill 文档，避免把运行闭环任务变成文档扩写。
- 本轮不修改 `generate_report.py`，先用 `report_gate_R1.json` 和 `dry_run_summary.json` 证明门控闭环。

## Task 1: Run State 与 Agent Graph

**Files:**
- Create: `pentest-agent-harness/tests/test_run_state_and_agent_graph.py`
- Create: `pentest-agent-harness/tools/init_run_state.py`
- Create: `pentest-agent-harness/schemas/agent_graph.schema.json`
- Modify: `pentest-agent-harness/schemas/run_state.schema.json`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_run_state_and_agent_graph.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "init_run_state.py"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_init(run_dir):
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(run_dir),
            "--run-id",
            "demo",
            "--target-url",
            "https://example.test",
            "--repo-path",
            "/workspace/source",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_init_run_state_creates_state_graph_and_checkpoint_dir(tmp_path):
    run_dir = tmp_path / "runs" / "demo"

    result = run_init(run_dir)

    assert result.returncode == 0, result.stderr
    assert "initialized run state" in result.stdout
    assert (run_dir / "checkpoints").is_dir()

    state = load_json(run_dir / "run_state.json")
    graph = load_json(run_dir / "artifacts" / "dispatcher-agent" / "agent_graph.json")

    assert state["run_id"] == "demo"
    assert state["target_url"] == "https://example.test"
    assert state["repo_path"] == "/workspace/source"
    assert state["current_phase"] == "created"
    assert state["current_round"] == "R0"
    assert state["status"] == "created"
    assert state["completed_agents"] == []
    assert state["pending_agents"] == ["recon-agent"]
    assert state["verification_queue"] == {"total": 0, "verified": 0, "blocked": 0}
    assert state["report_gate"]["status"] == "not_run"
    assert state["resume"]["checkpoint_dir"] == "checkpoints"

    agent_ids = [node["agent_id"] for node in graph["nodes"]]
    assert agent_ids[:3] == ["root", "dispatcher-agent", "recon-agent"]
    assert graph["nodes"][0]["status"] == "running"
    assert graph["nodes"][2]["parent_id"] == "dispatcher-agent"


def test_init_run_state_refuses_bad_agent_safe_paths(tmp_path):
    bad_dir = tmp_path / "runs" / "bad"

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(bad_dir), "--run-id", "../bad"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert "invalid run id" in result.stderr
    assert "Traceback" not in result.stderr


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_init_run_state_creates_state_graph_and_checkpoint_dir(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_init_run_state_refuses_bad_agent_safe_paths(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_run_state_and_agent_graph.py
```

Expected: FAIL because `tools/init_run_state.py` does not exist.

- [ ] **Step 3: 实现 `init_run_state.py`**

Create `pentest-agent-harness/tools/init_run_state.py` with these functions and CLI behavior:

```python
#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path


class RunStateError(ValueError):
    pass


SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")
STABLE_TIME = "1970-01-01T00:00:00Z"


def validate_safe_id(value: str, label: str) -> None:
    if not value or not SAFE_ID.match(value) or ".." in value or "/" in value or "\\" in value:
        raise RunStateError(f"invalid {label}: {value}")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def base_graph() -> dict:
    nodes = [
        {
            "agent_id": "root",
            "name": "Root Harness Agent",
            "parent_id": None,
            "status": "running",
            "round": "R0",
            "task": "协调授权灰白盒渗透测试闭环",
            "contract_path": "",
            "result_path": "",
            "skills": ["pentest-harness", "safety-gate"],
            "started_at": STABLE_TIME,
            "completed_at": "",
        },
        {
            "agent_id": "dispatcher-agent",
            "name": "Dispatcher Agent",
            "parent_id": "root",
            "status": "pending",
            "round": "R0",
            "task": "生成合约、队列和轮次状态",
            "contract_path": "",
            "result_path": "artifacts/dispatcher-agent/dry_run_summary.json",
            "skills": ["agent-contract", "coverage-matrix"],
            "started_at": "",
            "completed_at": "",
        },
        {
            "agent_id": "recon-agent",
            "name": "Recon Agent",
            "parent_id": "dispatcher-agent",
            "status": "pending",
            "round": "R0",
            "task": "生成攻击面边界、信任边界、威胁模型和优先队列",
            "contract_path": "",
            "result_path": "artifacts/recon-agent/recon_priority_queue.json",
            "skills": ["target-intake", "recon-enumeration"],
            "started_at": "",
            "completed_at": "",
        },
    ]
    return {"schema_version": "1.0", "nodes": nodes}


def init_run_state(
    run_dir: Path,
    run_id: str,
    target_url: str,
    repo_path: str,
    scope_hash: str = "sha256-placeholder",
    config_hash: str = "sha256-placeholder",
) -> dict:
    validate_safe_id(run_id, "run id")
    (run_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
    state = {
        "run_id": run_id,
        "target_url": target_url,
        "repo_path": repo_path,
        "scope_hash": scope_hash,
        "config_hash": config_hash,
        "target_fingerprint": "",
        "current_phase": "created",
        "current_round": "R0",
        "status": "created",
        "completed_agents": [],
        "failed_agents": [],
        "pending_agents": ["recon-agent"],
        "verification_queue": {"total": 0, "verified": 0, "blocked": 0},
        "report_gate": {
            "status": "not_run",
            "verified_findings": 0,
            "candidate_findings": 0,
            "blocked_findings": 0,
        },
        "resume": {"checkpoint_dir": "checkpoints", "last_completed_step": "created"},
    }
    write_json(run_dir / "run_state.json", state)
    write_json(run_dir / "artifacts" / "dispatcher-agent" / "agent_graph.json", base_graph())
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    parser.add_argument("--run-id", default="demo")
    parser.add_argument("--target-url", default="https://example.test")
    parser.add_argument("--repo-path", default="/workspace/source")
    args = parser.parse_args()
    try:
        state = init_run_state(Path(args.run_dir), args.run_id, args.target_url, args.repo_path)
    except (RunStateError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"initialized run state: {state['run_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 创建 schema**

Create `pentest-agent-harness/schemas/agent_graph.schema.json`:

```json
{
  "type": "object",
  "required": ["schema_version", "nodes"],
  "properties": {
    "schema_version": {"type": "string"},
    "nodes": {"type": "array"}
  }
}
```

Modify `pentest-agent-harness/schemas/run_state.schema.json` to preserve existing required fields and add these properties:

```json
"verification_queue": {"type": "object"},
"report_gate": {"type": "object"},
"resume": {"type": "object"}
```

- [ ] **Step 5: 运行任务测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_run_state_and_agent_graph.py
```

Expected: PASS.

- [ ] **Step 6: 提交**

Run:

```bash
git add pentest-agent-harness/tests/test_run_state_and_agent_graph.py pentest-agent-harness/tools/init_run_state.py pentest-agent-harness/schemas/agent_graph.schema.json pentest-agent-harness/schemas/run_state.schema.json
git commit -m "feat: initialize run state and agent graph"
```

## Task 2: Verification Queue

**Files:**
- Create: `pentest-agent-harness/tests/test_verification_queue.py`
- Create: `pentest-agent-harness/tools/build_verification_queue.py`
- Create: `pentest-agent-harness/schemas/verification_queue.schema.json`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_verification_queue.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "build_verification_queue.py"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_build_verification_queue_from_candidates_and_coverage_gaps(tmp_path):
    run_dir = tmp_path / "runs" / "demo"
    write_json(
        run_dir / "artifacts" / "evaluation-agent" / "round_evaluation_R1.json",
        {
            "round": "R1",
            "summary": {"coverage_gaps": 1, "unchecked_candidates": 1, "conflicts": 0},
            "coverage_gaps": [
                {
                    "agent": "static-audit-agent",
                    "target": "orders-api",
                    "risk": "High",
                    "depth": "shallow",
                    "reason": "High 目标覆盖深度为 shallow",
                    "evidence": ["backend/src/OrderController.java:33"],
                }
            ],
            "conflicts": [],
            "unchecked_candidates": [
                {
                    "id": "UC-001",
                    "source_agent": "static-audit-agent",
                    "target_agent": "browser-pentest-agent",
                    "reason": "需要验证普通用户读取他人订单",
                    "priority": "P1",
                    "evidence": ["backend/src/OrderController.java:33"],
                }
            ],
            "r2_required": True,
            "r2_tasks": [],
        },
    )
    write_json(
        run_dir / "artifacts" / "static-audit-agent" / "agent_result_R1.json",
        {
            "agent": "static-audit-agent",
            "round": "R1",
            "status": "completed",
            "coverage": [],
            "findings": [],
            "unchecked_candidates": [],
            "conflicts": [],
        },
    )

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir), "--round", "R1"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    queue = load_json(run_dir / "artifacts" / "evaluation-agent" / "verification_queue_R1.json")
    assert queue["round"] == "R1"
    assert queue["summary"]["total"] == 2
    assert [item["status"] for item in queue["items"]] == ["queued", "queued"]
    assert queue["items"][0]["verification_type"] == "browser-authz-replay"
    assert queue["items"][0]["safety_level"] == "safe-replay"
    assert queue["items"][1]["verification_type"] == "coverage-gap-review"
    assert queue["items"][1]["safety_level"] == "safe-observation"


def test_build_verification_queue_requires_evaluation(tmp_path):
    run_dir = tmp_path / "runs" / "missing"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(run_dir), "--round", "R1"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "cannot read round_evaluation_R1.json" in result.stderr
    assert "Traceback" not in result.stderr


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_build_verification_queue_from_candidates_and_coverage_gaps(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_build_verification_queue_requires_evaluation(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_verification_queue.py
```

Expected: FAIL because `tools/build_verification_queue.py` does not exist.

- [ ] **Step 3: 实现 `build_verification_queue.py`**

Create `pentest-agent-harness/tools/build_verification_queue.py` with:

```python
#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


class VerificationQueueError(ValueError):
    pass


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json_object(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise VerificationQueueError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise VerificationQueueError(f"cannot read {filename}: {error.strerror}") from error
    if not isinstance(data, dict):
        raise VerificationQueueError(f"{path.name} must contain a JSON object")
    return data


def candidate_item(index: int, candidate: dict) -> dict:
    return {
        "verification_id": f"VQ-{index:03d}",
        "source_agent": candidate.get("source_agent", "unknown-agent"),
        "target_agent": candidate.get("target_agent", "browser-pentest-agent"),
        "candidate_id": candidate.get("id", f"candidate-{index:03d}"),
        "title": candidate.get("reason", "未验证候选"),
        "risk": "High" if candidate.get("priority") in {"P0", "P1"} else "Medium",
        "verification_type": "browser-authz-replay",
        "safety_level": "safe-replay",
        "status": "queued",
        "evidence": candidate.get("evidence", []),
        "required_artifacts": ["dynamic_evidence", "request_response_summary"],
    }


def gap_item(index: int, gap: dict) -> dict:
    return {
        "verification_id": f"VQ-{index:03d}",
        "source_agent": gap.get("agent", "evaluation-agent"),
        "target_agent": gap.get("agent", "static-audit-agent"),
        "candidate_id": f"gap-{index:03d}",
        "title": gap.get("reason", "覆盖缺口需要复核"),
        "risk": gap.get("risk", "Medium"),
        "verification_type": "coverage-gap-review",
        "safety_level": "safe-observation",
        "status": "queued",
        "evidence": gap.get("evidence", []),
        "required_artifacts": ["coverage_notes"],
    }


def build_verification_queue(run_dir: Path, round_name: str) -> dict:
    evaluation = load_json_object(
        run_dir / "artifacts" / "evaluation-agent" / f"round_evaluation_{round_name}.json"
    )
    items = []
    for candidate in evaluation.get("unchecked_candidates", []):
        if isinstance(candidate, dict):
            items.append(candidate_item(len(items) + 1, candidate))
    for gap in evaluation.get("coverage_gaps", []):
        if isinstance(gap, dict):
            items.append(gap_item(len(items) + 1, gap))
    queue = {
        "round": round_name,
        "state": "planned",
        "summary": {
            "total": len(items),
            "queued": len(items),
            "verified": 0,
            "blocked": 0,
        },
        "items": items,
    }
    write_json(run_dir / "artifacts" / "evaluation-agent" / f"verification_queue_{round_name}.json", queue)
    return queue


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    parser.add_argument("--round", default="R1")
    args = parser.parse_args()
    try:
        queue = build_verification_queue(Path(args.run_dir), args.round)
    except (VerificationQueueError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"built verification queue: {queue['summary']['total']} items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 创建 schema**

Create `pentest-agent-harness/schemas/verification_queue.schema.json`:

```json
{
  "type": "object",
  "required": ["round", "state", "summary", "items"],
  "properties": {
    "round": {"type": "string"},
    "state": {"type": "string", "enum": ["planned", "running", "completed"]},
    "summary": {"type": "object"},
    "items": {"type": "array"}
  }
}
```

- [ ] **Step 5: 运行任务测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_verification_queue.py
```

Expected: PASS.

- [ ] **Step 6: 提交**

Run:

```bash
git add pentest-agent-harness/tests/test_verification_queue.py pentest-agent-harness/tools/build_verification_queue.py pentest-agent-harness/schemas/verification_queue.schema.json
git commit -m "feat: build verification queue"
```

## Task 3: Dynamic Evidence 与 Report Gate

**Files:**
- Create: `pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py`
- Create: `pentest-agent-harness/tools/write_simulated_dynamic_evidence.py`
- Create: `pentest-agent-harness/tools/report_gate.py`
- Create: `pentest-agent-harness/schemas/dynamic_evidence.schema.json`
- Create: `pentest-agent-harness/schemas/report_gate.schema.json`

- [ ] **Step 1: 写失败测试**

Create `pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py` with:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_SCRIPT = ROOT / "tools" / "write_simulated_dynamic_evidence.py"
GATE_SCRIPT = ROOT / "tools" / "report_gate.py"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_run(run_dir):
    write_json(
        run_dir / "run_state.json",
        {
            "run_id": "demo",
            "target_url": "https://example.test",
            "repo_path": "/workspace/source",
            "scope_hash": "sha256-placeholder",
            "config_hash": "sha256-placeholder",
            "current_phase": "evaluation",
            "current_round": "R1",
            "status": "running",
            "completed_agents": [],
            "failed_agents": [],
            "pending_agents": [],
        },
    )
    write_json(
        run_dir / "artifacts" / "evaluation-agent" / "round_evaluation_R1.json",
        {
            "round": "R1",
            "summary": {"agent_results": 2, "findings": 0, "coverage_gaps": 1, "unchecked_candidates": 1, "conflicts": 0},
            "coverage_gaps": [{"agent": "static-audit-agent", "target": "orders-api", "risk": "High", "depth": "shallow"}],
            "conflicts": [],
            "unchecked_candidates": [],
            "r2_required": True,
            "r2_tasks": [],
        },
    )
    write_json(
        run_dir / "artifacts" / "evaluation-agent" / "verification_queue_R1.json",
        {
            "round": "R1",
            "state": "planned",
            "summary": {"total": 2, "queued": 2, "verified": 0, "blocked": 0},
            "items": [
                {
                    "verification_id": "VQ-001",
                    "source_agent": "static-audit-agent",
                    "target_agent": "browser-pentest-agent",
                    "candidate_id": "UC-001",
                    "title": "需要验证普通用户读取他人订单",
                    "risk": "High",
                    "verification_type": "browser-authz-replay",
                    "safety_level": "safe-replay",
                    "status": "queued",
                    "evidence": ["backend/src/OrderController.java:33"],
                    "required_artifacts": ["dynamic_evidence"],
                },
                {
                    "verification_id": "VQ-002",
                    "source_agent": "static-audit-agent",
                    "target_agent": "static-audit-agent",
                    "candidate_id": "gap-002",
                    "title": "覆盖缺口需要复核",
                    "risk": "High",
                    "verification_type": "coverage-gap-review",
                    "safety_level": "safe-observation",
                    "status": "queued",
                    "evidence": [],
                    "required_artifacts": ["coverage_notes"],
                },
            ],
        },
    )


def test_simulated_dynamic_evidence_and_report_gate(tmp_path):
    run_dir = tmp_path / "runs" / "demo"
    seed_run(run_dir)

    evidence_result = subprocess.run(
        [sys.executable, str(EVIDENCE_SCRIPT), str(run_dir), "--round", "R1"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert evidence_result.returncode == 0, evidence_result.stderr

    gate_result = subprocess.run(
        [sys.executable, str(GATE_SCRIPT), str(run_dir), "--round", "R1"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert gate_result.returncode == 0, gate_result.stderr

    evidence = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence_R1.json")
    gate = load_json(run_dir / "artifacts" / "report-agent" / "report_gate_R1.json")
    state = load_json(run_dir / "run_state.json")

    assert evidence["summary"]["total"] == 2
    assert evidence["items"][0]["status"] == "reachable"
    assert evidence["items"][1]["status"] == "blocked"
    assert gate["status"] == "passed_with_candidates"
    assert gate["summary"]["confirmed_findings"] == 0
    assert gate["summary"]["candidate_findings"] == 1
    assert gate["summary"]["blocked_findings"] == 1
    assert gate["summary"]["coverage_gaps"] == 1
    assert state["current_phase"] == "report-gate"
    assert state["status"] == "completed"
    assert state["report_gate"]["candidate_findings"] == 1


def test_report_gate_requires_evidence(tmp_path):
    run_dir = tmp_path / "runs" / "missing"
    seed_run(run_dir)
    result = subprocess.run(
        [sys.executable, str(GATE_SCRIPT), str(run_dir), "--round", "R1"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "cannot read dynamic_evidence_R1.json" in result.stderr
    assert "Traceback" not in result.stderr


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        test_simulated_dynamic_evidence_and_report_gate(Path(directory))
    with tempfile.TemporaryDirectory() as directory:
        test_report_gate_requires_evidence(Path(directory))
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py
```

Expected: FAIL because the two tools do not exist.

- [ ] **Step 3: 实现 `write_simulated_dynamic_evidence.py`**

Create `pentest-agent-harness/tools/write_simulated_dynamic_evidence.py` with these rules:

```python
#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


class DynamicEvidenceError(ValueError):
    pass


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json_object(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise DynamicEvidenceError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise DynamicEvidenceError(f"cannot read {filename}: {error.strerror}") from error
    if not isinstance(data, dict):
        raise DynamicEvidenceError(f"{path.name} must contain a JSON object")
    return data


def evidence_for(item: dict) -> dict:
    status = "reachable" if item.get("verification_type") == "browser-authz-replay" else "blocked"
    return {
        "verification_id": item.get("verification_id", ""),
        "status": status,
        "method": item.get("verification_type", "manual-review"),
        "request": {
            "method": "GET",
            "url": "https://example.test/redacted",
            "body": "",
        },
        "response": {
            "status_code": 200 if status == "reachable" else 0,
            "body_excerpt": "dry-run simulated evidence" if status == "reachable" else "",
        },
        "screenshot": f"artifacts/browser-pentest-agent/screenshots/{item.get('verification_id', 'unknown')}.png",
        "playwright_poc": f"artifacts/browser-pentest-agent/poc/{item.get('verification_id', 'unknown')}.spec.js",
        "observed_result": "模拟浏览器可达，未执行破坏性操作" if status == "reachable" else "dry-run 未执行覆盖缺口复核",
        "limitations": [] if status == "reachable" else ["需要人工补充真实源码或浏览器证据"],
        "evidence_paths": item.get("evidence", []),
    }


def write_simulated_dynamic_evidence(run_dir: Path, round_name: str) -> dict:
    queue = load_json_object(
        run_dir / "artifacts" / "evaluation-agent" / f"verification_queue_{round_name}.json"
    )
    items = [evidence_for(item) for item in queue.get("items", []) if isinstance(item, dict)]
    evidence = {
        "round": round_name,
        "mode": "simulated",
        "summary": {
            "total": len(items),
            "reachable": sum(1 for item in items if item["status"] == "reachable"),
            "verified": sum(1 for item in items if item["status"] in {"verified", "exploited"}),
            "blocked": sum(1 for item in items if item["status"] == "blocked"),
        },
        "items": items,
    }
    write_json(run_dir / "artifacts" / "browser-pentest-agent" / f"dynamic_evidence_{round_name}.json", evidence)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    parser.add_argument("--round", default="R1")
    args = parser.parse_args()
    try:
        evidence = write_simulated_dynamic_evidence(Path(args.run_dir), args.round)
    except (DynamicEvidenceError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"wrote simulated dynamic evidence: {evidence['summary']['total']} items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 实现 `report_gate.py`**

Create `pentest-agent-harness/tools/report_gate.py` with:

```python
#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


class ReportGateError(ValueError):
    pass


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json_object(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ReportGateError(f"invalid JSON in {path.name}: {error.msg}") from error
    except OSError as error:
        filename = Path(error.filename).name if error.filename else path.name
        raise ReportGateError(f"cannot read {filename}: {error.strerror}") from error
    if not isinstance(data, dict):
        raise ReportGateError(f"{path.name} must contain a JSON object")
    return data


def update_run_state(run_dir: Path, round_name: str, gate: dict, evidence: dict) -> None:
    state = load_json_object(run_dir / "run_state.json")
    state["current_phase"] = "report-gate"
    state["current_round"] = round_name
    state["status"] = "completed"
    state["verification_queue"] = {
        "total": evidence["summary"]["total"],
        "verified": evidence["summary"]["verified"],
        "blocked": evidence["summary"]["blocked"],
    }
    state["report_gate"] = {
        "status": gate["status"],
        "verified_findings": gate["summary"]["confirmed_findings"],
        "candidate_findings": gate["summary"]["candidate_findings"],
        "blocked_findings": gate["summary"]["blocked_findings"],
    }
    state["resume"] = {"checkpoint_dir": "checkpoints", "last_completed_step": "report-gate"}
    write_json(run_dir / "run_state.json", state)


def report_gate(run_dir: Path, round_name: str) -> dict:
    evaluation = load_json_object(
        run_dir / "artifacts" / "evaluation-agent" / f"round_evaluation_{round_name}.json"
    )
    queue = load_json_object(
        run_dir / "artifacts" / "evaluation-agent" / f"verification_queue_{round_name}.json"
    )
    evidence = load_json_object(
        run_dir / "artifacts" / "browser-pentest-agent" / f"dynamic_evidence_{round_name}.json"
    )
    evidence_items = evidence.get("items", [])
    confirmed = [item for item in evidence_items if isinstance(item, dict) and item.get("status") in {"verified", "exploited"}]
    candidates = [item for item in evidence_items if isinstance(item, dict) and item.get("status") in {"candidate", "queued", "reachable"}]
    blocked = [item for item in evidence_items if isinstance(item, dict) and item.get("status") == "blocked"]
    status = "passed" if confirmed else "passed_with_candidates"
    gate = {
        "round": round_name,
        "status": status,
        "summary": {
            "confirmed_findings": len(confirmed),
            "candidate_findings": len(candidates),
            "blocked_findings": len(blocked),
            "coverage_gaps": len(evaluation.get("coverage_gaps", [])),
            "verification_queue_items": len(queue.get("items", [])),
        },
        "confirmed_findings": confirmed,
        "needs_human_verification": candidates,
        "blocked_items": blocked,
        "coverage_gaps": evaluation.get("coverage_gaps", []),
        "rules": [
            "未验证候选不得进入 confirmed findings",
            "verified/exploited 才能作为已验证漏洞",
            "candidate/queued/reachable 进入需要人工验证",
            "blocked 进入阻塞项",
        ],
    }
    write_json(run_dir / "artifacts" / "report-agent" / f"report_gate_{round_name}.json", gate)
    update_run_state(run_dir, round_name, gate, evidence)
    return gate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    parser.add_argument("--round", default="R1")
    args = parser.parse_args()
    try:
        gate = report_gate(Path(args.run_dir), args.round)
    except (ReportGateError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"report gate {gate['status']}: confirmed={gate['summary']['confirmed_findings']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: 创建 schema**

Create `pentest-agent-harness/schemas/dynamic_evidence.schema.json`:

```json
{
  "type": "object",
  "required": ["round", "mode", "summary", "items"],
  "properties": {
    "round": {"type": "string"},
    "mode": {"type": "string", "enum": ["simulated", "browser", "api", "manual"]},
    "summary": {"type": "object"},
    "items": {"type": "array"}
  }
}
```

Create `pentest-agent-harness/schemas/report_gate.schema.json`:

```json
{
  "type": "object",
  "required": ["round", "status", "summary", "confirmed_findings", "needs_human_verification", "blocked_items", "coverage_gaps"],
  "properties": {
    "round": {"type": "string"},
    "status": {"type": "string", "enum": ["passed", "passed_with_candidates", "failed"]},
    "summary": {"type": "object"},
    "confirmed_findings": {"type": "array"},
    "needs_human_verification": {"type": "array"},
    "blocked_items": {"type": "array"},
    "coverage_gaps": {"type": "array"}
  }
}
```

- [ ] **Step 6: 运行任务测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py
```

Expected: PASS.

- [ ] **Step 7: 提交**

Run:

```bash
git add pentest-agent-harness/tests/test_dynamic_evidence_and_report_gate.py pentest-agent-harness/tools/write_simulated_dynamic_evidence.py pentest-agent-harness/tools/report_gate.py pentest-agent-harness/schemas/dynamic_evidence.schema.json pentest-agent-harness/schemas/report_gate.schema.json
git commit -m "feat: add dynamic evidence report gate"
```

## Task 4: Dry-run 闭环集成与全量验证

**Files:**
- Modify: `pentest-agent-harness/tools/run_harness_dry_run.py`
- Modify: `pentest-agent-harness/tests/test_harness_dry_run.py`
- Modify: `pentest-agent-harness/tests/test_validate_schema.py`

- [ ] **Step 1: 修改 dry-run 测试断言新增产物**

Modify `pentest-agent-harness/tests/test_harness_dry_run.py` inside `test_harness_dry_run_creates_contracts_results_evaluation_and_r2_queue` after existing path assertions:

```python
    assert (run_dir / "run_state.json").exists()
    assert (dispatcher_dir / "agent_graph.json").exists()
    assert (evaluation_dir / "verification_queue_R1.json").exists()
    assert (run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence_R1.json").exists()
    assert (run_dir / "artifacts" / "report-agent" / "report_gate_R1.json").exists()
```

Add after summary load:

```python
    run_state = load_json(run_dir / "run_state.json")
    agent_graph = load_json(dispatcher_dir / "agent_graph.json")
    verification_queue = load_json(evaluation_dir / "verification_queue_R1.json")
    dynamic_evidence = load_json(run_dir / "artifacts" / "browser-pentest-agent" / "dynamic_evidence_R1.json")
    report_gate = load_json(run_dir / "artifacts" / "report-agent" / "report_gate_R1.json")
```

Add assertions:

```python
    assert run_state["status"] == "completed"
    assert run_state["current_phase"] == "report-gate"
    assert any(node["agent_id"] == "root" for node in agent_graph["nodes"])
    assert verification_queue["summary"]["total"] >= 1
    assert dynamic_evidence["summary"]["total"] == verification_queue["summary"]["total"]
    assert report_gate["summary"]["candidate_findings"] >= 1
    assert summary["outputs"]["run_state"] == "run_state.json"
    assert summary["outputs"]["agent_graph"] == "artifacts/dispatcher-agent/agent_graph.json"
    assert summary["outputs"]["verification_queue"] == "artifacts/evaluation-agent/verification_queue_R1.json"
    assert summary["outputs"]["dynamic_evidence"] == "artifacts/browser-pentest-agent/dynamic_evidence_R1.json"
    assert summary["outputs"]["report_gate"] == "artifacts/report-agent/report_gate_R1.json"
```

- [ ] **Step 2: 运行 dry-run 测试确认失败**

Run:

```bash
python3 pentest-agent-harness/tests/test_harness_dry_run.py
```

Expected: FAIL because dry-run does not call the new tools yet.

- [ ] **Step 3: 修改 `run_harness_dry_run.py` imports**

Modify imports near the top:

```python
from build_agent_contracts import build_agent_contracts
from build_verification_queue import build_verification_queue
from check_agent_contracts import check_agent_contracts
from check_recon_artifacts import check_recon_artifacts
from evaluate_round import evaluate_round
from init_recon_artifacts import init_recon_artifacts
from init_run_state import init_run_state
from report_gate import report_gate
from write_simulated_dynamic_evidence import write_simulated_dynamic_evidence
```

- [ ] **Step 4: 修改 `run_harness_dry_run` 编排顺序**

Modify `run_harness_dry_run` to:

```python
def run_harness_dry_run(run_dir: Path, force: bool = False, round_name: str = "R1") -> dict:
    ensure_fresh_or_forced(run_dir, force)
    init_run_state(run_dir, "demo-dry-run", "https://example.test", "/workspace/source")
    prepare_recon_artifacts(run_dir)
    check_recon_artifacts(run_dir)
    queue = build_agent_contracts(run_dir, round_name)
    check_agent_contracts(run_dir, round_name)
    agent_result_count = write_simulated_agent_results(run_dir, queue, round_name)
    evaluation = evaluate_round(run_dir, round_name)
    verification_queue = build_verification_queue(run_dir, round_name)
    dynamic_evidence = write_simulated_dynamic_evidence(run_dir, round_name)
    gate = report_gate(run_dir, round_name)
    return write_summary(
        run_dir,
        round_name,
        queue,
        agent_result_count,
        evaluation,
        verification_queue,
        dynamic_evidence,
        gate,
    )
```

- [ ] **Step 5: 修改 `write_summary` 签名和 outputs**

Change the function signature:

```python
def write_summary(
    run_dir: Path,
    round_name: str,
    queue: dict,
    agent_result_count: int,
    evaluation: dict,
    verification_queue: dict,
    dynamic_evidence: dict,
    gate: dict,
) -> dict:
```

Add these summary fields:

```python
        "verification_queue_items": verification_queue["summary"]["total"],
        "dynamic_evidence_items": dynamic_evidence["summary"]["total"],
        "report_gate_status": gate["status"],
```

Extend `outputs`:

```python
            "run_state": "run_state.json",
            "agent_graph": "artifacts/dispatcher-agent/agent_graph.json",
            "verification_queue": f"artifacts/evaluation-agent/verification_queue_{round_name}.json",
            "dynamic_evidence": f"artifacts/browser-pentest-agent/dynamic_evidence_{round_name}.json",
            "report_gate": f"artifacts/report-agent/report_gate_{round_name}.json",
```

- [ ] **Step 6: 增加 schema validator 测试**

Modify `pentest-agent-harness/tests/test_validate_schema.py` with a new test:

```python
def test_new_mvp_closure_schemas_accept_minimal_objects(tmp_path):
    samples = {
        "agent_graph.schema.json": {"schema_version": "1.0", "nodes": []},
        "verification_queue.schema.json": {"round": "R1", "state": "planned", "summary": {}, "items": []},
        "dynamic_evidence.schema.json": {"round": "R1", "mode": "simulated", "summary": {}, "items": []},
        "report_gate.schema.json": {
            "round": "R1",
            "status": "passed_with_candidates",
            "summary": {},
            "confirmed_findings": [],
            "needs_human_verification": [],
            "blocked_items": [],
            "coverage_gaps": [],
        },
    }
    for schema_name, sample in samples.items():
        data_path = tmp_path / f"{schema_name}.data.json"
        data_path.write_text(json.dumps(sample), encoding="utf-8")
        result = subprocess.run(
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
        assert result.returncode == 0, result.stderr
```

Add this test call in the `if __name__ == "__main__"` block inside the temp directory section:

```python
        test_new_mvp_closure_schemas_accept_minimal_objects(TmpPath())
```

- [ ] **Step 7: 运行任务测试**

Run:

```bash
python3 pentest-agent-harness/tests/test_harness_dry_run.py
python3 pentest-agent-harness/tests/test_validate_schema.py
```

Expected: PASS.

- [ ] **Step 8: 运行全量验证**

Run:

```bash
python3 pentest-agent-harness/tools/check_agent_skill_docs.py --root pentest-agent-harness
python3 pentest-agent-harness/tests/run_all.py
PYTHONPYCACHEPREFIX=/private/tmp/pentest-agent-pycache python3 -m py_compile \
  pentest-agent-harness/tools/init_run_state.py \
  pentest-agent-harness/tools/build_verification_queue.py \
  pentest-agent-harness/tools/write_simulated_dynamic_evidence.py \
  pentest-agent-harness/tools/report_gate.py
```

Expected:

- `valid agent/skill docs`
- every test prints `PASS`
- py_compile exits 0

- [ ] **Step 9: 提交并推送**

Run:

```bash
git add pentest-agent-harness
git commit -m "feat: close runnable mvp dry run loop"
git push origin main
```

## Self-Review

Spec coverage:

- Run state and agent graph are covered by Task 1.
- Verification queue is covered by Task 2.
- Dynamic evidence and report gate are covered by Task 3.
- Dry-run integration and schema validation are covered by Task 4.
- The non-goal of real browser/proxy/exploit execution is preserved by using simulated evidence only.

Placeholder scan:

- This plan contains no unfinished placeholder markers or undefined function names.
- Every new tool has explicit function names and CLI behavior.
- Every task includes exact file paths and commands.

Type consistency:

- `round_name` is used consistently across tools.
- `verification_queue_<round>.json`, `dynamic_evidence_<round>.json`, and `report_gate_<round>.json` paths match between tests and tools.
- `run_state.json.report_gate` and `report_gate_<round>.json.summary` use matching count fields.
