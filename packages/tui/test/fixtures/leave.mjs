// A whole process that reads once and leaves, for read.test.mjs:
//   node leave.mjs <world directory> <the kernel's record, as JSON> <sleeper|status|server>
// It starts one cycle over the fakes of that directory, waits for what the third argument names
// ("sleeper": the kernel has exited and the grandchild it left is running; "status": the kernel is
// running; "server": the kernel reading the roster of other machines is running), stops its
// reader, and returns from its last statement.
// It never calls process.exit: that the process ends at all is what the test is about.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createReader } from "../../lib/read.mjs";

const [dir, cli, wait] = process.argv.slice(2);
const log = join(dir, "calls.jsonl");
const started = (action) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []).find((call) => call.action === action && call.event === "start");
/** Signal 0: false once the process has ended and this process has reaped it, so has seen it exit. */
const reaped = (pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === "ESRCH"; } };
const ready = () => (wait === "sleeper" ? Boolean(started("sleeper")) && Boolean(started("status")) && reaped(started("status").pid) : Boolean(started(wait)));

const roster = { remote: { remoteGroups: [], rosterAnswered: false, rosterFailure: null }, memory: new Map(), notes: new Map() };
const reader = createReader({ cli: JSON.parse(cli), collector: join(dir, "collector.mjs"), getServed: () => [join(dir, "deployment")], getEntry: () => null, getRoster: () => roster, onEntry: () => {}, onRoster: () => {} });
reader.request();
const poll = setInterval(() => {
  if (!ready()) return;
  clearInterval(poll);
  reader.stop();
  process.stdout.write("stopped\n");
}, 20);
