// awebai/oats#780: on a case-insensitive filesystem (APFS, the macOS default) one home has as
// many spellings as its path has letters: `.../deployment/...` and `.../DEPLOYMENT/...` are the
// same directory. The session receipt is keyed by the home's path, so every spelling must find
// the one receipt: a spawn keys it by the on-disk (canonical) spelling, and a reader finds it
// from any spelling. A receipt an earlier kernel wrote under the spawn's own spelling is still
// found where it is, from that spelling; a third spelling of such a home misses it (the
// documented limit: address the home as `oats status` prints it).
//
// The deployment is realpath'd, so its on-disk spelling is the fixture's own: `deployment`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { inspectInstanceSession, retirementRecoveryFacts, startInstanceSession } from "../lib/core.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-receipt-case-")));
const session = "t";
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket();
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const fx = v2Deployment();
test.after(() => { try { tmux("kill-server"); } catch { /* gone */ } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); fx.cleanup(); } });

/** Whether this filesystem folds letter case: `Probe` created, `probe` found. */
const caseInsensitive = (() => {
  const probe = join(fx.base, "Probe");
  mkdirSync(probe);
  try { return existsSync(join(fx.base, "probe")); } finally { rmSync(probe, { recursive: true, force: true }); }
})();
const FOLDS = caseInsensitive ? {} : { skip: "filesystem is case-sensitive: two spellings are two directories" };
const EXACT = caseInsensitive ? { skip: "filesystem is case-insensitive: two spellings are one directory" } : {};

// The canonical spelling and two others of the same path.
const deploymentAs = (spelling) => (p) => p.replace(`${fx.base}/deployment/`, `${fx.base}/${spelling}/`).replace(new RegExp(`^${fx.base}/deployment$`), `${fx.base}/${spelling}`);
const upper = deploymentAs("DEPLOYMENT");
const title = deploymentAs("Deployment");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const baselines = (home) => join(dirname(home), ".oats-retirement", "baselines");
/** Where a home's receipt sits when it is keyed by this spelling of the home. */
const receiptAt = (spelling) => join(baselines(spelling), `${createHash("sha256").update(spelling).digest("hex")}.json`);
const receiptFiles = (home) => readdirSync(baselines(home)).sort();
const missingNaming = (...paths) => (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN" && /^no session receipt for /.test(e.message) && paths.every((p) => e.message.includes(p));

/** A spawned home (no launch). Spawned through the canonical spelling, as fx.spawn does. */
async function spawnHome(name) {
  const path = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  try { return (await fx.spawn("dev", { name, harness: "claude" })).home; } finally { process.env.PATH = path; }
}

/** Move a home's receipt to where a kernel before #780 put it when the spawn used `spelling`:
 *  keyed by that spelling, with that spelling as its `home`. */
function asLegacyReceipt(home, spelling) {
  assert.notEqual(spelling, home, "the legacy spelling differs from the canonical one");
  const receipt = readJson(receiptAt(home));
  writeFileSync(receiptAt(spelling), JSON.stringify({ ...receipt, home: spelling }, null, 2) + "\n", { mode: 0o600 });
  rmSync(receiptAt(home));
}

test("#780 T1: a home spawned through its canonical spelling is found through another spelling", FOLDS, async () => {
  const home = await spawnHome("t1");
  assert.equal(readJson(receiptAt(home)).home, home, "the receipt records the canonical spelling");
  assert.equal(inspectInstanceSession(home).state, "not-launched");
  const other = inspectInstanceSession(upper(home));
  assert.equal(other.state, "not-launched", "the receipt is found through an upper-cased ancestor");
  assert.equal(other.present, false);
});

test("#780: a spawn through a non-canonical spelling keys its receipt by the canonical one and records it", FOLDS, () => {
  const r = fx.cli(["spawn", "dev", "--name", "t1b", "--no-launch", "--dir", upper(fx.dep), "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const home = join(fx.root, "dev", "instances", "t1b");
  assert.deepEqual(receiptFiles(home).filter((f) => f === basename(receiptAt(home))), [basename(receiptAt(home))], "the receipt sits at the canonical key");
  assert.equal(existsSync(receiptAt(upper(home))), false, "and at no key of the spawn's own spelling");
  assert.equal(readJson(receiptAt(home)).home, home, "its home is the canonical spelling");
  for (const spelling of [home, upper(home), title(home)]) assert.equal(inspectInstanceSession(spelling).state, "not-launched", spelling);
});

test("#780 T2: a receipt an earlier kernel wrote under the spawn's spelling is found from that spelling, where it is; another spelling misses it, naming both paths it looked at", FOLDS, async () => {
  const home = await spawnHome("t2");
  const legacy = upper(home);
  asLegacyReceipt(home, legacy);
  const before = receiptFiles(home);
  assert.equal(inspectInstanceSession(legacy).state, "not-launched", "the spawn's own spelling finds its receipt");
  // The documented limit: a spelling that is neither the receipt's nor the canonical one misses it.
  // The canonical spelling's legacy key is its canonical key, so it names one path; a third spelling names both.
  assert.throws(() => inspectInstanceSession(home), missingNaming(receiptAt(home)));
  assert.throws(() => inspectInstanceSession(title(home)), missingNaming(receiptAt(home), receiptAt(title(home))));
  assert.deepEqual(receiptFiles(home), before, "reading neither moved, copied nor wrote a receipt");
  assert.equal(readJson(receiptAt(legacy)).home, legacy, "the legacy receipt is untouched");
});

test("#780: a current canonical receipt wins over an earlier incarnation's receipt left at a legacy spelling, from either spelling", FOLDS, async () => {
  const home = await spawnHome("t4");
  const stale = upper(home);
  // What an earlier incarnation of the same name, spawned under `stale` before #780, left behind:
  // retire keeps receipts. It recorded a launch this home's instance.json does not.
  writeFileSync(receiptAt(stale), JSON.stringify({ ...readJson(receiptAt(home)), home: stale, runtime: { launched: true, tmux: { session: "old", window: "t4", socket } } }, null, 2) + "\n", { mode: 0o600 });
  for (const spelling of [home, stale, title(home)]) assert.equal(inspectInstanceSession(spelling).state, "not-launched", `${spelling} reads the current receipt`);
});

/** Declare a disposable home entry in the home's receipt: retire honours it only from a receipt that records this home. */
function declareDisposable(home) {
  const receipt = readJson(receiptAt(home));
  writeFileSync(receiptAt(home), JSON.stringify({ ...receipt, disposableHome: [{ owner: "acme.ident", root: ".ident" }] }, null, 2) + "\n", { mode: 0o600 });
}

test("#780: retire honours a receipt read through another spelling of the home", FOLDS, async () => {
  const home = await spawnHome("t7");
  declareDisposable(home);
  for (const spelling of [home, upper(home)]) assert.deepEqual(retirementRecoveryFacts(spelling).disposableHome, [{ owner: "acme.ident", root: ".ident" }], spelling);
});

test("#780: a home exchanged for a symlink is not the home its receipt records, whatever the filesystem", async () => {
  const home = await spawnHome("t8");
  declareDisposable(home);
  assert.equal(retirementRecoveryFacts(home).disposableHome.length, 1, "fixture premise: the receipt is honoured for the home itself");
  renameSync(home, `${home}-moved`);
  symlinkSync(`${home}-moved`, home);
  assert.deepEqual(retirementRecoveryFacts(home).disposableHome, [], "the symlink's receipt is read, and it records another home");
});

/** A spawned home with a recorded command whose harness is a held fixture process. */
async function startableHome(name) {
  const home = await spawnHome(name);
  const harness = join(base, "fakeharness");
  if (!existsSync(harness)) {
    writeFileSync(harness, `#!/usr/bin/env node
const { existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(join(home, "harness-ready"), String(process.pid));
setInterval(() => { if (existsSync(join(home, "release-" + process.pid))) process.exit(0); }, 25);
`);
    chmodSync(harness, 0o755);
  }
  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} ${shq(harness)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  writeFileSync(join(home, "TASK.md"), "task\n");
  const { launch: _recipe, ...meta } = readJson(join(home, "instance.json"));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...meta, tmux: { session, window: name, socket }, command, launched: false }, null, 2) + "\n");
  try { tmux("has-session", "-t", `=${session}`); } catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", base); }
  return home;
}
const harnessReady = (home) => waitUntil(() => { try { process.kill(Number(readFileSync(join(home, "harness-ready"), "utf8")), 0); return true; } catch { return false; } }, `${basename(home)} fixture harness ready`);
const releaseHarness = (home) => writeFileSync(join(home, `release-${readFileSync(join(home, "harness-ready"), "utf8")}`), "");

test("#780 T3: a start records the launch in the receipt it found: a legacy receipt stays where it is, and no second receipt appears", FOLDS, async () => {
  const home = await startableHome("t3");
  const legacy = upper(home);
  asLegacyReceipt(home, legacy);
  const before = receiptFiles(home);
  const r = startInstanceSession(legacy);
  assert.equal(r.reused, "new");
  assert.deepEqual(r.target, { backend: "tmux", session, window: "t3", socket: resolve(socket) });
  assert.deepEqual(readJson(receiptAt(legacy)).runtime, { launched: true, tmux: { session, window: "t3", socket: resolve(socket) } }, "the legacy receipt records the launch");
  assert.equal(readJson(receiptAt(legacy)).home, legacy, "and keeps its own home");
  assert.equal(existsSync(receiptAt(home)), false, "no canonical receipt was created");
  assert.deepEqual(receiptFiles(home), before);
  await harnessReady(home);
  assert.equal(inspectInstanceSession(legacy).present, true);
  releaseHarness(home);
  await waitUntil(() => inspectInstanceSession(legacy).state === "shell", "harness exit");
  tmux("kill-window", "-t", `=${session}:=t3`);
});

test("#780: retire through a case-variant spelling of the deployment finds the receipt, quiesces the session and retires", FOLDS, async () => {
  const home = await startableHome("t5");
  const r = startInstanceSession(home);
  assert.equal(r.reused, "new");
  await harnessReady(home);
  const retired = fx.cli(["retire", "t5", "--dir", upper(fx.dep), "--json"]);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  const result = JSON.parse(retired.stdout);
  assert.equal(result.retired, "t5", retired.stdout);
  assert.equal(result.workRecovery?.classes?.includes("unknown instance-home provenance"), false, "the receipt was found: the home's provenance is known");
  assert.equal(existsSync(home), false, retired.stdout);
  assert.equal(tmux("list-windows", "-t", `=${session}`, "-F", "#{window_name}").split("\n").includes("t5"), false, "the session was quiesced");
});

test("#780: on a case-sensitive filesystem a home spelled with different case is another, nonexistent home", EXACT, async () => {
  const home = await spawnHome("t6");
  assert.equal(inspectInstanceSession(home).state, "not-launched");
  const other = inspectInstanceSession(upper(home));
  assert.equal(other.state, "stopped", "nothing is there");
  assert.equal(other.present, false);
  assert.equal(other.home, upper(home));
});
