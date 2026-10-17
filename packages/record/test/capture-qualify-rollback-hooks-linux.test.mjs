// Rollback qualification of the hooks and the periodic service (#1165 B1,
// extending #1108 Q3). The tested tree is packed and installed into an npm
// prefix, and that install's setup installs the periodic service and writes
// its hook entry, bin/capture-hook.mjs. Going back installs the published
// 0.61.0 over it in the same prefix, as `npm i -g @awebai/oats@0.61.0` does, so
// the paths those definitions name now hold 0.61.0: the hook entry and the
// service runner are absent, so the hook exits 1 (not Claude's Stop-blocking
// 2), and a service start fails. 0.61.0's own setup then installs its watcher
// and its hooks, leaving this release's hook line in place for the operator to
// remove (docs/upgrading.md). Runs only
// in a dispatched "Linux tests" workflow (fixtures/real-manager.mjs); a skip is
// not evidence. systemd --user reads units from the runner user's own
// ~/.config/systemd/user and setup writes hooks into the runner user's
// ~/.claude*/settings.json, so both are used for real, and the test starts and
// ends by removing exactly the two named units and restoring ~/.claude.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { captureServiceTimer, captureServiceUnit } from "../lib/capture-service-definition.mjs";
import { shellWords } from "../lib/capture-hook-ownership.mjs";
import { installHead, installRelease, report, runnerFacts, scratch, table } from "./fixtures/qualify.mjs";
import { realManagerSkip, until } from "./fixtures/real-manager.mjs";

const skip = realManagerSkip("linux") ?? false, owner = "rollbackhooks", OLD = "0.61.0";
const systemctl = (...args) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 30_000 });
const units = join(homedir(), ".config", "systemd", "user"), servicePath = join(units, captureServiceUnit), timerPath = join(units, captureServiceTimer);
const claude = join(homedir(), ".claude"), settings = join(claude, "settings.json");
const tail = text => String(text ?? "").trim().slice(-600);
function show(unit, ...properties) {
  const r = systemctl("show", unit, ...properties.flatMap(property => ["-p", property]));
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(r.stdout.trim().split("\n").filter(Boolean).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}
function resetUnits() {
  for (const args of [["stop", captureServiceTimer], ["stop", captureServiceUnit], ["disable", captureServiceTimer], ["disable", captureServiceUnit]]) systemctl(...args);
  for (const path of [servicePath, timerPath]) fs.rmSync(path, { force: true });
  systemctl("daemon-reload"); systemctl("reset-failed", captureServiceUnit, captureServiceTimer);
}
/** The runner user's ~/.claude as found, restored after the test. */
function keepClaude(t) {
  const existed = fs.existsSync(claude), before = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
  t.after(() => {
    if (!existed) fs.rmSync(claude, { recursive: true, force: true });
    else if (before === null) fs.rmSync(settings, { force: true });
    else fs.writeFileSync(settings, before);
  });
  fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(settings, "{}\n");
}
const hooks = event => (JSON.parse(fs.readFileSync(settings, "utf8")).hooks?.[event] ?? []).flatMap(group => group.hooks ?? []).map(hook => hook.command);

test(`after going back to ${OLD} the hook exits 1, a service start fails, and ${OLD}'s setup restores its watcher and hooks`, { skip, timeout: 19 * 60_000 }, async t => {
  resetUnits(); t.after(resetUnits); keepClaude(t);
  const base = scratch(t, "qualify-rollback-hooks-"), root = join(base, "record"), prefix = join(base, "prefix");
  runnerFacts(t, { root: base, scratch: base });
  const installed = join(prefix, "node_modules", "@awebai", "oats", "packages", "record");
  const bin = join(installed, "bin"), runner = join(installed, "lib", "capture-service-runner.mjs");

  // This release, installed as a package: its setup installs the periodic
  // service and writes the hook entry, both naming the installed files.
  const head = installHead(base, prefix);
  report(t, "tested-install", { tarball: head.tarball, resolved: head.resolved });
  assert.ok(fs.existsSync(join(bin, "capture-hook.mjs")) && fs.existsSync(runner), "the tested install has the hook entry and the service runner");
  const setup = spawnSync(process.execPath, [head.cli, "setup", "--owner", owner, "--root", root], { encoding: "utf8", timeout: 300_000, env: { ...process.env } });
  t.diagnostic(`head setup exit ${setup.status}\n${tail(setup.stdout)}\n${tail(setup.stderr)}`);
  assert.equal(setup.status, 0);
  const written = Object.fromEntries(["Stop", "SessionEnd"].map(event => [event, hooks(event)]));
  for (const event of ["Stop", "SessionEnd"]) {
    assert.equal(written[event].length, 1, JSON.stringify(written));
    assert.equal(shellWords(written[event][0])[1], join(bin, "capture-hook.mjs"));
  }
  assert.ok(fs.readFileSync(servicePath, "utf8").includes(runner), "the unit runs the installed runner");
  // Let setup's own pass end, so the start below is a new run.
  systemctl("stop", captureServiceUnit); systemctl("reset-failed", captureServiceUnit);

  // Going back: the published 0.61.0 over the same prefix. The definitions are
  // unchanged and now name 0.61.0's files, where the hook entry and the runner
  // are absent, so the hook fails to load with exit 1.
  const old = installRelease(base, OLD, { prefix });
  report(t, "outgoing-release", { version: old.version, integrity: old.integrity, resolved: old.resolved });
  assert.equal(old.cli, head.cli, "0.61.0 replaced the tested install in place");
  assert.equal(fs.existsSync(join(bin, "capture-hook.mjs")), false, "0.61.0 has no hook entry");
  assert.equal(fs.existsSync(runner), false, "0.61.0 has no service runner");
  const hook = spawnSync("sh", ["-c", written.Stop[0]], { encoding: "utf8", timeout: 60_000, env: { ...process.env } });
  // What the form this release replaced would have done under 0.61.0.
  const earlier = spawnSync(process.execPath, [join(bin, "capture.mjs"), "--owner", owner, "--quiet", "--hook", "--root", root],
    { encoding: "utf8", timeout: 60_000 });
  report(t, "rollback-hook", { command: written.Stop[0], exit: hook.status, stderr: tail(hook.stderr), earlierForm: { exit: earlier.status, stderr: tail(earlier.stderr) } });
  assert.notEqual(hook.status, 2, "the hook entry can never return Claude's blocking exit 2 under 0.61.0");
  assert.equal(hook.status, 1, hook.stderr);
  assert.match(hook.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);

  // The service's runner is absent under 0.61.0 too: a start fails. Type=exec
  // is active while node runs, so the run is read once it has ended, and its
  // invocation is a new one.
  const before = show(captureServiceUnit, "InvocationID").InvocationID;
  systemctl("start", captureServiceUnit);
  const start = await until(() => {
    const s = show(captureServiceUnit, "ActiveState", "Result", "InvocationID");
    return ["inactive", "failed"].includes(s.ActiveState) && s.InvocationID !== before && s;
  }, 60_000, "the rolled-back service run to end");
  report(t, "rollback-service-start", start);
  assert.notEqual(start.Result, "success", JSON.stringify(start));

  // 0.61.0's own setup: its watcher and its hooks.
  const back = spawnSync(process.execPath, [old.cli, "setup", "--owner", owner, "--root", root], { encoding: "utf8", timeout: 300_000, env: { ...process.env } });
  t.diagnostic(`${OLD} setup exit ${back.status}\n${tail(back.stdout)}\n${tail(back.stderr)}`);
  const watcher = show(captureServiceUnit, "UnitFileState", "ActiveState", "FragmentPath", "ExecStart");
  const after = Object.fromEntries(["Stop", "SessionEnd"].map(event => [event, hooks(event)]));
  const leftover = Object.fromEntries(Object.entries(after).map(([event, commands]) => [event, commands.filter(command => command.includes("capture-hook.mjs"))]));
  const restored = Object.fromEntries(Object.entries(after).map(([event, commands]) => [event, commands.filter(command => shellWords(command)?.[1] === join(bin, "capture.mjs"))]));
  report(t, "rollback-restored", { setupExit: back.status, watcher, timerPresent: fs.existsSync(timerPath), hooks: after, leftover, restored });
  table(t, `rollback to ${OLD}: hooks and service`, [
    { step: "hook entry under 0.61.0", result: `exit ${hook.status}` },
    { step: "earlier capture.mjs --hook form under 0.61.0", result: `exit ${earlier.status}` },
    { step: "service start under 0.61.0", result: `${start.ActiveState}/${start.Result}` },
    { step: `${OLD} setup`, result: `exit ${back.status}; watcher ${watcher.UnitFileState}/${watcher.ActiveState}; timer file ${fs.existsSync(timerPath) ? "left" : "gone"}` },
  ]);
  assert.equal(back.status, 0, back.stderr);
  assert.equal(watcher.FragmentPath, servicePath);
  assert.match(watcher.ExecStart, /--watch/, "0.61.0's watcher unit");
  assert.equal(watcher.UnitFileState, "enabled"); assert.equal(watcher.ActiveState, "active");
  for (const event of ["Stop", "SessionEnd"]) {
    assert.equal(restored[event].length, 1, `${OLD}'s ${event} hook: ${JSON.stringify(after[event])}`);
    assert.equal(leftover[event].length, 1, `the documented leftover line in ${event}: ${JSON.stringify(after[event])}`);
  }
});
