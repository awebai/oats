// Real systemd --user qualification of the periodic capture service (#1108
// D2). Runs only in a dispatched "Linux tests" workflow on a disposable runner
// with lingering (fixtures/real-manager.mjs); anywhere else every case skips
// with that reason, which is not evidence. systemd --user reads units from the
// runner user's own ~/.config/systemd/user, so the named units live there;
// every case starts and ends by stopping, disabling and removing exactly those
// two units. The record root is a scratch directory.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { captureServiceTimer, captureServiceUnit } from "../lib/capture-service-definition.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { alive, captureScript, nodeWrapper, realManagerSkip, runSetup, scratch, script, until } from "./fixtures/real-manager.mjs";

const skip = realManagerSkip("linux") ?? false, owner = "realmgr";
const systemctl = (...args) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 30_000 });
const units = join(homedir(), ".config", "systemd", "user"), servicePath = join(units, captureServiceUnit), timerPath = join(units, captureServiceTimer);
function show(unit, ...properties) {
  const r = systemctl("show", unit, ...properties.flatMap(property => ["-p", property]));
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(r.stdout.trim().split("\n").filter(Boolean).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}
function reset() {
  for (const args of [["stop", captureServiceTimer], ["stop", captureServiceUnit], ["disable", captureServiceTimer], ["disable", captureServiceUnit]]) systemctl(...args);
  for (const path of [servicePath, timerPath]) fs.rmSync(path, { force: true });
  systemctl("daemon-reload"); systemctl("reset-failed", captureServiceUnit, captureServiceTimer);
}
function isolated(t) {
  reset(); t.after(reset);
  const base = scratch(t, "real-linux-"), root = join(base, "record");
  return { base, root, marker: join(root, "capture-service-pending.json"),
    setup: (env = {}, args = []) => runSetup(["--owner", owner, "--root", root, "--no-hooks", ...args], { OATS_NODE_BIN: process.execPath, ...env }) };
}
const log = (t, r) => t.diagnostic(`setup exit ${r.status}\n${r.stdout}${r.stderr}`);
const realSystemctl = () => spawnSync("sh", ["-c", "command -v systemctl"], { encoding: "utf8" }).stdout.trim();

test("FIRST: systemctl --user answers on this runner (a failure here is a runner problem, not a skip)", { skip }, () => {
  const r = systemctl("show-environment");
  assert.equal(r.status, 0, `systemctl --user does not answer: ${r.stderr}`);
});

test("first install enables the timer, and the finite service is inactive between runs", { skip }, async t => {
  const f = isolated(t), r = f.setup(); log(t, r);
  assert.equal(r.status, 0); assert.match(r.stdout, /\n {2}service: scheduled\n/);
  const timer = show(captureServiceTimer, "UnitFileState", "ActiveState", "FragmentPath");
  assert.deepEqual(timer, { UnitFileState: "enabled", ActiveState: "active", FragmentPath: timerPath });
  assert.equal(show(captureServiceUnit, "UnitFileState").UnitFileState, "static");
  await until(() => show(captureServiceUnit, "ActiveState").ActiveState === "inactive", 120_000, "the finite service between runs");
  assert.equal(fs.existsSync(f.marker), false);
});

test("an owned legacy watcher unit converts: it is stopped and disabled and no old watcher survives", { skip }, async t => {
  const f = isolated(t), legacy = join(f.base, "legacy"); fs.mkdirSync(legacy);
  const node = script(join(legacy, "node"), "exec sleep 3600");
  fs.mkdirSync(units, { recursive: true });
  fs.writeFileSync(servicePath, `[Unit]\nDescription=turn-record capture watcher\n[Service]\nExecStart=${node} ${captureScript} --watch --owner ${owner}\nRestart=always\nRestartSec=60\n[Install]\nWantedBy=default.target\n`);
  assert.equal(systemctl("daemon-reload").status, 0); const started = systemctl("enable", "--now", captureServiceUnit); assert.equal(started.status, 0, started.stderr);
  const pid = Number(await until(() => Number(show(captureServiceUnit, "MainPID").MainPID), 30_000, "the legacy watcher"));
  const r = f.setup(); log(t, r); assert.equal(r.status, 0);
  assert.match(r.stdout, /manager action completed: systemctl --user stop turn-record-capture\.service/);
  assert.match(r.stdout, /manager action completed: systemctl --user disable turn-record-capture\.service/);
  await until(() => !alive(pid), 30_000, "the legacy watcher to exit");
  assert.equal(show(captureServiceUnit, "UnitFileState").UnitFileState, "static");
  assert.equal(show(captureServiceTimer, "UnitFileState").UnitFileState, "enabled");
  assert.doesNotMatch(fs.readFileSync(servicePath, "utf8"), /--watch|Restart=/);
});

test("a changed definition takes effect after daemon-reload", { skip }, t => {
  const f = isolated(t), first = f.setup(); log(t, first); assert.equal(first.status, 0);
  const wrapper = nodeWrapper(f.base), changed = f.setup({ OATS_NODE_BIN: wrapper.path }); log(t, changed); assert.equal(changed.status, 0);
  assert.match(changed.stdout, /service: definition written: .*turn-record-capture\.service/);
  const service = show(captureServiceUnit, "ExecStart", "NeedDaemonReload");
  assert.match(service.ExecStart, new RegExp(`path=${wrapper.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `));
  assert.equal(service.NeedDaemonReload, "no");
});

test("#1099 on real systemd: a failed first enable leaves the marker; a plain rerun completes activation", { skip }, t => {
  const f = isolated(t), bin = join(f.base, "bin"), once = join(f.base, "enable-failed"); fs.mkdirSync(bin);
  // Only the first `enable` fails; every other call is the real systemctl.
  script(join(bin, "systemctl"), `if [ "$2" = "enable" ] && [ ! -e '${once}' ]; then : > '${once}'; echo "injected enable failure" >&2; exit 1; fi\nexec '${realSystemctl()}' "$@"`);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const failed = f.setup(env); log(t, failed); assert.equal(failed.status, 1);
  assert.match(failed.stdout, /\n {2}service: failed: systemctl --user enable --now turn-record-capture\.timer failed \(injected enable failure; exit 1\)/);
  assert.match(failed.stdout, /\n {2}first capture pass: appended \d+, pending (yes|no)\n/);
  assert.ok(fs.existsSync(f.marker)); assert.equal(show(captureServiceTimer, "UnitFileState").UnitFileState, "disabled");
  const rerun = f.setup(env); log(t, rerun); assert.equal(rerun.status, 0);
  assert.match(rerun.stdout, /pending-activation marker removed/); assert.equal(fs.existsSync(f.marker), false);
  assert.deepEqual(show(captureServiceTimer, "UnitFileState", "ActiveState"), { UnitFileState: "enabled", ActiveState: "active" });
});

test("an unchanged rerun preserves an active pass", { skip }, async t => {
  const f = isolated(t), wrapper = nodeWrapper(f.base); fs.writeFileSync(wrapper.hold, ""); t.after(() => fs.rmSync(wrapper.hold, { force: true }));
  const first = f.setup({ OATS_NODE_BIN: wrapper.path }); log(t, first); assert.equal(first.status, 0);
  if (show(captureServiceUnit, "ActiveState").ActiveState !== "active") assert.equal(systemctl("start", "--no-block", captureServiceUnit).status, 0);
  const pid = Number(await until(() => Number(show(captureServiceUnit, "MainPID").MainPID), 30_000, "the held service pass"));
  const second = f.setup({ OATS_NODE_BIN: wrapper.path }); log(t, second); assert.equal(second.status, 0);
  assert.match(second.stdout, /definitions already installed/); assert.doesNotMatch(second.stdout, /manager action completed/);
  assert.equal(Number(show(captureServiceUnit, "MainPID").MainPID), pid, "the active pass is the same process"); assert.ok(alive(pid));
  fs.rmSync(wrapper.hold);
  const receipt = await until(() => { const status = readCaptureStatus(f.root); return status?.lastRun?.trigger === "service" && status.lastRun.finishedAt && status; }, 120_000, "the service receipt");
  assert.ok(["complete", "partial"].includes(receipt.lastRun.outcome), JSON.stringify(receipt.lastRun));
});

test("MemoryMax and RuntimeMaxSec are in the effective service", { skip }, t => {
  const f = isolated(t), r = f.setup(); log(t, r); assert.equal(r.status, 0);
  assert.deepEqual(show(captureServiceUnit, "MemoryMax", "RuntimeMaxUSec"), { MemoryMax: String(2 * 1024 ** 3), RuntimeMaxUSec: "5min" });
});

test("a missing, failing or signalled manager gives a useful reason and changes nothing", { skip }, t => {
  const f = isolated(t), bin = join(f.base, "bin"), empty = join(f.base, "empty"); fs.mkdirSync(bin); fs.mkdirSync(empty);
  const missing = f.setup({ PATH: empty }); log(t, missing); assert.equal(missing.status, 1);
  assert.match(missing.stderr, /systemctl --user show turn-record-capture\.service .* failed \(.*ENOENT.*\); check manager availability\/access and re-run setup/);
  for (const [body, reason] of [["exit 3", /exit 3/], ["kill -TERM $$", /signal SIGTERM/]]) {
    script(join(bin, "systemctl"), `echo "fixture refusal" >&2\n${body}`);
    const r = f.setup({ PATH: `${bin}:${process.env.PATH}` }); log(t, r); assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`systemctl --user show turn-record-capture\\.service .* failed \\(.*${reason.source}`));
  }
  assert.equal(fs.existsSync(servicePath), false); assert.equal(fs.existsSync(timerPath), false); assert.equal(fs.existsSync(f.marker), false);
});
