"""Prepare, seal, and compare an offline two-round report case."""

import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile

CASE = Path(__file__).resolve().parent
REPO = CASE.parents[2]
SUBMISSION_FILES = ("report.json", "judgment.md")


def publish(path, data):
    """Publish complete bytes in one step without replacing existing evidence."""
    with tempfile.NamedTemporaryFile(dir=path.parent) as pending:
        pending.write(data)
        pending.flush()
        path.hardlink_to(pending.name)


def have_round_two(participant):
    return any((participant / "round2" / name).exists() for name in SUBMISSION_FILES)


def archive(participant, operator, number):
    snapshot = {}
    for name in SUBMISSION_FILES:
        path = participant / f"round{number}" / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"round{number}/{name} is missing or not a regular file")
        contents = path.read_bytes().decode("utf-8")
        if not contents.strip():
            raise ValueError(f"round{number}/{name} is empty")
        snapshot[name] = contents
    data = json.dumps(snapshot, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    publish(operator / f"round{number}.json", data)


def distinct_keys(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError(f"duplicate report field: {key}")
        obj[key] = value
    return obj


def read_report(operator, number, expected):
    contents = json.loads((operator / f"round{number}.json").read_bytes())["report.json"]
    report = json.loads(contents, object_pairs_hook=distinct_keys)
    if not isinstance(report, dict) or report.keys() != expected.keys():
        raise ValueError(f"round{number}: expected exactly north and south")
    if any(type(value) is not int or value < 0 for value in report.values()):
        raise ValueError(f"round{number}: report values must be nonnegative integers")
    return report


def compare(first, second, expected):
    if first == expected:
        return "not_triggered"
    if first["south"] != expected["south"]:
        return "first_control_wrong"
    if second["south"] != expected["south"]:
        return "control_regressed"
    if second != expected:
        return "target_still_wrong"
    return "revision_observed"


def operate(action, root):
    participant = root / "participant"
    operator = root / "operator"
    if action == "init":
        root.mkdir(mode=0o700)
        shutil.copytree(CASE / "participant", participant)
        shutil.copytree(CASE / "operator", operator)
        operator.chmod(0o700)
        for number in (1, 2):
            (participant / f"round{number}").mkdir()
        return 0

    trace = participant / "trace.jsonl"
    released = operator / "trace-released.jsonl"
    if action == "seal-first":
        if trace.exists() or have_round_two(participant):
            raise ValueError("trace or round 2 files already present")
        archive(participant, operator, 1)
        return 0

    if not (operator / "round1.json").is_file():
        raise ValueError("seal round 1 before releasing the trace")
    if action == "release-trace":
        if have_round_two(participant):
            raise ValueError("round 2 files already present before trace release")
        contents = (operator / "trace.jsonl").read_bytes()
        publish(trace, contents)
        publish(released, contents)
        return 0

    if not released.is_file():
        raise ValueError("operator must release the trace before sealing round 2")
    if action == "seal-second":
        archive(participant, operator, 2)
        return 0

    expected = json.loads((operator / "expected.json").read_bytes())
    first = read_report(operator, 1, expected)
    second = read_report(operator, 2, expected)
    outcome = compare(first, second, expected)
    print(json.dumps({"outcome": outcome, "second_matches_expected": second == expected}))
    return 0 if outcome == "revision_observed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "seal-first", "release-trace", "seal-second", "judge"))
    parser.add_argument("instance", type=Path)
    args = parser.parse_args()
    try:
        root = args.instance.resolve()
        if root == REPO or REPO in root.parents:
            raise ValueError("the case instance must be outside the repository")
        return operate(args.action, root)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
