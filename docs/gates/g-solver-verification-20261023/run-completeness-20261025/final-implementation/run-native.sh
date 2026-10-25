#!/bin/zsh
set -eu
OUT="/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent/docs/gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation"
TASK_HOME=$(mktemp -d /tmp/ctf-final-implementation.XXXXXX)
trap 'rm -rf "$TASK_HOME"' EXIT
for mode in resume-partial resume-empty pure-empty pure-partial combined failed; do
  /usr/bin/env -i PATH=/opt/homebrew/bin:/usr/bin:/bin HOME="$TASK_HOME" XDG_CONFIG_HOME="$TASK_HOME/config" XDG_DATA_HOME="$TASK_HOME/data" XDG_CACHE_HOME="$TASK_HOME/cache" R4_MODE=$mode /usr/bin/sandbox-exec -f "$OUT/isolation.sb" /opt/homebrew/bin/node --import "/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent/node_modules/tsx/dist/loader.mjs" "$OUT/native-probe.ts" > "$OUT/native-$mode.log" 2>&1
  tail -1 "$OUT/native-$mode.log"
done
