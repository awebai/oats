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
  const options = { platform, node: process.execPath, request, setupCommand: "turn-record setup", uid: 501, run: runManager, log: line => logs.push(line) };
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
    // Recoveries are the command a person runs: `oats setup` when the kernel
    // handed a node in, else `turn-record setup`; never this node and setup.mjs.
    const recovery = `--owner fixture-owner --root ${serviceShellWord(f.root)}`;
    assert.ok(refused.stderr.includes(`oats setup ${recovery} --replace-service`), refused.stderr);
    assert.ok(refused.stderr.includes(`oats setup ${recovery} --no-service`)); assert.doesNotMatch(refused.stderr, /setup\.mjs/);
    const standalone = f.cli(["--no-hooks"], { OATS_NODE_BIN: undefined }); assert.equal(standalone.status, 1, standalone.stdout);
    assert.ok(standalone.stderr.includes(`turn-record setup ${recovery} --no-hooks --replace-service`), standalone.stderr);
    assert.ok(standalone.stderr.includes(`turn-record setup ${recovery} --no-hooks --no-service`));
    assert.doesNotMatch(standalone.stderr, /setup\.mjs|oats setup/); assert.deepEqual(f.operations(), []);
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
      assert.deepEqual(operations, [`systemctl --user stop ${service}`, `systemctl --user disable ${service}`,
        "systemctl --user daemon-reload", `systemctl --user enable --now ${timer}`]);
      assert.equal(JSON.parse(fs.readFileSync(f.state)).units[service].ActiveState, "inactive", "no old watcher survives");
    } else {
      assert.match(operations[0], /bootout/); assert.match(operations[1], /bootstrap/);
      assert.deepEqual(operations, ["launchctl bootout gui/501/ai.aweb.turn-record-capture", `launchctl bootstrap gui/501 ${target}`]);
    }
    const backups = fs.readdirSync(join(f.root, "service-backups")); assert.equal(backups.length, 1);
    const backup = join(f.root, "service-backups", backups[0], platform === "linux" ? service : "ai.aweb.turn-record-capture.plist");
    assert.equal(fs.readFileSync(backup, "utf8"), old); assert.ok(f.logs.some(line => line.includes(backups[0])));
    const previous = fs.readFileSync(target), mark = f.operations().length, changed = f.preflight({ node: "/new install/bin/node" }); applyCaptureService(changed);
    assert.equal(fs.readdirSync(join(f.root, "service-backups")).length, 2); assert.equal(fs.readFileSync(backup, "utf8"), old);
    assert.notDeepEqual(fs.readFileSync(target), previous); assert.doesNotMatch(fs.readFileSync(target, "utf8"), /--watch|KeepAlive|Restart=always/);
    // A changed periodic definition takes effect: stop, write, reload, start.
    assert.deepEqual(f.operations().slice(mark), platform === "linux"
      ? [`systemctl --user stop ${timer}`, `systemctl --user stop ${service}`, "systemctl --user daemon-reload", `systemctl --user enable --now ${timer}`]
      : ["launchctl bootout gui/501/ai.aweb.turn-record-capture", `launchctl bootstrap gui/501 ${target}`]);
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

test("a missing ancestor replaced by a link after preflight refuses before any apply mutation", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), ancestor = join(f.home, platform === "linux" ? ".config" : "Library");
    const external = join(f.base, "unrelated"); fs.mkdirSync(external);
    const plan = f.preflight();
    write(f.state, JSON.stringify(platform === "linux"
      ? { units: { [service]: plan.state.service, [timer]: plan.state.timer } } : { mac: plan.state }));
    const status = join(f.root, "capture-status.json"); write(status, "prior status bytes");
    const state = fs.readFileSync(f.state), hooks = fs.readFileSync(f.settings), calls = fs.readFileSync(f.calls);
    fs.symlinkSync(external, ancestor);
    assert.throws(() => applyCaptureService(plan), /parent changed since preflight/);
    assert.deepEqual(fs.readdirSync(external), []);
    for (const file of f.definition.files) assert.equal(fs.existsSync(file.path), false);
    assert.deepEqual(fs.readFileSync(f.settings), hooks); assert.deepEqual(fs.readFileSync(f.state), state);
    assert.deepEqual(fs.readFileSync(f.calls), calls, "refusal precedes even apply manager inspection");
    assert.equal(fs.readFileSync(status, "utf8"), "prior status bytes"); assert.deepEqual(f.operations(), []);
    assert.deepEqual(f.logs, []); assert.equal(fs.existsSync(join(f.root, "service-backups")), false);
  }
});

test("a missing ancestor linked after stopping an old registration prevents redirected writes and retains partial-apply evidence", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), ancestor = join(f.home, platform === "linux" ? ".config" : "Library");
    const external = join(f.base, "unrelated"); fs.mkdirSync(external);
    // The registered job can outlive its removed file. Stopping it is a
    // completed apply step, not something a later identity refusal rolls back.
    const absent = f.preflight();
    write(f.state, JSON.stringify(platform === "linux" ? { units: {
      [service]: { ...absent.state.service, LoadState: "loaded", UnitFileState: "static",
        ActiveState: "active", FragmentPath: f.definition.files[0].path },
      [timer]: absent.state.timer,
    } } : { mac: { registered: true, disabled: false, active: true, path: f.definition.files[0].path,
      argv: ["/old/node", "/old/package/bin/capture.mjs", "--watch", "--owner", "old-owner"], interval: null } }));
    const plan = f.preflight(), run = plan.run, hooks = fs.readFileSync(f.settings);
    const status = join(f.root, "capture-status.json"); write(status, "prior status bytes");
    plan.run = (command, args) => {
      const result = run(command, args);
      if (args.includes(platform === "linux" ? "stop" : "bootout")) fs.symlinkSync(external, ancestor);
      return result;
    };
    assert.throws(() => applyCaptureService(plan), /parent changed since preflight/);
    assert.deepEqual(fs.readdirSync(external), []);
    for (const file of f.definition.files) assert.equal(fs.existsSync(file.path), false);
    assert.deepEqual(fs.readFileSync(f.settings), hooks); assert.equal(fs.readFileSync(status, "utf8"), "prior status bytes");
    const state = JSON.parse(fs.readFileSync(f.state));
    assert.equal(platform === "linux" ? state.units[service].ActiveState : state.mac.registered,
      platform === "linux" ? "inactive" : false);
    assert.equal(f.operations().length, 1); assert.match(f.logs.join("\n"), /manager action completed: .*(?:stop|bootout)/);
    assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled|rollback/);
  }
});

test("directory identities created for the first named file remain binding for the second write", t => {
  const f = fixture(t), directory = dirname(f.definition.files[0].path), external = join(f.base, "unrelated");
  fs.mkdirSync(external); const plan = f.preflight(), rename = fs.renameSync;
  const hooks = fs.readFileSync(f.settings);
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (to === f.definition.files[0].path) {
      rename(directory, directory + ".saved");
      fs.symlinkSync(external, directory);
    }
  };
  try { assert.throws(() => applyCaptureService(plan), /parent changed since preflight/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readdirSync(external), []);
  assert.equal(fs.readFileSync(join(directory + ".saved", service), "utf8"), f.definition.files[0].contents);
  assert.equal(fs.existsSync(f.definition.files[1].path), false); assert.deepEqual(fs.readFileSync(f.settings), hooks);
  assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false); assert.deepEqual(f.operations(), []);
  assert.ok(f.logs.includes(`service: definition written: ${f.definition.files[0].path}`));
  assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled|rollback/);
});

test("refusal after a temporary write does not clean up through replaced ancestry", t => {
  const f = fixture(t), target = f.definition.files[0].path, directory = dirname(target);
  const external = join(f.base, "unrelated"); fs.mkdirSync(external);
  const plan = f.preflight(), writeFile = fs.writeFileSync;
  let temporary;
  fs.writeFileSync = (path, ...args) => {
    writeFile(path, ...args);
    if (typeof path === "string" && path.startsWith(target + ".tmp-")) {
      temporary = path.slice(directory.length + 1);
      fs.renameSync(directory, directory + ".saved");
      writeFile(join(external, temporary), "unrelated temporary-name collision");
      fs.symlinkSync(external, directory);
    }
  };
  try { assert.throws(() => applyCaptureService(plan), /parent changed since preflight/); }
  finally { fs.writeFileSync = writeFile; }
  assert.ok(temporary); assert.equal(fs.readFileSync(join(external, temporary), "utf8"), "unrelated temporary-name collision");
  assert.equal(fs.readFileSync(join(directory + ".saved", temporary), "utf8"), f.definition.files[0].contents);
  assert.equal(fs.existsSync(target), false); assert.deepEqual(f.operations(), []);
  assert.doesNotMatch(f.logs.join("\n"), /periodic capture scheduled|rollback/);
});

test("manager failure leaves partial apply visible and retry restores scheduling without invented pass results", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), operation = platform === "linux" ? "enable" : "bootstrap";
    if (platform === "darwin") write(f.state, JSON.stringify({ mac: { registered: false, disabled: false } }));
    write(f.config, JSON.stringify({ fail: operation })); const before = fs.readFileSync(f.settings);
    const failed = f.cli(); assert.equal(failed.status, 1); assert.match(failed.stderr, /fixture manager refusal.*re-run setup/);
    assert.ok(failed.stderr.includes(`setup recovery: inspect the reported files/manager state, then retry oats setup --owner fixture-owner --root ${serviceShellWord(f.root)}; use --no-service`), failed.stderr);
    assert.doesNotMatch(failed.stdout, /periodic capture scheduled|running first capture pass/);
    assert.deepEqual(fs.readFileSync(f.settings), before); assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
    assert.ok(fs.existsSync(f.definition.files[0].path), "completed file writes remain, no false atomic rollback claim");
    fs.unlinkSync(f.config);
    if (platform === "linux") {
      // The plain rerun is refused on the timer state it observes, before any hook or pass.
      const plain = f.cli(); assert.equal(plain.status, 1, plain.stdout);
      assert.match(plain.stderr, /^setup failed: E_CAPTURE_SERVICE_DISABLED: named capture service is not enabled: observed turn-record-capture\.timer LoadState=loaded UnitFileState=disabled;/m);
      assert.doesNotMatch(plain.stderr, /explicitly disabled|masked|setup recovery/);
      assert.ok(plain.stderr.includes(`oats setup --owner fixture-owner --root ${serviceShellWord(f.root)} --replace-service`), plain.stderr);
      assert.doesNotMatch(plain.stdout, /periodic capture scheduled|running first capture pass/);
      assert.deepEqual(fs.readFileSync(f.settings), before); assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
    }
    // A now-installed disabled timer is ambiguous with operator intent. The
    // explicit replacement choice is required, not guessed from prior failure.
    const recovered = f.cli(platform === "linux" ? ["--replace-service"] : []); assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /periodic capture scheduled/); assert.equal(readCaptureStatus(f.root).lastRun.trigger, "setup");
  }
});

test("a second failing run is nonzero, names the failing action and claims neither scheduling nor a pass", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), action = platform === "linux"
      ? /systemctl --user enable --now turn-record-capture\.timer failed \(fixture manager refusal; exit 5\)/
      : /launchctl bootstrap gui\/\d+ .* failed \(fixture manager refusal; exit 5\)/;
    if (platform === "darwin") write(f.state, JSON.stringify({ mac: { registered: false, disabled: false } }));
    write(f.config, JSON.stringify({ fail: platform === "linux" ? "enable" : "bootstrap" })); const hooks = fs.readFileSync(f.settings);
    // Linux refuses a plain rerun over the disabled timer the first run left
    // (pinned above), so its second attempt is the explicit replacement.
    for (const args of [[], platform === "linux" ? ["--replace-service"] : []]) {
      const failed = f.cli(args); assert.equal(failed.status, 1, failed.stdout); assert.match(failed.stderr, action);
      assert.match(failed.stderr, /^setup recovery: .* retry oats setup --owner fixture-owner /m);
      assert.doesNotMatch(failed.stdout, /periodic capture scheduled|running first capture pass/);
      assert.deepEqual(fs.readFileSync(f.settings), hooks); assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false);
    }
    assert.match(f.operations().at(-1), platform === "linux" ? /enable --now turn-record-capture.timer/ : /bootstrap/);
  }
});

test("launchd print-disabled reads only its disabled-services block, in either value spelling", t => {
  for (const values of ["boolean", "state"]) for (const trailing of [false, true]) {
    const f = fixture(t, "darwin"); write(f.config, JSON.stringify({ printDisabled: { values, trailing } }));
    install(f); assert.match(f.logs.at(-1), /periodic capture scheduled/, `${values} ${trailing}`);
    const state = JSON.parse(fs.readFileSync(f.state)); state.mac.disabled = true; write(f.state, JSON.stringify(state));
    const before = f.operations().length;
    assert.throws(() => f.preflight(), /E_CAPTURE_SERVICE_DISABLED/); assert.equal(f.operations().length, before);
    applyCaptureService(f.preflight({ replace: true })); assert.match(f.logs.at(-1), /periodic capture scheduled/);
  }
  for (const listing of [{ entries: ['\t"other.label" => maybe'] }, { values: "state", entries: ["\tunquoted => disabled"] }, { block: false, trailing: true }]) {
    const f = fixture(t, "darwin"); write(f.config, JSON.stringify({ printDisabled: listing }));
    assert.throws(() => f.preflight({ replace: true }), /indeterminate launchctl disabled/, JSON.stringify(listing));
    assert.deepEqual(f.operations(), []); assert.equal(fs.existsSync(f.definition.files[0].path), false);
  }
});

test("a launchd disabled entry for an absent, unregistered label is refused before writing and cleared only by explicit replacement", t => {
  // The override DB outlives the plist; only an operator's disable writes it.
  const f = fixture(t, "darwin"), plist = f.definition.files[0].path;
  write(f.state, JSON.stringify({ mac: { registered: false, disabled: true } })); const hooks = fs.readFileSync(f.settings);
  const refused = f.cli(); assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /^setup failed: E_CAPTURE_SERVICE_DISABLED: named capture service is not enabled: observed launchctl print-disabled gui\/\d+ lists ai\.aweb\.turn-record-capture as disabled \(named plist absent, label not registered\);/m);
  assert.doesNotMatch(refused.stderr, /explicitly disabled/);
  assert.equal(fs.existsSync(plist), false); assert.deepEqual(fs.readFileSync(f.settings), hooks);
  assert.equal(fs.existsSync(f.root), false); assert.deepEqual(f.operations(), []);
  const replaced = f.cli(["--replace-service"]); assert.equal(replaced.status, 0, replaced.stderr);
  assert.deepEqual(f.operations().map(line => line.split(" ")[1]), ["enable", "bootstrap"]);
  assert.match(replaced.stdout, /periodic capture scheduled/);
});

test("a label registered from another plist is foreign even under explicit replacement, never booted out or removed", t => {
  for (const identical of [false, true]) {
    const f = fixture(t, "darwin"), other = join(f.home, "Library", "LaunchAgents", "operator-copy.plist");
    const argv = identical ? f.definition.argv : ["/old/node", "/old/package/bin/capture.mjs", "--watch", "--owner", "old-owner"];
    write(other, "operator plist bytes\n");
    write(f.state, JSON.stringify({ mac: { registered: true, disabled: false, active: true, path: other, argv, interval: identical ? 900 : null } }));
    const state = fs.readFileSync(f.state), hooks = fs.readFileSync(f.settings);
    assert.throws(() => f.preflight({ replace: true }), /E_CAPTURE_SERVICE_FOREIGN: launchd registration .* is loaded from/);
    const refused = f.cli(["--replace-service"]); assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /^setup failed: E_CAPTURE_SERVICE_FOREIGN: launchd registration ai\.aweb\.turn-record-capture is loaded from /m);
    assert.ok(refused.stderr.includes(JSON.stringify(other)), refused.stderr);
    assert.match(refused.stderr, /--replace-service replaces only the named capture plist.*--no-service/);
    assert.deepEqual(f.operations(), []); assert.equal(fs.readFileSync(other, "utf8"), "operator plist bytes\n");
    assert.deepEqual(fs.readFileSync(f.state), state); assert.equal(fs.existsSync(f.definition.files[0].path), false);
    assert.deepEqual(fs.readFileSync(f.settings), hooks); assert.equal(fs.existsSync(f.root), false);
  }
});

test("dry-run over installed unchanged definitions invokes no manager and writes nothing", t => {
  for (const platform of ["linux", "darwin"]) {
    const f = fixture(t, platform), installed = f.cli(); assert.equal(installed.status, 0, installed.stderr);
    fs.unlinkSync(f.calls); const status = join(f.root, "capture-status.json");
    const files = f.definition.files.map(file => fs.readFileSync(file.path));
    const settings = fs.readFileSync(f.settings), state = fs.readFileSync(f.state), receipt = fs.readFileSync(status);
    const dry = f.cli(["--dry-run"]); assert.equal(dry.status, 0, dry.stderr);
    assert.equal(fs.existsSync(f.calls), false, "no manager query or mutation");
    for (const file of f.definition.files) assert.ok(dry.stdout.includes(`service: would keep ${file.path}`), dry.stdout);
    assert.match(dry.stdout, /manager registration\/disabled state unexamined/); assert.match(dry.stdout, /dry run: no first capture pass/);
    assert.deepEqual(f.definition.files.map(file => fs.readFileSync(file.path)), files);
    assert.deepEqual(fs.readFileSync(f.settings), settings); assert.deepEqual(fs.readFileSync(f.state), state);
    assert.deepEqual(fs.readFileSync(status), receipt);
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
