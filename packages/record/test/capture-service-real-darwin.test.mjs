// Real launchd qualification of the periodic capture service (#1108 D2). Runs
// only in a dispatched "macOS tests" workflow (fixtures/real-manager.mjs);
// anywhere else every case skips with that reason, which is not evidence.
// Each case uses a scratch HOME and record root: the plist, log and record live
// there, and only the gui/<uid> launchd registration is shared, booted out
// before and after every case.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { applyCaptureService, preflightCaptureService } from "../lib/capture-service-install.mjs";
import { captureServiceLabel } from "../lib/capture-service-definition.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { alive, captureScript, nodeWrapper, realManagerSkip, runSetup, scratch, script, until } from "./fixtures/real-manager.mjs";

const skip = realManagerSkip("darwin") ?? false;
const uid = process.getuid?.(), domain = `gui/${uid}`, target = `${domain}/${captureServiceLabel}`, owner = "realmgr";
const launchctl = (...args) => spawnSync("launchctl", args, { encoding: "utf8", timeout: 30_000 });
const plistPath = home => join(home, "Library", "LaunchAgents", `${captureServiceLabel}.plist`);
function job() {
  const r = launchctl("print", target);
  if (r.status !== 0) return null;
  return { path: /^\s*path = (.+)$/m.exec(r.stdout)?.[1], pid: Number(/^\s*pid = (\d+)$/m.exec(r.stdout)?.[1] ?? 0) || null,
    interval: Number(/^\s*run interval = (\d+) seconds\s*$/m.exec(r.stdout)?.[1] ?? 0) || null, text: r.stdout };
}
function bootout() { launchctl("bootout", target); }
function isolated(t) {
  bootout(); t.after(bootout);
  const home = scratch(t, "real-darwin-"), root = join(home, "record");
  return { home, root, setup: (env = {}, args = []) => runSetup(["--owner", owner, "--root", root, "--no-hooks", ...args], { HOME: home, OATS_NODE_BIN: process.execPath, ...env }) };
}
const log = (t, r) => t.diagnostic(`setup exit ${r.status}\n${r.stdout}${r.stderr}`);

test("FIRST: setup's parser reads what real launchctl print-disabled emits", { skip }, t => {
  const r = launchctl("print-disabled", domain);
  assert.equal(r.status, 0, r.stderr);
  // The shape only, never labels: which blocks real launchd prints and which value spellings.
  const blocks = [...r.stdout.matchAll(/^\s*([^"\s][^=\n]*?) = \{\s*$/gm)].map(match => match[1]);
  const values = [...new Set([...r.stdout.matchAll(/" => (\S+?);?\s*$/gm)].map(match => match[1]))];
  t.diagnostic(`launchctl print-disabled shape: blocks ${JSON.stringify(blocks)}; values ${JSON.stringify(values)}`);
  const { home, root } = isolated(t);
  const plan = preflightCaptureService({ platform: "darwin", node: process.execPath, setupCommand: "turn-record setup", log: () => {},
    request: { root, owner, plan: captureDefaultRootPlan({ home, cwd: home, env: {} }) } });
  assert.equal(typeof plan.state.disabled, "boolean"); assert.equal(plan.state.registered, false);
});

test("first install through setup registers the periodic job at the policy interval and runs the first pass", { skip }, t => {
  const f = isolated(t), r = f.setup(); log(t, r);
  assert.equal(r.status, 0); assert.match(r.stdout, /service: periodic capture scheduled \(every 15 minutes\)/);
  assert.match(r.stdout, /\n {2}first capture pass: appended \d+, pending (yes|no)\n {2}service: scheduled\n/);
  const registered = job(); assert.ok(registered, "the job is registered");
  assert.equal(registered.path, plistPath(f.home)); assert.equal(registered.interval, 900);
  assert.ok(["setup", "service"].includes(readCaptureStatus(f.root).lastRun.trigger));
  assert.equal(fs.existsSync(join(f.root, "capture-service-pending.json")), false);
});

test("an owned legacy KeepAlive watcher converts: the old job stops and no watcher survives", { skip }, async t => {
  const f = isolated(t), legacyDir = join(f.home, "legacy"); fs.mkdirSync(legacyDir);
  // A stand-in recognized as the legacy watcher (a "node" given capture.mjs --watch) that only waits.
  const pidFile = join(legacyDir, "pid"), node = script(join(legacyDir, "node"), `echo $$ > '${pidFile}'\nexec sleep 3600`);
  const logFile = join(f.home, "legacy.log");
  fs.mkdirSync(join(f.home, "Library", "LaunchAgents"), { recursive: true });
  fs.writeFileSync(plistPath(f.home), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>${captureServiceLabel}</string><key>ProgramArguments</key><array><string>${node}</string><string>${captureScript}</string><string>--watch</string><string>--owner</string><string>${owner}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>${logFile}</string><key>StandardErrorPath</key><string>${logFile}</string></dict></plist>
`);
  const loaded = launchctl("bootstrap", domain, plistPath(f.home)); assert.equal(loaded.status, 0, loaded.stderr);
  const pid = await until(() => fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, "utf8")), 30_000, "the legacy watcher to start");
  assert.ok(alive(pid), "the legacy watcher runs");
  const r = f.setup(); log(t, r); assert.equal(r.status, 0);
  assert.match(r.stdout, /manager action completed: launchctl bootout /); assert.match(r.stdout, /service: replacement backups at /);
  await until(() => !alive(pid), 30_000, "the legacy watcher to exit");
  const registered = job(); assert.equal(registered.interval, 900); assert.notEqual(registered.pid, pid);
  assert.doesNotMatch(fs.readFileSync(plistPath(f.home), "utf8"), /KeepAlive|--watch/);
});

test("an unchanged second setup preserves an active pass, and that real worker publishes its receipt", { skip }, async t => {
  const f = isolated(t), wrapper = nodeWrapper(f.home); fs.writeFileSync(wrapper.hold, "");
  t.after(() => fs.rmSync(wrapper.hold, { force: true }));
  const first = f.setup({ OATS_NODE_BIN: wrapper.path }); log(t, first); assert.equal(first.status, 0);
  // RunAtLoad starts the job; the wrapper holds it, so its pass is active.
  const [pid] = await until(() => wrapper.pids().length && wrapper.pids(), 30_000, "the service start");
  assert.equal(job().pid, pid);
  const second = f.setup({ OATS_NODE_BIN: wrapper.path }); log(t, second); assert.equal(second.status, 0);
  assert.match(second.stdout, /definitions already installed/); assert.doesNotMatch(second.stdout, /manager action completed/);
  assert.ok(alive(pid)); assert.equal(job().pid, pid, "the active pass is the same process");
  fs.rmSync(wrapper.hold);
  const receipt = await until(() => { const status = readCaptureStatus(f.root); return status?.lastRun?.trigger === "service" && status.lastRun.finishedAt && status; }, 120_000, "the service receipt");
  assert.ok(["complete", "partial"].includes(receipt.lastRun.outcome), JSON.stringify(receipt.lastRun));
  assert.equal(receipt.policy.intervalSeconds, 900); assert.equal(receipt.lastRun.pid > 0, true);
});

test("the next idle trigger starts a fresh worker (short interval through the internal definition seam)", { skip }, async t => {
  const f = isolated(t), wrapper = nodeWrapper(f.home), intervalSeconds = 15;
  const request = { root: f.root, owner, plan: captureDefaultRootPlan({ home: f.home, cwd: f.home, env: {} }) };
  const lines = [], plan = preflightCaptureService({ platform: "darwin", node: wrapper.path, request, setupCommand: "turn-record setup", intervalSeconds, log: line => lines.push(line) });
  applyCaptureService(plan); t.diagnostic(lines.join("\n"));
  assert.equal(job().interval, intervalSeconds);
  await until(() => wrapper.pids().length >= 1, 30_000, "the load-time run");
  await until(() => wrapper.pids().length >= 2, 90_000, "the interval-triggered run");
  const [first, second] = wrapper.pids(); assert.notEqual(first, second, "a fresh worker per trigger");
  await until(() => readCaptureStatus(f.root)?.lastRun?.finishedAt, 120_000, "a finished service receipt");
  assert.equal(readCaptureStatus(f.root).lastRun.trigger, "service");
});

test("unloaded recovery: after a bootout, a plain setup registers the job again", { skip }, t => {
  const f = isolated(t), first = f.setup(); log(t, first); assert.equal(first.status, 0);
  bootout(); assert.equal(job(), null);
  const again = f.setup(); log(t, again); assert.equal(again.status, 0);
  assert.match(again.stdout, /manager action completed: launchctl bootstrap /); assert.doesNotMatch(again.stdout, /launchctl bootout/);
  const registered = job(); assert.equal(registered.path, plistPath(f.home)); assert.equal(registered.interval, 900);
});
