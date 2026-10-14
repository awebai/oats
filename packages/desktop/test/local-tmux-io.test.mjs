// The local viewer attaches with tmux's `sync` client feature where tmux has client
// features (3.2 and later), so tmux wraps each redraw in synchronized output (#1193).
// No real tmux: execFileSync and spawnPty are recorders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localTmuxIo, tmuxHasClientFeatures } from "../local-tmux-io.mjs";

test("tmuxHasClientFeatures: tmux 3.2 and later, by release number; anything unparsed has none", () => {
  for (const version of ["tmux 3.2", "tmux 3.2a", "tmux 3.3a\n", "tmux 3.5", "tmux 3.7c", "tmux 3.10", "tmux 4.0", "tmux 10.1-rc"]) {
    assert.equal(tmuxHasClientFeatures(version), true, version);
  }
  for (const version of ["tmux 3.0", "tmux 3.0a", "tmux 3.1", "tmux 3.1c", "tmux 2.9a", "tmux 1.8",
    "tmux next-3.6", "tmux master", "tmux openbsd-7.4", "not tmux 3.4", "tmux", "3.4", "", "  ", undefined, null, 3.4]) {
    assert.equal(tmuxHasClientFeatures(version), false, String(version));
  }
});

/** A localTmuxIo whose `tmux -V` answers `version` (a function to throw). */
function recorded(version, socket = "/memory/tmux.sock") {
  const sync = [], ptys = [];
  const io = localTmuxIo(socket, {
    env: { HOME: "/home/fixture", PATH: "/usr/bin", TMUX: "/tmp/tmux-1000/default,1,0" },
    execFileSync: (bin, args, options) => {
      sync.push({ bin, args, options });
      if (args.at(-1) !== "-V") return "";
      if (typeof version === "function") return version();
      return version;
    },
    spawnPty: (bin, args, options) => { ptys.push({ bin, args, options }); return {}; },
  });
  return { io, sync, ptys };
}

test("spawnPty: tmux 3.2+ attaches with -T sync, before attach-session", () => {
  const { io, ptys } = recorded("tmux 3.4\n");
  io.spawnPty("=agents:=dev", 80, 24);
  assert.deepEqual(ptys[0].args, ["-u", "-S", "/memory/tmux.sock", "-T", "sync", "attach-session", "-t", "=agents:=dev"]);
  assert.equal(ptys[0].bin, "tmux");
});

test("spawnPty: tmux 3.0/3.1, an unparsed version or a failed probe attach exactly as before", () => {
  for (const version of ["tmux 3.0a\n", "tmux 3.1c\n", "tmux next-3.6\n", "", () => { throw new Error("ENOENT"); }]) {
    const { io, ptys } = recorded(version);
    io.spawnPty("=agents:=dev", 80, 24);
    assert.deepEqual(ptys[0].args, ["-u", "-S", "/memory/tmux.sock", "attach-session", "-t", "=agents:=dev"], String(version));
  }
});

test("spawnPty without a saved socket: -u -T sync attach-session", () => {
  const { io, ptys, sync } = recorded("tmux 3.3a", null);
  io.spawnPty("=agents:=dev", 80, 24);
  assert.deepEqual(ptys[0].args, ["-u", "-T", "sync", "attach-session", "-t", "=agents:=dev"]);
  assert.deepEqual(sync[0].args, ["-u", "-V"]);
});

test("the version is asked once per io, with run's own socket and environment, and only to attach", () => {
  const { io, sync, ptys } = recorded("tmux 3.4");
  io.preflight("=agents:=dev"); io.tmux(["set-option", "-t", "=v", "status", "off"]);
  assert.ok(!sync.some(call => call.args.includes("-V")), "nothing asked before an attach");
  io.spawnPty("=agents:=dev", 80, 24); io.spawnPty("=agents:=dev", 100, 30);
  const probes = sync.filter(call => call.args.includes("-V"));
  assert.equal(probes.length, 1, "asked once");
  assert.deepEqual(probes[0].args, ["-u", "-S", "/memory/tmux.sock", "-V"]);
  assert.deepEqual(probes[0].options.env, sync[0].options.env, "the environment every tmux call gets");
  assert.equal(probes[0].options.timeout, 4000);
  assert.ok(ptys.every(pty => pty.args.includes("sync")));
});

test("a failed probe is not asked again: the io attaches without -T for its life", () => {
  let calls = 0;
  const { io, ptys } = recorded(() => { calls++; throw new Error("timed out"); });
  io.spawnPty("=agents:=dev", 80, 24); io.spawnPty("=agents:=dev", 80, 24);
  assert.equal(calls, 1);
  assert.ok(ptys.every(pty => !pty.args.includes("-T")));
});
