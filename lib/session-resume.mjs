/** `oats session resume` (feature session-resume, #1559): the machine sweep. After a shutdown, a
 *  reboot or a crash, every launched instance home whose session was lost (status `sessionEnd: lost`)
 *  on every local deployment is started again with `session start --resume`, in its own harness
 *  conversation; running homes are left alone, stopped and exited ones stay stopped.
 *
 *  - The machine's deployments come from the registry, read only (readDeploymentsDocument, never the
 *    first-use import that listDeployments may write); `deployment` narrows the sweep to one
 *    directory, registered or not. Nothing opts a deployment out: stopping an instance with OATS
 *    is what keeps it down.
 *  - Each home starts as a child process of this kernel (`session start --resume --home <home>
 *    --json`, its cwd the home's deployment), so each start resolves its own deployment's scope; at
 *    most RESUME_CONCURRENCY at once. A per-home failure is a row, never the sweep's failure.
 *  - One sweep per machine: a mkdir lock under OATS_HOME_DIR (default ~/.oats) `session-resume/`,
 *    holding its pid and boot id; a lock whose pid is gone, or taken in another boot, is stale and
 *    taken over. A second sweep answers E_RESUME_BUSY.
 *  - No retry storm, through one note per boot (`note.json`): a refused resume is noted, and a later
 *    sweep in the same boot reports it again (`refused-this-boot`) without starting it (a home whose
 *    start id changed since is not matched); and a home is started by sweeps at most RESUME_LIMIT
 *    times in a boot (counted by home: each start makes a new start id), then reported
 *    `keeps-getting-lost` without a start. A start counts when it launched something (`resumed`,
 *    `fresh`, `blocked`). `session start --resume` run by hand is neither bounded nor counted.
 *    Without a boot id (neither Linux nor macOS) nothing is noted or counted: each sweep tries again.
 *  The lock and the note are kernel-private, not a contract. `plan` predicts from the note, starting
 *  nothing, taking no lock and writing no note. */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { oatsError } from "./errors.mjs";
import { deploymentState, readDeploymentsDocument } from "./deployments.mjs";
import { listInstances, resumeConversation } from "./core.mjs";

export const RESUME_SCHEMA = 1;
/** At most this many starts run at once. */
export const RESUME_CONCURRENCY = 4;
/** At most this many sweep starts of one home in one boot. */
export const RESUME_LIMIT = 3;
/** An acquirer's lock without an owner record yet is its own for this long (the gap between mkdir and
 *  the owner's write); older, it is a crashed acquirer's. */
const OWNERLESS_GRACE_MS = 60_000;

const oatsHomeDir = () => process.env.OATS_HOME_DIR || join(homedir(), ".oats");
/** The kernel-private directory of the lock and the note. */
export const resumeStateDir = () => join(oatsHomeDir(), "session-resume");
const lockDir = () => join(resumeStateDir(), "lock");
const notePath = () => join(resumeStateDir(), "note.json");

/** This boot's identity, or null where the kernel cannot read one: Linux's boot id, macOS's boot
 *  time (`sysctl -n kern.boottime`, its `sec`/`usec`). */
export function bootId({ platform = process.platform, read = (p) => readFileSync(p, "utf8"), sysctl = () => execFileSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }) } = {}) {
  try {
    if (platform === "linux") return read("/proc/sys/kernel/random/boot_id").trim() || null;
    if (platform === "darwin") { const m = /sec = (\d+), usec = (\d+)/.exec(sysctl()); return m ? `${m[1]}.${m[2]}` : null; }
  } catch { /* unknown */ }
  return null;
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };

/** Take the machine's resume lock → its release function. Busy: E_RESUME_BUSY. A lock whose owner's
 *  pid is gone, whose owner was recorded in another boot, or that has had no owner for
 *  OWNERLESS_GRACE_MS is stale: it is taken over under a second mkdir (`lock.takeover`), so two
 *  sweeps that both find it stale cannot both take it. */
export function acquireResumeLock({ boot = bootId(), now = () => Date.now() } = {}) {
  const dir = lockDir(), takeover = `${dir}.takeover`;
  mkdirSync(resumeStateDir(), { recursive: true, mode: 0o700 });
  const busy = (why) => oatsError("E_RESUME_BUSY", `another session resume on this machine holds ${dir} (${why}); nothing was started`);
  const stale = () => {
    const owner = readJson(join(dir, "owner.json"));
    if (!owner) { try { return now() - statSync(dir).mtimeMs > OWNERLESS_GRACE_MS ? "no owner" : null; } catch { return "gone"; } }
    if (boot && owner.bootId && owner.bootId !== boot) return `taken in another boot by pid ${owner.pid}`;
    return pidAlive(owner.pid) ? null : `its owner pid ${owner.pid} is gone`;
  };
  const take = () => { mkdirSync(dir); writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, bootId: boot, at: new Date(now()).toISOString() }) + "\n", { mode: 0o600 }); };
  try { take(); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (!stale()) { const owner = readJson(join(dir, "owner.json")); throw busy(owner ? `pid ${owner.pid} holds it` : "its owner is not recorded yet"); }
    try { mkdirSync(takeover); }
    catch (t) {
      if (t.code !== "EEXIST") throw t;
      // A takeover that crashed leaves its directory: after the grace it is gone for good.
      let old = false; try { old = now() - statSync(takeover).mtimeMs > OWNERLESS_GRACE_MS; } catch { /* removed meanwhile */ }
      if (!old) throw busy("another sweep is taking over a stale lock");
      rmSync(takeover, { recursive: true, force: true });
      try { mkdirSync(takeover); } catch { throw busy("another sweep is taking over a stale lock"); }
    }
    try {
      // Read again under the takeover: another sweep may have taken it meanwhile.
      if (existsSync(dir) && !stale()) throw busy("another sweep took it over");
      const aside = `${dir}.stale-${process.pid}-${now()}`;
      try { renameSync(dir, aside); rmSync(aside, { recursive: true, force: true }); } catch (r) { if (r.code !== "ENOENT") throw r; }
      take();
    } finally { rmSync(takeover, { recursive: true, force: true }); }
  }
  return () => { try { if (readJson(join(dir, "owner.json"))?.pid === process.pid) rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
}

/** This boot's note: `{ bootId, refused: [{ home, startId, code, message, at }], resumes: { <home>: n } }`;
 *  empty for another boot's note, an unreadable one, or no boot id. */
export function readBootNote(boot = bootId()) {
  const note = boot ? readJson(notePath()) : undefined;
  if (!note || note.bootId !== boot) return { bootId: boot, refused: [], resumes: {} };
  const resumes = {};
  if (note.resumes && typeof note.resumes === "object" && !Array.isArray(note.resumes)) {
    for (const [home, n] of Object.entries(note.resumes)) if (Number.isSafeInteger(n) && n > 0) resumes[home] = n;
  }
  return { bootId: boot, refused: Array.isArray(note.refused) ? note.refused.filter((r) => r && typeof r.home === "string") : [], resumes };
}
/** Note a sweep's `refusals` (each replacing its home's earlier entry) and the `launched` homes (each
 *  counted once more) for this boot; another boot's note is replaced whole. Nothing is written
 *  without a boot id. */
export function noteSweep({ refusals = [], launched = [] }, boot = bootId()) {
  if (!boot || (!refusals.length && !launched.length)) return;
  const note = readBootNote(boot);
  const homes = new Set(refusals.map((r) => r.home));
  const resumes = { ...note.resumes };
  for (const home of launched) resumes[home] = (resumes[home] ?? 0) + 1;
  const path = notePath();
  mkdirSync(resumeStateDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ bootId: boot, refused: [...note.refused.filter((r) => !homes.has(r.home)), ...refusals], resumes }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** The deployments a sweep considers: the one `deployment` names (E_BAD_ARGS when it is not a
 *  deployment directory), else the registry's live rows, sorted: a row `oats deployments remove` took
 *  out (a tombstone, `removed: true`) is never swept. Registry errors (E_DEPLOYMENTS_*) throw. */
function sweptDeployments(deployment) {
  if (deployment !== undefined) {
    const dir = resolve(deployment);
    if (deploymentState(dir) !== "ok") throw oatsError("E_BAD_ARGS", `--deployment ${dir} is not a deployment directory (no oats-local.yaml there); nothing was started`);
    return [dir];
  }
  return readDeploymentsDocument().deployments.filter((row) => row && row.removed !== true).map((row) => row.path).sort();
}

/** One deployment: its entry for `deployments[]` and, when it is swept, its homes' rows to act on. */
function readDeployment(dir) {
  const state = deploymentState(dir);
  if (state !== "ok") return { entry: { deployment: dir, state, swept: false, reason: "not-ok" } };
  let rows;
  try {
    // The status rows `oats status --dir <deployment> --json` lists (listInstances), from the
    // deployment's own instance root.
    const root = join(dir, "agents");
    rows = existsSync(root) ? listInstances(root).flatMap((a) => (a.instances || []).map((i) => ({ deployment: dir, ...i }))) : [];
  } catch (e) {
    return { entry: { deployment: dir, state, swept: false, reason: "unreadable", code: typeof e?.code === "string" && e.code.startsWith("E_") ? e.code : "E_RESUME_UNREADABLE", message: String(e?.message ?? e) } };
  }
  return { entry: { deployment: dir, state, swept: true }, rows };
}

/** The outcomes of a start that launched something: the ones RESUME_LIMIT counts. */
const LAUNCHED = new Set(["resumed", "fresh", "blocked"]);
const base = (row) => ({ deployment: row.deployment, instance: row.instance, home: row.home });

/** What a start's JSON answer means for the sweep's row. */
export function rowFromStart(row, answer) {
  if (answer?.ok === true) {
    const r = answer.result ?? {}, resume = r.resume ?? {};
    const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w) => typeof w === "string") : [];
    const extra = warnings.length ? { warnings } : {};
    if (resume.resumed === true) {
      if (resume.waiting === "resume-confirmation") return { ...base(row), outcome: "blocked", reason: "resume-confirmation", ...(resume.sessionId ? { sessionId: resume.sessionId } : {}), ...extra };
      return { ...base(row), outcome: "resumed", ...(resume.sessionId ? { sessionId: resume.sessionId } : {}), ...extra };
    }
    return { ...base(row), outcome: "fresh", reason: resume.reason ?? "no-conversation", ...extra };
  }
  const code = typeof answer?.error?.code === "string" ? answer.error.code : "E_SESSION_START_FAILED";
  const message = String(answer?.error?.message ?? "the start gave no answer");
  if (code === "E_SPAWN_INCOMPLETE") return { ...base(row), outcome: "blocked", reason: "launch-prompt", code, ...(answer.error.details?.launchPrompts ? { launchPrompts: answer.error.details.launchPrompts } : {}) };
  if (code === "E_SESSION_START_BUSY") return { ...base(row), outcome: "skipped", reason: "start-busy", code };
  if (code === "E_RESUME_NOT_LOST" || code === "E_SESSION_RUNNING") return { ...base(row), outcome: "skipped", reason: "not-lost", code };
  if (code === "E_SESSION_UNKNOWN") return { ...base(row), outcome: "skipped", reason: "unknown", code, message };
  return { ...base(row), outcome: "refused", reason: "start-refused", code, message };
}

/** The environment of a start the sweep runs: this one's, without an instance identity, so a sweep
 *  run from inside an instance starts each home as the home itself, in its deployment. */
function startEnvironment(env) {
  const out = { ...env };
  for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"]) delete out[k];
  return out;
}
function runStart({ execPath, bin, env }, row) {
  return new Promise((done) => {
    execFile(execPath, [bin, "session", "start", "--resume", "--home", row.home, "--json"], { cwd: row.deployment, env: startEnvironment(env), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      let answer;
      try { answer = JSON.parse(String(stdout).trim().split("\n").pop()); } catch { answer = undefined; }
      if (!answer || typeof answer !== "object") answer = { ok: false, error: { code: "E_SESSION_START_FAILED", message: `the start exited${error?.code !== undefined ? ` with status ${error.code}` : ""}${error?.signal ? ` on ${error.signal}` : ""} without an answer` } };
      done(answer);
    });
  });
}
async function inBatches(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The sweep → `{ schemaVersion, plan, deployments, rows }` (docs/desktop-cli-api.md). `kernel`:
 *  `{ execPath, bin }`, how a start is run; `env` the environment each start gets. */
export async function resumeSessions({ deployment, plan = false, kernel, env = process.env, boot = bootId() } = {}) {
  const release = plan ? null : acquireResumeLock({ boot });
  try {
    const deployments = [], candidates = [], rows = [];
    for (const dir of sweptDeployments(deployment)) {
      const { entry, rows: found } = readDeployment(dir);
      deployments.push(entry);
      for (const row of found ?? []) {
        if (row.running === true) rows.push({ ...base(row), outcome: "already-running" });
        else if (row.running === null) rows.push({ ...base(row), outcome: "skipped", reason: "unknown" });
        else if (row.sessionEnd === "lost") candidates.push(row);
      }
    }
    const note = readBootNote(boot);
    const toStart = [];
    for (const row of candidates) {
      const startId = row.startId ?? null;
      const prior = note.refused.find((r) => r.home === row.home && (r.startId ?? null) === startId);
      if (prior) rows.push({ ...base(row), outcome: "refused", reason: "refused-this-boot", code: prior.code, message: prior.message });
      else if ((note.resumes[row.home] ?? 0) >= RESUME_LIMIT) rows.push({ ...base(row), outcome: "refused", reason: "keeps-getting-lost", message: `${row.instance} was resumed ${note.resumes[row.home]} times in this boot and was lost again each time; a sweep tries it again after the next boot, or start it by hand (oats session start --resume --home ${row.home})` });
      else if (plan) rows.push(predicted(row));
      else toStart.push(row);
    }
    const started = await inBatches(toStart, RESUME_CONCURRENCY, async (row) => rowFromStart(row, await runStart({ ...kernel, env }, row)));
    rows.push(...started);
    if (!plan) noteSweep({
      refusals: started.filter((r) => r.outcome === "refused").map((r) => ({ home: r.home, startId: toStart.find((c) => c.home === r.home)?.startId ?? null, code: r.code, message: r.message, at: new Date().toISOString() })),
      launched: started.filter((r) => LAUNCHED.has(r.outcome)).map((r) => r.home),
    }, boot);
    rows.sort((a, b) => (a.deployment < b.deployment ? -1 : a.deployment > b.deployment ? 1 : a.home < b.home ? -1 : a.home > b.home ? 1 : 0));
    return { schemaVersion: RESUME_SCHEMA, plan: !!plan, deployments, rows };
  } finally { release?.(); }
}

/** `--plan`'s prediction for a lost home: refused for a home with no recipe, else resumed or fresh
 *  as the conversation lookup reads now. */
function predicted(row) {
  if (!(row.launch && typeof row.launch === "object")) return { ...base(row), outcome: "refused", reason: "start-refused", code: "E_LAUNCH_LEGACY", message: `${row.instance} records no launch recipe (an earlier kernel spawned it): re-spawn it from the deployment` };
  const found = resumeConversation(row.home, row);
  return found.sessionId ? { ...base(row), outcome: "resumed", sessionId: found.sessionId } : { ...base(row), outcome: "fresh", reason: found.reason };
}
