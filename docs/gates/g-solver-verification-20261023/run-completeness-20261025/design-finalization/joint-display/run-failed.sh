#!/bin/zsh
set -eu
OUT=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-design-validation-acydgwx0/joint-display
for mode in failed; do
  /usr/bin/env -i PATH=/opt/homebrew/bin:/usr/bin:/bin HOME=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-r4-home XDG_CONFIG_HOME=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-r4-home/config XDG_DATA_HOME=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-r4-home/data XDG_CACHE_HOME=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-r4-home/cache R4_MODE=$mode /usr/bin/sandbox-exec -f $OUT/isolation.sb /opt/homebrew/bin/node --import /Users/caihaoming/.codex/worktrees/result-joint-validation/pentest-agent/node_modules/tsx/dist/loader.mjs $OUT/native-probe.ts > $OUT/closed-projection-native-$mode.log 2>&1
  tail -1 $OUT/closed-projection-native-$mode.log
done
