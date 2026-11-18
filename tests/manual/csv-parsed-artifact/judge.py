#!/usr/bin/env python3
"""Independently judge a parsed-records artifact against frozen expected values.

The judge reads exactly two JSON files: the expected records and the artifact.
It never reads input/orders.csv and never imports a CSV parser, so the expected
values cannot be recomputed from the data under test.

Usage:
    python3 -I judge.py expected/records.json artifacts/correct.json

Exit codes: 0 = pass, 1 = fail, 2 = usage or invalid expected file.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

FIELDS = ("id", "item", "note")


def load_json(path: str, *, expected: bool) -> object:
    prefix = "ERROR" if expected else "FAIL"
    exit_code = 2 if expected else 1
    try:
        with Path(path).open(encoding="utf-8") as handle:
            return json.load(handle)
    except OSError as error:
        print(f"{prefix} cannot read {path}: {error}", file=sys.stderr)
        raise SystemExit(exit_code) from error
    except json.JSONDecodeError as error:
        print(f"{prefix} invalid JSON in {path}: {error}", file=sys.stderr)
        raise SystemExit(exit_code) from error


def expect_records(document: object, path: str) -> list[dict[str, str]]:
    if not isinstance(document, list):
        print(f"ERROR {path}: expected a JSON array of records", file=sys.stderr)
        raise SystemExit(2)
    records: list[dict[str, str]] = []
    for index, item in enumerate(document):
        if not isinstance(item, dict):
            print(f"ERROR {path}: record[{index}] is not an object", file=sys.stderr)
            raise SystemExit(2)
        record = {}
        for field in FIELDS:
            value = item.get(field)
            if not isinstance(value, str):
                print(f"ERROR {path}: record[{index}].{field} is not a string", file=sys.stderr)
                raise SystemExit(2)
            record[field] = value
        records.append(record)
    return records


def artifact_records(document: object) -> tuple[list[dict[str, str]], list[str]]:
    """Return extracted records and shape problems; never raises for bad artifacts."""
    problems: list[str] = []
    if isinstance(document, dict) and isinstance(document.get("records"), list):
        document = document["records"]
    if not isinstance(document, list):
        return [], ["artifact is not a JSON array or an object with a records array"]

    records: list[dict[str, str]] = []
    for index, item in enumerate(document):
        if not isinstance(item, dict):
            problems.append(f"record[{index}] is not an object")
            continue
        missing = [field for field in FIELDS if field not in item]
        if missing:
            problems.append(f"record[{index}] missing {','.join(missing)}")
            continue
        record: dict[str, str] = {}
        for field in FIELDS:
            if not isinstance(item[field], str):
                problems.append(f"record[{index}].{field} is not a string")
                break
            record[field] = item[field]
        else:
            records.append(record)
    return records, problems


def quoted(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: judge.py <expected.json> <artifact.json>", file=sys.stderr)
        return 2

    expected_path, artifact_path = sys.argv[1], sys.argv[2]
    expected = expect_records(load_json(expected_path, expected=True), expected_path)
    if not any("\n" in record[field] for record in expected for field in FIELDS):
        print(
            "ERROR expected records contain no embedded newline; this case requires one",
            file=sys.stderr,
        )
        return 2
    document = load_json(artifact_path, expected=False)
    actual, shape_problems = artifact_records(document)

    issues: list[str] = list(shape_problems)
    for index in range(max(len(expected), len(actual))):
        if index >= len(expected):
            issues.append(f"record[{index}]: unexpected record {json.dumps(actual[index], ensure_ascii=False)}")
            continue
        if index >= len(actual):
            issues.append(f"record[{index}]: missing record {json.dumps(expected[index], ensure_ascii=False)}")
            continue
        for field in FIELDS:
            if actual[index][field] != expected[index][field]:
                issues.append(
                    f"record[{index}].{field}: expected {quoted(expected[index][field])}, "
                    f"got {quoted(actual[index][field])}"
                )

    # Make the quoted-newline condition explicit: a right-shaped record table can
    # still lose the newline that belongs to a field value.
    newline_slots = [
        (index, field)
        for index, record in enumerate(expected)
        for field in FIELDS
        if "\n" in record[field]
    ]
    missing_newlines = [
        (index, field)
        for index, field in newline_slots
        if index < len(actual) and "\n" not in actual[index][field]
    ]
    for index, field in missing_newlines:
        issues.append(f"record[{index}].{field}: embedded newline missing")

    header = f"artifact={artifact_path} expected={expected_path}"
    if issues:
        print(f"FAIL {header}")
        print(f"records: got {len(actual)}, expected {len(expected)}")
        for issue in issues:
            print(f"  {issue}")
        if shape_problems:
            print(f"  artifact shape: {len(shape_problems)} problem(s)")
        return 1

    print(f"PASS {header}")
    print(f"records: {len(actual)}/{len(expected)}")
    if newline_slots:
        slots = ", ".join(f"record[{index}].{field}" for index, field in newline_slots)
        print(f"embedded newline: preserved in {slots}")
    else:
        print("embedded newline: not present in the expected data")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
