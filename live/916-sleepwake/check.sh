#!/bin/bash
# #916 sleep/wake leg, step 2 (after wake): PASS only if, in the scratch job's run history and in
# the unit's tick.log alike, there is one sleep gap with no run inside it; the first run after
# wake evaluates the minute it fired in, once; no slept minute is ever evaluated (skipped, not
# replayed); and at least two more runs follow, one per minute, each started at second 0-5.
# The power log (pmset -g log) must show a sleep inside the gap and no run while asleep.
# Then it runs cleanup.sh.
# Usage: ./check.sh [<scratch dir>]            (the one /private/tmp/oats-916-* when omitted)
#        ./check.sh --baseline <scratch dir>   (prepare.sh: wait for two on-schedule ticks)
#        ./check.sh --evaluate <evidence.json> (the verdict alone, on a given history; no cleanup)
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)

# The evaluator. Input: { runs, ticks: [{scheduledFor, startedAt}], power: [{at, event, text}] | null, sleepMinutes }.
read -r -d '' EVALUATE <<'JS'
import * as fs from "node:fs";
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
const at = (r) => `scheduledFor ${iso(r.f)}, started ${iso(r.s)} (+${((r.s - r.f) / 1000).toFixed(1)} s)`;
const MIN = 60000, GAP = 90000, LATE = 6000, PROMPT = 15000;
export function rows(list) {
  return (list || []).filter((r) => r && r.scheduledFor && r.startedAt)
    .map((r) => ({ f: Date.parse(r.scheduledFor), s: Date.parse(r.startedAt) })).sort((a, b) => a.s - b.s);
}
/** The sleep gap: the one pause of more than 90 s between consecutive starts. */
export function split(seq) {
  const gaps = [];
  for (let i = 1; i < seq.length; i++) if (seq[i].s - seq[i - 1].s > GAP) gaps.push(i);
  return gaps;
}
function onSchedule(r) { return r.s - r.f >= 0 && r.s - r.f < LATE; }
/** Two consecutive minutes, each ticked at second 0-5 (the baseline prepare.sh waits for). */
export function baseline(seq) {
  for (let i = seq.length - 1; i > 0; i--) if (seq[i].f === seq[i - 1].f + MIN && onSchedule(seq[i]) && onSchedule(seq[i - 1])) return [seq[i - 1], seq[i]];
  return null;
}
function sleeps(power) { // [start, end): from "Entering Sleep state" to the next Wake or DarkWake
  const out = [];
  let from = null;
  for (const p of power) {
    if (p.event === "Sleep" && /Entering Sleep state/.test(p.text || "")) { if (from === null) from = p.at; }
    else if ((p.event === "Wake" || p.event === "DarkWake") && from !== null) { out.push([from, p.at]); from = null; }
  }
  if (from !== null) out.push([from, Infinity]);
  return out;
}
export function judge(name, list, power, sleepMinutes) {
  const seq = rows(list), fail = [], ok = [];
  const say = (bad, msg) => (bad ? fail : ok).push(`${name}: ${msg}`);
  const gaps = split(seq);
  if (gaps.length === 0) return { fail: [`${name}: no pause of more than 90 s between runs: the Mac did not sleep (check pmset -g assertions), or check.sh ran before the sleep`], ok };
  if (gaps.length > 1) return { fail: [`${name}: ${gaps.length} pauses of more than 90 s, expected one sleep: ${gaps.map((g) => `${iso(seq[g - 1].s)} -> ${iso(seq[g].s)}`).join("; ")}`], ok };
  const g = gaps[0], before = seq.slice(0, g), after = seq.slice(g), last = before.at(-1), wake = after[0];
  say(false, `last run before the sleep: ${at(last)}`);
  say(false, `first run after the wake: ${at(wake)}`);
  const pause = wake.s - last.s;
  say(pause < sleepMinutes * MIN, `the pause is ${(pause / MIN).toFixed(1)} min (at least ${sleepMinutes} expected)`);
  const base = baseline(before);
  say(!base, base ? `baseline before the sleep: ${at(base[0])}; ${at(base[1])}` : "no two consecutive on-schedule runs before the sleep");
  say(!(wake.s >= wake.f && wake.s - wake.f < MIN), `the wake run evaluates ${iso(wake.f)}, ${wake.s >= wake.f && wake.s - wake.f < MIN ? "the minute it started in" : "NOT the minute it started in"}`);
  const counts = new Map();
  for (const r of seq) counts.set(r.f, (counts.get(r.f) || 0) + 1);
  const twice = [...counts].filter(([, n]) => n > 1);
  say(twice.length > 0, twice.length ? `minutes evaluated more than once: ${twice.map(([f, n]) => `${iso(f)} x${n}`).join(", ")}` : "every minute was evaluated at most once");
  const replayed = seq.filter((r) => r.f > last.f && r.f < wake.f);
  const stale = after.filter((r) => r.f <= last.f);
  if (replayed.length) say(true, `slept minutes replayed: ${replayed.map(at).join("; ")}`);
  else if (wake.f > last.f) say(false, `the ${Math.round((wake.f - last.f) / MIN) - 1} slept minutes between ${iso(last.f)} and ${iso(wake.f)} were skipped, not replayed`);
  if (stale.length) say(true, `runs after the wake evaluated a minute from before the sleep: ${stale.map(at).join("; ")}`);
  const post = after.slice(1);
  say(post.length < 2, `${post.length} runs after the wake run (at least 2 expected)`);
  for (let i = 1; i < after.length; i++) {
    const p = after[i - 1], r = after[i];
    if (r.f !== p.f + MIN) say(true, `after ${iso(p.f)} came ${iso(r.f)}, not the next minute`);
    else say(!onSchedule(r), `${at(r)}${onSchedule(r) ? "" : ": NOT at second 0-5"}`);
  }
  if (!power) say(true, "no power log was read: a sleep in the gap and the wake run's promptness are unproven");
  else {
    const asleep = sleeps(power);
    const inGap = asleep.filter(([a]) => a > last.s && a < wake.s);
    say(inGap.length === 0, inGap.length ? `the power log shows the sleep: ${inGap.map(([a, b]) => `${iso(a)} -> ${b === Infinity ? "(no wake yet)" : iso(b)}`).join("; ")}` : `the power log shows no "Entering Sleep state" between ${iso(last.s)} and ${iso(wake.s)}`);
    const whileAsleep = seq.filter((r) => asleep.some(([a, b]) => r.s >= a && r.s < b));
    say(whileAsleep.length > 0, whileAsleep.length ? `runs started while asleep: ${whileAsleep.map(at).join("; ")}` : "no run started while asleep");
    // The coalesced fire comes at the wake: the first Wake or DarkWake after the gap's last "Entering Sleep state".
    const slept = inGap.length ? inGap.at(-1)[0] : null;
    const woke = slept === null ? undefined : power.find((p) => (p.event === "Wake" || p.event === "DarkWake") && p.at > slept && p.at <= wake.s);
    if (!woke) say(true, `the power log shows no wake between the sleep and ${iso(wake.s)}`);
    else {
      const lag = wake.s - woke.at, boundary = Math.ceil(woke.at / MIN) * MIN;
      say(lag > PROMPT, `the wake run started ${(lag / 1000).toFixed(1)} s after the wake at ${iso(woke.at)} (${woke.event}; at most ${PROMPT / 1000} s expected${lag > PROMPT ? ": no tick ran at the wake" : ""})`);
      if (lag <= PROMPT && wake.f === boundary && boundary - woke.at <= PROMPT) say(true, `inconclusive: the wake came ${((boundary - woke.at) / 1000).toFixed(1)} s before ${iso(boundary)}, so a fire at the wake and that minute's own fire cannot be told apart; sleep again`);
    }
  }
  return { fail, ok };
}
export function verdict(ev) {
  const a = judge("runs", ev.runs, ev.power, ev.sleepMinutes ?? 5), b = judge("tick.log", ev.ticks, ev.power, ev.sleepMinutes ?? 5);
  const fail = [...a.fail, ...b.fail];
  return { pass: fail.length === 0, lines: [...fail.map((l) => `  FAIL ${l}`), ...[...a.ok, ...b.ok].map((l) => `  ok   ${l}`)] };
}
/** The evidence of a scratch dir: the job's run history and every tick tick.log recorded. */
export function evidence(S, powerFile) {
  const st = JSON.parse(fs.readFileSync(`${S}/state.json`, "utf8"));
  let runs = [];
  try { runs = JSON.parse(fs.readFileSync(`${S}/dep/.agents/schedules/state.json`, "utf8")).jobs?.[st.job]?.recentRuns || []; } catch { /* no run yet */ }
  const ticks = [];
  try {
    for (const line of fs.readFileSync(`${S}/log/tick.log`, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const t = JSON.parse(line).result;
      if (t?.minute && t?.tickedAt) ticks.push({ scheduledFor: `${t.minute}:00.000Z`, startedAt: t.tickedAt });
    }
  } catch { /* no tick yet */ }
  let power = null;
  if (powerFile) {
    power = [];
    const re = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d) (Sleep|Wake|DarkWake)\s+(.*)$/;
    for (const line of fs.readFileSync(powerFile, "utf8").split("\n")) {
      const m = re.exec(line);
      if (m) power.push({ at: Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`), event: m[5], text: m[6].trim() });
    }
  }
  return { runs: runs.map(({ scheduledFor, startedAt }) => ({ scheduledFor, startedAt })), ticks, power, sleepMinutes: st.sleepMinutes };
}
JS
js() { node --input-type=module -e "$EVALUATE
$1" "${@:2}"; }

case "${1:-}" in
  --evaluate)
    [ -f "${2:-}" ] || { echo "usage: check.sh --evaluate <evidence.json>" >&2; exit 2; }
    js 'const v = verdict(JSON.parse(fs.readFileSync(process.argv[1], "utf8")));
        console.log(v.pass ? "PASS" : "FAIL"); console.log(v.lines.join("\n")); process.exitCode = v.pass ? 0 : 1;' "$2"
    exit $?;;
  --baseline)
    S="${2:?usage: check.sh --baseline <scratch dir>}"
    for _ in $(seq 1 40); do
      js 'const e = evidence(process.argv[1]); const r = baseline(rows(e.runs)), t = baseline(rows(e.ticks));
          if (r && t) { console.log(`baseline: runs ${r.map((x) => new Date(x.f).toISOString()).join(", ")}; tick.log the same minutes: ${r.every((x, i) => x.f === t[i].f)}`); process.exit(0); }
          process.exit(1);' "$S" && exit 0
      sleep 5
    done
    exit 1;;
  --*) echo "unknown option $1" >&2; exit 2;;
esac

S="${1:-}"
if [ -z "$S" ]; then
  shopt -s nullglob; found=(/private/tmp/oats-916-*/state.json)
  [ "${#found[@]}" -eq 1 ] && [ -f "${found[0]}" ] || { echo "pass the scratch dir: found ${#found[@]} /private/tmp/oats-916-*/state.json" >&2; exit 2; }
  S=$(dirname "${found[0]}")
fi
[ -f "$S/state.json" ] || { echo "no $S/state.json" >&2; exit 2; }
echo "scratch $S, checked at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Wait (at most 4 min) until the history has a pause and two runs after the wake run.
for _ in $(seq 1 48); do
  js 'const e = evidence(process.argv[1]); const ok = (l) => { const s = rows(l), g = split(s); return g.length >= 1 && s.length - g.at(-1) >= 3; };
      process.exit(ok(e.runs) && ok(e.ticks) ? 0 : 1);' "$S" && break
  sleep 5
done

power="$S/power.log"
pmset -g log 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} [+-][0-9]{4} (Sleep|Wake|DarkWake) ' >"$power" || rm -f "$power"
js 'const e = evidence(process.argv[1], fs.existsSync(process.argv[2]) ? process.argv[2] : null);
    const s = rows(e.runs); const from = s.length ? s[0].s - 60000 : 0;
    if (e.power) e.power = e.power.filter((p) => p.at >= from);
    fs.writeFileSync(`${process.argv[1]}/evidence.json`, JSON.stringify(e, null, 2));
    const v = verdict(e);
    console.log(v.pass ? "PASS" : "FAIL"); console.log(v.lines.join("\n"));
    console.log("power log in the window:"); for (const p of e.power || []) console.log(`  ${new Date(p.at).toISOString()} ${p.event} ${p.text.slice(0, 100)}`);
    const err = `${process.argv[1]}/log/tick.err`; if (fs.existsSync(err) && fs.statSync(err).size) console.log(`tick.err:\n${fs.readFileSync(err, "utf8").slice(-2000)}`);
    process.exitCode = v.pass ? 0 : 1;' "$S" "$power"
rc=$?
cp "$S/evidence.json" "/private/tmp/oats916-evidence-$(date -u +%Y%m%dT%H%M%SZ).json" 2>/dev/null && echo "evidence kept in /private/tmp/oats916-evidence-*.json"
"$here/cleanup.sh" "$S"
exit $rc
