import test from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { piOutcomePath, writePiOutcome, readPiOutcome, writePiExitMarker, summarizePiOutcome } from "../lib/captured-pi-outcome.mjs";
import { observePiSdkSession, PI_SDK_HOST, parsePiHostRecipeArgs } from "../lib/pi-sdk-host.mjs";
import { parsePiExitArgv } from "../lib/captured-pi-host.mjs";
import { renderCapturedPiCompletion } from "../lib/core.mjs";

const id = "12345678-1234-4123-8123-123456789abc";
const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-pi-outcome-unit-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home"), sessionDir = join(root, "S");
  mkdirSync(home); mkdirSync(sessionDir);
  // UNIT-only authority and root tripwire, NOT a substitute for record-v2 proof.
  const identity = lstatSync(sessionDir);
  const check = () => {
    const actual = lstatSync(sessionDir);
    assert.ok(actual.isDirectory() && actual.dev === identity.dev && actual.ino === identity.ino, "unit root replaced");
  };
  const authority = { home, sessionDir, incarnationId: "original-incarnation",
    intent: { schemaVersion: 1, incarnationId: "original-incarnation", executionId: "original-execution", attempt: 1 },
    nativeRecordId: id, executionBinding: { schemaVersion: 1, deployment: root, resolution: { format: "unit", id: "source" } },
    target: { backend: "tmux", session: "unit", window: "unit" }, inputIntegrity: { format: "unit", value: "task-digest" },
    selected: { runtime: "pi", provider: "native-provider", id: "exact-model", sdkVersion: "0.85.1" } };
  const sessionFile = join(sessionDir, "native-session.jsonl");
  writeFileSync(sessionFile, "unit-only native-file placeholder\n");
  const native = { role: "assistant", provider: "native-provider", model: "exact-model", responseModel: "reported-model-version",
    stopReason: "stop", timestamp: 123, content: [{ type: "text", text: "DO-NOT-COPY-NONCE" }], errorMessage: "DO-NOT-COPY-SECRET", rawStopReason: "DO-NOT-COPY-RAW" };
  const header = { type: "session", version: 3, id, cwd: home, timestamp: "2026-01-01T00:00:00Z", extra: "DO-NOT-COPY-HEADER" };
  const session = { model: { provider: native.provider, id: native.model, apiKey: "DO-NOT-COPY-AUTH" }, messages: [native],
    sessionManager: { getHeader: () => header, getSessionId: () => id, getSessionFile: () => sessionFile,
      getBranch: () => [{ type: "message", id: "native-entry", message: native }] } };
  const observation = observePiSdkSession(session, "0.85.1");
  const sdk = { schemaVersion: 1, kind: "oats.pi-sdk-outcome", authority, observed: { exitCode: 0, observation } };
  const process = { schemaVersion: 1, kind: "oats.pi-process-outcome", authority, observed: { exitCode: 0, source: "launcher-wait-status" } };
  return { root, home, sessionDir, authority, check, session, native, header, sdk, process, sessionFile };
}

test("SDK observation uses actual session/branch data, never request/nonce/errors/profile fields", t => {
  const f = fixture(t), o = f.sdk.observed.observation;
  assert.equal(o.header.id, id);
  assert.equal(o.finalAssistant.entryId, "native-entry");
  assert.equal(o.finalAssistant.responseModel, "reported-model-version");
  assert.ok(!JSON.stringify(o).includes("DO-NOT-COPY"));
  f.native.model = "actually-different";
  assert.equal(observePiSdkSession(f.session, "0.85.1").finalAssistant.model, "actually-different");
  f.session.messages.push({ role: "toolResult", timestamp: 124 });
  assert.equal(observePiSdkSession(f.session, "0.85.1").finalAssistant, null, "earlier assistant is not final after another native message");
  f.session.messages = [{ ...f.native, timestamp: 999 }];
  assert.equal(observePiSdkSession(f.session, "0.85.1").finalAssistant, null, "branch/state disagreement is not patched up");
});

test("both real observer facts are necessary; return0/ID/nonce alone never qualifies", t => {
  const f = fixture(t), summarize = (sdk, process) => summarizePiOutcome(f.authority, sdk, process, f.check);
  for (const [sdk, process] of [[null, null], [f.sdk, null], [null, f.process]]) {
    const result = summarize(sdk, process);
    assert.equal(result.status, "incomplete"); assert.equal(result.qualified, false);
  }
  const good = summarize(f.sdk, f.process);
  assert.equal(good.status, "succeeded"); assert.equal(good.qualified, true); assert.equal(good.nonAuthorizing, true);
  assert.equal(good.authority.intent.attempt, 1, "original dispatch ref, not a reconciliation counter");
  for (const code of [1, 7, 127, 143, 255]) {
    assert.equal(summarize(f.sdk, { ...f.process, observed: { ...f.process.observed, exitCode: code } }).status, "failed");
    assert.equal(summarize({ ...f.sdk, observed: { ...f.sdk.observed, exitCode: code } }, f.process).status, "failed");
  }
});

test("missing/partial/failed or mismatched native header/model/final evidence holds qualification", t => {
  const f = fixture(t);
  const changes = [
    s => { s.observed.observation = null; },
    s => { s.observed.observation.header = null; },
    s => { s.observed.observation.header.version = 2; },
    s => { s.observed.observation.header.cwd = "/foreign"; },
    s => { s.observed.observation.header.id = "foreign"; },
    s => { s.observed.observation.sessionFile = null; },
    s => { s.observed.observation.sdkVersion = "other"; },
    s => { s.observed.observation.model = null; },
    s => { s.observed.observation.model.id = "other"; },
    s => { s.observed.observation.finalAssistant = null; },
    s => { s.observed.observation.finalAssistant.provider = "other"; },
    s => { s.observed.observation.finalAssistant.model = "other"; },
    ...["length", "toolUse", "error", "aborted"].map(reason => s => { s.observed.observation.finalAssistant.stopReason = reason; }),
  ];
  for (const mutate of changes) {
    const sdk = structuredClone(f.sdk); mutate(sdk);
    assert.equal(summarizePiOutcome(f.authority, sdk, f.process, f.check).qualified, false);
  }
  rmSync(f.sessionFile);
  assert.equal(summarizePiOutcome(f.authority, f.sdk, f.process, f.check).qualified, false);
});

test("outcomes bind exact original incarnation/intent/native record/target/input/selection", t => {
  const f = fixture(t);
  for (const mutate of [a => a.incarnationId = "foreign", a => a.intent.attempt++, a => a.intent.executionId = "other",
    a => a.nativeRecordId = "87654321-1234-4123-8123-123456789abc", a => a.target.window = "other",
    a => a.inputIntegrity.value = "other", a => a.selected.id = "other", a => a.executionBinding.resolution.id = "other"]) {
    const receipt = structuredClone(f.sdk); mutate(receipt.authority);
    assert.throws(() => summarizePiOutcome(f.authority, receipt, f.process, f.check), { code: "E_PI_HOST_OUTCOME" });
  }
  for (const exitCode of [undefined, null, "0", -1, 256, 0.5, NaN]) {
    assert.throws(() => summarizePiOutcome(f.authority, f.sdk, { ...f.process, observed: { ...f.process.observed, exitCode } }, f.check));
  }
  assert.throws(() => summarizePiOutcome(f.authority, { ...f.sdk, schemaVersion: 2 }, f.process, f.check));
  assert.throws(() => summarizePiOutcome(f.authority, { ...f.sdk, credential: "unit-secret" }, f.process, f.check));
});

test("write-once observations, read-only absence and ID-only marker remain distinct", t => {
  const f = fixture(t); let checks = 0;
  const check = () => { checks++; f.check(); };
  assert.equal(readPiOutcome("sdk", f.authority, check), null);
  const sdk = writePiOutcome("sdk", f.authority, f.sdk.observed, check);
  const process = writePiOutcome("process", f.authority, f.process.observed, check);
  assert.deepEqual(JSON.parse(JSON.stringify(readPiOutcome("sdk", f.authority, check))), sdk);
  assert.equal(summarizePiOutcome(f.authority, sdk, process, check).qualified, true);
  const file = piOutcomePath(f.sessionDir, id, "process"), before = readFileSync(file);
  assert.throws(() => writePiOutcome("process", f.authority, { exitCode: 7, source: "launcher-wait-status" }, check), { code: "EEXIST" });
  assert.deepEqual(readFileSync(file), before, "no result overwrite/downgrade");
  writePiExitMarker(f.authority, check);
  assert.equal(readFileSync(join(f.home, ".oats-start-exited"), "utf8"), "original-execution\n");
  assert.ok(checks > 12);
});

test("partial evidence, symlinks, oversize data and unowned session files refuse without repair", t => {
  const f = fixture(t), file = piOutcomePath(f.sessionDir, id, "sdk");
  writeFileSync(file, "{partial");
  assert.throws(() => readPiOutcome("sdk", f.authority, f.check));
  assert.throws(() => writePiOutcome("sdk", f.authority, f.sdk.observed, f.check), { code: "EEXIST" });
  assert.equal(readFileSync(file, "utf8"), "{partial");
  rmSync(file); symlinkSync(f.sessionFile, file);
  assert.throws(() => readPiOutcome("sdk", f.authority, f.check));
  rmSync(file); writeFileSync(file, " ".repeat(32769));
  assert.throws(() => readPiOutcome("sdk", f.authority, f.check), { code: "E_PI_HOST_OUTCOME" });
  const sdk = structuredClone(f.sdk); sdk.observed.observation.sessionFile = join(f.home, "outside.jsonl");
  assert.throws(() => summarizePiOutcome(f.authority, sdk, f.process, f.check), { code: "E_PI_HOST_OUTCOME" });
  rmSync(f.sessionFile); symlinkSync(join(f.home, "outside.jsonl"), f.sessionFile);
  assert.equal(summarizePiOutcome(f.authority, f.sdk, f.process, f.check).qualified, false);
});

test("root drift during publication/read holds and retains original partial evidence", t => {
  const f = fixture(t); let checks = 0;
  assert.throws(() => writePiOutcome("sdk", f.authority, f.sdk.observed, () => {
    if (++checks === 2) { renameSync(f.sessionDir, f.sessionDir + "-original"); mkdirSync(f.sessionDir); }
    f.check();
  }), /unit root replaced/);
  assert.equal(readFileSync(piOutcomePath(f.sessionDir + "-original", id, "sdk")).length, 0);
  assert.throws(() => readPiOutcome("sdk", f.authority, f.check), /unit root replaced/);
  assert.throws(() => readFileSync(piOutcomePath(f.sessionDir, id, "sdk")), { code: "ENOENT" });
});

test("private process-observer argv cannot become launch-selection/request authority", () => {
  const args = ["--oats-pi-record-exit", "1", "--home", "/original", "--native-record", id, "--exit-status", "7"];
  assert.deepEqual(parsePiExitArgv(args), { home: "/original", nativeRecordId: id, exitCode: 7 });
  for (const value of ["", "00", "-1", "256", "0.5", "null", "NaN"]) assert.throws(() => parsePiExitArgv([...args.slice(0, -1), value]), { code: "E_PI_HOST_ARGS" });
  for (const bad of [args.slice(2), [...args, "--model", "x/y"], args.map(v => v === "/original" ? "relative" : v), args.map(v => v === id ? "../other" : v)]) assert.throws(() => parsePiExitArgv(bad), { code: "E_PI_HOST_ARGS" });
  assert.throws(() => parsePiHostRecipeArgs(args), { code: "E_PI_HOST_ARGS" });
});

test("public captured inspect has a closed read-only grammar before any source/native effects", t => {
  const f = fixture(t), cli = new URL("../bin/oats.mjs", import.meta.url).pathname;
  const scope = ["--deployment", f.root, "--resolution", "sha256-" + "a".repeat(64), "--home", f.home, "--json"];
  for (const args of [
    ["session", "inspect", ...scope],
    ["session", "inspect", ...scope, "--native-record", id, "--request", "/not-read"],
    ["session", "inspect", ...scope, "--native-record", id, "--retry-intent", "not-admitted"],
    ["session", "inspect", ...scope, "--native-record", id, "--model", "other/model"],
    ["session", "start", ...scope, "--native-record", id],
    ["session", "inspect", "--home", f.home, "--native-record", id, "--json"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd: f.home });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS");
    assert.equal(result.stderr, "");
  }
  assert.throws(() => lstatSync(join(f.home, ".oats-start-pending.json")), { code: "ENOENT" });
});

test("common tmux/Herdr wrapper observes actual shell exit status and preserves original env/ref", t => {
  const f = fixture(t), observer = join(f.root, "inert-observer.mjs"), receipt = join(f.root, "inert-observation.json");
  writeFileSync(observer, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(receipt)},JSON.stringify({argv:process.argv.slice(2),attempt:process.env.OATS_EXECUTION_ATTEMPT,home:process.env.OATS_INSTANCE_HOME})); process.exitCode=19;\n`);
  const command = `OATS_INSTANCE_HOME=${quote(f.home)} OATS_EXECUTION_ATTEMPT='1' ${quote(PI_SDK_HOST)} --unit`;
  for (const status of [0, 7, 143]) {
    const rendered = renderCapturedPiCompletion(command, `/bin/sh -c ${quote(`exit ${status}`)}`, { home: f.home, nativeRecordId: id });
    assert.ok(rendered.includes('--exit-status "$oats_start_status"'));
    assert.ok(!rendered.includes(".oats-start-exited"), "guarded recorder, not unguarded shell marker write");
    const inert = rendered.replace(quote(PI_SDK_HOST), quote(observer)); // TEST ONLY: no backend/model/SDK execution
    for (const backend of ["tmux", "herdr"]) {
      const suffix = backend === "herdr" ? '; exit "$oats_start_status"' : '; printf "%s" "$oats_start_status"';
      const child = spawnSync("/bin/sh", ["-c", inert + suffix], { encoding: "utf8" });
      if (backend === "herdr") assert.equal(child.status, status, "observer's19 must not replace native status");
      else assert.equal(child.stdout, String(status), "tmux completion preserves native status before fallback shell");
      const observed = JSON.parse(readFileSync(receipt, "utf8"));
      assert.equal(parsePiExitArgv(observed.argv).exitCode, status);
      assert.equal(observed.attempt, "1"); assert.equal(observed.home, f.home);
    }
  }
});
