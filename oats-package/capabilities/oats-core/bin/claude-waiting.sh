#!/bin/sh
# oats.core: Claude Code waiting emitter.
#   claude-waiting.sh set <permission|question> <node> <cli>
#   claude-waiting.sh clear <node> <cli>
# Run by the Claude Code hooks oats-core.mjs writes into <home>/.claude/settings.json.
# It reports through `oats instance waiting set|clear --producer oats.core` that the
# session waits on the human, and never touches producer `agent` (the agent's own claim).
#
# It can NEVER hurt the Claude session: Claude reads a hook's stdout and exit code as
# decisions, so this script writes nothing anywhere visible, always exits 0, and bounds
# the CLI at ~3 s (Claude's own hook timeout is 5 s).
exec >/dev/null 2>&1 </dev/null

action=$1
case "$action" in
  set)
    reason=$2; node=$3; cli=$4
    case "$reason" in permission|question) ;; *) exit 0 ;; esac
    ;;
  clear)
    node=$2; cli=$3
    ;;
  *) exit 0 ;;
esac

home=$OATS_INSTANCE_HOME
case "$home" in /*) ;; *) exit 0 ;; esac
[ -f "$home/instance.json" ] && [ ! -L "$home/instance.json" ] || exit 0
case "$node" in /*) ;; *) exit 0 ;; esac
case "$cli" in /*) ;; *) exit 0 ;; esac
[ -x "$node" ] && [ -f "$cli" ] || exit 0

# Emitter-private debounce marker: present while oats.core's claim is set, so a clear on
# every tool call starts no node process unless there is a claim to clear.
marker=$home/.oats-waiting-claude

# Run the CLI in the background with a watchdog (macOS has no timeout(1)).
run_cli() {
  "$node" "$cli" instance waiting "$@" --home "$home" --json &
  pid=$!
  ( sleep 3; kill -9 "$pid" ) &
  watchdog=$!
  wait "$pid"
  kill "$watchdog"
}

if [ "$action" = set ]; then
  : > "$marker" || exit 0
  run_cli set --producer oats.core --reason "$reason"
else
  [ -e "$marker" ] || exit 0
  rm -f "$marker"
  run_cli clear --producer oats.core
fi
exit 0
