// Doctor owns transport/presentation only; package fixtures own diagnosis.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { doctorCaptureWarnings } from "../lib/doctor-capture.mjs";
import { captureHealthForDoctor } from "../packages/record/lib/capture-health.mjs";
import { validCaptureHealthEnvelope } from "../packages/record/lib/capture-status.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const healthy = () => ({ schemaVersion: 1, status: "ok", rows: [], lastRun: null, lastSuccess: null,
  lastFailure: null, backlog: { pending: false, setAsideCount: 0, setAside: [], truncated: false,
    failedCount: 0, failed: [], failedTruncated: false } });
const response = value => ({ status: 0, signal: null, stdout: JSON.stringify(value), stderr: "" });
const codes = rows => rows.map(row => row.code);
function disk(path) {
  if (!existsSync(path)) return null;
  const st = lstatSync(path);
  if (!st.isDirectory()) return { bytes: readFileSync(path).toString("base64"), mtime: st.mtimeMs };
  return Object.fromEntries(readdirSync(path).sort().map(name => [name, disk(join(path, name))]));
}
function fixture(t) {
  const fx = v2Deployment(); t.after(() => fx.cleanup());
  const root = join(fx.base, "turn-record 'literal root'"), calls = join(fx.base, "health-calls");
  const preload = join(fx.base, "observe-health.mjs");
  writeFileSync(preload, `
import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
cp.spawnSync = function(executable, args, options) {
  if (args?.some(arg => typeof arg === 'string' && arg.endsWith('/capture-health-doctor.mjs'))) {
    appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ executable, args, options }) + '\\n');
    if (process.env.FIXTURE_BAD_HEALTH) return { status: 0, signal: null, stdout: '{}', stderr: '' };
  }
  return original.call(this, executable, args, options);
};
syncBuiltinESMExports();
`);
  const cli = (args = [], extra = {}) => {
    writeFileSync(calls, "");
    const result = fx.cli(["doctor", ...args], { env: { TURN_RECORD_ROOT: root,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, ...extra } });
    assert.equal(result.error, undefined);
    const launches = readFileSync(calls, "utf8").split("\n").filter(Boolean).map(JSON.parse);
    return { ...result, launches };
  };
  return { fx, root, cli };
}

test("doctor shows setup's pending-activation row from the package reader without touching the marker", t => {
  const f = fixture(t); mkdirSync(f.root); writeFileSync(join(f.root, "capture-service-pending.json"), '{"platform":"fixture"}\n');
  const before = disk(f.root), result = f.cli(["--json"]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.launches.length, 1);
  const row = JSON.parse(result.stdout).warnings.find(warning => warning.code === "capture-service-pending");
  // No capture definition exists under the fixture home, so the marker is stale.
  assert.match(row.message, /^The pending-activation marker .*capture-service-pending\.json is stale: .* Run oats setup --root /);
  assert.deepEqual(disk(f.root), before);
});

test("doctor delegates once with caller root/home and maps only package warning rows without mutation", t => {
  const f = fixture(t);
  const absent = f.cli(["--json"]);
  assert.equal(absent.status, 0, absent.stderr); assert.equal(absent.launches.length, 1);
  assert.deepEqual(JSON.parse(absent.stdout).warnings.filter(row => row.code.startsWith("capture-")), []);
  assert.equal(existsSync(f.root), false); assert.equal(existsSync(join(f.fx.env.HOME, ".turn-record")), false);
  mkdirSync(f.root); writeFileSync(join(f.root, "sentinel"), "unchanged");
  const before = disk(f.root), expected = captureHealthForDoctor(f.root, { home: f.fx.env.HOME }).rows;
  for (const args of [["--json"], []]) {
    const result = f.cli(args);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.launches.length, 1);
    const launch = result.launches[0];
    assert.equal(launch.executable, process.execPath);
    assert.equal(launch.options.env.HOME, f.fx.env.HOME);
    assert.equal(launch.options.env.TURN_RECORD_ROOT, f.root);
    assert.equal(launch.options.cwd, f.fx.dep);
    assert.equal(launch.options.env.NODE_OPTIONS, undefined);
    assert.equal(launch.options.env.TMUX, undefined);
    assert.equal(launch.options.timeout, 20000); assert.equal(launch.options.maxBuffer, 1024 * 1024);
    assert.equal(launch.options.killSignal, "SIGKILL");
    if (args.length) {
      const value = JSON.parse(result.stdout);
      assert.equal(value.schemaVersion, 1); assert.equal(value.workspaceApi, 2);
      assert.deepEqual(value.warnings.filter(row => row.code.startsWith("capture-")), expected);
      assert.equal(Object.hasOwn(value, "captureHealth"), false, "no extra doctor envelope/schema");
    } else for (const row of expected) assert.ok(result.stdout.includes(`warning  ${row.code}  ${row.message}`));
    assert.deepEqual(disk(f.root), before);
  }
});

test("doctor preserves relative and default root selection and command failure differs from diagnosis", t => {
  const f = fixture(t), relative = "relative turn-record";
  mkdirSync(join(f.fx.dep, relative));
  const selected = f.cli(["--json"], { TURN_RECORD_ROOT: relative });
  assert.equal(selected.status, 0);
  assert.deepEqual(codes(JSON.parse(selected.stdout).warnings.filter(row => row.code.startsWith("capture-"))),
    ["capture-status-missing", "capture-success-stale"]);
  assert.ok(JSON.parse(selected.stdout).warnings.some(row => row.message.includes(`${relative}/capture-status.json`)));
  assert.equal(existsSync(f.root), false);
  mkdirSync(join(f.fx.env.HOME, ".turn-record"));
  const defaults = f.cli(["--json"], { TURN_RECORD_ROOT: undefined });
  assert.equal(defaults.status, 0);
  assert.ok(JSON.parse(defaults.stdout).warnings.some(row => row.message.includes(join(f.fx.env.HOME, ".turn-record", "capture-status.json"))));
  mkdirSync(join(f.fx.env.HOME, ".claude")); writeFileSync(join(f.fx.env.HOME, ".claude", "settings.json"), "{");
  const before = disk(f.fx.env.HOME);
  for (const extra of [{}, { FIXTURE_BAD_HEALTH: "1" }]) {
    const result = f.cli(["--json"], extra);
    assert.equal(result.status, 0, "doctor retains its warning exit contract on reader/invalid-response failure");
    assert.equal(result.launches.length, 1);
    const rows = JSON.parse(result.stdout).warnings.filter(row => row.code.startsWith("capture-"));
    assert.deepEqual(codes(rows), ["capture-health-unavailable"]);
    assert.match(rows[0].message, /oats capture --health --json/);
    assert.equal(existsSync(f.root), false); assert.deepEqual(disk(f.fx.env.HOME), before);
  }
});

test("doctor --soul stays composition-only in JSON and text, even with an unavailable health reader", t => {
  const f = fixture(t);
  const synced = f.fx.cli(["sync"]); assert.equal(synced.status, 0, synced.stderr);
  for (const args of [["--soul", "dev", "--json"], ["--soul", "dev"]]) {
    const result = f.cli(args, { FIXTURE_BAD_HEALTH: "1" });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.launches, []);
    if (args.includes("--json")) {
      const value = JSON.parse(result.stdout);
      assert.equal(typeof value.composedInstructions, "string");
      assert.equal(value.warnings.some(row => row.code.startsWith("capture-")), false);
    } else { assert.match(result.stdout, /Final composed AGENTS.md for dev/); assert.doesNotMatch(result.stdout, /capture-health-unavailable/); }
    assert.equal(existsSync(f.root), false);
  }
});

test("transport rejects failures, output overflow and invalid envelopes rather than inventing diagnosis", () => {
  const warning = { ...healthy(), status: "warning", rows: [{ code: "capture-success-stale", message: "package owns the remedy" }] };
  const cases = [undefined, { ...response(warning), status: 1 }, { ...response(warning), signal: "SIGKILL" },
    { ...response(warning), error: { code: "ETIMEDOUT" } }, { ...response(warning), error: { code: "ENOBUFS" } },
    { status: 0, signal: null, stdout: "not JSON", stderr: "PRIVATE-STDERR" },
    ...[{}, null, [], { ...healthy(), schemaVersion: 2 }, { ...healthy(), extra: 1 },
      { ...healthy(), status: "warning" }, { ...warning, rows: [{ code: "capture-stale", message: 1 }] },
      { ...warning, rows: [{ code: "capture-stale", message: "ok", extra: true }] },
      { ...healthy(), lastRun: {} }, { ...healthy(), lastSuccess: {} }, { ...healthy(), lastFailure: {} },
      { ...healthy(), backlog: { ...healthy().backlog, setAsideCount: 1 } }].map(response),
    { ...response(healthy()), stdout: " ".repeat(1024 * 1024) + "{}" },
    { ...response(healthy()), stderr: "x".repeat(1024 * 1024) }];
  for (const answer of cases) {
    let calls = 0;
    const rows = doctorCaptureWarnings({ run: () => { calls++; return answer; } });
    assert.equal(calls, 1); assert.deepEqual(codes(rows), ["capture-health-unavailable"]);
    assert.doesNotMatch(rows[0].message, /PRIVATE-STDERR|package owns/);
  }
  assert.deepEqual(codes(doctorCaptureWarnings({ run: () => { throw new Error("PRIVATE-TRANSPORT"); } })), ["capture-health-unavailable"]);
  assert.deepEqual(doctorCaptureWarnings({ run: () => response(warning) }), warning.rows);
  assert.deepEqual(doctorCaptureWarnings({ run: () => response(healthy()) }), []);
  const legacy = healthy(); for (const key of ["failedCount", "failed", "failedTruncated"]) delete legacy.backlog[key];
  assert.equal(validCaptureHealthEnvelope(legacy), true, "nullable old receipts/backlog remain readable");
});

test("fixed transport bounds actually terminate and reap a silent child and excessive pipe output", { timeout: 35000 }, t => {
  const f = fixture(t);
  for (const script of ["setInterval(() => {}, 1000)", "process.stdout.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000)",
    "process.stderr.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000)"]) {
    let calls = 0, actual;
    const rows = doctorCaptureWarnings({ cwd: f.fx.base, env: { ...f.fx.env, TURN_RECORD_ROOT: f.root, NODE_OPTIONS: "--not-an-option", TMUX: "forbidden" },
      run: (executable, args, options) => {
        calls++; assert.equal(executable, process.execPath); assert.ok(args.at(-1).endsWith("/capture-health-doctor.mjs"));
        assert.deepEqual(args.slice(0, -1), process.execArgv.filter(arg => arg === "--experimental-sqlite"));
        assert.equal(options.env.NODE_OPTIONS, undefined); assert.equal(options.env.TMUX, undefined);
        assert.equal(options.timeout, 20000); assert.equal(options.maxBuffer, 1024 * 1024);
        // Fixture replaces only this child's program. The actual production
        // timeout, output cap and SIGKILL options are exercised unchanged. The
        // child has no descendants; spawnSync waits for its terminal receipt.
        actual = spawnSync(executable, ["-e", script], options); return actual;
      } });
    assert.equal(calls, 1); assert.deepEqual(codes(rows), ["capture-health-unavailable"]);
    assert.ok(actual.error); assert.equal(actual.signal, "SIGKILL");
    assert.equal(actual.error.code, script.startsWith("setInterval") ? "ETIMEDOUT" : "ENOBUFS");
    assert.equal(existsSync(f.root), false);
  }
});
