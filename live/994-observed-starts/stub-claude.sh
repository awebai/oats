#!/bin/sh
# DRY-RUN STUB of the #994 live runs. THIS IS NOT CLAUDE and shows nothing about Claude: it paints a
# scripted sequence of frames so the mechanics and the verdict arithmetic can be checked. run.sh
# starts it only under LIVE_994_DRY_RUN=yes, and refuses it otherwise. It reads no key.
#
# LIVE_994_STUB_SCENARIO picks the frames (drive.mjs sets it, `session` by default):
#   session            blank, a logo frame, then a session frame, which stays
#   notice             the same, with a notice block (two rows that begin with the notice bar)
#   trust              blank, a logo frame, then the folder-trust screen, which stays
#   late-question      a session frame at once, the folder-trust screen first painted at 3 s
#   unmarked-question  a logo frame, then an invented question with none of the kernel's markers
#   blank              nothing, for ever
#   old                an executable without --no-chrome: with that flag it prints an
#                      "unknown option" line and exits 1 at once; without it, `session`
# In the probe shape (`plugin list --json`) it prints an empty JSON array and exits 0.
# The folder-trust screen is LIVE_994_STUB_FIXTURE (the checkout's
# test/fixtures/launch-prompts/frame-01.txt) with its two workspace rows replaced by this folder.
# Each call is appended to LIVE_994_STUB_LOG: the folder, the arguments, and five variables.
scenario="${LIVE_994_STUB_SCENARIO:-session}"
if [ -n "${LIVE_994_STUB_LOG:-}" ]; then
  {
    echo "call"
    echo "cwd=$PWD"
    for arg in "$@"; do echo "arg=$arg"; done
    for name in CLAUDE_CODE_ENABLE_CFC DISABLE_TELEMETRY DO_NOT_TRACK CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; do
      eval "value=\${$name-unset}"
      echo "env $name=$value"
    done
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then echo "env CLAUDE_CONFIG_DIR=set"; else echo "env CLAUDE_CONFIG_DIR=unset"; fi
    echo "end"
  } >> "$LIVE_994_STUB_LOG"
fi
shape=launch
no_chrome=no
for arg in "$@"; do
  [ "$arg" = --no-chrome ] && no_chrome=yes
  [ "$arg" = plugin ] && shape=probe
done
if [ "$scenario" = old ] && [ "$no_chrome" = yes ]; then
  echo "error: unknown option '--no-chrome'" >&2
  exit 1
fi
if [ "$shape" = probe ]; then
  echo "[]"
  exit 0
fi
[ "$scenario" = old ] && scenario=session

clear_screen() { printf '\033[2J\033[H'; }
logo() {
  clear_screen
  printf '%s\n' ' ▐▛███▜▌' '▝▜█████▛▘' '  ▘▘ ▝▝'
}
session() {
  clear_screen
  printf '%s\n' ' ▐▛███▜▌   Claude Code v0.0.0' '▝▜█████▛▘  dry-run stub, not Claude' "  ▘▘ ▝▝    $PWD" ''
  # STUB_994_PAINT: a string the dry-run check asks the stub to paint, to see the sanitation check fail.
  [ -n "${STUB_994_PAINT:-}" ] && printf ' %s\n' "$STUB_994_PAINT"
  [ "${1:-}" = notice ] && printf '%s\n' '▎ dry-run stub notice, first row' '▎ dry-run stub notice, second row' ''
  printf '%s' '> '
}
trust() {
  fixture="${LIVE_994_STUB_FIXTURE:-}"
  [ -f "$fixture" ] || { echo "stub: LIVE_994_STUB_FIXTURE is not a file"; exit 3; }
  clear_screen
  sed -n '1,4p' "$fixture"
  printf ' %s\n' "$PWD"
  sed -n '7,18p' "$fixture"
}
question() {
  clear_screen
  printf '%s\n' '' ' Dry-run stub question (invented, not a Claude screen)' '' ' Would you like the stub to go on?' '' ' ❯ 1. Yes' '   2. No'
}

# One long-lived process under the stub for the whole run, as a running harness has.
sleep 86400 &
case "$scenario" in
  session) clear_screen; sleep 0.1; logo; sleep 0.2; session;;
  notice) clear_screen; sleep 0.1; logo; sleep 0.2; session notice;;
  trust) clear_screen; sleep 0.1; logo; sleep 0.3; trust;;
  late-question) session; sleep 3; trust;;
  unmarked-question) logo; sleep 0.2; question;;
  blank) clear_screen;;
  *) echo "stub: unknown scenario $scenario"; kill $! 2>/dev/null; exit 3;;
esac
wait
