#!/bin/bash
# The live runs of awebai/oats#994: start one executable in one pane, on a private tmux socket, and
# watch it. No key is sent to the pane, ever. Nothing is fetched. See README.md.
#
# Usage: ./run.sh <mode> [NAME] [--prepare] [--checkout <oats checkout>]
#   modes: probe plain no-chrome approved approved-optout trust old chrome-offer chrome-flag chrome-env chrome-yolo
#   NAME (approved-optout only): DISABLE_TELEMETRY, DO_NOT_TRACK or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
#   --prepare creates the run folder, prints its path and stops.
# Settings come from LIVE_994_* variables (README.md, "Environment"). Everything is written under
# LIVE_994_BASE: the run folder <base>/run-<mode>/home and the out dir <base>/out-<mode>-<UTC>/.
# Exit status: 0 the run was made and checked; 1 it failed, its files hold a forbidden string, or
# the tmux server is still there; 2 refused, nothing was started.
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd -P)"
[ $# -gt 0 ] || { sed -n '2,13p' "$0" >&2; exit 2; }
for tool in node tmux git; do
  command -v "$tool" >/dev/null || { echo "refused: $tool is not on PATH" >&2; exit 2; }
done
# An empty environment for everything this run starts: the caller's (an agent session's tokens, an
# instance or tmux identity) never reaches node, tmux or the pane. Only PATH, a throwaway HOME, a
# terminal type, a locale and this run's own LIVE_994_* settings pass. The caller's home and user
# name pass as two more, which only the base refusal and the sanitation check read.
pass=(PATH="$PATH" TERM=xterm-256color LANG=C.UTF-8 LIVE_994_CALLER_HOME="${HOME:-}" LIVE_994_CALLER_USER="${USER:-${LOGNAME:-}}")
for v in LIVE_994_BASE LIVE_994_EXECUTABLE LIVE_994_CLAUDE_BINARY LIVE_994_CONFIG_DIR LIVE_994_OLD_CLAUDE LIVE_994_EXTRA_ENV \
  LIVE_994_SECONDS LIVE_994_PANE LIVE_994_ALSO_FORBID LIVE_994_DRY_RUN LIVE_994_STUB_SCENARIO; do
  [ -n "${!v:-}" ] && pass+=("$v=${!v}")
done
# Every refusal is checked here, before anything is started. This prints the run folder.
out="$(env -i "${pass[@]}" HOME=/nonexistent node "$here/drive.mjs" plan "$@")" || exit $?
[ -n "$out" ] || exit 0   # --prepare
# A neutral working directory: never the caller's, never inside an instance home.
cd "$out"
set +e
env -i "${pass[@]}" HOME="$out/throwaway-home" node "$here/drive.mjs" run "$out" "$@"
status=$?
env -i "${pass[@]}" HOME="$out/throwaway-home" node "$here/report.mjs" "$out"
checked=$?
set -e
[ "$status" -eq 2 ] && exit 2
[ "$status" -eq 0 ] && [ "$checked" -eq 0 ] || exit 1
