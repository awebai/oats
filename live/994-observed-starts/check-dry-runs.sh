#!/bin/bash
# The stub dry runs of the #994 live-run scripts, one at a time, each compared with what it must
# show. They prove the mechanics and the verdict arithmetic, nothing about Claude: the only
# executable started is this directory's stub-claude.sh (or, in a refusal check, nothing at all).
#
# Usage: LIVE_994_BASE=<an existing, empty scratch directory outside the home directory> \
#          ./check-dry-runs.sh [--checkout <oats checkout>]
# It uses tmux on private sockets under that base, and nothing else: each case gets <base>/cNN.
# It prints one line per case, with no path in it, and exits 0 when every case passed.
set -uo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd -P)"
checkout="$here/../.."
[ "${1:-}" = --checkout ] && checkout="${2:?--checkout takes a path}"
base="${LIVE_994_BASE:?LIVE_994_BASE is required: an existing, empty scratch directory outside the home directory}"
[ -d "$base" ] || { echo "LIVE_994_BASE must be an existing directory" >&2; exit 2; }
base="$(cd "$base" && pwd -P)"
[ -z "$(ls -A "$base")" ] || { echo "LIVE_994_BASE must be empty: every case writes its own directory there" >&2; exit 2; }
# Only what a case sets reaches run.sh.
for v in $(env | sed -n 's/^\(LIVE_994_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
stub="$here/stub-claude.sh"
failed=0
passed=0
number=0

newcase() { number=$((number + 1)); c="$base/c$(printf '%02d' "$number")"; mkdir "$c"; }

# dry <scenario> <seconds> [VAR=value ...] -- <run.sh arguments>: one stub run in the case directory.
dry() {
  local scenario="$1" seconds="$2"; shift 2
  local vars=()
  while [ "$1" != -- ]; do vars+=("$1"); shift; done
  shift
  env LIVE_994_BASE="$c" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_OLD_CLAUDE="$stub" LIVE_994_STUB_SCENARIO="$scenario" \
    LIVE_994_SECONDS="$seconds" ${vars[@]+"${vars[@]}"} "$here/run.sh" "$@" --checkout "$checkout" >"$c/console.log" 2>&1
}

# expect <label> <exit status> <wanted status> <JavaScript expression over the run's files>
expect() {
  if node -e '
    const fs = require("fs"), path = require("path");
    const [label, dir, status, want, expr] = process.argv.slice(1);
    const outs = fs.readdirSync(dir).filter((name) => name.startsWith("out-"));
    const outName = outs.length === 1 ? outs[0] : null;
    const json = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dir, outName, name), "utf8")); } catch { return null; } };
    const text = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
    const v = json("verdict.json"), h = json("host.json"), t = json("timeline.json"), p = json("probe.json"), k = json("chrome-setting.json");
    const cleanup = json("cleanup.json"), s = json("sanitation.json"), log = text(path.join(dir, "console.log"));
    // The stub log, as calls of { cwd, args, env }.
    const calls = text(path.join(dir, outName || "", "stub-calls.log")).split("call\n").slice(1).map((block) => {
      const call = { cwd: null, args: [], env: {} };
      for (const line of block.split("\n")) {
        if (line.startsWith("cwd=")) call.cwd = line.slice(4);
        else if (line.startsWith("arg=")) call.args.push(line.slice(4));
        else if (line.startsWith("env ")) { const [name, value] = line.slice(4).split("="); call.env[name] = value; }
      }
      return call;
    });
    const args = (i) => (calls[i] ? calls[i].args.join(" ") : null);
    const between = (value, low, high) => typeof value === "number" && value >= low && value <= high;
    const clean = !!cleanup && cleanup.serverGone && cleanup.paneProcessGroupGone;
    const sane = !!s && s.failed.length === 0;
    let pass = false, note = "";
    try { pass = Number(status) === Number(want) && !!eval(expr); } catch (e) { note = ` [${e.message}]`; }
    const facts = v && v.pane !== false && v.harness
      ? `${v.outcome}${v.outcomeMs === null ? "" : ` at ${v.outcomeMs} ms`}; non-blank ${v.firstNonBlankMs}, marker ${v.firstMarkerMs}, window ${v.cleanWindowCompletedMs}; `
        + `harness ${v.harness.capturesBeforeRunning === null ? "never read as running" : `running after ${v.harness.capturesBeforeRunning} captures`}, gone ${v.harness.noLongerRunningMs}; ${v.captures} captures, ${v.failedCaptures} failed`
      : "";
    console.log(`${pass ? "ok  " : "FAIL"} ${label}: exit ${status}${facts ? `; ${facts}` : ""}${note}`);
    if (!pass) console.log(`     wanted exit ${want} and: ${expr}`);
    process.exit(pass ? 0 : 1);
  ' "$1" "$c" "$2" "$3" "$4"; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
}

# refused <label> [VAR=value ...] -- <run.sh arguments>: exit 2, and nothing started or written but the case directory.
refused() {
  local label="$1"; shift
  local vars=()
  while [ "$1" != -- ]; do vars+=("$1"); shift; done
  shift
  newcase
  env LIVE_994_BASE="$c" ${vars[@]+"${vars[@]}"} "$here/run.sh" "$@" --checkout "$checkout" >"$c/console.log" 2>&1
  local status=$?
  if [ "$status" -eq 2 ] && grep -q '^refused: ' "$c/console.log" && [ -z "$(ls -d "$c"/out-* "$c"/tmux 2>/dev/null)" ]; then
    passed=$((passed + 1)); echo "ok   refused, $label: exit 2, nothing started"
  else
    failed=$((failed + 1)); echo "FAIL refused, $label: exit $status"
  fi
}

# The out dir of a run in the background, once its pane exists.
pane_started() {
  local tries=0 o
  while [ "$tries" -lt 150 ]; do
    o="$(ls -d "$c"/out-* 2>/dev/null | head -1)"
    if [ -n "$o" ] && grep -q '"panePid": [0-9]' "$o/state.json" 2>/dev/null; then echo "$o"; return 0; fi
    tries=$((tries + 1)); sleep 0.1
  done
  return 1
}
socket_of() { node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1] + "/state.json", "utf8")).socket)' "$1"; }
private_tmux() { local socket="$1"; shift; env -i PATH="$PATH" tmux -u -S "$socket" "$@"; }

echo "#994 live-run dry runs: $(uname -s) $(uname -m), $(tmux -V), node $(node --version), bash ${BASH_VERSION%%(*}"
echo "the stub is not Claude: these runs prove the mechanics and the verdict arithmetic, nothing about Claude"

session='v.outcome === "no-prompt" && between(v.cleanWindowCompletedMs, 2000, 5000) && v.firstMarkerMs === null && v.questionAfterNoPrompt === false && v.sessionBannerFirstMs !== null && v.harness.noLongerRunningMs === null && v.exitFile.firstSeenMs === null && v.settledFrame.settled && h.stub === true && h.dryRun === true && h.pane.width === 110 && h.pane.height === 35 && clean && sane && calls.length === 1 && calls[0].cwd.endsWith("/run-" + h.mode + "/home")'

# --- every mode, against the stub
newcase; dry session 5 -- probe
expect "probe" $? 0 'v.pane === false && p.length === 2 && p.every((row) => row.exitStatus === 0 && row.stdoutIsJsonArray && row.stderrFirstLine === null) && args(0) === "--no-chrome plugin list --json" && args(1) === "plugin list --json" && t === null && sane'

newcase; dry session 5 -- plain
expect "plain" $? 0 "$session"' && args(0) === "-- @TASK.md" && calls[0].env.CLAUDE_CODE_ENABLE_CFC === "unset"'

newcase; dry session 5 -- no-chrome
expect "no-chrome" $? 0 "$session"' && args(0) === "--no-chrome -- @TASK.md"'

newcase; dry session 5 -- approved
expect "approved" $? 0 "$session"' && args(0) === "--channels plugin:aweb-channel@awebai-marketplace -- @TASK.md"'

newcase; dry trust 5 -- trust
expect "trust" $? 0 'v.outcome === "blocked: unexpected prompt" && between(v.firstMarkerMs, 100, 4000) && v.firstMarkers.includes("Yes, I trust this folder") && v.firstMarkers.includes("Accessing workspace:") && v.cleanWindowCompletedMs === null && v.questionMatchedMarker === true && v.questionAfterNoPrompt === false && v.sessionBannerFirstMs === null && clean && sane'

newcase; dry old 5 -- old
expect "old" $? 0 'p[0].exitStatus === 1 && !p[0].stdoutIsJsonArray && /^error: unknown option .--no-chrome.$/.test(p[0].stderrFirstLine) && p[1].exitStatus === 0 && p[1].stdoutIsJsonArray && v.outcome === "blocked: harness exited" && between(v.outcomeMs, 0, 1000) && v.screenOnlyOutcome === "no-prompt" && v.exitFile.status === 1 && between(v.exitFile.firstSeenMs, 0, 1000) && between(v.harness.noLongerRunningMs, 0, 1000) && args(2) === "--no-chrome -- @TASK.md" && h.executableVariable === "LIVE_994_OLD_CLAUDE" && clean && sane'

newcase; mkdir "$c/config"; dry unmarked-question 5 LIVE_994_CONFIG_DIR="$c/config" -- chrome-offer
expect "chrome-offer (a question with no marker)" $? 0 'v.outcome === "no-prompt" && v.questionMatchedMarker === false && v.markerCaptures === 0 && k.before === "absent" && k.after === "absent" && calls[0].env.CLAUDE_CONFIG_DIR === "set" && /questionMatchedMarker: FALSE/.test(log) && clean && sane'

newcase; mkdir "$c/config"; echo '{"claudeInChromeDefaultEnabled": false, "other": "unread"}' > "$c/config/.claude.json"
dry session 5 LIVE_994_CONFIG_DIR="$c/config" -- chrome-flag
expect "chrome-flag" $? 0 "$session"' && args(0) === "--no-chrome -- @TASK.md" && k.before === "false" && k.after === "false"'

# The configuration under a HOME passed in LIVE_994_EXTRA_ENV, with no LIVE_994_CONFIG_DIR.
mkdir "$base/operator-home"; echo '{"claudeInChromeDefaultEnabled": true}' > "$base/operator-home/.claude.json"
newcase; dry session 5 LIVE_994_EXTRA_ENV="HOME=$base/operator-home" -- chrome-env
expect "chrome-env (the configuration under a HOME of the extra environment)" $? 0 "$session"' && calls[0].env.CLAUDE_CODE_ENABLE_CFC === "0" && calls[0].env.CLAUDE_CONFIG_DIR === "unset" && k.before === "true" && k.after === "true" && h.extraEnvNames.join() === "HOME" && h.configuration === "the HOME of LIVE_994_EXTRA_ENV"'

newcase; dry session 5 -- chrome-yolo
expect "chrome-yolo" $? 0 "$session"' && args(0) === "--dangerously-skip-permissions -- @TASK.md" && k.before === "not-read"'

for name in DISABLE_TELEMETRY DO_NOT_TRACK CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; do
  newcase; dry notice 5 -- approved-optout "$name"
  expect "approved-optout $name" $? 0 "v.outcome === 'no-prompt' && v.noticeBlocksAtSettledFrame === 1 && v.settledFrame.flagIgnoredEntry === null && h.optOut === '$name' && outName.startsWith('out-approved-optout-$name-') && calls[0].env.$name === '1' && args(0) === '--channels plugin:aweb-channel@awebai-marketplace -- @TASK.md' && clean && sane"
done

# --- the verdict arithmetic and the edge cases, against the stub
newcase; dry late-question 6 -- plain
expect "a question first painted at 3 s" $? 0 'v.outcome === "no-prompt" && v.questionAfterNoPrompt === true && between(v.firstMarkerMs, 2700, 5000) && v.firstMarkerMs > v.cleanWindowCompletedMs && v.questionAfterNoPromptTimes.firstMarkerMs === v.firstMarkerMs && /questionAfterNoPrompt: true/.test(log) && clean && sane'

newcase; dry blank 3 -- plain
expect "a screen that stays blank" $? 0 'v.outcome === "blocked: observation timeout" && v.firstNonBlankMs === null && v.blankCaptures === v.captures && v.harness.noLongerRunningMs === null && clean && sane'

newcase; dry session 5 LIVE_994_PANE=80x24 -- plain
expect "another pane size" $? 0 'v.outcome === "no-prompt" && h.pane.width === 80 && h.pane.height === 24 && t.rows.every((row) => row.failed || (row.width === 80 && row.height === 24))'

newcase; dry session 5 -- plain &
job=$!
if o="$(pane_started)"; then sleep 1; private_tmux "$(socket_of "$o")" resize-window -t live994 -x 90 -y 30; fi
wait "$job"
expect "the pane resized mid-run" $? 0 'v.geometryChanges.length >= 1 && v.geometryChanges[0].width === 90 && v.geometryChanges[0].height === 30 && v.failure === null && clean'

newcase; dry session 5 -- plain &
job=$!
if o="$(pane_started)"; then sleep 1; private_tmux "$(socket_of "$o")" kill-server; fi
wait "$job"
expect "the pane gone mid-run" $? 1 'v.failure === "three consecutive captures failed" && v.failedCaptures === 3 && t.rows.slice(-3).every((row) => row.failed && row.harnessRunning === null) && /RUN FAILED/.test(log) && clean'

newcase; dry session 30 -- plain &
job=$!
if o="$(pane_started)"; then sleep 1; pkill -INT -f "drive.mjs run $o"; fi
wait "$job"
expect "the driver interrupted mid-run" $? 1 'v.interrupted === "SIGINT" && v.captures >= 5 && v.captures < 100 && v.failure === null && clean && sane'

# One capture that fails: a tmux on PATH that refuses its fifth capture and passes everything else on.
newcase; mkdir "$c/bin"
cat > "$c/bin/tmux" <<SHIM
#!/bin/sh
case " \$* " in *" capture-pane "*)
  n=\$(( \$(cat '$c/captures' 2>/dev/null || echo 0) + 1 )); echo "\$n" > '$c/captures'
  [ "\$n" -eq 5 ] && exit 1;;
esac
exec '$(command -v tmux)' "\$@"
SHIM
chmod +x "$c/bin/tmux"
dry session 5 PATH="$c/bin:$PATH" -- plain
expect "one capture that fails" $? 0 'v.failedCaptures === 1 && v.failure === null && t.rows[4].failed === true && t.rows[4].error === "tmux-failed" && v.outcome === "no-prompt" && clean && sane'

newcase; dry session 3 LIVE_994_EXTRA_ENV="STUB_994_PAINT=$(id -un)" -- plain
expect "a frame that holds the user name" $? 1 's.failed.length >= 1 && s.failed.every((row) => row.classes.join() === "user" && row.file.startsWith("frames/plain/")) && /sanitation: FAILED/.test(log) && h.extraEnvNames.join() === "STUB_994_PAINT"'

newcase; dry session 3 LIVE_994_EXTRA_ENV="STUB_994_PAINT=account@example.invalid" LIVE_994_ALSO_FORBID="nothing-like-this account@example.invalid" -- plain
expect "a frame that holds an also-forbidden string" $? 1 's.failed.length >= 1 && s.failed.every((row) => row.classes.join() === "also-forbid-2") && !/example\.invalid/.test(log) && !/example\.invalid/.test(JSON.stringify([h, s, v]))'

newcase; dry session 3 LIVE_994_EXTRA_ENV="HOME=$base/operator-home STUB_994_PAINT=$base/operator-home" -- chrome-offer
expect "a frame that holds the HOME of the extra environment" $? 1 's.failed.length >= 1 && s.failed.every((row) => row.classes.join() === "extra-env-home") && !log.includes("operator-home")'

# The evidence cannot be written (here, a directory where timeline.json goes): the cleanup still runs.
newcase; dry session 4 -- plain &
job=$!
left=unknown
if o="$(pane_started)"; then
  mkdir "$o/timeline.json"; socket="$(socket_of "$o")"; wait "$job"; status=$?
  left=no; private_tmux "$socket" list-sessions >/dev/null 2>&1 && left=yes
else wait "$job"; status=99; fi
if [ "$status" -eq 1 ] && [ "$left" = no ] && grep -q '"serverGone": true' "$o/cleanup.json" 2>/dev/null; then passed=$((passed + 1)); echo "ok   the evidence cannot be written: exit 1, and the private server is gone without cleanup.sh"
else failed=$((failed + 1)); echo "FAIL the evidence cannot be written: exit $status, server left $left"; fi

# A run whose driver is killed: cleanup.sh kills the private server it left.
newcase; dry session 30 -- plain &
job=$!
left=unknown
if o="$(pane_started)"; then
  pkill -9 -f "drive.mjs run $o" ; wait "$job"
  socket="$(socket_of "$o")"
  private_tmux "$socket" list-sessions >/dev/null 2>&1 && left=yes
  "$here/cleanup.sh" "$o" >"$c/cleanup.log" 2>&1; status=$?
  private_tmux "$socket" list-sessions >/dev/null 2>&1 && left=still
else wait "$job"; status=99; fi
if [ "$left" = yes ] && [ "$status" -eq 0 ]; then passed=$((passed + 1)); echo "ok   cleanup.sh after a killed driver: the server was left, cleanup.sh exit 0, no server after it"
else failed=$((failed + 1)); echo "FAIL cleanup.sh after a killed driver: server left $left, cleanup.sh exit $status"; fi

# --- refusals: exit 2, nothing started
refused "an unknown mode" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" -- nonsense
refused "an opt-out variable that is not one of the three" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" -- approved-optout TELEMETRY
refused "no executable" LIVE_994_DRY_RUN=yes -- plain
refused "a relative executable" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE=stub-claude.sh -- plain
refused "the stub without LIVE_994_DRY_RUN" LIVE_994_EXECUTABLE="$stub" -- plain
refused "LIVE_994_DRY_RUN with another executable" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE=/bin/sh -- plain
refused "no configuration directory outside a dry run" LIVE_994_EXECUTABLE=/bin/sh -- plain
refused "old without LIVE_994_OLD_CLAUDE" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" -- old
refused "seconds shorter than the clean window" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_SECONDS=1 -- plain
refused "a pane size that is not WxH" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_PANE=wide -- plain
refused "an extra environment entry that is not NAME=value" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_EXTRA_ENV="A=1 b c" -- plain
refused "CLAUDE_CONFIG_DIR in the extra environment" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_EXTRA_ENV="CLAUDE_CONFIG_DIR=/x" -- plain
refused "HOME in the extra environment outside the chrome modes" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_EXTRA_ENV="HOME=/" -- plain
refused "a variable the mode sets, in the extra environment" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_EXTRA_ENV="CLAUDE_CODE_ENABLE_CFC=1" -- chrome-env
refused "an unknown option" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" -- plain --send
refused "a second opt-out variable in the extra environment" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_EXTRA_ENV="DO_NOT_TRACK=1" -- approved-optout DISABLE_TELEMETRY
newcase; chmod 777 "$c"
env LIVE_994_BASE="$c" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" "$here/run.sh" plain --checkout "$checkout" >"$c/console.log" 2>&1; status=$?
if [ "$status" -eq 2 ] && grep -q '^refused: LIVE_994_BASE must be a directory of your own' "$c/console.log" && [ -z "$(ls "$c" | grep -v '^console.log$')" ]; then passed=$((passed + 1)); echo "ok   refused, a base other users can write: exit 2, nothing started"
else failed=$((failed + 1)); echo "FAIL refused, a base other users can write: exit $status"; fi
newcase; mkdir "$c/run-plain"
env LIVE_994_BASE="$c" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" LIVE_994_CONFIG_DIR="$c/run-plain" "$here/run.sh" plain --checkout "$checkout" >"$c/console.log" 2>&1; status=$?
env LIVE_994_BASE="$c" LIVE_994_CONFIG_DIR="$c/run-plain" "$here/run.sh" plain --prepare >>"$c/console.log" 2>&1; prepared=$?
if [ "$status" -eq 2 ] && [ "$prepared" -eq 2 ] && [ "$(grep -c '^refused: LIVE_994_CONFIG_DIR overlaps' "$c/console.log")" -eq 2 ] && [ -z "$(ls -A "$c/run-plain")" ]; then passed=$((passed + 1)); echo "ok   refused, a configuration directory where this script writes, with and without --prepare: exit 2 each, nothing written there"
else failed=$((failed + 1)); echo "FAIL refused, a configuration directory where this script writes: exit $status, with --prepare $prepared"; fi
# A link where the script would write is never followed: the run folder, its home, its TASK.md.
mkdir "$base/elsewhere"
newcase; ln -s "$base/elsewhere" "$c/run-plain"; mkdir "$c/run-trust"; ln -s "$base/elsewhere" "$c/run-trust/home"
mkdir -p "$c/run-old/home"; ln -s "$base/elsewhere/TASK.md" "$c/run-old/home/TASK.md"
links=0
for m in plain trust old; do
  env LIVE_994_BASE="$c" "$here/run.sh" "$m" --prepare >>"$c/console.log" 2>&1
  [ $? -eq 2 ] && links=$((links + 1))
done
if [ "$links" -eq 3 ] && [ -z "$(ls -A "$base/elsewhere")" ] && [ "$(grep -c '^refused: ' "$c/console.log")" -eq 3 ]; then passed=$((passed + 1)); echo "ok   refused, a link where the run folder, its home or its TASK.md goes: exit 2 each, nothing written through it"
else failed=$((failed + 1)); echo "FAIL refused, a link where the script would write: $links of 3 refused"; fi
newcase
env LIVE_994_BASE="$HOME" LIVE_994_DRY_RUN=yes LIVE_994_EXECUTABLE="$stub" "$here/run.sh" plain --checkout "$checkout" >"$c/console.log" 2>&1; status=$?
if [ "$status" -eq 2 ] && grep -q '^refused: LIVE_994_BASE must be outside the home directory' "$c/console.log"; then passed=$((passed + 1)); echo "ok   refused, a base that is the home directory: exit 2, nothing started"
else failed=$((failed + 1)); echo "FAIL refused, a base that is the home directory: exit $status"; fi

# --prepare creates the run folder with its nine-line TASK.md, and stops.
newcase
env LIVE_994_BASE="$c" "$here/run.sh" trust --prepare >"$c/console.log" 2>&1; status=$?
if [ "$status" -eq 0 ] && [ "$(wc -l < "$c/run-trust/home/TASK.md" | tr -d ' ')" = 9 ] && grep -q "run-trust/home$" "$c/console.log" && [ -z "$(ls -d "$c"/out-* "$c"/tmux 2>/dev/null)" ]; then
  passed=$((passed + 1)); echo "ok   --prepare: exit 0, the run folder and its nine-line TASK.md, nothing else"
else failed=$((failed + 1)); echo "FAIL --prepare: exit $status"; fi

# --- the verdict arithmetic on written timelines (no tmux)
if node --input-type=module -e '
  const { judge } = await import(process.argv[2]);
  const rows = (to, change = () => ({})) => Array.from({ length: to / 100 + 1 }, (_, i) => ({ ms: i * 100, blank: false, markers: [], changed: i === 0, sessionBanner: false, noticeBlocks: 0, harnessRunning: true, exitFile: false, ...change(i * 100) }));
  const verdict = (to, change, mode = "plain") => judge({ mode, intervalMs: 100, rows: rows(to, change) });
  const cases = {
    "a marker on screen for one capture still blocks, and shows as one capture": () => { const v = verdict(3000, (ms) => (ms === 500 ? { markers: ["No, exit"] } : {})); return v.outcome === "blocked: unexpected prompt" && v.outcomeMs === 500 && v.markerRuns.length === 1 && v.markerRuns[0].captures === 1 && v.cleanWindowCompletedMs === 2600 && v.questionAfterNoPrompt === false; },
    "a blank capture restarts the window": () => { const v = verdict(4000, (ms) => (ms === 1000 ? { blank: true } : {})); return v.outcome === "no-prompt" && v.cleanWindowStartMs === 1100 && v.outcomeMs === 3100; },
    "a failed capture restarts the window": () => { const v = verdict(4000, (ms) => (ms === 1000 ? { failed: true, error: "tmux-failed" } : {})); return v.outcome === "no-prompt" && v.outcomeMs === 3100 && v.failedCaptures === 1; },
    "a marker after the window completed is questionAfterNoPrompt": () => { const v = verdict(4000, (ms) => (ms >= 3000 ? { markers: ["Esc to cancel"] } : {})); return v.outcome === "no-prompt" && v.outcomeMs === 2000 && v.questionAfterNoPrompt === true && v.questionAfterNoPromptTimes.firstMarkerMs === 3000 && v.questionAfterNoPromptTimes.cleanWindowCompletedMs === 2000; },
    "one not-running reading before the executable started is not judged": () => { const v = verdict(3000, (ms) => (ms === 0 ? { harnessRunning: false } : {})); return v.outcome === "no-prompt" && v.harness.noLongerRunningMs === null && v.harness.singleNotRunningReadings === 1 && v.harness.capturesBeforeRunning === 1; },
    "a capture whose process could not be read breaks the pair": () => { const v = verdict(3000, (ms) => (ms === 100 || ms === 300 ? { harnessRunning: false } : ms === 200 ? { harnessRunning: null } : {})); return v.outcome === "no-prompt" && v.harness.noLongerRunningMs === null && v.harness.singleNotRunningReadings === 2 && v.harness.firstNotRunningMs === 100 && v.harness.readings === 30; },
    "two not-running readings in a row are a harness that exited": () => { const v = verdict(3000, () => ({ harnessRunning: false })); return v.outcome === "blocked: harness exited" && v.outcomeMs === 0 && v.screenOnlyOutcome === "no-prompt" && v.harness.firstRunningMs === null; },
    "the harness gone at the capture that completes the window is harness exited": () => { const v = verdict(3000, (ms) => (ms >= 2000 ? { harnessRunning: false } : {})); return v.outcome === "blocked: harness exited" && v.outcomeMs === 2000 && v.cleanWindowCompletedMs === 2000; },
    "the harness gone after the window completed is no-prompt": () => { const v = verdict(3000, (ms) => (ms >= 2100 ? { harnessRunning: false } : {})); return v.outcome === "no-prompt" && v.harness.noLongerRunningMs === 2100; },
    "neither by the end is an observation timeout": () => { const v = verdict(3000, () => ({ blank: true })); return v.outcome === "blocked: observation timeout" && v.outcomeMs === null && v.firstNonBlankMs === null; },
    "the settled frame is the last one, with how long it held": () => { const v = verdict(3000, (ms) => (ms === 700 ? { changed: true, frame: "f", noticeBlocks: 2 } : ms > 700 ? { noticeBlocks: 2 } : {}), "approved-optout"); return v.settledFrame.ms === 700 && v.settledFrame.heldMs === 2300 && v.settledFrame.settled === true && v.noticeBlocksAtSettledFrame === 2 && !("questionMatchedMarker" in v); },
    "a screen still changing at the end is not settled": () => { const v = verdict(3000, () => ({ changed: true }), "trust"); return v.settledFrame.settled === false && v.settledFrame.heldMs === 0 && v.questionMatchedMarker === false; },
  };
  let bad = 0;
  for (const [name, check] of Object.entries(cases)) { const ok = check(); if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} verdict: ${name}`); }
  process.exit(bad ? 1 : 0);
' verdict-arithmetic "$here/verdict.mjs"; then passed=$((passed + 1)); else failed=$((failed + 1)); fi

# --- no script of the package can put input into a pane
if grep -nE 'send-[k]eys|send-[p]refix|paste-[b]uffer|load-[b]uffer|set-[b]uffer|pipe-[p]ane|respawn-[p]ane|run-[s]hell' "$here"/*.sh "$here"/*.mjs "$here"/tmux.conf; then
  failed=$((failed + 1)); echo "FAIL a script names a tmux command that reaches a pane"
else passed=$((passed + 1)); echo "ok   no script names a tmux command that sends input to a pane"; fi

left="$(pgrep -f "$base/c[0-9][0-9]/" || true)"
if [ -n "$left" ]; then failed=$((failed + 1)); echo "FAIL a process still names a case directory"; else passed=$((passed + 1)); echo "ok   no process is left from any case"; fi
echo "$passed checks passed, $failed failed"
[ "$failed" -eq 0 ]
