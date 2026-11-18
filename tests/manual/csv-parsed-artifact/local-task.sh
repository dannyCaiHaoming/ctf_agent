#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
expected_sha256="9a85274950a18c1decd0c97934cf7af91c902e1b81606e201487c88601f1247b"
hint="如果兩種讀法可能不同，可用一筆含引號內換行的小樣本比較它們的結果。"

die() {
  echo "local-task: $*" >&2
  exit 2
}

usage() {
  cat >&2 <<'EOF'
usage:
  local-task.sh prepare <A|B> <run-dir>   # run-dir must not exist and must be outside the repo
  local-task.sh score   <A|B> <run-dir>   # judge out/records.json from a finished session
EOF
  exit 2
}

absolute() {
  python3 -I -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

hash_file() {
  python3 -I -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"
}

[[ $# -eq 3 ]] || usage
action="$1"
group="$2"
run="$(absolute "$3")"

[[ "$action" == prepare || "$action" == score ]] || usage
[[ "$group" == A || "$group" == B ]] || die "group must be A or B"
case "$run/" in
  "$repo/"*) die "run directory must be outside the repository: $run" ;;
esac

if [[ "$action" == prepare ]]; then
  [[ ! -e "$run" ]] || die "run directory already exists: $run"
  mkdir -p "$run/input" "$run/out"
  cp "$here/input/orders.csv" "$run/input/orders.csv"
  cp "$here/input/task.md" "$run/input/task.md"
  if [[ "$group" == B ]]; then
    printf '\n%s\n' "$hint" >> "$run/input/task.md"
  fi
  chmod 700 "$run"
  echo "prepared group $group"
  echo "run: $run"
  echo "files:"
  find "$run" -maxdepth 2 -type f -print | sort
  echo "task: $run/input/task.md"
  echo "data: $run/input/orders.csv"
  echo "output: $run/out/records.json"
  echo
  echo "next: start a clean session with cwd=$run, hand it input/task.md only,"
  echo "      then run: $0 score $group $run"
  exit 0
fi

[[ -d "$run" ]] || die "run directory not found: $run"
artifact="$run/out/records.json"
[[ -f "$artifact" ]] || die "missing submission: $artifact"

actual_sha256="$(hash_file "$here/expected/records.json")"
[[ "$actual_sha256" == "$expected_sha256" ]] || die "expected/records.json integrity check failed"
cmp -s "$here/input/orders.csv" "$run/input/orders.csv" || die "input/orders.csv changed in the run directory"

submission="$(dirname "$run")/$(basename "$run")-submission.json"
if [[ -e "$submission" ]]; then
  cmp -s "$artifact" "$submission" || die "first submission already saved at $submission and differs; refusing to overwrite"
else
  cp -p "$artifact" "$submission"
fi

log="${submission%.json}.log"
set +e
python3 -I "$here/judge.py" "$here/expected/records.json" "$submission" >"$log" 2>&1
rc=$?
set -e
verdict="$(sed -n '1s/ .*//p' "$log")"
echo "submission: $submission"
echo "verdict: ${verdict:-UNKNOWN}"
echo "full result: $log"
exit "$rc"
