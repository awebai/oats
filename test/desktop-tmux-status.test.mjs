import test from "node:test";
import assert from "node:assert/strict";
import { createTmuxStatusReader, agentPane } from "../packages/client/tmux-status.mjs";
import { observeLiveness } from "../packages/client/liveness.mjs";
import { resolveAgentPane, AGENT_PANE_OPTION } from "../lib/session-input.mjs";

/** One window's panes, [paneId, mark, dead], in the order tmux lists them; the window is named
 *  "agent", as its instance is (#1569). */
const WINDOWS = {
  "one pane": [["%4", "", "0"]],
  "one pane with another instance's mark": [["%4", "other", "0"]],
  "one dead pane": [["%4", "agent", "1"]],
  "marked, split before it (a respawned agent)": [["%3", "", "0"], ["%7", "agent", "0"]],
  "marked, listed first": [["%7", "agent", "0"], ["%3", "", "0"]],
  "none marked: the lowest id, by number": [["%10", "", "0"], ["%9", "", "0"]],
  "another instance's mark is never this one's": [["%2", "other", "0"], ["%5", "", "0"]],
  "the resolved pane is dead": [["%3", "agent", "1"], ["%5", "", "0"]],
  "two marked: can't tell": [["%7", "agent", "0"], ["%3", "agent", "0"]],
  "three marked: can't tell": [["%7", "agent", "0"], ["%3", "agent", "0"], ["%12", "agent", "0"]],
  "only other instances' marks: can't tell": [["%2", "other", "0"], ["%5", "another", "0"]],
};
/** The reader's `list-panes -a` answer for a window: each pane runs a command named after its id. */
const listed = (panes) => panes.map(([id, mark, dead]) => `team\tagent\t@1\t${id}\t${dead}\tcmd${id.slice(1)}\t${id.slice(1)}\t${mark}`).join("\n") + "\n";

test("saved socket and session determine status, with one query per socket", () => {
  const calls = [];
  const read = createTmuxStatusReader({ exec: (bin, args) => {
    calls.push([bin, args]);
    assert.equal(args[0], "-u");
    return args[args.indexOf("-S") + 1] === "/saved"
      ? "team\tminerva\t@1\t%1\t0\tclaude\t123\t\n" : "team\tother\t@2\t%2\t0\tclaude\t456\t\n";
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
    return "team\talive\t@1\t%1\t0\tzsh\t11\t\nteam\tshell\t@2\t%2\t0\tzsh\t21\t\nteam\tdead\t@3\t%3\t1\tclaude\t31\t\n";
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
  const exec = (bin, args) => { calls.push([bin, args]); return "team\tlive\t@1\t%1\t0\tclaude\t42\t\n"; };
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

test("the reader's copy of the agent-pane rule answers as the kernel's does, sentences included, for every window (#1569)", () => {
  for (const [what, panes] of Object.entries(WINDOWS)) {
    const asListed = panes.map(([paneId, mark, dead]) => ({ paneId, mark, dead }));
    const kernel = resolveAgentPane(asListed, "agent");
    assert.deepEqual(agentPane(asListed, "agent"), kernel, `${what}: the same pane or the same sentence`);
    const calls = [];
    const r = createTmuxStatusReader({ exec: (bin, args) => { calls.push(args); return listed(panes); } })({ instance: "agent", tmux: { session: "team" } });
    assert.equal(calls[0].at(-1).endsWith(`\t#{${AGENT_PANE_OPTION}}`), true, "the reader lists the kernel's mark, last");
    if (kernel.error) {
      assert.deepEqual([r.running, r.runtimeState, r.runtimeError], [null, "unreachable", kernel.error], `${what}: unknown, with the kernel's sentence`);
    } else if (kernel.pane.dead === "1") {
      assert.deepEqual([r.running, r.runtimeState], [false, "stopped"], `${what}: judged on the resolved pane alone`);
    } else {
      assert.deepEqual([r.running, r.runtimeState, r.paneCommand, r.tmux.id], [true, "running", `cmd${kernel.pane.paneId.slice(1)}`, "@1"],
        `${what}: the resolved pane's command; tmux.id stays the window`);
    }
  }
});

test("a split window reads as its agent's pane: running beside a shell, a fallback shell beside a running prompt (#1569)", () => {
  const read = (text, ps) => createTmuxStatusReader({ exec: (bin) => (bin === "ps" ? ps : text) })({ instance: "agent", tmux: { session: "team" } });
  const running = read("team\tagent\t@1\t%3\t0\tclaude\t30\tagent\nteam\tagent\t@1\t%5\t0\tzsh\t50\t\n", "50 1 zsh\n");
  assert.deepEqual([running.running, running.runtimeState, running.paneCommand], [true, "running", "claude"]);
  // The agent's pane is a fallback shell with no child; the prompt pane beside it runs a program.
  const shell = read("team\tagent\t@1\t%3\t0\tzsh\t30\tagent\nteam\tagent\t@1\t%5\t0\tbash\t50\t\n", "30 1 zsh\n50 1 bash\n51 50 python3\n");
  assert.deepEqual([shell.running, shell.runtimeState], [false, "shell"]);
  // Unmarked (a window from before the mark): the lowest id is the agent's, whichever pane is listed first.
  const legacy = read("team\tagent\t@1\t%8\t0\tbash\t80\t\nteam\tagent\t@1\t%2\t0\tclaude\t20\t\n", "");
  assert.deepEqual([legacy.running, legacy.paneCommand], [true, "claude"]);
});

test("the mark is the window's recorded name, which is the instance's; a pane id the answer lacks makes it unknown (#1569)", () => {
  const read = (text, meta) => createTmuxStatusReader({ exec: () => text })(meta);
  const panes = "team\tsaved\t@1\t%3\t0\tzsh\t30\t\nteam\tsaved\t@1\t%5\t0\tclaude\t50\tsaved\n";
  assert.equal(read(panes, { instance: "alias", tmux: { session: "team", window: "saved" } }).paneCommand, "claude", "marked with the window's name");
  assert.equal(read("team\tagent\t@1\t3\t0\tclaude\t30\t\n", { instance: "agent", tmux: { session: "team" } }).running, null);
});
