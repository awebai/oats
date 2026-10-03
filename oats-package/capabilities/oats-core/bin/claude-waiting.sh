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

# Emitter-private debounce marker, outside the home (it is not the instance's state): a
# per-user temp file keyed by the home, present while oats.core's claim is set, so a clear
# on every tool call starts no node process unless there is a claim to clear. Its
# directory must be a real directory we own with mode 0700; a symlink is never followed. An unusable
# marker means "no debounce": set and clear then always call the CLI (it is idempotent).
# Losing it (reboot, tmp cleanup) is harmless: the session boundary voids the claim.
marker=
dir=${TMPDIR:-/tmp}
dir=${dir%/}/oats-waiting
[ -e "$dir" ] || [ -L "$dir" ] || mkdir -m 700 "$dir"
# test -O (owned by us) is not in POSIX but every sh we run under has it (dash, bash, ash,
# zsh); where it is missing the test fails and the marker is simply not used.
usable=
# shellcheck disable=SC3067
if [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ]; then
  # Mode exactly 0700 and no ACL (an existing directory is never repaired): a directory
  # others can write could hold a planted marker. "+" (an ACL) is refused and "." (an
  # SELinux context) accepted. macOS shows "@" (xattrs) INSTEAD of "+" when both are
  # present, so an "@" directory is used only when `ls -lde` lists no ACL entry under it.
  perms=$(ls -ld "$dir")
  # shellcheck disable=SC2012
  case "${perms%% *}" in
    drwx------|drwx------.) usable=yes ;;
    drwx------@) [ "$(ls -lde "$dir" | wc -l)" -eq 1 ] && usable=yes ;;
  esac
fi
if [ -n "$usable" ]; then
  sum=$(printf '%s' "$home" | { shasum -a 256 || sha256sum || cksum; })
  key=$(printf '%.16s' "${sum%% *}")
  case "$key" in ''|*[!0-9a-f]*) ;; *) marker=$dir/$key.claude ;; esac
fi
# A marker path that exists as anything but a regular file is unusable too.
if [ -n "$marker" ] && { [ -L "$marker" ] || { [ -e "$marker" ] && [ ! -f "$marker" ]; }; }; then marker=; fi

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
  if [ -n "$marker" ]; then
    # An open AskUserQuestion is shown through Claude's permission dialog, so its own
    # permission_prompt follows the question's set: the marker holds the current reason,
    # and a permission prompt never relabels an open question.
    current=
    [ -f "$marker" ] && IFS= read -r current < "$marker"
    [ "$reason" = permission ] && [ "$current" = question ] && exit 0
    printf '%s\n' "$reason" > "$marker"
  fi
  run_cli set --producer oats.core --reason "$reason"
else
  if [ -n "$marker" ]; then
    [ -e "$marker" ] || exit 0
    rm -f "$marker"
  fi
  run_cli clear --producer oats.core
fi
exit 0
