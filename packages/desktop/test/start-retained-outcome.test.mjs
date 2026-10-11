// A Start or Restart that stops at a launch prompt (OATS 0.52.0, awebai/oats#917): the kernel answers
// E_SPAWN_INCOMPLETE with the retained outcome in its details, as for a spawn; the start route adds it as
// `incomplete`, and the dialog says what happened in the Desktop's words, with the kernel's command-line
// sentence as an attributed quote. The kernel's message is hand-written from lib/core.mjs
// `retainedPromptError` at kernel head 881ecc1f; the details are helpers/launch-prompt-fixture.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createInstanceStarter } from "../renderer/start-instance.mjs";
import { setWorkspace, apiJson, httpError } from "../renderer/views/common.mjs";
import { retainedStartMessage, retainedSpawnDetails } from "../../client/launch-prompt-outcome.mjs";
import { retained, differed, EXPECTED, FOUND, DIFFERED, observationTimeout, observationTimeoutMessage } from "./helpers/launch-prompt-fixture.mjs";

const tick = () => new Promise((r) => setImmediate(r));
const HOME = "/workspace/agents/accountant/instances/accountant-minerva", NAME = "accountant-minerva";
const kernelMessage = (reason) => `${reason}; home and pane retained: inspect ${HOME}, then use oats session start --home '${HOME}'. If Claude's development-channel confirmation changed, read the prompt and press Enter yourself, or add its captured wording as a tolerance entry in a reviewed change; never broaden the matcher.`;
/** The start route's 409 answer for a retained outcome. `prompts` overrides the fixture's launchPrompts. */
function refusal(status = "blocked", prompts = {}) {
  const details = retained({ instance: NAME, home: HOME }, status);
  details.launchPrompts = { ...details.launchPrompts, ...prompts };
  return { error: kernelMessage(details.launchPrompts.reason), code: "E_SPAWN_INCOMPLETE", incomplete: retainedSpawnDetails(details) };
}
/** The shell's ctx.api throws httpError for a received non-2xx answer (the Electron bridge's shape). */
const viaShell = (body) => () => { throw httpError({ ok: false, status: 409, body }, "/api/start/x"); };
/** A fetch-shaped ctx.api (the browser harness): apiJson builds the error. */
const viaFetch = (body) => () => ({ ok: false, status: 409, json: async () => body });

function setup({ start, restart = false, running = false, server } = {}) {
  const dom = new JSDOM("<body><button id='opener'>Start</button></body>");
  setWorkspace("/workspace");
  const instance = { instance: NAME, home: HOME, runtime: "claude", model: "sonnet", running, ...(server ? { server, addressable: true } : {}) };
  const calls = [], opened = [], state = { running };
  const cli = { ok: true, features: ["session-start", "session-restart"], remote: ["session-start", "session-restart"] };
  const ctx = { api: async (path, opts) => {
    calls.push({ path, opts });
    if (path === "/api/cli") return cli;
    if (path.startsWith("/api/panel")) return { instances: [{ ...instance, running: state.running }] };
    if (path === "/api/models") return { models: [] };
    if (path.startsWith("/api/start/") || path.startsWith("/api/restart/")) return start();
    assert.fail(path);
  }, openTerminal: async (ref) => opened.push(ref), notify: () => {} };
  const open = createInstanceStarter(dom.window.document, ctx, { waitForReady: async () => true });
  const modal = open(instance, { restart });
  const q = (s) => modal.querySelector(s);
  return { dom, modal, q, calls, opened, state, starts: () => calls.filter((c) => /^\/api\/(start|restart)\//.test(c.path)).length,
    submit: () => q("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true })),
    cleanup: () => { setWorkspace("/finished"); dom.window.close(); } };
}

test("the sentence for a start: not confirmed, the reason, whether input was sent, and what to do", () => {
  const blocked = retainedSpawnDetails(retained({ instance: NAME, home: HOME }));
  assert.equal(retainedStartMessage(NAME, blocked), `OATS could not confirm that ${NAME} finished starting: blocked: unexpected prompt. A launch-prompt answer was submitted; this does not confirm readiness. Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`);
  const incomplete = retainedSpawnDetails(retained({ instance: NAME, home: HOME }, "incomplete"));
  assert.equal(retainedStartMessage(NAME, incomplete), `OATS could not confirm that ${NAME} finished starting: launch prompt audit failed after possible input. Input may already have been sent. Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`);
  const unanswered = { ...blocked, launchPrompts: { ...blocked.launchPrompts, answers: [] } };
  assert.equal(retainedStartMessage(NAME, unanswered), `OATS could not confirm that ${NAME} finished starting: blocked: unexpected prompt. Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`);
  // The Enter was sent and its completion was not seen: blocked, with the answer. The second part is keyed on the answer.
  const unseen = retainedSpawnDetails({ ...retained({ instance: NAME, home: HOME }), launchPrompts: observationTimeout() });
  assert.equal(retainedStartMessage(NAME, unseen), `OATS could not confirm that ${NAME} finished starting: blocked: observation timeout. A launch-prompt answer was submitted; this does not confirm readiness. Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`);
  // Never "failed" and never "started"; an unknown reason is inspection-only.
  for (const d of [blocked, incomplete, unanswered, unseen]) assert.doesNotMatch(retainedStartMessage(NAME, d), /failed to start|was started|oats session start|--home/);
  assert.match(retainedStartMessage(NAME, { launchPrompts: { status: "blocked", reason: "a new reason" } }), /finished starting: Launch requires inspection\. Its session was kept\./);
});

test("both hops between the server and the dialog carry `incomplete`, decoded again, and only beside E_SPAWN_INCOMPLETE", async () => {
  const body = refusal("blocked", { differed: differed() });
  const fromShell = httpError({ ok: false, status: 409, body }, "/api/start/x");
  assert.deepEqual(fromShell.incomplete, body.incomplete); assert.equal(fromShell.code, "E_SPAWN_INCOMPLETE");
  const fromFetch = await apiJson({ api: viaFetch(body) }, "/api/start/x").catch((e) => e);
  assert.deepEqual(fromFetch.incomplete, body.incomplete); assert.equal(fromFetch.message, body.error);
  // Decoded again: what the reader does not list is not carried.
  const padded = { ...body, incomplete: { ...body.incomplete, command: "PRIVATE", launchPrompts: { ...body.incomplete.launchPrompts, screen: "PRIVATE" } } };
  assert.doesNotMatch(JSON.stringify(httpError({ ok: false, status: 409, body: padded }, "/x").incomplete), /PRIVATE/);
  for (const bad of [{ ...body, code: "E_BUSY" }, { ...body, code: undefined }, { ...body, incomplete: null }, { ...body, incomplete: "x" },
    { ...body, incomplete: { ...body.incomplete, home: "relative" } }, { ...body, incomplete: { instance: NAME, home: HOME, launched: "unknown" } }]) {
    assert.equal(Object.hasOwn(httpError({ ok: false, status: 409, body: bad }, "/x"), "incomplete"), false, JSON.stringify(bad).slice(0, 80));
    assert.equal(Object.hasOwn(await apiJson({ api: viaFetch(bad) }, "/x").catch((e) => e), "incomplete"), false);
  }
});

for (const [hop, via] of [["the shell's ctx.api", viaShell], ["a fetch-shaped ctx.api", viaFetch]]) {
  test(`Start dialog (${hop}): the Desktop's sentence is the status; what differed and the kernel's message sit under it`, async () => {
    const body = refusal("blocked", { differed: differed({ index: 212 }) });
    const s = setup({ start: via(body) });
    try {
      await tick(); s.submit(); await tick(); await tick();
      const status = s.q(".start-status"), outcome = s.q(".start-outcome");
      assert.equal(status.textContent, retainedStartMessage(NAME, body.incomplete));
      assert.match(status.textContent, /^OATS could not confirm that accountant-minerva finished starting: blocked: unexpected prompt\./);
      // The kernel's command-line sentence is never the dialog's own text.
      assert.doesNotMatch(status.textContent, /oats session start|--home|never broaden the matcher|\/workspace\//);
      assert.equal(status.textContent.includes(FOUND), false);
      assert.equal(outcome.hidden, false); assert.equal(status.contains(outcome), false); assert.equal(status.nextElementSibling, outcome);
      const [group, says] = outcome.children;
      assert.equal(group.className, "launch-differed");
      assert.deepEqual([...group.querySelectorAll(".source-quote-lead")].map((n) => n.textContent), ["OATS expected:", "The terminal showed:"]);
      assert.deepEqual([...group.querySelectorAll("blockquote")].map((n) => n.textContent), [EXPECTED, FOUND]);
      // The kernel's message: a paragraph with the lead-in, the message one display line alone in its <bdi>.
      assert.equal(says.tagName, "P"); assert.equal(says.className, "start-kernel-says");
      assert.equal(says.childNodes[0].textContent, "OATS says: ");
      assert.equal(says.querySelector("bdi").textContent, body.error); assert.equal(says.querySelectorAll("bdi").length, 1);
      assert.equal(says.querySelector(".source-quote"), null);
      assert.ok(s.modal.querySelector("style").textContent.includes(".source-quote-text") && s.modal.querySelector("style").textContent.includes(".launch-differed-lead"));
      // As after any failed start: the act is not offered again until Refresh status.
      assert.equal(s.q(".start-submit").disabled, true); assert.equal(s.q(".start-retry").disabled, false);
      s.submit(); await tick();
      assert.equal(s.starts(), 1);
      assert.equal(s.modal.isConnected, true); assert.deepEqual(s.opened, []);
    } finally { s.cleanup(); }
  });
}

test("Start dialog: an Enter whose completion was not seen (0.52: blocked, the Enter in answers) says an answer was submitted; claudeSessionShown is not read", async () => {
  for (const prompts of [observationTimeout(), observationTimeout({ differed: differed(), claudeSessionShown: true })]) {
    const details = { ...retained({ instance: NAME, home: HOME }), launchPrompts: prompts };
    const body = { error: observationTimeoutMessage(HOME), code: "E_SPAWN_INCOMPLETE", incomplete: retainedSpawnDetails(details) };
    assert.equal(Object.hasOwn(body.incomplete.launchPrompts, "claudeSessionShown"), false);
    const s = setup({ start: viaShell(body) });
    try {
      await tick(); s.submit(); await tick(); await tick();
      assert.equal(s.q(".start-status").textContent, `OATS could not confirm that ${NAME} finished starting: blocked: observation timeout. A launch-prompt answer was submitted; this does not confirm readiness. Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`);
      // What differed shows when the kernel kept a screen; the kernel's sentence, quoted, carries the rest.
      assert.equal(s.q(".start-outcome .launch-differed") !== null, Object.hasOwn(prompts, "differed"));
      if (prompts.differed) assert.deepEqual(body.incomplete.launchPrompts.differed, DIFFERED);
      assert.equal(s.q(".start-kernel-says bdi").textContent, body.error);
      assert.equal(s.q(".start-submit").disabled, true); assert.equal(s.modal.isConnected, true); assert.deepEqual(s.opened, []);
    } finally { s.cleanup(); }
  }
});

test("Start dialog: without differed there are no lines; the kernel's message is filtered and stays text", async () => {
  const body = { ...refusal("incomplete"), error: "launch prompt audit failed after possible input; <b>home</b>\u202E and\tpane retained" };
  const s = setup({ start: viaShell(body) });
  try {
    await tick(); s.submit(); await tick(); await tick();
    assert.match(s.q(".start-status").textContent, /finished starting: launch prompt audit failed after possible input\. Input may already have been sent\. Its session was kept\./);
    const outcome = s.q(".start-outcome");
    assert.equal(outcome.querySelector(".launch-differed"), null);
    assert.equal(outcome.children.length, 1);
    assert.equal(outcome.querySelector("bdi").textContent, "launch prompt audit failed after possible input; <b>home</b>\uFFFD and pane retained");
    assert.equal(outcome.querySelector("b"), null);
  } finally { s.cleanup(); }
});

test("Start dialog: after Refresh status the lines go, and a kept session is offered as Open terminal, never as another Start", async () => {
  const s = setup({ start: viaShell(refusal("blocked", { differed: differed() })) });
  try {
    await tick(); s.submit(); await tick(); await tick();
    assert.equal(s.q(".start-outcome").hidden, false);
    s.state.running = true; // the retained session is there
    s.q(".start-retry").click(); await tick(); await tick();
    assert.equal(s.q(".start-outcome").hidden, true); assert.equal(s.q(".start-outcome").children.length, 0);
    assert.equal(s.q(".start-status").textContent, "This instance is already running.");
    assert.equal(s.q(".start-submit").textContent, "Open terminal"); assert.equal(s.q(".start-submit").disabled, false);
    s.submit(); await tick();
    assert.equal(s.starts(), 1); assert.equal(s.opened.length, 1);
  } finally { s.cleanup(); }
});

test("Restart dialog: the same sentence and lines; after Refresh status it offers Restart again, as after any failed restart", async () => {
  const body = refusal("blocked", { differed: differed() });
  const s = setup({ restart: true, running: true, start: viaShell(body) });
  try {
    await tick();
    assert.equal(s.q(".start-submit").textContent, "Restart");
    s.submit(); await tick(); await tick();
    assert.equal(s.calls.some((c) => c.path.startsWith("/api/restart/")), true);
    assert.equal(s.q(".start-status").textContent, retainedStartMessage(NAME, body.incomplete));
    assert.equal(s.q(".start-outcome .launch-differed blockquote").textContent, EXPECTED);
    assert.equal(s.q(".start-submit").disabled, true);
    s.q(".start-retry").click(); await tick(); await tick();
    assert.equal(s.q(".start-outcome").hidden, true);
    assert.equal(s.q(".start-submit").textContent, "Restart"); assert.equal(s.q(".start-submit").disabled, false);
  } finally { s.cleanup(); }
});

test("Start dialog: a routed host's retained outcome reads the same", async () => {
  const body = refusal("blocked", { differed: differed() });
  const s = setup({ server: "build", start: viaShell(body) });
  try {
    await tick(); s.submit(); await tick(); await tick();
    assert.equal(s.q(".start-status").textContent, retainedStartMessage(NAME, body.incomplete));
    assert.equal(s.q(".start-outcome .launch-differed") !== null, true);
  } finally { s.cleanup(); }
});

test("Start dialog: a refusal that carries no decodable outcome shows as before", async () => {
  const message = kernelMessage("blocked: unexpected prompt");
  for (const body of [{ error: message, code: "E_SPAWN_INCOMPLETE" }, { error: message, code: "E_SPAWN_INCOMPLETE", incomplete: { instance: NAME, home: "relative", launched: "unknown" } },
    { error: "Another start is running", code: "E_BUSY", incomplete: refusal().incomplete }, { error: "HTTP 500" }]) {
    const s = setup({ start: viaShell(body) });
    try {
      await tick(); s.submit(); await tick(); await tick();
      assert.equal(s.q(".start-status").textContent, body.error);
      assert.equal(s.q(".start-outcome").hidden, true); assert.equal(s.q(".start-outcome").children.length, 0);
      assert.equal(s.q(".start-submit").disabled, true);
    } finally { s.cleanup(); }
  }
});
