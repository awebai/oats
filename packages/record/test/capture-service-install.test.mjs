// Isolated source fixtures only: managers are intercepted or injected models.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { captureServiceDefinition } from "../lib/capture-service-definition.mjs";
import { captureServiceOwnership } from "../lib/capture-service-ownership.mjs";
import { preflightCaptureService, applyCaptureService, serviceShellWord } from "../lib/capture-service-install.mjs";
import { fakeCaptureManager } from "./fixtures/capture-fake-manager.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";

const setup = fileURLToPath(new URL("../bin/setup.mjs", import.meta.url));
const service = "turn-record-capture.service", timer = "turn-record-capture.timer";
const write = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text); };
function fixture(t, platform = "linux") {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-service-install-")), home = join(base, "home"), root = join(base, "record 'quoted' $root %h");
  fs.mkdirSync(home); const settings = join(home, ".claude/settings.json"); write(settings, '{"kept":true}\n');
  const request = { root, owner: "fixture-owner", plan: captureDefaultRootPlan({ home, cwd: base, env: {} }) };
  const definition = captureServiceDefinition({ platform, node: process.execPath, request });
  const logs = [], calls = join(home, ".manager-calls"), state = join(home, ".manager-state.json"), config = join(home, ".manager-config.json");
  const runManager = (command, args) => fakeCaptureManager(home, command, args);
  const options = { platform, node: process.execPath, request, setupPath: setup, uid: 501, run: runManager, log: line => logs.push(line) };
  const guard = join(base, "guard.mjs");
  write(guard, `import os from 'node:os'; import cp from 'node:child_process'; import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fakeCaptureManager } from ${JSON.stringify(new URL("./fixtures/capture-fake-manager.mjs", import.meta.url).href)};
os.platform = () => ${JSON.stringify(platform)};
const open = fs.openSync;
cp.spawnSync = (command, args, options) => {
  if (['launchctl','systemctl'].includes(command)) return fakeCaptureManager(process.env.HOME, command, args);
  throw new Error('unexpected synchronous child in setup fixture');
};
fs.openSync = (path, ...args) => {
  if (path === process.env.FIXTURE_DENY_TARGET) throw Object.assign(new Error('fixture target unreadable'), { code: 'EACCES' });
  return open(path, ...args);
}; syncBuiltinESMExports();`);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, root, settings, request, definition, options, logs, calls, state, config,
    preflight(extra = {}) { return preflightCaptureService({ ...options, ...extra }); },
    cli(args = [], extra = {}) { return spawnSync(process.execPath, ["--no-warnings", "--import", guard, setup,
      "--owner", request.owner, "--root", root, ...args], { cwd: base, env: { HOME: home, PATH: "", TMPDIR: base,
        XDG_CACHE_HOME: join(base, "cache"), OATS_NODE_BIN: process.execPath, ...extra }, encoding: "utf8", timeout: 30000 }); },
    operations() { return fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(line => !/systemctl --user show |launchctl print/.test(line)) : []; },
  };
}
function install(f) { const plan = f.preflight(); applyCaptureService(plan); return plan; }
function legacy(f, node = "/old/node", script = "/old/package/bin/capture.mjs") {
  if (f.options.platform === "linux") return `[Unit]\nDescription=turn-record capture watcher\n[Service]\nExecStart=${node} ${script} --watch --owner old-owner\nRestart=always\nRestartSec=60\n[Install]\nWantedBy=default.target\n`;
  return `<plist version="1.0"><dict><key>Label</key><string>ai.aweb.turn-record-capture</string><key>ProgramArguments</key><array><string>${node}</string><string>${script}</string><string>--watch</string><string>--owner</string><string>old-owner</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>/old/log</string><key>StandardErrorPath</key><string>/old/log</string></dict></plist>`;
}

test("ownership accepts complete known templates, never basename/mention/extra directive/malformed marker", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), kind = platform === "linux" ? "service" : "plist", old = legacy(f);
    assert.equal(captureServiceOwnership(old, kind), "legacy");
    for (const file of f.definition.files) assert.equal(captureServiceOwnership(file.contents, file.path.endsWith(".timer") ? "timer" : kind), "periodic");
    for (const text of [old.replace("/old/node", "/bin/sh"), old.replace("/old/package/bin/capture.mjs", "/external/wrapper"),
      old.replace("--watch", "--quiet"), old.replace("old-owner", "bad/owner"), "capture.mjs --watch --owner old-owner", old.slice(0, -12),
      f.definition.files[0].contents.replace("oats-turn-record-service:1", "oats-turn-record-service:2"),
      platform === "linux" ? old + "[Service]\nExecStartPost=/bin/other\n" : old.replace("</dict>", "<key>EnvironmentVariables</key><dict></dict></dict>")])
      assert.equal(captureServiceOwnership(text, kind), "foreign", text);
    const quoted = platform === "linux" ? old.replace("/old/node /old/package/bin/capture.mjs", '"/old path/node" "/missing install/bin/capture.mjs"') : old.replace("/old/package", "/missing install &amp; package");
    assert.equal(captureServiceOwnership(quoted, kind), "legacy", "missing executable is not an ownership probe");
  }
});

test("all-target foreign/read/manager refusals leave hooks, definitions and capture status untouched", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), target = f.definition.files.at(-1).path, foreign = "operator-owned wrapper definition\n";
    write(target, foreign); const hook = fs.readFileSync(f.settings);
    const refused = f.cli(); assert.equal(refused.status, 1, refused.stdout); assert.match(refused.stderr, /E_CAPTURE_SERVICE_FOREIGN/);
    assert.ok(refused.stderr.includes(`--root ${serviceShellWord(f.root)}`)); assert.match(refused.stderr, /--replace-service.*--no-service/s);
    assert.equal(fs.readFileSync(target, "utf8"), foreign); assert.deepEqual(fs.readFileSync(f.settings), hook);
    assert.equal(fs.existsSync(f.root), false); assert.deepEqual(f.operations(), []);
    const unreadable = f.cli(["--replace-service"], { FIXTURE_DENY_TARGET: target });
    assert.equal(unreadable.status, 1); assert.match(unreadable.stderr, /fixture target unreadable/);
    assert.equal(fs.existsSync(f.root), false); assert.deepEqual(f.operations(), []);
    write(f.config, JSON.stringify({ fail: platform === "linux" ? "show" : "print-disabled", missing: true }));
    const unavailable = f.cli(["--replace-service"]); assert.equal(unavailable.status, 1); assert.match(unavailable.stderr, /fixture manager missing/);
    assert.deepEqual(fs.readFileSync(f.settings), hook); assert.equal(fs.readFileSync(target, "utf8"), foreign);
  }
  const f = fixture(t); write(f.definition.files[0].path, legacy(f)); fs.mkdirSync(f.definition.files[1].path);
  assert.throws(() => f.preflight({ replace: true }), /nonregular/); assert.equal(fs.existsSync(f.calls), false);
});

test("absent install verifies scheduling; unchanged periodic manager preserves active pass; missing registration recovers", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform); install(f);
    assert.match(f.logs.at(-1), /periodic capture scheduled \(every 15 minutes\)/);
    const state = JSON.parse(fs.readFileSync(f.state));
    if (platform === "linux") state.units[service].ActiveState = "active";
    else state.mac.active = true;
    write(f.state, JSON.stringify(state)); const before = f.operations().length;
    install(f); assert.equal(f.operations().length, before, "unchanged healthy setup never restarts active work");
    const after = JSON.parse(fs.readFileSync(f.state)); assert.equal(platform === "linux" ? after.units[service].ActiveState : after.mac.active, platform === "linux" ? "active" : true);
    if (platform === "linux") { state.units[timer].ActiveState = "inactive"; }
    else state.mac.registered = false;
    write(f.state, JSON.stringify(state)); install(f);
    assert.match(f.operations().at(-1), platform === "linux" ? /enable --now turn-record-capture.timer/ : /bootstrap/);
    assert.doesNotMatch(f.operations().slice(before).join("\n"), /stop turn-record-capture.service|bootout|kickstart/);
  }
});

test("legacy and changed definitions stop old work, back up exact bytes and converge without duplicate schedules", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), old = legacy(f), target = f.definition.files[0].path; write(target, old);
    install(f); const operations = f.operations();
    if (platform === "linux") {
      assert.deepEqual(operations.slice(0, 2), [`systemctl --user stop ${service}`, `systemctl --user disable ${service}`]);
      assert.match(operations.at(-1), /enable --now turn-record-capture.timer/);
    } else { assert.match(operations[0], /bootout/); assert.match(operations[1], /bootstrap/); }
    const backups = fs.readdirSync(join(f.root, "service-backups")); assert.equal(backups.length, 1);
    const backup = join(f.root, "service-backups", backups[0], platform === "linux" ? service : "ai.aweb.turn-record-capture.plist");
    assert.equal(fs.readFileSync(backup, "utf8"), old); assert.ok(f.logs.some(line => line.includes(backups[0])));
    const previous = fs.readFileSync(target), changed = f.preflight({ node: "/new install/bin/node" }); applyCaptureService(changed);
    assert.equal(fs.readdirSync(join(f.root, "service-backups")).length, 2); assert.equal(fs.readFileSync(backup, "utf8"), old);
    assert.notDeepEqual(fs.readFileSync(target), previous); assert.doesNotMatch(fs.readFileSync(target, "utf8"), /--watch|KeepAlive|Restart=always/);
  }
});

test("explicit disabled/masked replacement backs up links without following/removing an external wrapper", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform); install(f); const state = JSON.parse(fs.readFileSync(f.state));
    if (platform === "linux") state.units[timer].UnitFileState = "disabled"; else state.mac.disabled = true;
    write(f.state, JSON.stringify(state)); const before = f.operations().length;
    assert.throws(() => f.preflight(), /E_CAPTURE_SERVICE_DISABLED/); assert.equal(f.operations().length, before);
    applyCaptureService(f.preflight({ replace: true })); assert.match(f.logs.at(-1), /periodic capture scheduled/);
  }
  const f = fixture(t); fs.mkdirSync(dirname(f.definition.files[0].path), { recursive: true });
  fs.symlinkSync("/dev/null", f.definition.files[0].path);
  assert.throws(() => f.preflight(), /E_CAPTURE_SERVICE_DISABLED/);
  applyCaptureService(f.preflight({ replace: true }));
  const backupDir = fs.readdirSync(join(f.root, "service-backups"))[0];
  assert.equal(fs.readlinkSync(join(f.root, "service-backups", backupDir, service)), "/dev/null");
  const other = fixture(t), wrapper = join(other.base, "external-wrapper"); write(wrapper, "keep external wrapper bytes");
  fs.mkdirSync(dirname(other.definition.files[0].path), { recursive: true }); fs.symlinkSync(wrapper, other.definition.files[0].path);
  assert.throws(() => other.preflight(), /E_CAPTURE_SERVICE_FOREIGN/);
  applyCaptureService(other.preflight({ replace: true })); assert.equal(fs.readFileSync(wrapper, "utf8"), "keep external wrapper bytes");
  assert.equal(fs.lstatSync(other.definition.files[0].path).isSymbolicLink(), false);
});

test("indeterminate manager state cannot be overridden by replace", t => {
  const f = fixture(t); install(f); const before = f.operations().length;
  for (const values of [{ LoadState: "error" }, { UnitFileState: "mystery" }, { DropInPaths: "/operator/override.conf" }]) {
    write(f.config, JSON.stringify({ units: { [service]: values } }));
    assert.throws(() => f.preflight({ replace: true }), /indeterminate|unsupported/);
  }
  assert.equal(f.operations().length, before);
});

test("hook read/shape refusal precedes any service mutation, including explicit replacement", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), target = f.definition.files[0].path; write(target, legacy(f));
    const original = fs.readFileSync(f.settings);
    const denied = f.cli(["--replace-service"], { FIXTURE_DENY_TARGET: f.settings });
    assert.equal(denied.status, 1); assert.match(denied.stderr, /fixture target unreadable/);
    assert.equal(fs.existsSync(f.calls), false); assert.equal(fs.existsSync(f.root), false);
    assert.deepEqual(fs.readFileSync(f.settings), original); assert.equal(fs.readFileSync(target, "utf8"), legacy(f));
    write(f.settings, '{"hooks":{"Stop":true}}');
    const malformed = f.cli(["--replace-service"]);
    assert.equal(malformed.status, 1); assert.equal(fs.existsSync(f.calls), false);
    assert.equal(fs.existsSync(f.root), false); assert.equal(fs.readFileSync(target, "utf8"), legacy(f));
  }
});

test("runtime legacy enablement is disabled before finite timer activation", t => {
  const f = fixture(t); write(f.definition.files[0].path, legacy(f));
  const configured = f.preflight();
  const units = structuredClone(configured.state); units.service.UnitFileState = "enabled-runtime";
  write(f.state, JSON.stringify({ units: { [service]: units.service, [timer]: units.timer } }));
  applyCaptureService(f.preflight());
  assert.ok(f.operations().includes(`systemctl --user --runtime disable ${service}`));
  assert.equal(JSON.parse(fs.readFileSync(f.state)).units[service].UnitFileState, "static");
});

test("unmask does not authorize a replaced parent or a different target", t => {
  for (const replacement of ["parent", "file"]) {
    const f = fixture(t), target = f.definition.files[0].path;
    fs.mkdirSync(dirname(target), { recursive: true }); fs.symlinkSync("/dev/null", target);
    const plan = f.preflight({ replace: true }), run = plan.run;
    plan.run = (command, args) => {
      const result = run(command, args);
      if (args.includes("unmask")) {
        if (replacement === "parent") { fs.renameSync(dirname(target), dirname(target) + ".saved"); fs.mkdirSync(dirname(target)); }
        else write(target, "operator replacement");
      }
      return result;
    };
    assert.throws(() => applyCaptureService(plan), /changed since preflight/);
    if (replacement === "file") assert.equal(fs.readFileSync(target, "utf8"), "operator replacement");
    else assert.equal(fs.existsSync(target), false);
    assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled/);
  }
});

test("manager signal/nonzero/read failure never supplies replacement permission", t => {
  for (const platform of ["linux", "darwin"]) for (const failure of [{ code: 9 }, { code: null, signal: "SIGTERM" }, { missing: true }]) {
    const f = fixture(t, platform), target = f.definition.files[0].path; write(target, legacy(f));
    write(f.config, JSON.stringify({ fail: platform === "linux" ? "show" : "print-disabled", ...failure }));
    const before = fs.readFileSync(target); assert.throws(() => f.preflight({ replace: true }), /failed/);
    assert.deepEqual(fs.readFileSync(target), before); assert.equal(fs.existsSync(f.root), false); assert.deepEqual(f.operations(), []);
  }
});

test("a changed registered definition that cannot be stopped remains byte-identical", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), target = f.definition.files[0].path, bytes = legacy(f); write(target, bytes);
    const plan = f.preflight(); write(f.config, JSON.stringify({ fail: platform === "linux" ? "stop" : "bootout" }));
    assert.throws(() => applyCaptureService(plan), /failed/);
    assert.equal(fs.readFileSync(target, "utf8"), bytes); assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
    assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled/);
  }
});

test("failed backup and changed file/parent/manager identity prevent mutation", t => {
  const f = fixture(t), target = f.definition.files[0].path; write(target, legacy(f));
  const plan = f.preflight(); write(f.root, "not a backup directory");
  assert.throws(() => applyCaptureService(plan)); assert.deepEqual(f.operations(), []); assert.equal(fs.readFileSync(target, "utf8"), legacy(f));
  fs.unlinkSync(f.root);
  const changed = f.preflight(); fs.renameSync(target, `${target}.saved`); write(target, legacy(f));
  assert.throws(() => applyCaptureService(changed), /changed since preflight/); assert.deepEqual(f.operations(), []);
  const parent = f.preflight(), directory = dirname(target); fs.renameSync(directory, `${directory}.saved`); fs.mkdirSync(directory);
  write(target, legacy(f)); assert.throws(() => applyCaptureService(parent), /parent changed/); assert.deepEqual(f.operations(), []);
  const managerPlan = f.preflight(); write(f.config, JSON.stringify({ units: { [service]: { UnitFileState: "disabled" } } }));
  assert.throws(() => applyCaptureService(managerPlan), /identity\/enablement changed/); assert.deepEqual(f.operations(), []);
});

test("a dangling ancestor link cannot acquire an unrelated target after preflight", t => {
  const f = fixture(t), directory = dirname(f.definition.files[0].path), external = join(f.base, "external-directory");
  fs.mkdirSync(dirname(directory), { recursive: true }); fs.symlinkSync(external, directory);
  const plan = f.preflight(); fs.mkdirSync(external);
  assert.throws(() => applyCaptureService(plan), /parent changed since preflight/);
  assert.deepEqual(fs.readdirSync(external), []); assert.deepEqual(f.operations(), []);
  assert.equal(fs.readlinkSync(directory), external); assert.equal(fs.existsSync(f.root), false);
});

test("manager failure leaves partial apply visible and retry restores scheduling without invented pass results", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), operation = platform === "linux" ? "enable" : "bootstrap";
    if (platform === "darwin") write(f.state, JSON.stringify({ mac: { registered: false, disabled: false } }));
    write(f.config, JSON.stringify({ fail: operation })); const before = fs.readFileSync(f.settings);
    const failed = f.cli(); assert.equal(failed.status, 1); assert.match(failed.stderr, /fixture manager refusal.*re-run setup/);
    assert.doesNotMatch(failed.stdout, /periodic capture scheduled|running first capture pass/);
    assert.deepEqual(fs.readFileSync(f.settings), before); assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
    assert.ok(fs.existsSync(f.definition.files[0].path), "completed file writes remain, no false atomic rollback claim");
    fs.unlinkSync(f.config);
    // A now-installed disabled timer is ambiguous with operator intent. The
    // explicit replacement choice is required, not guessed from prior failure.
    const recovered = f.cli(platform === "linux" ? ["--replace-service"] : []); assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /periodic capture scheduled/); assert.equal(readCaptureStatus(f.root).lastRun.trigger, "setup");
  }
});

test("successful manager command without verified activation cannot claim scheduling", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform);
    if (platform === "darwin") write(f.state, JSON.stringify({ mac: { registered: false, disabled: false } }));
    const plan = f.preflight(), run = plan.run;
    plan.run = (command, args) => args.includes(platform === "linux" ? "enable" : "bootstrap")
      ? { status: 0, signal: null, stdout: "", stderr: "" } : run(command, args);
    assert.throws(() => applyCaptureService(plan), /verification failed/);
    assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled/);
  }
});

test("no-service bypasses even unreadable targets and managers; dry-run reads only, and explicit root reaches hooks/pass", t => {
  const f = fixture(t); fs.mkdirSync(f.definition.files[0].path, { recursive: true });
  write(f.config, JSON.stringify({ fail: "show", missing: true }));
  const skipped = f.cli(["--no-service"]); assert.equal(skipped.status, 0, skipped.stderr); assert.equal(fs.existsSync(f.calls), false);
  const settings = JSON.parse(fs.readFileSync(f.settings));
  const command = settings.hooks.Stop[0].hooks[0].command; assert.ok(command.endsWith(`--root ${serviceShellWord(f.root)}`));
  assert.equal(readCaptureStatus(f.root).lastRun.trigger, "setup"); assert.equal(fs.statSync(f.definition.files[0].path).isDirectory(), true);
  const dry = fixture(t, "darwin"), bytes = fs.readFileSync(dry.settings); const result = dry.cli(["--dry-run"]);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /manager registration\/disabled state unexamined/);
  assert.equal(fs.existsSync(dry.calls), false); assert.equal(fs.existsSync(dry.root), false);
  assert.deepEqual(fs.readFileSync(dry.settings), bytes); assert.equal(fs.existsSync(dry.definition.files[0].path), false);
});
