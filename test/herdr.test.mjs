import test from "node:test";
import assert from "node:assert/strict";
import { inspectHerdr, stopHerdr, inputHerdr, validHerdrTarget } from "../lib/herdr.mjs";
const target = { backend: "herdr", binary: "/bin/herdr", socket: "/tmp/herdr.sock", workspaceId: "w1", paneId: "w1:p1", terminalId: "term_original", protocol: 20 };
function fixture({ terminal = target.terminalId, status = "idle", agent = true, fail = false, stubborn = false } = {}) {
  let present = true;
  const calls = [];
  return { calls, exec(bin, args, opts) {
    calls.push(args);
    assert.equal(opts.env.HERDR_SOCKET_PATH, target.socket);
    if (fail) throw new Error("server unreachable");
    if (args[0] === "api") return JSON.stringify({ result: { snapshot: { protocol: 20,
      panes: present ? [{ pane_id: target.paneId, terminal_id: terminal }] : [],
      agents: present && agent ? [{ terminal_id: terminal, agent_status: status }] : [],
    } } });
    if (args[1] === "close" && !stubborn) present = false;
    return "";
  } };
}
test("Herdr stop proves original terminal absent", () => {
  const io = fixture();
  stopHerdr(target, io);
  assert.equal(inspectHerdr(target, io).present, false);
  assert.deepEqual(io.calls.filter((x) => x[1] === "close"), [["pane", "close", "w1:p1"]]);
});
test("reused pane id does not authorize killing or prompting its replacement", () => {
  const io = fixture({ terminal: "term_replacement" });
  stopHerdr(target, io);
  assert.throws(() => inputHerdr(target, "check aw", io), /stopped or was replaced/);
  assert.ok(io.calls.every((x) => x[0] === "api"));
});
test("unreachable or stubborn session cannot be reported stopped", () => {
  assert.throws(() => stopHerdr(target, fixture({ fail: true })), /unreachable/);
  assert.throws(() => stopHerdr(target, fixture({ stubborn: true })), /still present/);
});
test("terminal input preserves literal content without harness-specific readiness policy", () => {
  const io = fixture({ status: "working" });
  const text = "Check aw; literal $(not-a-shell-command)";
  inputHerdr(target, text, io);
  assert.deepEqual(io.calls.at(-1), ["pane", "run", target.paneId, text]);
  assert.ok(validHerdrTarget(target));
  assert.equal(validHerdrTarget({ ...target, protocol: 999 }), false);
});
