#!/bin/sh
# oats.core: Claude Code waiting emitter.
#   claude-waiting.sh set <permission|question> <node> <cli> <marker>
#   claude-waiting.sh clear <node> <cli> <marker>
#   claude-waiting.sh clear-tool <node> <cli> <marker>   (a PreToolUse/PostToolUse clear: skipped for a subagent's tool call)
# <marker> is the debounce marker's path, from the launch hook, or '' for none.
# Run by the Claude Code hooks oats-core.mjs writes into <home>/.claude/settings.json.
# It reports through `oats instance waiting set|clear --producer oats.core` that the
# session waits on the human, and never touches producer `agent` (the agent's own claim).
#
# It can NEVER hurt the Claude session: Claude reads a hook's stdout and exit code as
# decisions, so this script writes nothing anywhere visible, always exits 0, and bounds
# the CLI at ~3 s (Claude's own hook timeout is 5 s). The hook's JSON input stays on fd 3
# for the one bounded read that needs it (from_subagent); nothing else reads stdin.
exec >/dev/null 2>&1
# A closed stdin is never redirected from (a failed redirection ends sh itself); without
# /dev/fd the input reads as empty, which means the main thread.
if [ -e /dev/fd/0 ]; then exec 3<&0; else exec 3</dev/null; fi
exec </dev/null

action=$1
case "$action" in
  set)
    reason=$2; node=$3; cli=$4; marker=${5:-}
    case "$reason" in permission|question) ;; *) exit 0 ;; esac
    ;;
  clear|clear-tool)
    node=$2; cli=$3; marker=${4:-}
    ;;
  *) exit 0 ;;
esac

home=$OATS_INSTANCE_HOME
case "$home" in /*) ;; *) exit 0 ;; esac
[ -f "$home/instance.json" ] && [ ! -L "$home/instance.json" ] || exit 0
case "$node" in /*) ;; *) exit 0 ;; esac
case "$cli" in /*) ;; *) exit 0 ;; esac
[ -x "$node" ] && [ -f "$cli" ] || exit 0
# The CLI resolves nothing from the cwd Claude ran the hook in.
cd "$home" || exit 0

# Emitter-private debounce marker, outside the home (it is not the instance's state): a
# per-user temp file keyed by the home, present while oats.core's claim is set, so a clear
# on every tool call starts no node process unless there is a claim to clear. The launch
# hook computed its path and vetted its directory once (per user, created 0700, owned by
# us, mode exactly 0700, not a symlink, no ACL); the hot path only re-checks that the
# directory is still a real directory we own, which only we could have changed. Anything
# else means "no debounce": set and clear then always call the CLI (it is idempotent).
# Losing it (reboot, tmp cleanup) is harmless: the session boundary voids the claim.
case "$marker" in /*/*.claude) ;; *) marker= ;; esac
# test -O (owned by us) is not in POSIX but every sh we run under has it (dash, bash, ash,
# zsh); where it is missing the test fails and the marker is simply not used.
# shellcheck disable=SC3067
if [ -n "$marker" ] && ! { [ -d "${marker%/*}" ] && [ ! -L "${marker%/*}" ] && [ -O "${marker%/*}" ]; }; then marker=; fi
# A marker path that exists as anything but a regular file is unusable too.
if [ -n "$marker" ] && { [ -L "$marker" ] || { [ -e "$marker" ] && [ ! -f "$marker" ]; }; }; then marker=; fi

# Kill process $1 after $2 seconds (macOS has no timeout(1)), unless this watchdog is
# killed first: its TERM trap then ends its sleep too, so nothing is left behind. A TERM
# that lands before the sleep's pid is known is caught by `killed`. Sets $watchdog.
start_watchdog() {
  (
    timer='' killed=''
    trap 'killed=1; [ -z "$timer" ] || kill "$timer"' TERM
    sleep "$2" &
    timer=$!
    [ -z "$killed" ] || { kill "$timer"; exit 0; }
    wait "$timer" && kill -9 "$1"
  ) >/dev/null &
  watchdog=$!
}

# Whether this hook's input is a subagent's tool event (a background or parallel subagent
# in the same session), from Claude Code 2.1.288's payload: compact one-line JSON whose
# top-level keys put "agent_id" (subagents only) before "hook_event_name". Only the text
# before the first "hook_event_name" is looked at: a string value escapes its quotes, so
# that text holds top-level keys only. Read at most 64 KiB, for at most 1 s. No match
# (no key, another order, an input cut short before "hook_event_name", nothing read)
# means the main thread: the clear goes ahead.
from_subagent() {
  input=$(
    head -c 65536 <&3 &
    reader=$!
    start_watchdog "$reader" 1
    wait "$reader"
    kill "$watchdog"
  )
  prefix=${input%%\"hook_event_name\"*}
  [ "$prefix" != "$input" ] || return 1
  case "$prefix" in *'"agent_id":"'[A-Za-z0-9_-]*|*'"agent_id": "'[A-Za-z0-9_-]*) return 0 ;; esac
  return 1
}

# A subagent's tool call resolves nothing the human was asked by the main thread, so its
# clear is skipped (a permission Notification never says who asked: see docs). With a
# usable marker and no claim there is nothing to clear, and stdin is not even read.
if [ "$action" = clear-tool ]; then
  [ -n "$marker" ] && [ ! -e "$marker" ] && exit 0
  from_subagent && exit 0
  action=clear
fi

# Run the CLI in the background under a 3 s watchdog. Its status is the CLI's: non-zero
# when it failed or the watchdog killed it.
run_cli() {
  "$node" "$cli" instance waiting "$@" --home "$home" --json &
  pid=$!
  start_watchdog "$pid" 3
  wait "$pid"
  status=$?
  kill "$watchdog"
  return "$status"
}

# The marker's one line is its writer's token: "<reason> <pid>" for a set, "clear <pid>"
# for a clear under way. A set and a clear that run at once (parallel tool calls) can
# then tell that the other touched it, whatever order their CLI calls land in.
token() { line=; [ -f "$marker" ] && IFS= read -r line < "$marker"; printf '%s' "$line"; }

if [ -z "$marker" ]; then
  if [ "$action" = set ]; then
    run_cli set --producer oats.core --reason "$reason"
  else
    run_cli clear --producer oats.core
  fi
  exit 0
fi

if [ "$action" = set ]; then
  # An open AskUserQuestion is shown through Claude's permission dialog, so its own
  # permission_prompt follows the question's set: a permission prompt never relabels an
  # open question.
  current=$(token)
  [ "$reason" = permission ] && [ "${current%% *}" = question ] && exit 0
  mine="$reason $$"
  printf '%s\n' "$mine" > "$marker"
  run_cli set --producer oats.core --reason "$reason"
  # A clear ran while this set's CLI did (it rewrote or removed the marker), and its
  # clear may have landed before this set: clear again rather than leave a stale claim.
  [ "$(token)" = "$mine" ] || run_cli clear --producer oats.core
else
  [ -e "$marker" ] || exit 0
  mine="clear $$"
  printf '%s\n' "$mine" > "$marker"
  # The marker goes only once the clear is recorded: a failed or killed clear keeps it,
  # so the next clear retries. A set that came in meanwhile keeps it too, and is
  # recorded again in case this clear landed after it.
  if run_cli clear --producer oats.core; then
    now=$(token)
    if [ "$now" = "$mine" ]; then
      rm -f "$marker"
    else
      case "${now%% *}" in permission|question) run_cli set --producer oats.core --reason "${now%% *}" ;; esac
    fi
  fi
fi
exit 0
