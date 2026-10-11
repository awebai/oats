#!/bin/bash
# Removes what run.sh created if a run stopped before its own cleanup.
# Usage: ./cleanup.sh <out-dir of that run>   (reads <out-dir>/state.json)
set -uo pipefail
out="${1:?usage: cleanup.sh <out-dir>}"
state="$out/state.json"
[ -f "$state" ] || { echo "no $state: nothing was created, or it is another directory" >&2; exit 2; }
base=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).base)' "$state")
tmuxdir=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tmuxTmpdir)' "$state")
case "$base" in /tmp/oats-*|/private/tmp/oats-*|/var/folders/*/oats-*|/private/var/folders/*/oats-*) ;; *) echo "refusing: base $base is not a fixture temp dir" >&2; exit 2;; esac
# The fixture's private TMUX_TMPDIR is realpath(mkdtemp("/tmp/oats-tmux-")) (test/helpers/host-fixture.mjs
# privateTmuxTmpdir): /tmp/oats-tmux-XXXXXX, /private/tmp/oats-tmux-XXXXXX on macOS. Nothing else is removed.
case "$tmuxdir" in /tmp/oats-tmux-?*|/private/tmp/oats-tmux-?*) ;; *) echo "refusing: tmux dir $tmuxdir is not the fixture's private TMUX_TMPDIR (/tmp/oats-tmux-*)" >&2; exit 2;; esac
socket="$tmuxdir/tmux-$(id -u)/oats"
if [ -S "$socket" ]; then tmux -S "$socket" kill-server 2>/dev/null && echo "killed private tmux server $socket"; fi
sleep 1
left=$(pgrep -fl "$base" || true)
if [ -n "$left" ]; then
  echo "processes still naming $base (shown, then sent SIGTERM):"; echo "$left"
  pgrep -f "$base" | xargs kill 2>/dev/null || true; sleep 1
fi
rm -rf "$base" "$tmuxdir"
echo "base exists: $([ -e "$base" ] && echo yes || echo no); tmux dir exists: $([ -e "$tmuxdir" ] && echo yes || echo no); processes naming base: $(pgrep -fl "$base" || echo none)"
