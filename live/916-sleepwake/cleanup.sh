#!/bin/bash
# #916 sleep/wake leg: removes what prepare.sh made. Boots out the scratch label only, removes its
# plist and the scratch dir, and checks that the real ai.oats.schedule-tick.plist is unchanged.
# Refuses a path other than /private/tmp/oats-916-XXXXXX and a label other than
# ai.oats.schedule-tick-916sw-XXXXXX with the same suffix.
# Usage: ./cleanup.sh <scratch dir>
set -uo pipefail
S="${1:?usage: cleanup.sh <scratch dir>}"
[[ "$S" =~ ^/private/tmp/oats-916-[A-Za-z0-9]{6}$ ]] || { echo "refusing: $S is not /private/tmp/oats-916-XXXXXX" >&2; exit 2; }
[ -d "$S" ] && [ ! -L "$S" ] || { echo "refusing: $S is not a directory" >&2; exit 2; }
[ "$(cd "$S" && pwd -P)" = "$S" ] || { echo "refusing: $S resolves elsewhere" >&2; exit 2; }
[ -f "$S/state.json" ] || { echo "refusing: no $S/state.json, so not a prepare.sh scratch dir" >&2; exit 2; }
field() { node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; console.log(v ?? "")' "$S/state.json" "$1"; }
label=$(field label); before=$(field realPlistSha256)
suffix=${S##*/oats-916-}
[[ "$label" =~ ^ai\.oats\.schedule-tick-916sw-[A-Za-z0-9]{6}$ ]] && [ "$label" = "ai.oats.schedule-tick-916sw-$suffix" ] \
  || { echo "refusing: label '$label' is not ai.oats.schedule-tick-916sw-$suffix" >&2; exit 2; }
[ -n "$before" ] || { echo "refusing: $S/state.json records no realPlistSha256" >&2; exit 2; }

real="$HOME/Library/LaunchAgents/ai.oats.schedule-tick.plist"
realsha() { if [ -e "$real" ]; then shasum -a 256 "$real" | cut -d' ' -f1; else echo absent; fi; }
uid=$(id -u)
rc=0
[ "$(realsha)" = "$before" ] || { echo "WARNING: $real changed since prepare.sh ($before -> $(realsha)); this script never writes it" >&2; rc=1; }

if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
  launchctl bootout "gui/$uid/$label" || { echo "launchctl bootout gui/$uid/$label failed" >&2; rc=1; }
fi
launchctl print "gui/$uid/$label" >/dev/null 2>&1 && { echo "$label is still loaded; the scratch dir is kept" >&2; exit 1; }
rm -f "$S/$label.plist"
# A tick or its job still running from the scratch copy (macOS pgrep never lists its own ancestors).
left=$(pgrep -f "$S/" || true)
[ -z "$left" ] || { echo "processes running from $S (sent SIGTERM): $(pgrep -fl "$S/" | tr '\n' ';')" >&2; kill $left 2>/dev/null || true; sleep 1; }
rm -rf "$S"
after=$(realsha)
[ "$after" = "$before" ] || rc=1
echo "cleanup: $label loaded: $(launchctl print "gui/$uid/$label" >/dev/null 2>&1 && echo yes || echo no); scratch removed: $([ -e "$S" ] && echo no || echo yes); real plist sha256 $before before, $after after: $([ "$after" = "$before" ] && echo unchanged || echo CHANGED)"
exit $rc
