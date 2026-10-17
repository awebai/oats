// Rollback qualification of the hooks and the periodic service (#1165 B1,
// extending #1108 Q3). This release's setup installs the periodic service and
// writes its hook entry, bin/capture-hook.mjs. Going back to 0.61.0 puts 0.61.0
// at the paths those definitions name: the hook entry is absent, so the hook
// exits 1 (not Claude's Stop-blocking 2), and a service start fails. 0.61.0's
// own setup then installs its watcher and its hooks, leaving this release's
// hook line in place for the operator to remove (docs/upgrading.md). Runs only
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
import { dirname, join } from "node:path";
import { captureServiceTimer, captureServiceUnit } from "../lib/capture-service-definition.mjs";
import { shellWords } from "../lib/capture-hook-ownership.mjs";
import { installRelease, report, runnerFacts, scratch, table } from "./fixtures/qualify.mjs";
import { realManagerSkip, runSetup, setupScript, until } from "./fixtures/real-manager.mjs";

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
  const base = scratch(t, "qualify-rollback-hooks-"), root = join(base, "record");
  runnerFacts(t, { root: base, scratch: base });
  const old = installRelease(base, OLD), oldPackage = dirname(dirname(old.cli));
  report(t, "outgoing-release", { version: old.version, integrity: old.integrity });
  const headBin = dirname(setupScript), oldBin = join(oldPackage, "packages", "record", "bin");
  const headLib = join(dirname(headBin), "lib"), oldLib = join(oldPackage, "packages", "record", "lib");

  // This release's setup: the periodic service and the hook entry.
  const head = runSetup(["--owner", owner, "--root", root], { OATS_NODE_BIN: process.execPath });
  t.diagnostic(`head setup exit ${head.status}\n${tail(head.stdout)}\n${tail(head.stderr)}`);
  assert.equal(head.status, 0);
  const written = Object.fromEntries(["Stop", "SessionEnd"].map(event => [event, hooks(event)]));
  for (const event of ["Stop", "SessionEnd"]) {
    assert.equal(written[event].length, 1, JSON.stringify(written));
    assert.equal(shellWords(written[event][0])[1], join(headBin, "capture-hook.mjs"));
  }

  // Going back: the same definitions now name 0.61.0's files. The hook entry
  // is absent there, so the hook fails to load with exit 1.
  const rolled = written.Stop[0].replace(headBin, oldBin);
  const hook = spawnSync("sh", ["-c", rolled], { encoding: "utf8", timeout: 60_000, env: { ...process.env } });
  // What the form this release replaced would have done under 0.61.0.
  const earlier = spawnSync(process.execPath, [join(oldBin, "capture.mjs"), "--owner", owner, "--quiet", "--hook", "--root", root],
    { encoding: "utf8", timeout: 60_000 });
  report(t, "rollback-hook", { command: rolled, exit: hook.status, stderr: tail(hook.stderr), earlierForm: { exit: earlier.status, stderr: tail(earlier.stderr) } });
  assert.notEqual(hook.status, 2, "the hook entry can never return Claude's blocking exit 2 under 0.61.0");
  assert.equal(hook.status, 1, hook.stderr);
  assert.match(hook.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);

  // The service's runner is absent under 0.61.0 too: a start fails.
  fs.writeFileSync(servicePath, fs.readFileSync(servicePath, "utf8").replaceAll(headLib, oldLib));
  systemctl("daemon-reload");
  systemctl("start", captureServiceUnit);
  const start = await until(() => { const s = show(captureServiceUnit, "ActiveState", "Result"); return s.ActiveState !== "activating" && s; }, 60_000, "the rolled-back service start to end");
  report(t, "rollback-service-start", start);
  assert.notEqual(start.Result, "success", JSON.stringify(start));

  // 0.61.0's own setup: its watcher and its hooks.
  const back = spawnSync(process.execPath, [old.cli, "setup", "--owner", owner, "--root", root], { encoding: "utf8", timeout: 300_000, env: { ...process.env } });
  t.diagnostic(`${OLD} setup exit ${back.status}\n${tail(back.stdout)}\n${tail(back.stderr)}`);
  const watcher = show(captureServiceUnit, "UnitFileState", "ActiveState", "FragmentPath", "ExecStart");
  const after = Object.fromEntries(["Stop", "SessionEnd"].map(event => [event, hooks(event)]));
  const leftover = Object.fromEntries(Object.entries(after).map(([event, commands]) => [event, commands.filter(command => command.includes("capture-hook.mjs"))]));
  const restored = Object.fromEntries(Object.entries(after).map(([event, commands]) => [event, commands.filter(command => shellWords(command)?.[1] === join(oldBin, "capture.mjs"))]));
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
