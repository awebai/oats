import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLaunchPromptController } from "../lib/launch-prompts.mjs";
import { DEV_CHANNEL_ENTRIES } from "../lib/launch-prompt-fixtures.mjs";
import { raw296, linux296, trustPrompts, sessions, edit } from "./helpers/dev-channel-screens.mjs";

// The prompt screens are real captures; the post-answer session screen is
// SYNTHETIC (any non-blank screen without a question marker completes).
const PLUGIN = "plugin:aweb-channel@awebai-marketplace";
const ENTRY = DEV_CHANNEL_ENTRIES[0].id;
const target = { socket: "/private/test.sock", windowId: "@4", paneId: "%7", pid: "42" };
const session = "SYNTHETIC session ready\n> \n";
const trust = trustPrompts["frame-02-trust-selected.txt"];
const version = { claudeVersion: "2.1.296", claudeVersionSource: "executable-path" };

function setup(t, options = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-prompt-")));
  const home = join(base, "home");
  mkdirSync(home);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const io = { time: 0, text: raw296, sends: [], audits: [], retained: [], captures: 0, snapshotHook: null, sendHook: null, auditHook: null,
    snapshot(tgt, timeout) {
      assert.ok(timeout > 0 && timeout <= 30000);
      this.captures++;
      const screen = { ...tgt, width: 194, height: 50, text: this.text };
      return this.snapshotHook?.(screen) ?? screen;
    },
    send(tgt, key, timeout) {
      assert.deepEqual(tgt, target);
      assert.ok(timeout > 0 && timeout <= 30000);
      this.sends.push(key);
      if (this.sendHook) return this.sendHook(key);
      this.text = session;
      return { status: "submitted" };
    },
    audit(data) {
      this.audits.push(data);
      return this.auditHook?.(data) ?? { ok: true, row: { at: "2026-10-10T00:00:00.000Z", kind: "launch-prompt", incarnation: "test-incarnation", data: { ...data } }, results: [{ path: join(home, "events.jsonl"), ok: true }, { path: "/unavailable/log", ok: false }] };
    },
  };
  const args = { home, startId: "start-test", ...version, transport: io, audit: data => io.audit(data),
    retainFrame: input => { io.retained.push({ outcome: input.outcome, recognition: input.recognition, text: input.screen.text }); return { ok: true }; },
    now: () => io.time, sleep: ms => { io.time += ms; } };
  options.configure?.({ args, io, home, base });
  const controller = createLaunchPromptController(args);
  return { controller, io, args, home, base };
}
const terminalRow = io => io.audits.at(-1);

test("the exact prompt gets one audited Enter and completes on a stable session screen", t => {
  const { controller, io, home } = setup(t);
  const result = controller.observeNew(target);
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "recognized launch boundary");
  assert.deepEqual(io.sends, ["Enter"]);
  assert.deepEqual(result.answers, [{ class: "awebDevelopmentChannel", signatureId: ENTRY, status: "submitted" }]);
  assert.deepEqual(io.audits.map(a => a.status), ["attempted", "submitted", "completed"]);
  for (const row of io.audits) {
    assert.equal(row.claudeVersion, "2.1.296");
    assert.equal(row.claudeVersionSource, "executable-path");
    assert.ok(!Object.hasOwn(row, "consentSource"));
    assert.ok(!JSON.stringify(row).includes("SYNTHETIC") && !JSON.stringify(row).includes("WARNING"));
  }
  assert.equal(io.audits[0].signatureId, ENTRY);
  assert.equal(io.audits[0].key, "Enter");
  assert.match(io.audits[0].signatureDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.receipt[0].results[0].path, join(home, "events.jsonl"));
  assert.equal(result.receipt[0].results[1].ok, false);
  assert.deepEqual(io.retained.map(r => [r.outcome, r.recognition]), [["completed", "stable-screen"]]);
  assert.equal(controller.observeNew(target), result);
  assert.equal(io.sends.length, 1);
});

for (const [label, text] of [["2.1.296 linux 80 columns", linux296["80x35"]], ["2.1.296 linux 60 columns", linux296["60x35"]]]) {
  test(`width-independent match answers ${label}`, t => {
    const { controller, io } = setup(t, { configure({ io }) { io.text = text; } });
    assert.equal(controller.observeNew(target).status, "completed");
    assert.deepEqual(io.sends, ["Enter"]);
  });
}

const nearMisses = [
  ["another plugin", edit(raw296, PLUGIN, "plugin:other-channel@elsewhere")],
  ["two plugins", edit(raw296, `Channels: ${PLUGIN}`, `Channels: ${PLUGIN}, plugin:other@elsewhere`)],
  ["the options in the other order", edit(raw296, "  ❯ 1. I am using this for local development\n    2. Exit", "  ❯ 1. Exit\n    2. I am using this for local development")],
  ["the selection on 2. Exit", edit(raw296, "  ❯ 1. I am using this for local development\n    2. Exit", "    1. I am using this for local development\n  ❯ 2. Exit")],
  ["a trust prompt stacked above", trust + raw296],
  ["one extra line", edit(raw296, "  Enter to confirm", "  Press 1 to continue\n\n  Enter to confirm")],
  ["a missing line", edit(raw296, "  Please use --channels to run a list of approved channels.\n", "")],
  ["a pane too narrow to wrap at word boundaries (real 40 columns)", linux296["40x35"]],
];
for (const [label, text] of nearMisses) {
  test(`near miss: ${label} blocks loudly with no keystroke`, t => {
    const { controller, io } = setup(t, { configure({ io }) { io.text = text; } });
    const result = controller.observeNew(target);
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "blocked: unexpected prompt");
    assert.deepEqual(io.sends, []);
    const row = terminalRow(io);
    assert.equal(row.differed.nearest, ENTRY);
    assert.ok(Number.isInteger(row.differed.firstDifference.index));
    assert.ok(row.differed.firstDifference.expected.length <= 40 && row.differed.firstDifference.found.length <= 40);
    assert.ok(io.time >= 200 && io.time < 1000, "a stable miss blocks within about 200 ms");
    assert.deepEqual(io.retained.map(r => [r.outcome, r.recognition, r.text]), [["blocked", "unmatched", text]], "private evidence holds the full screen");
  });
}

for (const [name, text] of Object.entries(trustPrompts)) {
  test(`real folder-trust prompt ${name} is never answered`, t => {
    const { controller, io } = setup(t, { configure({ io }) { io.text = text; } });
    assert.equal(controller.observeNew(target).reason, "blocked: unexpected prompt");
    assert.deepEqual(io.sends, []);
  });
}

for (const [name, text] of Object.entries(sessions)) {
  test(`real post-answer session ${name} completes`, t => {
    const { controller, io } = setup(t, { configure({ io }) { io.sendHook = () => { io.text = text; return { status: "submitted" }; }; } });
    assert.equal(controller.observeNew(target).status, "completed");
    assert.deepEqual(io.sends, ["Enter"]);
  });
}

test("a prompt painted in two steps is answered once", t => {
  const partial = raw296.slice(0, raw296.indexOf("  Channels:"));
  const { controller, io } = setup(t, { configure({ io }) {
    io.text = partial;
    io.snapshotHook = s => { if (io.captures === 2) io.text = raw296; return { ...s, text: io.text }; };
  } });
  const result = controller.observeNew(target);
  assert.equal(result.status, "completed");
  assert.deepEqual(io.sends, ["Enter"]);
});

test("a screen that never settles is a loud miss at the bound: no key, what differed, the last screen kept", t => {
  const { controller, io } = setup(t, { configure({ io }) { io.snapshotHook = s => ({ ...s, text: `SYNTHETIC spinner ${io.captures}\n` }); } });
  const result = controller.observeNew(target);
  assert.equal(result.reason, "blocked: unexpected prompt");
  assert.equal(result.differed.nearest, ENTRY);
  assert.equal(io.time, 30000);
  assert.deepEqual(io.sends, []);
  assert.deepEqual(io.retained.map(r => [r.outcome, r.recognition]), [["blocked", "unmatched"]]);
  assert.match(io.retained[0].text, /^SYNTHETIC spinner \d+\n$/);
});

test("a blank screen is bounded at 30 seconds and 100 ms", t => {
  for (const text of ["", " \n"]) {
    const { controller, io } = setup(t, { configure({ io }) { io.text = text; } });
    assert.equal(controller.observeNew(target).reason, "blocked: observation timeout");
    assert.equal(io.time, 30000);
    assert.equal(io.captures, 300);
    assert.deepEqual(io.sends, []);
  }
});

test("after the Enter, a question marker blocks with no second key", t => {
  const { controller, io } = setup(t, { configure({ io }) { io.sendHook = () => { io.text = trust; return { status: "submitted" }; }; } });
  const result = controller.observeNew(target);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "blocked: unexpected prompt");
  assert.equal(result.answers[0].status, "submitted");
  assert.deepEqual(io.sends, ["Enter"]);
  assert.deepEqual(io.retained.map(r => [r.outcome, r.recognition]), [["blocked", "unmatched"]]);
});

test("the prompt still showing within 2 s of the Enter is waited out; returning after 2 s blocks", t => {
  const quick = setup(t, { configure({ io }) {
    io.sendHook = () => ({ status: "submitted" });
    io.snapshotHook = s => { if (io.sends.length && io.time >= 1500) io.text = session; return { ...s, text: io.text }; };
  } });
  assert.equal(quick.controller.observeNew(target).status, "completed");
  assert.deepEqual(quick.io.sends, ["Enter"]);

  const stuck = setup(t, { configure({ io }) { io.sendHook = () => ({ status: "submitted" }); } });
  const result = stuck.controller.observeNew(target);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "blocked: repeated or unsupported prompt");
  assert.ok(stuck.io.time >= 2000 && stuck.io.time < 3000);
  assert.deepEqual(stuck.io.sends, ["Enter"]);
});

test("completion needs two non-blank marker-free captures at least 200 ms apart, with nothing else between", t => {
  const { controller, io } = setup(t, { configure({ io }) {
    io.sendHook = () => { io.text = session; return { status: "submitted" }; };
    // Session, blank, session, session...: the blank resets the pair.
    io.snapshotHook = s => { if (io.sends.length && io.captures === 5) return { ...s, text: "" }; return { ...s, text: io.text }; };
  } });
  const sentAt = () => io.audits.find(a => a.status === "submitted");
  const result = controller.observeNew(target);
  assert.equal(result.status, "completed");
  assert.ok(sentAt());
  assert.ok(io.time >= 400, "the reset pushed completion past the first pair");
});

test("no completion within the bound after the Enter is incomplete, never a second key", t => {
  const { controller, io } = setup(t, { configure({ io }) { io.sendHook = () => { io.text = ""; return { status: "submitted" }; }; } });
  const result = controller.observeNew(target);
  assert.equal(result.status, "incomplete");
  assert.equal(result.reason, "launch prompt completion not observed");
  assert.equal(result.answers[0].status, "submitted");
  assert.deepEqual(io.sends, ["Enter"]);
});

test("foreign or replaced target and capture failures never send", t => {
  for (const field of ["socket", "windowId", "paneId", "pid", "throw"]) {
    const { controller, io } = setup(t);
    io.snapshotHook = s => {
      if (field === "throw") throw new Error("secret output");
      return { ...s, [field]: "foreign" };
    };
    const result = controller.observeNew(target);
    assert.equal(result.status, "blocked");
    assert.deepEqual(io.sends, []);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("home inode substitution after intent prevents input", t => {
  const { controller, io, home } = setup(t);
  io.auditHook = data => {
    if (data.status === "attempted") { renameSync(home, home + "-old"); mkdirSync(home); }
    return { ok: true, results: [{ path: "/actual", ok: true }] };
  };
  assert.equal(controller.observeNew(target).status, "incomplete");
  assert.deepEqual(io.sends, []);
});

test("screen mutation while durable intent is written prevents input", t => {
  const { controller, io } = setup(t);
  io.auditHook = data => { if (data.status === "attempted") io.text = raw296 + "  changed\n"; return { ok: true }; };
  assert.equal(controller.observeNew(target).status, "blocked");
  assert.deepEqual(io.sends, []);
});

test("audit intent failure sends nothing and post-send failure is incomplete without retry", t => {
  for (const status of ["attempted", "submitted"]) {
    const { controller, io } = setup(t);
    io.auditHook = data => ({ ok: data.status !== status, results: [{ path: "/log", ok: data.status !== status }] });
    const result = controller.observeNew(target);
    assert.equal(result.status, "incomplete");
    assert.deepEqual(io.sends, status === "attempted" ? [] : ["Enter"]);
    controller.observeNew(target);
    assert.equal(result.answers.length, 0);
  }
});

test("failed, thrown, and ambiguous key outcomes are never retried or answered", t => {
  for (const result of [{ status: "failed" }, { status: "uncertain" }, undefined, "throw"]) {
    const { controller, io } = setup(t);
    io.sendHook = () => { if (result === "throw") throw new Error("possibly sent"); return result; };
    const observed = controller.observeNew(target);
    assert.equal(observed.status, "incomplete");
    assert.deepEqual(io.sends, ["Enter"]);
    assert.deepEqual(observed.answers, []);
    controller.observeNew(target);
    assert.deepEqual(io.sends, ["Enter"]);
  }
});

test("a second observation is refused and a later valid frame cannot reopen authority", t => {
  const { controller, io } = setup(t, { configure({ io }) { io.sendHook = () => { io.text = trust; return { status: "submitted" }; }; } });
  const result = controller.observeNew(target);
  io.text = raw296;
  assert.equal(controller.observeNew(target), result);
  assert.equal(controller.observeRespawn(target, controller.captureBeforeRespawn({ ...target, pid: "41" })), result);
  assert.deepEqual(io.sends, ["Enter"]);
});

test("respawn requires private old capture, changed PID, exact target and fresh bytes", t => {
  for (const mode of ["valid", "same-pid", "stale", "foreign", "missing", "forged"]) {
    const { controller, io } = setup(t);
    io.text = mode === "stale" ? raw296 : "old process screen";
    const old = { ...target, pid: mode === "same-pid" ? target.pid : "41" };
    const token = mode === "missing" ? undefined : mode === "forged" ? { ok: true } : controller.captureBeforeRespawn(old);
    io.text = raw296;
    const result = controller.observeRespawn(mode === "foreign" ? { ...target, paneId: "%9" } : target, token);
    assert.equal(result.status, mode === "valid" ? "completed" : "blocked", mode);
    if (mode !== "valid") assert.deepEqual(io.sends, []);
  }
});

test("respawn waits for visible bytes to change even after PID changes", t => {
  const { controller, io } = setup(t);
  const token = controller.captureBeforeRespawn({ ...target, pid: "41" });
  io.snapshotHook = s => {
    if (io.captures === 3) io.text = "";
    if (io.captures === 4) io.text = raw296;
    return { ...s, text: io.text };
  };
  assert.equal(controller.observeRespawn(target, token).status, "completed");
  assert.ok(io.time >= 200);
});

test("a respawn resize before the fresh screen blocks: the old prompt cannot be reflowed into a match", t => {
  const { controller, io } = setup(t);
  const token = controller.captureBeforeRespawn({ ...target, pid: "41" });
  io.snapshotHook = s => ({ ...s, width: 120, text: io.text + " " });
  assert.equal(controller.observeRespawn(target, token).reason, "blocked: respawn geometry changed before fresh screen");
  assert.deepEqual(io.sends, []);
});

test("creation-time home identity cannot be replaced before controller construction", t => {
  const { controller, io } = setup(t, { configure({ args }) { args.expectedHomeIdentity = { dev: -1, ino: -1 }; } });
  assert.notEqual(controller.observeNew(target).status, "completed");
  assert.deepEqual(io.sends, []);
});

test("pre-respawn capture and dispatch share the original 30-second deadline", t => {
  const { controller, io } = setup(t);
  io.text = "old screen";
  io.snapshotHook = screen => { io.time += 19000; return screen; };
  const before = controller.captureBeforeRespawn({ ...target, pid: "41" });
  assert.equal(before.ok, true);
  io.time += 1000; // Time spent dispatching belongs to this same authority.
  io.snapshotHook = screen => screen;
  io.text = "";
  const result = controller.observeRespawn(target, before);
  assert.equal(result.reason, "blocked: observation timeout");
  assert.equal(io.time, 30000);
  assert.equal(io.captures, 101);
  assert.deepEqual(io.sends, []);
});

test("constructor deadline can expire before any dispatch observation", t => {
  const { controller, io } = setup(t);
  io.time = 30000;
  assert.equal(controller.observeNew(target).reason, "blocked: observation timeout");
  assert.equal(io.captures, 0);
  assert.deepEqual(io.sends, []);
});

test("an unknown Claude version is audited as unknown and never gates", t => {
  const { controller, io } = setup(t, { configure({ args }) { args.claudeVersion = "unknown"; args.claudeVersionSource = "unknown"; } });
  assert.equal(controller.observeNew(target).status, "completed");
  assert.ok(io.audits.every(a => a.claudeVersion === "unknown" && a.claudeVersionSource === "unknown"));
});

test("a private evidence failure on completion is incomplete; on a block it is noted in the reason", t => {
  const done = setup(t, { configure({ args }) { args.retainFrame = () => ({ ok: false }); } });
  assert.equal(done.controller.observeNew(target).reason, "private launch evidence retention failed");
  const miss = setup(t, { configure({ args, io }) { io.text = nearMisses[0][1]; args.retainFrame = () => { throw new Error("raw os text"); }; } });
  const result = miss.controller.observeNew(target);
  assert.equal(result.reason, "blocked: unexpected prompt; private launch evidence retention failed");
  assert.ok(!JSON.stringify(result).includes("raw os text"));
});

test("every question marker blocks after the Enter, and none suppresses the initial confirmation", async t => {
  const { CLAUDE_QUESTION_MARKERS } = await import("../lib/launch-prompt-completion.mjs");
  assert.ok(CLAUDE_QUESTION_MARKERS.filter(m => raw296.includes(m)).length >= 3, "the confirmation itself carries markers");
  for (const marker of CLAUDE_QUESTION_MARKERS) {
    const { controller, io } = setup(t, { configure({ io }) { io.sendHook = () => { io.text = `SYNTHETIC session\n  ${marker}\n`; return { status: "submitted" }; }; } });
    const result = controller.observeNew(target);
    assert.equal(result.reason, "blocked: unexpected prompt", marker);
    assert.deepEqual(io.sends, ["Enter"], marker);
  }
});
