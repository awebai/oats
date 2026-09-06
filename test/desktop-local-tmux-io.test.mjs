import test from "node:test";
import assert from "node:assert/strict";
import { localTmuxIo, tmuxSocketArgs } from "../packages/desktop/local-tmux-io.mjs";
import { openTerm } from "../packages/desktop/tmux-target.mjs";
import { terminalTargetKey } from "../packages/desktop/terminal-registry.mjs";

test("saved socket follows preflight, viewer construction, PTY attach and cleanup", () => {
  const calls = [], attached = [];
  const io = localTmuxIo("/saved/socket", {
    execFileSync: (bin, argv) => { calls.push(argv); return argv.includes("new-session") ? "@99\n" : ""; },
    spawnPty: (bin, argv, opts) => { attached.push({ bin, argv, opts }); return {}; },
    env: { HOME: "/home", TMUX: "/wrong/socket,1,0" },
  });
  const opened = openTerm({ session: "team", window: "minerva" }, io);
  opened.killViewer();
  assert.ok(calls.length > 5);
  for (const argv of calls) assert.deepEqual(argv.slice(0, 3), ["-u", "-S", "/saved/socket"]);
  assert.ok(calls[0].includes("=team:=minerva"));
  assert.equal(calls.at(-1)[3], "kill-session");
  assert.deepEqual(attached[0].argv.slice(0, 4), ["-u", "-S", "/saved/socket", "attach-session"]);
  assert.equal(attached[0].opts.env.TMUX, undefined);
  assert.notEqual(terminalTargetKey("team", "minerva", "/saved/socket"), terminalTargetKey("team", "minerva", "/other/socket"));
});

test("invalid socket cannot execute tmux; omitted socket retains the default route", () => {
  for (const socket of ["relative", "--help", "/bad\0socket", 12]) assert.throws(() => tmuxSocketArgs(socket), /Invalid/);
  assert.deepEqual(tmuxSocketArgs(), ["-u"]);
});
