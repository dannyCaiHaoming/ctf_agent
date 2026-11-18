#!/usr/bin/env python3
"""Reference local path: read the raw CSV and write parsed records as JSON.

This is one allowed producer, not the judge. The judge reads only the expected
JSON and the artifact JSON; it does not import this script or parse the CSV.

Usage:
    python3 -I parse_records.py input/orders.csv /tmp/orders.records.json
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

FIELDS = ("id", "item", "note")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: parse_records.py <input.csv> <output.json>", file=sys.stderr)
        return 2

    source, destination = Path(sys.argv[1]), Path(sys.argv[2])
    with source.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    records = [
        {field: row[field] for field in FIELDS}
        for row in rows
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(records)} records to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
