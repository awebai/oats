import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-input-cli-")));
  t.after(() => {
    const pidFile = join(base, "probe.pid");
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {} }
    rmSync(base, { recursive: true, force: true });
  });
  const home = join(base, "instance"), bin = join(base, "bin"), log = join(base, "commands.jsonl"), key = createHash("sha256").update(home).digest("hex");
  const baselines = join(base, ".oats-retirement", "baselines");
  for (const dir of [home, bin, baselines]) mkdirSync(dir, { recursive: true });
  const tmux = { socket: join(base, "inert.sock"), session: "fixture", window: "agent" };
  // Minimal independent endpoint receipts: the production reader still checks
  // their agreement. There is no actual tmux server, model or delivery here.
  writeFileSync(join(home, "instance.json"), JSON.stringify({ launched: true, tmux }));
  writeFileSync(join(baselines, `${key}.json`), JSON.stringify({ version: 2, home, runtime: { launched: true, tmux } }));
  writeFileSync(join(bin, "tmux"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== '-u' || args[1] !== '-S' || args[2] !== ${JSON.stringify(tmux.socket)}) process.exit(90);
const command = args[3];
const record = { command, args, ...(command === 'load-buffer' ? { input: fs.readFileSync(0, 'utf8') } : {}) };
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(record) + '\\n');
if (command === process.env.FAIL_COMMAND) process.exit(7);
if (command === 'list-panes') process.stdout.write(process.env.PANE_ROW || '%12\\t0\\tcodex\\t123\\n');
if (args.includes('capture-pane')) {
  if (process.env.LOOK === 'timeout') {
    process.on('SIGTERM', () => {});
    fs.writeFileSync(${JSON.stringify(join(base, "probe.pid"))}, String(process.pid));
    setInterval(() => {}, 1000);
  } else if (process.env.LOOK === 'unreadable') process.exit(8);
  else {
    const entered = fs.readFileSync(${JSON.stringify(log)}, 'utf8').includes('"command":"send-keys"');
    process.stdout.write('80x24\\n' + (entered && process.env.LOOK === 'dialog' ? 'unrelated dialog' : 'same display') + '\\n80x24\\n');
  }
}
`);
  chmodSync(join(bin, "tmux"), 0o755);
  const env = { PATH: bin, HOME: base, OATS_HOME_DIR: join(base, "oats-home") };
  return { home, base, calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [],
    run(input, extra = {}, fromFile = false) {
      const args = [cli, "session", "input", "--home", home, "--json"];
      if (fromFile) { const file = join(base, "input.txt"); writeFileSync(file, input); args.push("--text-file", file); }
      return spawnSync(process.execPath, args, { cwd: base, env: { ...env, ...extra }, input: fromFile ? undefined : input, encoding: "utf8", timeout: 8000, killSignal: "SIGKILL" });
    } };
}

for (const look of ["unchanged", "dialog", "unreadable", "timeout"]) test(`session input full v1 envelope with inert ${look} display preserves single terminal operations`, (t) => {
  const fx = fixture(t), text = "literal $(touch NEVER)\n`also literal`";
  const result = fx.run(text, { LOOK: look });
  assert.equal(result.status, 0, `${result.stderr}\n${result.error || ""}`);
  assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, ok: true, result: { home: fx.home, backend: "tmux", present: true, state: "unknown", paneId: "%12", submitted: true, verified: look === "dialog" } });
  const calls = fx.calls();
  for (const command of ["load-buffer", "paste-buffer", "send-keys"]) assert.equal(calls.filter(r => r.command === command).length, 1);
  assert.equal(calls.find(r => r.command === "load-buffer").input, text);
  assert.deepEqual(calls.find(r => r.command === "send-keys").args.slice(3), ["send-keys", "-t", "%12", "Enter"]);
  assert.equal(existsSync(join(fx.base, "NEVER")), false);
  if (look === "timeout") {
    const pid = Number(readFileSync(join(fx.base, "probe.pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), e => e.code === "ESRCH", "timed-out read-only probe is gone despite ignoring TERM");
    rmSync(join(fx.base, "probe.pid"));
  }
});

test("session input CLI keeps input/authority/target refusals before any paste", (t) => {
  const fx = fixture(t);
  for (const text of ["", "bad\0input", "x".repeat(256 * 1024 + 1)]) {
    const result = fx.run(text, {}, true);
    assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS");
    assert.equal(fx.calls().length, 0);
  }
  const result = fx.run("wake", { PANE_ROW: "%12\t1\tcodex\t123\n" });
  assert.equal(JSON.parse(result.stdout).error.code, "E_SESSION_INPUT_FAILED");
  assert.equal(fx.calls().some(r => r.command === "paste-buffer"), false);
  writeFileSync(join(fx.home, "instance.json"), JSON.stringify({ launched: true, tmux: { socket: "/wrong/socket", session: "fixture", window: "agent" } }));
  const before = fx.calls().length;
  assert.equal(JSON.parse(fx.run("wake").stdout).error.code, "E_RUNTIME_AUTHORITY_MISMATCH");
  assert.equal(fx.calls().length, before);
});

for (const command of ["load-buffer", "paste-buffer", "send-keys"]) test(`session input ${command} failure remains a command error, not an observation`, (t) => {
  const fx = fixture(t), result = fx.run("literal", { FAIL_COMMAND: command });
  assert.equal(result.status, 1, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "E_SESSION_INPUT_FAILED");
  assert.equal(fx.calls().filter(r => r.command === command).length, 1);
  assert.ok(fx.calls().filter(r => r.command === "send-keys").length <= 1);
});
