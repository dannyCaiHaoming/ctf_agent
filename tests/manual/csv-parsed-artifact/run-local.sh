#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -ne 1 ]]; then
  echo "usage: run-local.sh <output.json>" >&2
  exit 2
fi
out="$1"

python3 -I "$here/parse_records.py" "$here/input/orders.csv" "$out"
python3 -I "$here/judge.py" "$here/expected/records.json" "$out"
