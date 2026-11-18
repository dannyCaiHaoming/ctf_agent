#!/bin/sh
# Participant-facing entry; keep one instance path throughout the conversation.
set -eu
tool="$(dirname "$0")/operate.py"
run() { python3 -I "$tool" "$1" "$instance"; }
case "${1:-}" in
  start)
    [ "$#" -eq 1 ] || exit 2
    base="$(cd "$(dirname "$0")/../../../.." && pwd)/pentest-agent-run-data/report-revision-sessions"
    mkdir -p "$base"
    instance="$(mktemp -d "$base/session.XXXXXXXX")/case"
    run init
    echo "INSTANCE=$instance"
    cat "$instance/participant/task.md" "$instance/participant/inputs.json" "$instance/participant/draft.json"
    echo '將本輪 report.json 與 judgment.md 寫到 INSTANCE/participant/round1/，再執行 first INSTANCE。'
    ;;
  first)
    [ "$#" -eq 2 ] || exit 2
    instance="$2"
    run seal-first
    run release-trace
    cat "$instance/participant/trace.jsonl"
    echo '根據新增記錄，將本輪兩份交付另寫到 INSTANCE/participant/round2/，再執行 finish INSTANCE。'
    ;;
  finish)
    [ "$#" -eq 2 ] || exit 2
    instance="$2"
    run seal-second
    rc=0
    result="$(run judge)" || rc=$?
    [ "$rc" -lt 2 ] || exit "$rc"
    (set -C; printf '%s\n' "$result" > "$instance/result.json")
    echo "已保存：$instance/result.json"
    ;;
  *) echo 'usage: session.sh start | first INSTANCE | finish INSTANCE' >&2; exit 2 ;;
esac
