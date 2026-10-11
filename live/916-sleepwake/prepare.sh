#!/bin/bash
# #916 sleep/wake leg, step 1: a scratch copy of OATS at #916's head ticks a scratch deployment
# from its own launchd job (label ai.oats.schedule-tick-916sw-<suffix>), rendered by #916's
# renderLaunchdPlist/hostUnitPlan. Everything lives in one /private/tmp/oats-916-XXXXXX dir;
# ~/.oats and the real ai.oats.schedule-tick are never written or loaded.
# Usage: ./prepare.sh                 build, load the scratch job, wait for two ticks on schedule
#        ./prepare.sh --render-only   build and render the plist; load nothing (prints the scratch dir)
set -euo pipefail
PIN=81b6e5369a3b01144a9bae782e912eb5772e1aca   # fix/902-schedule-tick-alignment, #916's head
SLEEP_MIN=5
JOB=tick-probe
here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-}
[ -z "$mode" ] || [ "$mode" = "--render-only" ] || { echo "usage: prepare.sh [--render-only]" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "prepare.sh is the launchd (macOS) leg" >&2; exit 2; }
repo=$(git -C "$here" rev-parse --show-toplevel)
git -C "$repo" cat-file -e "$PIN^{commit}" || { echo "commit $PIN is not in $repo: fetch it first" >&2; exit 2; }

S=$(mktemp -d /private/tmp/oats-916-XXXXXX)
suffix=${S##*/oats-916-}
label="ai.oats.schedule-tick-916sw-$suffix"
log="$S/prepare.log"
fail() { cp "$log" "/private/tmp/oats916-prepare-$suffix.log" 2>/dev/null; echo "FAIL: $*; log: /private/tmp/oats916-prepare-$suffix.log"; "$here/cleanup.sh" "$S" >&2 || true; exit 1; }

real="$HOME/Library/LaunchAgents/ai.oats.schedule-tick.plist"
realsha() { if [ -e "$real" ]; then shasum -a 256 "$real" | cut -d' ' -f1; else echo absent; fi; }
uid=$(id -u)
node -e 'const [S, label, uid, pin, sha, at, minutes] = process.argv.slice(1);
  require("fs").writeFileSync(`${S}/state.json`, JSON.stringify({ scratch: S, label, uid: Number(uid), pin, job: "tick-probe", sleepMinutes: Number(minutes), realPlistSha256: sha, preparedAt: at }, null, 2) + "\n");' \
  "$S" "$label" "$uid" "$PIN" "$(realsha)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SLEEP_MIN"
record() { node -e 'const fs = require("fs"), p = `${process.argv[1]}/state.json`; fs.writeFileSync(p, JSON.stringify({ ...JSON.parse(fs.readFileSync(p, "utf8")), [process.argv[2]]: process.argv[3] }, null, 2) + "\n");' "$S" "$1" "$2"; }

{
  echo "scratch $S, label $label, pin $PIN, at $(date -u +%Y-%m-%dT%H:%M:%SZ)" &&
  git clone -q --shared --no-checkout "$repo" "$S/oats" &&
  git -C "$S/oats" checkout -q --detach "$PIN" &&
  [ "$(git -C "$S/oats" rev-parse HEAD)" = "$PIN" ] &&
  (cd "$S/oats" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
} >>"$log" 2>&1 || fail "could not build the scratch copy of OATS at $PIN"

# The scratch deployment: a workspace reference that resolves nowhere, no members, no instances,
# and one command job every minute. A command job runs an oats argv only (no shell); its run
# history and the unit's tick.log carry each tick's fired minute and wall-clock start.
dep="$S/dep"; home="$S/oats-home"; logdir="$S/log"
mkdir -p "$dep/agents" "$home" "$logdir"
printf 'schemaVersion: 2\nworkspace: example.invalid/oats-916/sleepwake\n' >"$dep/oats-local.yaml"
printf '{"id":"%s","cron":"* * * * *","tz":"UTC","kind":"command","cwd":"%s","argv":["oats","trigger","list"]}\n' "$JOB" "$dep" >"$S/job.json"
export OATS_HOME_DIR="$home"
(cd "$dep" && node "$S/oats/bin/oats.mjs" schedule add "$JOB" --file "$S/job.json" --json) >>"$log" 2>&1 || fail "schedule add"
(cd "$dep" && node --input-type=module -e '
  const S = await import(process.argv[1]);
  S.registerWorkspace(process.argv[2]);
  const reg = S.readRegistry();
  if (JSON.stringify(reg.workspaces) !== JSON.stringify([process.argv[2]])) throw new Error(`registry: ${JSON.stringify(reg)}`);
  console.log(`registered in ${S.hostScheduleDir()}`);' "$S/oats/lib/schedule.mjs" "$dep") >>"$log" 2>&1 || fail "register the scratch deployment"

# The unit, rendered by #916's own code from this shell's environment; only the Label differs.
plist="$S/$label.plist"
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  const [mod, bin, logDir, home, label, out] = process.argv.slice(1);
  const H = await import(mod);
  const { node, path, warnings } = H.hostUnitPlan();
  const xml = H.renderLaunchdPlist({ node, path, oatsBin: bin, logDir, oatsHomeDir: home });
  const from = `<key>Label</key><string>${H.LAUNCHD_LABEL}</string>`;
  if (xml.split(from).length !== 2) throw new Error("the rendered plist does not carry exactly one Label");
  const unit = xml.replace(from, `<key>Label</key><string>${label}</string>`);
  if (unit.includes(`>${H.LAUNCHD_LABEL}<`)) throw new Error("the real label is still in the plist");
  writeFileSync(out, unit);
  for (const w of warnings) console.log(`warning: ${w}`);' \
  "$S/oats/lib/schedule-host.mjs" "$S/oats/bin/oats.mjs" "$logdir" "$home" "$label" "$plist" >>"$log" 2>&1 || fail "render the plist"
plutil -lint "$plist" >>"$log" 2>&1 || fail "plutil -lint $plist"

if [ "$mode" = "--render-only" ]; then echo "rendered, nothing loaded: $plist"; exit 0; fi

launchctl print "gui/$uid/$label" >/dev/null 2>&1 && fail "$label is already loaded"
launchctl bootstrap "gui/$uid" "$plist" >>"$log" 2>&1 || fail "launchctl bootstrap gui/$uid $plist"
record loadedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Ready only after two consecutive minutes ticked at second 0-5, each with the job's run.
"$here/check.sh" --baseline "$S" >>"$log" 2>&1 || fail "no baseline: two consecutive on-schedule ticks did not appear within 200 s (see $log)"
record lastTick "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).lastTick)' "$home/schedules/state.json")"
echo "ready; sleep the Mac for at least $SLEEP_MIN minutes now"
