import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LAUNCH_PANE_FORMAT, launchPaneTarget, launchPromptTransport } from "../lib/launch-prompt-transport.mjs";

const target = { socket: "/private/isolated.sock", windowId: "@12", paneId: "%34", pid: "567" };
const fields = ["@12", "%34", "567", "110", "3", "1"];
const header = fields.join("\t");
const output = (first = header, last = first, lines = ["first line", "  selected", ""]) => `${first}\n${lines.join("\n")}\n${last}\n`;
function stub(value = output()) {
  const calls = [];
  const transport = launchPromptTransport({ exec: (...args) => { calls.push(args); return typeof value === "function" ? value(...args) : value; } });
  return { transport, calls };
}

test("launch target comes only from one complete direct response and absolute socket", () => {
  assert.deepEqual(launchPaneTarget(target.socket, "@12\t%34\t567\n"), target);
  for (const response of ["", "@12", "@12\t%34", "@12\t%34\t", "@12\t%34\t0", "@12\t%34\t-1", "@12\t%34\t5x", "name\t%34\t567", "@12\tname\t567", "@12\t%34\t567\textra", "@12\t%34\t567\n@13\t%35\t568"]) {
    assert.throws(() => launchPaneTarget(target.socket, response), /invalid launch pane identity/);
  }
  for (const socket of [undefined, "", "relative.sock"]) assert.throws(() => launchPaneTarget(socket, "@12\t%34\t567"), /invalid launch pane identity/);
});

test("snapshot uses explicit socket and visible unjoined capture, preserving spaces and blank rows", () => {
  const { transport, calls } = stub();
  assert.deepEqual(transport.snapshot(target, 999.9), { ...target, width: 110, height: 3, text: "first line\n  selected\n\n" });
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, "tmux");
  assert.deepEqual(args, ["-u", "-S", target.socket, "display-message", "-p", "-t", target.paneId, `${LAUNCH_PANE_FORMAT}\t#{pane_width}\t#{pane_height}\t#{window_panes}`, ";", "capture-pane", "-p", "-t", target.paneId, ";", "display-message", "-p", "-t", target.paneId, `${LAUNCH_PANE_FORMAT}\t#{pane_width}\t#{pane_height}\t#{window_panes}`]);
  assert.ok(!args.includes("-J"));
  assert.deepEqual(args.slice(args.indexOf("capture-pane"), args.lastIndexOf(";")), ["capture-pane", "-p", "-t", "%34"]);
  assert.deepEqual(options, { encoding: "utf8", timeout: 999, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
});

test("every identity and geometry change during capture is rejected", () => {
  for (const [index, replacement] of [[0, "@13"], [1, "%35"], [2, "568"], [3, "109"], [4, "2"], [5, "2"]]) {
    const changed = [...fields]; changed[index] = replacement;
    assert.throws(() => stub(output(header, changed.join("\t"))).transport.snapshot(target, 100), /identity or geometry changed/);
  }
});

test("stable but foreign identity, split pane, and malformed geometry never pass", () => {
  for (const [index, replacement] of [[0, "@13"], [1, "%35"], [2, "568"], [5, "2"], [5, "0"], [5, "01"], [3, "0"], [3, "wide"], [4, "0"], [4, "3.0"]]) {
    const changed = [...fields]; changed[index] = replacement;
    assert.throws(() => stub(output(changed.join("\t"))).transport.snapshot(target, 100));
  }
  for (const line of ["", "@12\t%34\t567", `${header}\textra`]) assert.throws(() => stub(output(line)).transport.snapshot(target, 100));
});

test("truncated captures, extra rows and partial command failures cannot produce a snapshot", () => {
  for (const value of ["", `${header}\n`, `${header}\nfirst line\n`, output(header, header, []), output(header, header, ["one", "two"]), output(header, header, ["one", "two", "three", "four"])]) {
    assert.throws(() => stub(value).transport.snapshot(target, 100));
  }
  const failure = Object.assign(new Error("capture failed"), { stdout: output(), status: 1 });
  assert.throws(() => stub(() => { throw failure; }).transport.snapshot(target, 100), error => error === failure);
});

test("identity and fixed key submission always use the exact pane and bounded client options", () => {
  const identity = stub("@12\t%34\t567\n");
  assert.deepEqual(identity.transport.identity(target.socket, target.paneId), target);
  assert.deepEqual(identity.calls[0][1], ["-u", "-S", target.socket, "display-message", "-p", "-t", target.paneId, LAUNCH_PANE_FORMAT]);
  assert.equal(identity.calls[0][2].timeout, 1000);
  assert.equal(identity.calls[0][2].killSignal, "SIGKILL");
  const { transport, calls } = stub("");
  for (const key of ["Enter"]) {
    assert.deepEqual(transport.send(target, key, 0.5), { status: "submitted" });
    assert.deepEqual(calls.at(-1)[1], ["-u", "-S", target.socket, "send-keys", "-t", target.paneId, key]);
    assert.equal(calls.at(-1)[2].timeout, 1);
    assert.equal(calls.at(-1)[2].killSignal, "SIGKILL");
  }
  const count = calls.length;
  for (const key of ["Up", "Down", "Tab", "y", "C-m", "Enter Down", ""]) assert.throws(() => transport.send(target, key, 100), /invalid launch action/);
  assert.equal(calls.length, count);
  for (const timeout of [0, -1, NaN, Infinity]) assert.throws(() => transport.snapshot(target, timeout), /invalid launch target/);
  for (const invalid of [{ ...target, socket: "relative" }, { ...target, paneId: "name" }]) assert.throws(() => transport.snapshot(invalid, 100), /invalid launch target/);
  assert.equal(calls.length, count);
  const failure = Object.assign(new Error("timed out"), { code: "ETIMEDOUT", signal: "SIGKILL" });
  assert.throws(() => stub(() => { throw failure; }).transport.send(target, "Enter", 100), error => error === failure);
});

let hasTmux = false;
try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 1000 }); hasTmux = true; } catch {}
test("private tmux: new-window and respawn direct identities bind changed PID and fresh visible bytes", { skip: !hasTmux }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-lpt-")));
  const socket = join(dir, "test.sock");
  const run = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 3000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { try { run("kill-server"); } catch {} rmSync(dir, { recursive: true, force: true }); });
  run("-f", "/dev/null", "new-session", "-d", "-s", "isolated", "-x", "110", "-y", "35", "/bin/sh", "-c", "exec sleep 60");
  const transport = launchPromptTransport();
  const created = launchPaneTarget(socket, run("new-window", "-d", "-P", "-F", LAUNCH_PANE_FORMAT, "-t", "=isolated:", "-n", "stub", "/bin/sh", "-c", "printf 'BEFORE-STUB\\n'; exec sleep 60"));
  async function screenWith(identity, marker) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const screen = transport.snapshot(identity, 1000);
      if (screen.text.includes(marker)) return screen;
      await delay(20);
    }
    assert.fail(`isolated stub did not render ${marker}`);
  }
  const before = await screenWith(created, "BEFORE-STUB");
  assert.equal(before.height, 35);
  assert.equal(before.width, 110);
  assert.deepEqual(transport.identity(socket, created.paneId), created);
  const respawned = launchPaneTarget(socket, run("respawn-pane", "-k", "-t", created.paneId, "/bin/sh", "-c", "printf 'AFTER-STUB\\n'; exec sleep 60", ";", "display-message", "-p", "-t", created.paneId, LAUNCH_PANE_FORMAT));
  assert.equal(respawned.windowId, created.windowId);
  assert.equal(respawned.paneId, created.paneId);
  assert.notEqual(respawned.pid, created.pid);
  assert.throws(() => transport.snapshot(created, 1000), /launch pane replaced/);
  const after = await screenWith(respawned, "AFTER-STUB");
  assert.notEqual(after.text, before.text);
  assert.ok(!after.text.includes("BEFORE-STUB"));
  run("set-option", "-w", "-t", respawned.windowId, "window-size", "manual");
  run("resize-window", "-t", respawned.windowId, "-x", "83", "-y", "27");
  const token = transport.pin(respawned, { width: 110, height: 35 }, 1000);
  assert.deepEqual(token.previous, { width: 83, height: 27, windowSize: "manual" });
  assert.equal(transport.snapshot(respawned, 1000).width, 110);
  assert.deepEqual(transport.restore(respawned, token, 1000), { status: "restored" });
  assert.equal(transport.snapshot(respawned, 1000).width, 83);
  assert.equal(transport.snapshot(respawned, 1000).height, 27);
  run("set-option", "-w", "-u", "-t", respawned.windowId, "window-size");
  const inherited = transport.pin(respawned, { width: 110, height: 35 }, 1000);
  assert.equal(inherited.previous.windowSize, "");
  transport.restore(respawned, inherited, 1000);
  assert.equal(run("show-options", "-w", "-q", "-v", "-t", respawned.windowId, "window-size"), "");

  run("split-window", "-d", "-t", respawned.paneId, "/bin/sh", "-c", "exec sleep 60");
  assert.throws(() => transport.snapshot(respawned, 1000), /not exclusively owned/);
});

function geometryStub({ policy = "", failPin = false, replaceOnPinFailure = false } = {}) {
  let width = 83, height = 27, pid = "567", pinAttempted = false;
  const calls = [];
  const transport = launchPromptTransport({ exec(command, args, options) {
    calls.push({ args, options });
    assert.equal(command, "tmux");
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
    assert.ok(options.timeout > 0 && options.timeout <= 3000);
    assert.equal(options.killSignal, "SIGKILL");
    if (args[3] === "display-message") {
      const head = [target.windowId, target.paneId, pid, width, height, 1].join("\t");
      return output(head, head, Array(height).fill(""));
    }
    if (args[3] === "show-options") return policy ? `${policy}\n` : "";
    assert.equal(args[3], "set-option");
    assert.ok(!args.includes("-g"));
    for (let index = 0; index < args.length; index++) if (args[index] === "-t") assert.equal(args[index + 1], target.windowId);
    width = Number(args[args.indexOf("-x") + 1]);
    height = Number(args[args.indexOf("-y") + 1]);
    if (width === 110) {
      policy = "manual";
      pinAttempted = true;
      if (failPin) { if (replaceOnPinFailure) pid = "999"; throw new Error("partial pin failed"); }
    } else {
      policy = args.slice(3).includes("-u") ? "" : args.at(-1);
    }
    return "";
  } });
  return { transport, calls, state: () => ({ width, height, policy, pinAttempted }), replace: () => { pid = "999"; } };
}

test("pin restores exact window dimensions and explicit or inherited policy with an opaque one-use token", () => {
  for (const policy of ["", "manual", "latest", "largest", "smallest"]) {
    const { transport, calls, state } = geometryStub({ policy });
    const token = transport.pin(target, { width: 110, height: 35 }, 1000);
    assert.deepEqual(token.previous, { width: 83, height: 27, windowSize: policy });
    assert.deepEqual(state(), { width: 110, height: 35, policy: "manual", pinAttempted: true });
    assert.deepEqual(transport.restore(target, token, 1000), { status: "restored" });
    assert.deepEqual(state(), { width: 83, height: 27, policy, pinAttempted: true });
    assert.throws(() => transport.restore(target, token, 1000), /invalid launch geometry token/);
    assert.ok(!calls.some(call => call.args.includes("send-keys")));
  }
});

test("geometry refusal and partial pin rollback never send keys", () => {
  const split = stub(output(header.replace(/1$/, "2")));
  assert.throws(() => split.transport.pin(target, { width: 110, height: 35 }, 1000), /not exclusively owned/);
  assert.ok(!split.calls.some(call => call[1].includes("set-option")));
  const failed = geometryStub({ failPin: true });
  assert.throws(() => failed.transport.pin(target, { width: 110, height: 35 }, 1000), error => error.message === "partial pin failed" && error.geometryRestored === true);
  assert.deepEqual(failed.state(), { width: 83, height: 27, policy: "", pinAttempted: true });
  assert.ok(!failed.calls.some(call => call.args.includes("send-keys")));
  for (const geometry of [{ width: 0, height: 35 }, { width: 110, height: Infinity }]) assert.throws(() => failed.transport.pin(target, geometry, 1000), /invalid launch geometry/);
});

test("restoration refuses replaced PID and foreign or reconstructed token without resizing", () => {
  const original = geometryStub();
  const token = original.transport.pin(target, { width: 110, height: 35 }, 1000);
  assert.throws(() => original.transport.restore({ ...target, windowId: "@13" }, token, 1000), /invalid launch geometry token/);
  assert.throws(() => geometryStub().transport.restore(target, token, 1000), /invalid launch geometry token/);
  assert.throws(() => original.transport.restore(target, structuredClone(token), 1000), /invalid launch geometry token/);
  original.replace();
  const count = original.calls.filter(call => call.args.includes("resize-window")).length;
  assert.throws(() => original.transport.restore(target, token, 1000), /launch pane replaced/);
  assert.equal(original.calls.filter(call => call.args.includes("resize-window")).length, count);
});


test("failed pin cleanup reports incomplete restoration without resizing a replacement process", () => {
  const failed = geometryStub({ failPin: true, replaceOnPinFailure: true });
  assert.throws(() => failed.transport.pin(target, { width: 110, height: 35 }, 1000), error => error.geometryRestoreFailed === true && error.geometryRestored !== true);
  assert.equal(failed.calls.filter(call => call.args.includes("resize-window")).length, 1);
  assert.ok(!failed.calls.some(call => call.args.includes("send-keys")));
});
