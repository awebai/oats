#!/bin/sh
# oats.core: Claude Code waiting emitter.
#   claude-waiting.sh set <permission|question> <node> <cli> <marker>
#   claude-waiting.sh clear <node> <cli> <marker>        (a turn boundary: UserPromptSubmit, Stop, SessionEnd; not debounced)
#   claude-waiting.sh clear-tool <node> <cli> <marker>   (a PreToolUse/PostToolUse clear: debounced; skipped for a subagent's tool call)
# <marker> is the debounce marker's path, from the launch hook, or '' for none.
# Run by the Claude Code hooks oats-core.mjs writes into <home>/.claude/settings.json.
# It reports through `oats instance waiting set|clear --producer oats.core` that the
# session waits on the human, and never touches producer `agent` (the agent's own claim).
#
# It can NEVER hurt the Claude session: Claude reads a hook's stdout and exit code as
# decisions, so this script writes nothing anywhere visible, always exits 0, never waits
# for another hook, and stays under Claude's 5 s hook timeout: no CLI call starts once ~2 s
# have passed since it began its work (an input read counts), and each call is killed at
# ~3 s. The hook's JSON input stays on fd 3 for the one bounded read that needs it
# (from_subagent); nothing else reads stdin.
#
# The protocol (with a marker; without one every event just calls the CLI):
#   <marker>          the INTENT: the latest event's wish, "permission", "question" or
#                     "clear". Every hook writes it first.
#   <marker>.applied  what the CLI last RECORDED: also "unknown" while a call is under way
#                     or after one failed (it may have written the claim). Absent is clear
#                     (the launch hook removes it with the session's claims). Only the lock
#                     holder writes it.
#   <marker>.lock     a directory: one RECONCILER at a time, its pid file the holder's
#                     token "<pid> <began>".
#   <marker>.lock.reap  a directory: one REAPER of a stale lock at a time.
#   <marker>.force    present: the next reconciliation calls the CLI even where intent and
#                     applied agree. Every turn boundary (`clear`) writes it, and the call
#                     that applies the intent consumes it.
# A hook writes its intent, then takes the lock if it is free (never waiting) and
# reconciles: while intent and applied differ, it records applied as unknown, calls the CLI
# for the intent and, on success, records the intent as applied, re-reading the intent
# after each call. A hook that finds the lock held just exits: the holder re-reads the
# intent after each call, and once more after letting go of the lock, so a newer intent is
# applied by it, in event order. A failed call, the call cap or the time budget leaves the
# two apart, for the next event to finish. A lock whose holder is gone (pid dead, or taken
# over 5 s ago, past Claude's timeout) is broken by a reaper, which judges it again under
# the reap lock first. A holder acknowledges a call and releases the lock only while the
# lock still holds its token.
# The kernel write itself is not fenced (issue #568), so a holder suspended past 5 s, or a
# reaper killed at a precise instant, can leave the claim wrong while intent and applied
# agree. The forced call at every turn boundary bounds that: a wrongly shown claim lasts
# until the end of the turn, or, if the turn's last hook found a reconciliation out of
# time, until the next event; a hidden question lasts until the human answers it.
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
# per-user temp file keyed by the home holding the latest intent (permission, question or
# clear), beside what the CLI last recorded, so a clear on every tool call starts no node
# process unless there is a claim to clear. The launch
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
# Beside the marker (the intent): <marker>.applied (what the CLI last recorded) and
# <marker>.lock (a directory: one reconciler at a time). A path that exists as anything
# else (a symlink, a file where the lock goes) makes the marker unusable too.
applied=$marker.applied
lock=$marker.lock
reaper=$marker.lock.reap
force=$marker.force
for f in "$marker" "$applied" "$force"; do
  if [ -n "$marker" ] && { [ -L "$f" ] || { [ -e "$f" ] && [ ! -f "$f" ]; }; }; then marker=; fi
done
for d in "$lock" "$reaper"; do
  if [ -n "$marker" ] && { [ -L "$d" ] || { [ -e "$d" ] && [ ! -d "$d" ]; }; }; then marker=; fi
done

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

# The intent: "permission", "question" or "clear"; absent or anything else is clear.
state_of() {
  line=
  [ -f "$1" ] && IFS= read -r line < "$1"
  case "$line" in permission|question) printf '%s' "$line" ;; *) printf clear ;; esac
}

# What the CLI last recorded: absent is clear (nothing recorded this session); anything
# but "permission", "question" or "clear" (an "unknown", a torn write) is unknown, which
# matches no intent, so the next event calls the CLI.
applied_of() {
  [ -e "$applied" ] || { printf clear; return; }
  line=
  IFS= read -r line < "$applied"
  case "$line" in permission|question|clear) printf '%s' "$line" ;; *) printf unknown ;; esac
}

# Whether the lock still holds this hook's token.
owns() {
  line=
  [ -f "$lock/pid" ] && IFS= read -r line < "$lock/pid"
  [ "$line" = "$token" ]
}

# Take the reconciler's lock if it is free, or held by a holder that is gone; never wait.
take_lock() {
  if mkdir "$lock" 2>/dev/null; then
    printf '%s\n' "$token" > "$lock/pid"
    return 0
  fi
  reap
}

# Break a stale lock and take it. Reapers take turns under the reap lock (one that finds it
# held exits), and each judges the lock again there: a judgement made before can never
# remove the lock a faster reaper has just taken. The new lock gets its token before the
# reap lock is let go. A reap lock left by a reaper killed in that instant is removed once
# it is a minute old.
reap() {
  if ! mkdir "$reaper" 2>/dev/null; then
    [ -n "$(find "$reaper" -prune -mmin +1 2>/dev/null)" ] || return 1
    rmdir "$reaper" 2>/dev/null
    mkdir "$reaper" 2>/dev/null || return 1
  fi
  took=''
  if stale_lock; then
    rm -f "$lock/pid"
    rmdir "$lock" 2>/dev/null
    if mkdir "$lock" 2>/dev/null; then
      printf '%s\n' "$token" > "$lock/pid"
      took=1
    fi
  fi
  rmdir "$reaper"
  [ -n "$took" ]
}

# Whether the lock's holder is gone: its pid is dead, or it took the lock over 5 s ago
# (Claude has killed it by then, or the machine slept; a reused pid looks alive). A lock
# with no readable pid file yet is its holder's first instant, unless it is a minute old (a
# holder killed in that instant).
stale_lock() {
  holder='' since=''
  [ -f "$lock/pid" ] && read -r holder since < "$lock/pid"
  case "$holder$since" in
    ''|*[!0-9]*) [ -n "$(find "$lock" -prune -mmin +1 2>/dev/null)" ]; return ;;
  esac
  kill -0 "$holder" 2>/dev/null || return 0
  [ $(( $(date +%s) - since )) -gt 5 ]
}

# Bring the recorded claim to the latest intent, under the lock (see the protocol above).
# At most 3 calls, and none once 2 s (whole seconds, so under 2 s in fact) have passed since
# $began: the worst case stays under 5 s.
reconcile() {
  token="$$ $began"
  calls=0
  while take_lock; do
    settled=''
    while :; do
      want=$(state_of "$marker")
      if [ ! -e "$force" ] && [ "$want" = "$(applied_of)" ]; then settled=1; break; fi
      [ "$calls" -lt 3 ] && [ $(( $(date +%s) - began )) -lt 2 ] || break
      # This call applies the latest intent, so it answers every forced call asked so far;
      # one asked during it leaves the flag again for the next round.
      rm -f "$force"
      # Until the call is known to have landed, the recorded claim is unknown: one that
      # fails or is killed may still have written it.
      printf 'unknown\n' > "$applied"
      calls=$((calls + 1))
      if [ "$want" = clear ]; then
        run_cli clear --producer oats.core || break
      else
        run_cli set --producer oats.core --reason "$want" || break
      fi
      # A holder whose lock was broken under it (it ran past 5 s: the machine slept)
      # acknowledges nothing and leaves the successor's lock alone.
      owns || return 0
      printf '%s\n' "$want" > "$applied"
    done
    owns || return 0
    rm -f "$lock/pid"
    rmdir "$lock"
    # A hook that found the lock held between our last read and here left its intent to us.
    [ -n "$settled" ] && { [ -e "$force" ] || [ "$(state_of "$marker")" != "$(applied_of)" ]; } || return 0
  done
}

# A subagent's tool call resolves nothing the human was asked by the main thread, so a
# tool clear (clear-tool) from one is skipped (a permission Notification never says who
# asked: see docs). It reads the input only when there is a claim to clear.
if [ -z "$marker" ]; then
  if [ "$action" = set ]; then
    run_cli set --producer oats.core --reason "$reason"
  else
    [ "$action" = clear-tool ] && from_subagent && exit 0
    run_cli clear --producer oats.core
  fi
  exit 0
fi

intent=$(state_of "$marker")
if [ "$action" = set ]; then
  # An open AskUserQuestion is shown through Claude's permission dialog, so its own
  # permission_prompt follows the question's set: a permission prompt never relabels an
  # open question.
  [ "$reason" = permission ] && [ "$intent" = question ] && exit 0
  began=$(date +%s)
  printf '%s\n' "$reason" > "$marker"
elif [ "$action" = clear-tool ]; then
  # Nothing to clear (cleared and recorded so, no forced call due): no node process, no
  # input read. This is the hot path: every tool call runs it twice.
  [ "$intent" = clear ] && [ "$(applied_of)" = clear ] && [ ! -e "$force" ] && exit 0
  began=$(date +%s)
  from_subagent && exit 0
  printf 'clear\n' > "$marker"
else
  # A turn boundary gets a CLI call whatever the cache says, to repair a claim a late
  # write left wrong: from this hook or, if another hook holds the lock, from that holder
  # if it still has time (the flag); otherwise from the next event.
  began=$(date +%s)
  printf 'clear\n' > "$marker"
  : > "$force"
fi
reconcile
exit 0
