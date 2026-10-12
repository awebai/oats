#!/bin/bash
# Kills the private tmux server of a #994 live run that stopped before its own cleanup. It kills
# nothing else and removes nothing. Usage: ./cleanup.sh <out-dir of that run>
# Exit status: 0 no server is left; 1 the server is still there; 2 refused.
set -uo pipefail
out="${1:?usage: cleanup.sh <out-dir>}"
state="$out/state.json"
[ -f "$state" ] || { echo "refused: no $state: nothing was started, or it is another directory" >&2; exit 2; }
field() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s[process.argv[2]]??""))' "$state" "$1"; }
socket="$(field socket)"; session="$(field session)"; pid="$(field panePid)"
# Only a socket this package made: <base>/tmux/<UTC stamp>-<pid>.
case "$socket" in /*/tmux/[0-9]*T[0-9]*Z-[0-9]*) ;; *) echo "refused: $state names no socket of a #994 live run" >&2; exit 2;; esac
[ "$session" = live994 ] || { echo "refused: $state names another session" >&2; exit 2; }
# An empty environment, as in the run: tmux then talks to this socket and no other server.
t() { env -i PATH="$PATH" tmux -u -S "$socket" "$@"; }
if [ -S "$socket" ] && sessions="$(t list-sessions -F '#{session_name}' 2>/dev/null)"; then
  # Never a server that holds anything but this run's one session.
  [ "$sessions" = live994 ] || { echo "refused: the server on that socket is not this run's" >&2; exit 2; }
  t kill-server 2>/dev/null
  echo "killed the private tmux server"
else
  echo "no server answers on the run's socket"
fi
left=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  left=no
  t list-sessions >/dev/null 2>&1 && left=yes
  [ "$left" = no ] && break
  sleep 0.3
done
group=unknown
case "$pid" in ''|null|*[!0-9]*) ;; *) if kill -0 -- "-$pid" 2>/dev/null; then group=alive; else group=gone; fi;; esac
echo "tmux server still there: $left; pane process group: $group"
[ "$left" = no ] || exit 1
