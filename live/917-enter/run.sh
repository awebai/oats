#!/bin/bash
# #917 live runs with a real Claude at the fixed head: `enter` (network denied, the kernel's one
# Enter on the confirmation) and `notice` (network up, Claude ignores the flag: flag-ignored).
# The enter run's executable is LIVE_ENTER_EXECUTABLE (an absolute path to an isolation wrapper);
# on macOS it defaults to claude-sandboxed.sh (sandbox-exec), on Linux the operator brings one.
# The Claude binary is LIVE_ENTER_CLAUDE_BINARY, else Homebrew's on macOS, `command -v claude` on Linux.
# This script fetches nothing and writes only its out dir; see README.md, "What the scripts touch".
# Usage: ./run.sh <enter|notice> <oats repo checked out at the fixed head>
# Writes everything it observed to ./out-<mode>-<UTC timestamp>/ and prints a summary. See README.md.
# Exit status: 0 shown; 3 shown by the kernel's rows but the witness sampled no frame; 1 otherwise.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mode="${1:?usage: run.sh <enter|notice> <oats repo at the fixed head>}"
repo="${2:?usage: run.sh <enter|notice> <oats repo at the fixed head>}"
case "$mode" in enter|notice) ;; *) echo "mode must be enter or notice, not $mode" >&2; exit 2;; esac
[ -f "$repo/bin/oats.mjs" ] || { echo "not an OATS checkout: $repo" >&2; exit 2; }
# Absolute: the run changes into its output directory before it uses the checkout.
repo="$(cd "$repo" && pwd -P)"
if [ -n "${LIVE_ENTER_CLAUDE:-}" ] && [ "${LIVE_ENTER_DRY_RUN:-}" != "yes" ]; then
  echo "LIVE_ENTER_CLAUDE is set: that is a stub dry run, not the live proof. Unset it, or set LIVE_ENTER_DRY_RUN=yes." >&2; exit 2
fi
absolute_executable() { case "$1" in /*) [ -x "$1" ] || { echo "$2 $1 is not executable" >&2; exit 2; };; *) echo "$2 must be an absolute path, not $1" >&2; exit 2;; esac; }
[ -z "${LIVE_ENTER_CLAUDE_BINARY:-}" ] || absolute_executable "$LIVE_ENTER_CLAUDE_BINARY" LIVE_ENTER_CLAUDE_BINARY
[ -z "${LIVE_ENTER_EXECUTABLE:-}" ] || absolute_executable "$LIVE_ENTER_EXECUTABLE" LIVE_ENTER_EXECUTABLE
case "$(uname -s)" in
  Darwin)
    if [ "$mode" = enter ] && [ -z "${LIVE_ENTER_CLAUDE:-}" ] && [ -z "${LIVE_ENTER_EXECUTABLE:-}" ]; then
      [ -x "$here/claude-sandboxed.sh" ] || { echo "$here/claude-sandboxed.sh must be executable (chmod +x)" >&2; exit 2; }
      [ -x /usr/bin/sandbox-exec ] || { echo "/usr/bin/sandbox-exec is missing" >&2; exit 2; }
    fi;;
  Linux)
    [ -n "${LIVE_ENTER_CLAUDE:-}${LIVE_ENTER_CLAUDE_BINARY:-}" ] || command -v claude >/dev/null || { echo "claude is not on PATH: set LIVE_ENTER_CLAUDE_BINARY" >&2; exit 2; }
    if [ "$mode" = enter ] && [ -z "${LIVE_ENTER_EXECUTABLE:-}" ] && [ -z "${LIVE_ENTER_CLAUDE:-}" ]; then
      echo "the enter run on Linux needs LIVE_ENTER_EXECUTABLE: the absolute path of your isolation wrapper" >&2; exit 2
    fi;;
  *) echo "unsupported platform $(uname -s)" >&2; exit 2;;
esac
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] || { echo "$repo has uncommitted changes: run at a clean head" >&2; exit 2; }
out="$here/out-$mode-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
echo "mode: $mode"
echo "oats head: $(git -C "$repo" rev-parse HEAD)"
claude="${LIVE_ENTER_CLAUDE:-${LIVE_ENTER_CLAUDE_BINARY:-$([ "$(uname -s)" = Darwin ] && echo /opt/homebrew/bin/claude || command -v claude)}}"
echo "claude: $claude -> $(realpath "$claude")"
echo "output: $out"
# A neutral working directory: never inside an instance home, so the kernel acts as no instance.
cd "$out"
# An empty environment for the fixture, the kernel, tmux and Claude: the caller's (an agent
# session's tokens, an instance or tmux identity) never reaches them. Only PATH, a throwaway HOME
# in the out dir, a terminal type, a locale and this run's own LIVE_ENTER_* settings pass.
mkdir -p "$out/caller-home"
pass=(PATH="$PATH" HOME="$out/caller-home" TERM=xterm-256color LANG=C.UTF-8)
for v in LIVE_ENTER_EXECUTABLE LIVE_ENTER_CLAUDE_BINARY LIVE_ENTER_CLAUDE LIVE_ENTER_DRY_RUN LIVE_ENTER_EXTRA_ENV LIVE_ENTER_EXPECT; do
  [ -n "${!v:-}" ] && pass+=("$v=${!v}")
done
status=0
env -i "${pass[@]}" node "$here/drive.mjs" "$repo" "$out" "$mode" 2>&1 | tee "$out/run.log" || status=$?
status=${PIPESTATUS[0]:-$status}
echo
echo "== summary (also in $out)"
node -e '
const fs=require("fs"),p=require("path"),o=process.argv[1],r=f=>{try{return JSON.parse(fs.readFileSync(p.join(o,f),"utf8"))}catch{return null}};
const h=r("host.json")||{};if(h.extraLaunchEnv)console.log(`extra launch env: ${JSON.stringify(h.extraLaunchEnv)}`);console.log(`${h.mode} run by ${h.ranBy} on ${h.host}, ${h.platform}, Claude ${h.claudeVersion} (${h.claudeVersionSource}, from ${h.claudeBinaryRealPath})${h.claudeVersionOutput?`, claude --version: ${h.claudeVersionOutput}`:""}, launched through ${h.launchExecutable}${h.dryRunStub?" (DRY-RUN STUB)":""}, oats ${h.oatsHead}`);
for(const s of ["spawn","restart"]){const e=r(`${s}-evidence.json`);if(!e){console.log(`${s}: no evidence`);continue}
console.log(`${s}: ${e.status} (${e.reason}), launched ${e.launched}; rows ${e.rows.join(", ")||"none"}; entry ${e.entry??"-"}; Enter rows ${e.enterRows}, Enters ${e.enterKeys}; audited frame captured ${e.auditedFrameCaptured}, equals entry one ${e.frameEqualsEntryOne}, matches flag-ignored ${e.frameMatchesFlagIgnored}; claudeSessionShown ${e.claudeSessionShown}; audit claudeVersion ${e.auditClaudeVersion}`)}
console.log(`verdict: ${JSON.stringify(r("verdict.json"))}`);
console.log(`cleanup: ${JSON.stringify(r("cleanup.json"))}`);' "$out"
exit "$status"
