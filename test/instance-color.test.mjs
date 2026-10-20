// Feature instance-color (awebai/oats#1421 §2): an instance's colour, presentation only, in a home file of its
// own (`.oats-color.json`, lib/instance-color.mjs), set and cleared by `oats instance color`, read on status rows,
// `inspect --home` and the remote roster.
//
// What is pinned here:
// - the kernel's palette is the clients' (packages/client/soul-colors.mjs SOUL_COLORS);
// - the record: its shape and mode, written only on a change; the reader takes a regular file of at most 4 KiB
//   that is a valid record, and anything else is null, never an error;
// - the file is kernel-owned: a capability cannot declare it, and it is no change to the home's stored digest;
// - the CLI: the answer, `changed`, --clear, the refusals with #1421's words, resolution as `instance stop`
//   answers it, E_INSTANCE_RETIRING beside a retire, the feature; status rows and inspect --home carry it.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { SOUL_COLORS } from "../packages/client/soul-colors.mjs";
import { COLOR_FILE, INSTANCE_COLORS, RECORD_MAX, paletteColor, readInstanceColor, writeInstanceColor } from "../lib/instance-color.mjs";
import { instanceColorRefusal } from "../lib/instance-lifecycle.mjs";
import { disposableHomeRootProblem } from "../lib/capability-contract.mjs";
import { KERNEL_HOME_RECEIPTS, retirePendingMarkerPath, storedTreeDigest } from "../lib/core.mjs";

function okResult(r, what) {
  assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
  const j = JSON.parse(r.stdout.trim());
  assert.equal(j.ok, true, `${what}: ${r.stdout}`);
  return j.result;
}
function refused(r, what) {
  assert.notEqual(r.status, 0, what);
  const j = JSON.parse(r.stdout.trim());
  assert.equal(j.ok, false, what);
  return j.error;
}
function home(t) {
  const base = fixtureBase("oats-instance-color-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "home");
  mkdirSync(dir);
  return dir;
}

test("the kernel's palette is the clients' SOUL_COLORS, in order", () => {
  assert.deepEqual([...INSTANCE_COLORS], [...SOUL_COLORS]);
  for (const c of INSTANCE_COLORS) assert.equal(paletteColor(c), c);
  for (const v of ["Sage", "sage ", "teal", "", null, undefined, 1, ["sage"]]) assert.equal(paletteColor(v), null, JSON.stringify(v));
});

test("writeInstanceColor: the record and its mode; the same colour again writes nothing; a clear removes it", (t) => {
  const h = home(t);
  const at = new Date("2026-10-20T15:00:00.000Z");
  assert.deepEqual(writeInstanceColor(h, "sage", { now: () => at }), { color: "sage", changed: true });
  const file = join(h, COLOR_FILE);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { colorApi: 1, color: "sage", at: "2026-10-20T15:00:00.000Z" });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const before = statSync(file).mtimeMs;
  assert.deepEqual(writeInstanceColor(h, "sage", { now: () => new Date("2027-01-01T00:00:00.000Z") }), { color: "sage", changed: false });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).at, "2026-10-20T15:00:00.000Z", "nothing was written");
  assert.equal(statSync(file).mtimeMs, before);
  assert.deepEqual(writeInstanceColor(h, "clay"), { color: "clay", changed: true });
  assert.equal(readInstanceColor(h), "clay");
  assert.deepEqual(writeInstanceColor(h, null), { color: null, changed: true });
  assert.throws(() => lstatSync(file), { code: "ENOENT" });
  assert.deepEqual(writeInstanceColor(h, null), { color: null, changed: false }, "clearing no colour is no change");
  // A file that is not a record shows no colour: clearing removes it, and that is no change of colour.
  writeFileSync(file, "not json");
  assert.deepEqual(writeInstanceColor(h, null), { color: null, changed: false });
  assert.throws(() => lstatSync(file), { code: "ENOENT" });
});

test("readInstanceColor: a valid record only; anything else is null, never an error", (t) => {
  const h = home(t);
  const file = join(h, COLOR_FILE);
  assert.equal(readInstanceColor(h), null, "no file");
  const put = (v) => { rmSync(file, { recursive: true, force: true }); writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v)); };
  put({ colorApi: 1, color: "olive", at: "x" });
  assert.equal(readInstanceColor(h), "olive");
  for (const bad of ["", "{", "null", "[]", "\"sage\"", { colorApi: 2, color: "sage" }, { color: "sage" }, { colorApi: 1, color: "teal" }, { colorApi: 1, color: "Sage" }, { colorApi: 1 }]) {
    put(bad);
    assert.equal(readInstanceColor(h), null, JSON.stringify(bad));
  }
  // Past 4 KiB: not a record, however it parses.
  put(JSON.stringify({ colorApi: 1, color: "sage", pad: "x".repeat(RECORD_MAX) }));
  assert.equal(readInstanceColor(h), null, "over RECORD_MAX");
  put(JSON.stringify({ colorApi: 1, color: "sage", pad: "x".repeat(RECORD_MAX - 60) }));
  assert.equal(readInstanceColor(h), "sage", "within RECORD_MAX");
  // A link is never followed, a directory is not a file, an unreadable file is none.
  rmSync(file);
  const target = join(dirname(h), "elsewhere.json");
  writeFileSync(target, JSON.stringify({ colorApi: 1, color: "sage" }));
  symlinkSync(target, file);
  assert.equal(readInstanceColor(h), null, "a symlink");
  rmSync(file);
  mkdirSync(file);
  assert.equal(readInstanceColor(h), null, "a directory");
  rmSync(file, { recursive: true });
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    put({ colorApi: 1, color: "sage" });
    chmodSync(file, 0o000);
    assert.equal(readInstanceColor(h), null, "unreadable");
    chmodSync(file, 0o600);
  }
});

test("the colour file is kernel-owned: a capability cannot declare it, and it is no change to the home's stored digest", (t) => {
  assert.ok(KERNEL_HOME_RECEIPTS.has(COLOR_FILE));
  for (const root of [COLOR_FILE, ".oats-color", ".oats-color.json.tmp-1"]) assert.equal(disposableHomeRootProblem(root), "kernel-owned", root);
  const h = home(t);
  writeFileSync(join(h, "AGENTS.md"), "# x\n");
  const digest = () => storedTreeDigest(h, 2, { instanceHome: true });
  const before = digest();
  writeInstanceColor(h, "mauve");
  assert.equal(digest(), before, "setting a colour does not change the home");
  writeInstanceColor(h, null);
  assert.equal(digest(), before);
});

test("oats instance color: set, the same again, clear; status rows and inspect --home carry it; the feature", (t) => {
  const fx = v2Deployment({ t });
  const spawned = okResult(fx.cli(["spawn", "dev", "--purpose", "c", "--no-launch", "--json"]), "spawn");
  const name = spawned.instance;
  // status --json answers its document bare, not in an envelope.
  const statusColor = () => {
    const r = fx.cli(["status", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).agents.flatMap((a) => a.instances).find((i) => i.instance === name).color;
  };
  const inspectColor = () => okResult(fx.cli(["inspect", "--home", spawned.home, "--json"]), "inspect").instance.color;
  assert.equal(statusColor(), null, "no colour yet");
  assert.equal(inspectColor(), null);

  assert.deepEqual(okResult(fx.cli(["instance", "color", name, "sage", "--json"]), "set"), { instanceColorApi: 1, instance: name, home: spawned.home, color: "sage", changed: true });
  assert.deepEqual(okResult(fx.cli(["instance", "color", name, "sage", "--json"]), "again"), { instanceColorApi: 1, instance: name, home: spawned.home, color: "sage", changed: false });
  assert.equal(statusColor(), "sage");
  assert.equal(inspectColor(), "sage");
  assert.equal(okResult(fx.cli(["instance", "color", name, "olive", "--home", spawned.home, "--json"]), "by --home").color, "olive");
  assert.deepEqual(okResult(fx.cli(["instance", "color", name, "--clear", "--json"]), "clear"), { instanceColorApi: 1, instance: name, home: spawned.home, color: null, changed: true });
  assert.equal(statusColor(), null);
  assert.equal(inspectColor(), null);

  // A colour recorded in instance.json is not the colour: only the home's own record is.
  const metaFile = join(spawned.home, "instance.json");
  writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(readFileSync(metaFile, "utf8")), color: "clay" }, null, 2));
  assert.equal(statusColor(), null);

  const r = fx.cli(["instance", "color", name, "slate"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `${name}: colour slate`);
  assert.ok(JSON.parse(fx.cli(["version", "--json"]).stdout).features.includes("instance-color"));
});

test("oats instance color refuses with #1421's words, resolves as instance stop does, and refuses a home being retired", (t) => {
  const fx = v2Deployment({ t });
  const spawned = okResult(fx.cli(["spawn", "dev", "--purpose", "r", "--no-launch", "--json"]), "spawn");
  const name = spawned.instance;
  const bad = refused(fx.cli(["instance", "color", name, "teal", "--json"]), "teal");
  assert.equal(bad.code, "E_BAD_ARGS");
  assert.equal(bad.message, "\"teal\" is not an instance colour: use one of sand, sage, slate, mauve, clay, olive, or --clear");
  assert.equal(instanceColorRefusal("teal"), bad.message);
  for (const [argv, what] of [[[name, "sage", "--clear"], "both"], [[name], "neither"], [[name, "sage", "olive"], "two colours"]]) {
    assert.equal(refused(fx.cli(["instance", "color", ...argv, "--json"]), what).code, "E_BAD_ARGS", what);
  }
  // Resolution: what `oats instance stop` answers.
  const stopCode = (argv) => refused(fx.cli(["instance", "stop", ...argv, "--plan", "--json"]), `stop ${argv}`).code;
  const colorCode = (argv) => refused(fx.cli(["instance", "color", ...argv, "sage", "--json"]), `color ${argv}`).code;
  for (const argv of [["nobody"], [name, "--home", join(dirname(spawned.home), "elsewhere")], [name, "--home", "relative/home"]]) {
    assert.equal(colorCode(argv), stopCode(argv), JSON.stringify(argv));
  }
  assert.equal(colorCode(["nobody"]), "E_SESSION_UNKNOWN");
  // A retire in flight: its pending marker beside the home.
  const marker = retirePendingMarkerPath(spawned.home);
  writeFileSync(marker, JSON.stringify({ reason: "retire pending" }));
  const retiring = refused(fx.cli(["instance", "color", name, "sage", "--json"]), "retiring");
  assert.equal(retiring.code, "E_INSTANCE_RETIRING");
  assert.match(retiring.message, /is being retired; the colour was not changed$/);
  assert.equal(readInstanceColor(spawned.home), null, "nothing was written");
  rmSync(marker);
  assert.equal(okResult(fx.cli(["instance", "color", name, "sage", "--json"]), "after").color, "sage");
});
