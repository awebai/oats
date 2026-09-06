import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxStatusReader } from "../packages/desktop/server/tmux-status.mjs";
import { initModel, collectControlPane } from "../packages/desktop/server/model.mjs";

test("saved socket and session determine status, with one query per socket", () => {
  const calls = [];
  const read = createTmuxStatusReader({ exec: (bin, args) => {
    calls.push([bin, args]);
    assert.equal(args[0], "-u");
    return args[args.indexOf("-S") + 1] === "/saved"
      ? "team\tminerva\t@1\t0\tclaude\t123\n" : "team\tother\t@2\t0\tclaude\t456\n";
  } });
  const meta = { instance: "minerva", tmux: { socket: "/saved", session: "team", window: "minerva" } };
  assert.equal(read(meta).running, true);
  assert.equal(read({ ...meta, instance: "alias" }).tmux.id, "@1", "uses saved window, not instance name");
  assert.equal(calls.length, 1);
  assert.equal(read({ ...meta, tmux: { ...meta.tmux, socket: "/other" } }).running, false);
  assert.equal(calls.length, 2);
});

test("wrapper shell with a harness child is running; fallback shell and dead pane are stopped", () => {
  let psCalls = 0;
  const read = createTmuxStatusReader({ exec: (bin) => {
    if (bin === "ps") { psCalls++; return "11 1 zsh\n12 11 /bin/zsh\n13 12 /opt/bin/claude\n21 1 zsh\n"; }
    return "team\talive\t@1\t0\tzsh\t11\nteam\tshell\t@2\t0\tzsh\t21\nteam\tdead\t@3\t1\tclaude\t31\n";
  } });
  const at = (instance) => read({ instance, tmux: { session: "team" } });
  assert.equal(at("alive").running, true);
  assert.equal(at("shell").running, false);
  assert.equal(at("shell").runtimeState, "shell");
  assert.equal(at("dead").running, false);
  assert.equal(psCalls, 1);
});

test("unreachable or malformed status stays unknown, proven missing socket is stopped", () => {
  for (const stderr of ["permission denied", "", "error connecting to /missing (No such file or directory)"]) {
    const read = createTmuxStatusReader({ exec: () => { throw Object.assign(new Error("tmux failed"), { stderr }); } });
    const r = read({ instance: "agent" });
    assert.equal(r.running, stderr.includes("No such file") ? false : null);
  }
  assert.equal(createTmuxStatusReader({ exec: () => "garbage" })({ instance: "agent" }).running, null);
});

test("panel model preserves saved-route status instead of rechecking the default socket", () => {
  const instances = [
    { instance: "live", running: true, tmux: { socket: "/saved", session: "team", window: "live", id: "@1" } },
    { instance: "unknown", running: null, runtimeError: "unreachable", tmux: { socket: "/lost" } },
  ];
  initModel({ listInstances: () => [{ name: "agent", dir: "/nonexistent-oats-status-test", instances }] });
  const panel = collectControlPane("/nonexistent-oats-status-test");
  assert.equal(panel.instances[0].running, true);
  assert.equal(panel.instances[0].tmux.socket, "/saved");
  assert.equal(panel.instances[0].tmux.id, "@1");
  assert.equal(panel.instances[1].running, null);
});
