import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxStatusReader } from "../packages/desktop/server/tmux-status.mjs";
import { observeLiveness } from "../packages/desktop/server/liveness.mjs";

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

test("liveness keeps the kernel-recorded socket/session target and never exposes a launch command", () => {
  const calls = [];
  const exec = (bin, args) => { calls.push([bin, args]); return "team\tlive\t@1\t0\tclaude\t42\n"; };
  const [live, other] = observeLiveness([
    { instance: "live", tmux: { socket: "/saved", session: "team", window: "live" } },
    { instance: "absent", tmux: { socket: "/saved", session: "team", window: "absent" } },
  ], { tmuxReader: createTmuxStatusReader({ exec }) });
  assert.equal(live.running, true); assert.equal(live.runtimeState, "running");
  assert.equal(live.tmux.socket, "/saved"); assert.equal(live.tmux.id, "@1");
  assert.equal(Object.hasOwn(live, "paneCommand"), false, "process status is not a launch command");
  assert.equal(other.running, false);
  assert.equal(calls.length, 1, "one query per saved socket");
  assert.deepEqual(calls[0][1].slice(0, 3), ["-u", "-S", "/saved"]);
});

test("liveness reports a Herdr-recorded row unsupported, never probing it or requiring a tmux window", () => {
  const stem = "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.";
  const target = { backend: "herdr", terminalId: "term_probe" };
  const rows = observeLiveness([
    { instance: "old-kernel", sessionTarget: target },
    { instance: "new-kernel", sessionTarget: target, runtimeState: "unsupported", runtimeError: `${stem} (new-kernel)` },
  ], { tmuxReader: () => assert.fail("Herdr rows never probe tmux") });
  assert.deepEqual(rows.map((r) => [r.running, r.runtimeState, r.runtimeError]), [[null, "unsupported", stem], [null, "unsupported", `${stem} (new-kernel)`]]);
  assert.deepEqual(rows.map((r) => r.tmux), [null, null], "Herdr is not projected as a fabricated tmux target");
});

test("malformed liveness requests are refused, malformed rows are unknown", () => {
  assert.throws(() => observeLiveness({}), /Invalid liveness request/);
  assert.equal(observeLiveness([null], { tmuxReader: () => assert.fail() })[0].running, null);
});
