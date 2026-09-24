import { launchSoul } from './helpers/workspace-actions.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const tick = () => new Promise((r) => setTimeout(r, 0));

// These suites exercise the spawn-form races; mutations require a VERIFIED
// compatible CLI (frozen contract), so seed the shared CLI state as
// available before each mount — the CLI dimension has its own suite
// (cli-degradation.test.mjs).
const cliStatusMod = await import("../renderer/views/cli-status.mjs");
const CLI_OK = { ok: true, bin: "/seed/oats", version: "0.18.0", source: "path", required: { desktopApi: 1, range: ">=0.18.0 <0.21.0" }, probedAt: 1, tried: [] };
async function seedCliAvailable() {
  await cliStatusMod.refreshCli({
    api: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, bin: "/seed/oats", version: "0.18.0", source: "path", required: { desktopApi: 1, range: ">=0.18.0 <0.21.0" }, probedAt: 1, tried: [] }) }),
  });
}

test("Spawn modal close restores focus to the LIVE Spawn button and preserves the selected soul (review 41059e0)", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body><div id=host></div></body></html>", { url: "http://localhost" });
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldSetInterval = globalThis.setInterval;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.setInterval = () => ({ fake: true });
  const common = await import("../renderer/views/common.mjs");
  const spawn = await import("../renderer/views/spawn.mjs");
  await seedCliAvailable();
  const previousWs = common.currentWorkspace();
  const agent = { name: "dev", agentsRoot: "/a", description: "", runtime: "pi", work: "workspace", repo: true, repoName: "r" };
  const ctx = {
    api: (pathname, opts = {}) => {
      if (pathname === "/api/cli" || pathname === "/api/cli/reprobe") return Promise.resolve(CLI_OK);
      if (pathname === "/api/models") return Promise.resolve({ ok: true, status: 200, json: async () => ({ runtime: "pi", models: [] }) });
      if (opts.method === "POST") return Promise.resolve({ ok: true, status: 200, json: async () => ({ instance: "x" }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => pathname.startsWith("/api/agents")
        ? { agents: [agent] }
        : { instances: [], workspace: { id: "w" }, workspaces: [] } });
    },
    openTerminal: () => {},
  };
  try {
    common.setWorkspace("w");
    spawn.mount(dom.window.document.getElementById("host"), ctx);
    await tick(); await tick();
    const doc = dom.window.document;
    const closePaths = [
      ["Escape", () => doc.querySelector(".spawn-dialog")
        .dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))],
      ["Cancel", () => doc.querySelector(".spawn-dialog .fcancel").click()],
      ["close-x", () => doc.querySelector(".spawn-dialog .fcancel-x").click()],
      ["backdrop", () => {
        const modal = doc.querySelector(".spawn-modal");
        const e = new dom.window.MouseEvent("mousedown", { bubbles: true });
        Object.defineProperty(e, "target", { value: modal });
        modal.dispatchEvent(e);
      }],
    ];
    for (const [name, closeIt] of closePaths) {
      const opener = launchSoul(doc); // action stays in the selected-soul inspector
      assert.ok(doc.querySelector(".spawn-dialog"), `${name}: modal open`);
      assert.ok(doc.querySelector(".soul-card.open"), `${name}: card highlighted while open`);
      closeIt();
      assert.equal(doc.querySelector(".spawn-dialog"), null, `${name}: modal closed`);
      assert.equal(doc.querySelector(".soul-card.open").dataset.agent, agent.name,
        `${name}: selected soul stays highlighted after the modal closes`);
      const live = doc.querySelector(".soul-inspector .spawn-act");
      assert.equal(doc.activeElement, live,
        `${name}: focus restored to the CURRENTLY CONNECTED inspector Launch action`);
      assert.equal(doc.activeElement, opener, `${name}: inspector action survives grid repaints`);
    }
  } finally {
    spawn.unmount();
    common.setWorkspace(previousWs);
    globalThis.setInterval = oldSetInterval;
    dom.window.close();
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});

test("spawn: post-spawn poll and terminal open use COMPOSITE identity — a same-named twin never satisfies the wait (merged-state review @7dd1e7b)", async () => {
  const spawn = await import("../renderer/views/spawn.mjs");
  // twin with the SAME NAME but a different home is already in the panel;
  // a bare-name match would return true on the first poll and the follow-up
  // open would then refuse the ambiguous name
  const twin = { instance: "dev-1", home: "/ws/second/agents/dev/instances/dev-1", agentsRoot: "/ws/second/agents", running: true, tmux: { session: "pi-agents" } };
  const mine = { instance: "dev-1", home: "/ws/agents/dev/instances/dev-1", agentsRoot: "/ws/agents", running: true, tmux: { session: "pi-agents" } };
  let polls = 0;
  const panels = [
    { instances: [twin] },           // roster lag: only the twin yet
    { instances: [twin, mine] },     // catch-up: the spawned instance appears
  ];
  const s = { ctx: { api: () => { const p = panels[Math.min(polls++, 1)]; return Promise.resolve({ ok: true, status: 200, json: async () => p }); } } };
  const ref = { instance: "dev-1", home: mine.home, agentsRoot: mine.agentsRoot };
  const ok = await spawn.waitForInstanceInPanel(s, ref, () => true, { tries: 5, delayMs: 0, sleep: async () => {} });
  assert.equal(ok, true, "wait succeeds once the composite identity appears");
  assert.equal(polls, 2, "the twin alone did NOT satisfy the first poll — bare-name early success is the bug");
  // legacy panels without home/agentsRoot fields still match by name
  let polls2 = 0;
  const s2 = { ctx: { api: () => { polls2++; return Promise.resolve({ ok: true, status: 200, json: async () => ({ instances: [{ instance: "dev-1", running: true, tmux: { session: "pi-agents" } }] }) }); } } };
  assert.equal(await spawn.waitForInstanceInPanel(s2, ref, () => true, { tries: 2, delayMs: 0, sleep: async () => {} }), true,
    "identity-less roster rows keep matching by name (no regression for old servers)");
  assert.equal(polls2, 1);
});

test("spawn: post-spawn wait requires TERMINAL READINESS — a listed-but-not-running instance (tmux not registered yet) never satisfies the poll", async () => {
  const spawn = await import("../renderer/views/spawn.mjs");
  // The roster snapshot lists a fresh spawn from its instance.json BEFORE
  // its tmux window registers: running:false, no tmux.session. Opening the
  // terminal at that point hits the shell's "no live tmux session" refusal
  // (the original bug — blocking alert + stuck modal). The wait must hold
  // until the row is running WITH a tmux session.
  const ref = { instance: "dev-1", home: "/ws/agents/dev/instances/dev-1" };
  let polls = 0;
  const panels = [
    { instances: [{ instance: "dev-1", home: ref.home, running: false, tmux: { session: "pi-agents" } }] }, // present, not running
    { instances: [{ instance: "dev-1", home: ref.home, running: true }] },                                   // running, tmux unregistered
    { instances: [{ instance: "dev-1", home: ref.home, running: true, tmux: { session: "pi-agents" } }] },   // READY
  ];
  const s = { ctx: { api: () => { const p = panels[Math.min(polls++, 2)]; return Promise.resolve({ ok: true, status: 200, json: async () => p }); } } };
  const ok = await spawn.waitForInstanceInPanel(s, ref, () => true, { tries: 5, delayMs: 0, sleep: async () => {} });
  assert.equal(ok, true, "wait succeeds once the instance is terminal-ready");
  assert.equal(polls, 3, "mere presence (not running / no tmux session) did NOT satisfy earlier polls — early success is the alert bug");
  // timeout degradation: a never-ready instance returns false (caller
  // degrades to the sidebar-roster status line — no auto-open, no alert)
  const s2 = { ctx: { api: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ instances: [{ instance: "dev-1", home: ref.home, running: false }] }) }) } };
  assert.equal(await spawn.waitForInstanceInPanel(s2, ref, () => true, { tries: 3, delayMs: 0, sleep: async () => {} }), false,
    "a never-ready instance times out to the graceful degradation path");
});

test("common: instanceApiPath carries the home qualifier for object refs (merged-state review @7dd1e7b)", async () => {
  const common = await import("../renderer/views/common.mjs");
  const prev = common.currentWorkspace();
  try {
    common.setWorkspace("w1");
    // object ref → exact-home qualified (server refuses ambiguous bare names)
    const p = common.instanceApiPath("keys", { instance: "dev-1", home: "/ws/agents/dev/instances/dev-1" });
    assert.equal(p, `/api/keys/dev-1?home=${encodeURIComponent("/ws/agents/dev/instances/dev-1")}&ws=w1`);
    // extra query composes with the qualifier
    const p2 = common.instanceApiPath("session", { instance: "dev-1", home: "/h" }, "lines=200");
    assert.equal(p2, `/api/session/dev-1?lines=200&home=${encodeURIComponent("/h")}&ws=w1`);
    // legacy string ref unchanged
    assert.equal(common.instanceApiPath("chat", "solo"), "/api/chat/solo?ws=w1");
  } finally { common.setWorkspace(prev); }
});

test("shell api errors: httpError carries the server's stable domain code (merged-state review @3e76616)", async () => {
  const common = await import("../renderer/views/common.mjs");
  // Electron-bridge shape: parsed body, no .json() — the shell's ctx.api
  // throws via httpError. Dropping body.code made doSpawn's
  // E_RELATIVE_AMBIGUOUS branch unreachable in PRODUCTION while
  // fetch-shaped tests stayed green.
  const e = common.httpError({ ok: false, status: 409,
    body: { error: 'relation "child": ambiguous', code: "E_RELATIVE_AMBIGUOUS" } }, "/api/spawn");
  assert.equal(e.message, 'relation "child": ambiguous');
  assert.equal(e.status, 409);
  assert.equal(e.code, "E_RELATIVE_AMBIGUOUS", "domain code survives the shell-parsed path");
  // code-less errors stay code-less; message falls back to status text
  const e2 = common.httpError({ ok: false, status: 500, body: {} }, "/api/x");
  assert.equal(e2.message, "HTTP 500 for /api/x");
  assert.ok(!("code" in e2));
  // the SHELL actually routes through httpError (composition root is not
  // importable — pin the wiring textually like the nav-manifest tests do)
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.ok(/if \(!r\.ok\) throw httpError\(r, pathname\);/.test(src), "shell ctx.api throws via the shared httpError");
  assert.ok(/httpError\s*\}?\s*from ".\/views\/common.mjs"|,\s*httpError\s*\}/.test(src), "shell imports httpError from common");
});
