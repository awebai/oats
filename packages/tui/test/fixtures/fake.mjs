// The fake programs of read.test.mjs, in one file. The test copies it into a temp directory under
// three names, and the name says what it plays:
//   oats.mjs       a kernel: `version --json`, `status … --json`, `workspace status … --json`,
//                  `server roster --json` (the action `server`)
//   collector.mjs  the liveness collector: rows on stdin, answers on stdout
//   sleeper.mjs    a grandchild that only sleeps
// It does what plan.json beside it says for the command it was asked (`{ stdout, stderr, exit,
// sleep, until, linger, grandchild, stubborn }`, all optional), and writes what it saw, one JSON line per event, to
// calls.jsonl beside it: the test reads its pid, its process group and its environment there.
// A kernel asked about a deployment (`--dir <path>`) takes its step from `deployments[<path>]` of
// the plan when the plan has one for that path: one fake kernel answers for several deployments.
// `until` names a file: the fake answers once that file exists (a slow kernel the test releases).
// It reads nothing else, starts nothing but the sleeper, and never runs a real `oats` or tmux.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";

const here = dirname(process.argv[1]), role = basename(process.argv[1], ".mjs"), argv = process.argv.slice(2);
const action = role !== "oats" ? role : argv[0] === "workspace" ? "workspace" : String(argv[0]);
const note = (record) => appendFileSync(join(here, "calls.jsonl"), `${JSON.stringify({ action, pid: process.pid, ...record })}\n`);

/** The process group and the session this process is in. */
function ids() {
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    const [, , pgid, sid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pgid: Number(pgid), sid: Number(sid) };
  } catch {
    return { pgid: Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim()), sid: null };
  }
}
/** The two families the instance variables belong to: enough to see which of them arrived. */
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith("OATS_") || name.startsWith("PI_")));

const plan = JSON.parse(readFileSync(join(here, "plan.json"), "utf8"));
const asked = argv.includes("--dir") ? argv[argv.indexOf("--dir") + 1] : null;
const step = plan.deployments?.[asked]?.[action] ?? plan[action] ?? {};
if (step.stubborn) process.on("SIGTERM", () => {}); // before it says it started: it does not end when asked
const stdin = role === "collector" ? readFileSync(0, "utf8") : undefined;
note({ event: "start", argv, cwd: process.cwd(), env: environment, ...ids(), ...(stdin === undefined ? {} : { stdin }) });

// Not detached and with this process's own pipes: it is in this process's group, and it holds the
// pipe its parent reads after this process is gone (unref'd: this process does not wait for it).
if (step.grandchild) spawn(process.execPath, [join(here, "sleeper.mjs")], { stdio: "inherit" }).unref();
if (step.stderr) process.stderr.write(step.stderr);
function answer() {
  process.stdout.on("error", () => {}); // the reader went away: nothing to say
  process.exitCode = step.exit ?? 0;
  note({ event: "writing" });
  // The callback runs once every byte has left this process: never, while the pipe is full.
  process.stdout.write(step.stdout ?? "", () => note({ event: "written" }));
  if (step.linger) setTimeout(() => {}, 60_000); // it answered, and does not exit
}
if (step.sleep || role === "sleeper") setTimeout(() => {}, 60_000);
else if (step.until) {
  // Not for ever: a test that never releases it leaves no process behind.
  const deadline = Date.now() + 60_000;
  const waiting = setInterval(() => {
    if (!existsSync(step.until) && Date.now() < deadline) return;
    clearInterval(waiting);
    if (existsSync(step.until)) answer();
  }, 15);
} else answer();
