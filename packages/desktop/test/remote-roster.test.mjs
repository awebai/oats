import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { remoteWorkspace, remotePanel, remoteAgents, unavailableGroups, spawnedWorkspace } from "../../client/remote-roster.mjs";
import { HERDR_REMOVED } from "../../client/terminal-contract.mjs";
import { waitingClaim } from "../../client/waiting-on-you.mjs";
import { kernelRemoteRow, kernelGoneRow, kernelRemoteGroup } from "./helpers/kernel-remote-row.mjs";
/** The time a remote panel is made at: remotePanel reads no clock, its caller gives the time. */
const AT = "2026-10-11T12:00:00.000Z";

const group = {
  id: "host-abc", server: "host", label: "Build server", registrationPresent: true,
  target: { workspace: "/remote/project" }, probe: { ok: true }, agentsRoot: "/remote/project/agents",
  souls: [{ name: "dev", runtime: "codex" }],
  instances: [{ instance: "dev-one", agent: "dev", home: "/remote/home", running: true, savedRoute: true }],
};

test("remote roster projects server identity and souls without local path resolution", () => {
  assert.equal(remoteWorkspace(group).id, "remote:host-abc");
  const panel = remotePanel(group, AT);
  assert.equal(panel.workspace.registrationPresent, true);
  assert.equal(panel.workspace.scope, "/remote/project");
  assert.equal(panel.instances[0].server, "host");
  assert.equal(panel.instances[0].home, "/remote/home");
  assert.equal(panel.instances[0].agentsRoot, "/remote/project/agents");
  assert.equal(panel.running, 1);
  assert.equal(remoteAgents(group)[0].server, "host");
  assert.equal(remoteAgents(group)[0].harness, "codex", "a pre-0.27 host's runtime reads as the harness");
  assert.equal(Object.hasOwn(remoteAgents(group)[0], "runtime"), false);
  assert.equal(remoteAgents({ ...group, souls: [{ name: "dev", harness: "claude" }] })[0].harness, "claude", "0.27 rows carry harness");
  assert.equal(remoteAgents({ ...group, souls: [{ name: "dev" }] })[0].harness, null, "an unreported harness is never guessed as pi");
});

test("spawn handoff matches the actual remote target, preserving old route groups", () => {
  const old = { ...group, id: "old", registrationPresent: false, target: { sshHost: "old", workspace: "/old" } };
  const current = { ...group, id: "current", target: { sshHost: "new", workspace: "/new" } };
  assert.equal(spawnedWorkspace([old, current], { server: "host", target: current.target }), "remote:current");
  assert.equal(spawnedWorkspace([old, current], { server: "host", target: old.target }), undefined);
  assert.equal(spawnedWorkspace([old, current], { server: "host" }), undefined);
});

test("removed registration keeps saved instances while unreachable means unknown, not stopped", () => {
  const removed = { ...group, registrationPresent: false };
  assert.equal(remotePanel(removed, AT).instances.length, 1);
  assert.equal(remotePanel(removed, AT).workspace.registrationPresent, false);
  assert.equal(remotePanel({ ...group, registrationPresent: undefined }, AT).workspace.registrationPresent, false);
  assert.equal(remotePanel({ ...group, registrationPresent: "true" }, AT).workspace.registrationPresent, false);
  assert.deepEqual(remoteAgents(removed), []);
  const [unreachable] = unavailableGroups([removed], { code: "E_SSH", message: "Connection refused" });
  const panel = remotePanel(unreachable, AT);
  assert.equal(panel.instances[0].running, null);
  assert.equal(panel.instances[0].savedRoute, true);
  assert.equal(panel.instances[0].runtimeError, "Connection refused");
  assert.equal(panel.error, "Connection refused");
});

test("a remote Herdr row is unsupported with the kernel's reason, from a 0.31 or an older remote kernel", () => {
  const stem = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
  const panel = remotePanel({ ...group, instances: [
    { instance: "h-new", agent: "dev", home: "/remote/h-new", running: null, savedRoute: true, runtimeState: "unsupported", runtimeError: `${stem} (h-new)` },
    { instance: "h-old", agent: "dev", home: "/remote/h-old", running: true, savedRoute: true, backend: "herdr", runtimeError: "Herdr snapshot unavailable" },
    { instance: "t-one", agent: "dev", home: "/remote/t-one", running: true, savedRoute: true, backend: "tmux" },
  ] }, AT);
  const [fresh, old, tmux] = panel.instances;
  assert.deepEqual([fresh.running, fresh.runtimeState, fresh.runtimeError], [null, "unsupported", `${stem} (h-new)`]);
  assert.deepEqual([old.running, old.runtimeState, old.runtimeError], [null, "unsupported", stem]);
  assert.equal(tmux.running, true); assert.equal(tmux.runtimeError, undefined);
  assert.equal(panel.running, 1);
});

test("Needs input: a remote row's waitingOnYou is validated (malformed → null), passed through when valid, never synthesized", () => {
  const claim = { since: "2026-10-03T10:00:00.000Z", producer: "pi-extension", reason: "attention", message: "Review <b>this</b>" };
  const row = waitingOnYou => remotePanel(kernelRemoteGroup([kernelRemoteRow("dev-one", { waitingOnYou })]), AT).instances[0];
  assert.deepEqual(row({ ...claim, extra: 1 }).waitingOnYou, claim);
  assert.equal(row({ ...claim, since: "now" }).waitingOnYou, null);
  assert.equal(row({ ...claim, producer: "token=abc123" }).waitingOnYou, null);
  assert.equal(row("yes").waitingOnYou, null);
  assert.equal(row(null).waitingOnYou, null, "a reported null stays null (unknown)");
  assert.equal(row({ ...claim, message: "x".repeat(201) }).waitingOnYou.message, null, "an oversized note keeps the claim");
  assert.equal(Object.hasOwn(remotePanel(kernelRemoteGroup(), AT).instances[0], "waitingOnYou"), false, "a remote kernel without the feature: absent stays absent");
  // An unreached server keeps last-known rows: the field rides along, and the renderer's gate (serverUnreached) hides it.
  const [group] = unavailableGroups([kernelRemoteGroup([kernelRemoteRow("dev-one", { waitingOnYou: claim })])], { code: "E_SSH", message: "Connection refused" });
  const unreached = remotePanel(group, AT).instances[0];
  assert.deepEqual([unreached.serverUnreached, unreached.running], [true, null]);
  assert.deepEqual(unreached.waitingOnYou, claim);
});

// #582: the kernel's remote roster sends `runtimeState: null` on every row (lib/servers.mjs, rowFacts). The
// rows here are in that shape, projected by the shipped remotePanel and read through the shipped gate. The
// full rosterGroups → remotePanel → waitingClaim run lives in the kernel's suite (Desktop tests never import lib/).
test("Needs input (#582): a kernel-shaped remote row (runtimeState null) shows its claim through remotePanel and waitingClaim", () => {
  const claim = { since: "2026-10-03T10:00:00.000Z", producer: "oats.core", reason: "question", message: "Which branch?" };
  const panel = (instances, extra) => remotePanel(kernelRemoteGroup(instances, extra), AT).instances;
  const [running] = panel([kernelRemoteRow("dev-one", { waitingOnYou: claim })]);
  assert.equal(running.runtimeState, null, "the projection keeps the kernel's null: not reported");
  assert.equal(running.running, true);
  assert.deepEqual(waitingClaim(running), claim, "not reported is not “not running”");
  // Everything that still hides it, on the same row.
  const [stopped] = panel([kernelRemoteRow("dev-one", { running: false, tmux: undefined, waitingOnYou: claim })]);
  assert.equal(waitingClaim(stopped), null, "the host says it is not running");
  const [unknown] = panel([kernelRemoteRow("dev-one", { running: null, runtimeState: "unreachable", runtimeError: "tmux is unavailable", waitingOnYou: claim })]);
  assert.equal(waitingClaim(unknown), null, "the host could not tell (unreachable)");
  const [herdr] = panel([kernelRemoteRow("dev-one", { running: null, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: gone", waitingOnYou: claim })]);
  assert.deepEqual([herdr.runtimeState, waitingClaim(herdr)], ["unsupported", null]);
  const [oldHerdr] = panel([kernelRemoteRow("dev-one", { backend: "herdr", waitingOnYou: claim })]);
  assert.deepEqual([oldHerdr.running, oldHerdr.runtimeState, waitingClaim(oldHerdr)], [null, "unsupported", null], "an older kernel's Herdr row, running by its own report");
  // A saved route the host no longer lists: the kernel never puts the field on it, and nothing is known.
  const [gone] = panel([kernelGoneRow("dev-gone")]);
  assert.deepEqual([Object.hasOwn(gone, "waitingOnYou"), gone.running, waitingClaim(gone)], [false, null, null]);
  assert.equal(waitingClaim({ ...gone, waitingOnYou: claim }), null, "and would not show one: its state is unknown");
  const [unreachedGroup] = unavailableGroups([kernelRemoteGroup([kernelRemoteRow("dev-one", { waitingOnYou: claim })])], { code: "E_SSH", message: "Connection refused" });
  assert.equal(waitingClaim(remotePanel(unreachedGroup, AT).instances[0]), null, "last-known rows of an unreached server");
  assert.equal(waitingClaim(running, { stale: true }), null, "a row the roster holds stale");
  assert.equal(waitingClaim(panel([kernelRemoteRow("dev-one")])[0]), null, "no field (an older remote kernel): unknown");
  assert.equal(waitingClaim(panel([kernelRemoteRow("dev-one", { waitingOnYou: null })])[0]), null, "a reported null: unknown");
});

test("#675: a remote row's description comes from its own group's soul, as reported, never synthesized", () => {
  const described = { ...group, souls: [{ name: "dev", description: "Builds the desktop app." }, { name: "ops", description: "Runs ops." }] };
  assert.equal(remotePanel(described, AT).instances[0].description, "Builds the desktop app.");
  for (const souls of [[{ name: "dev" }], [{ name: "dev", description: 42 }], [{ name: "dev", description: null }], [], undefined, [{ name: "ops", description: "Runs ops." }]]) {
    assert.equal(remotePanel({ ...group, souls }, AT).instances[0].description, null, JSON.stringify(souls));
  }
  // A same-named soul in another group is never used.
  const other = { ...group, id: "other", server: "other", souls: [{ name: "dev", description: "Another host's dev." }] };
  const bare = { ...group, souls: [] };
  assert.equal(remotePanel(bare, AT).instances[0].description, null);
  assert.equal(remotePanel(other, AT).instances[0].description, "Another host's dev.");
  assert.equal(remotePanel(bare, AT).instances[0].description, null, "projection is per group");
});

test("a remote panel is stamped with the time its caller gives, and the module reads no clock", (t) => {
  // The clock is another year than the time given: an answer that read it would hold that year.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2031-03-04T05:06:07.000Z") });
  assert.equal(remotePanel(group, "2026-10-11T12:00:00.000Z").generatedAt, "2026-10-11T12:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(remotePanel(group, AT)), /2031-/);
  assert.deepEqual({ ...remotePanel(group, "x"), generatedAt: null }, { ...remotePanel(group, AT), generatedAt: null }, "the time is the panel's stamp and nothing else of it");
  // Not by a default argument, a fallback or a comment's promise: the source names no `Date` at all.
  assert.doesNotMatch(readFileSync(new URL("../../client/remote-roster.mjs", import.meta.url), "utf8"), /\bDate\b/);
});

test("a remote panel made without a time throws, naming the argument: there is no default", () => {
  for (const at of [undefined, null, "", 0, 1760184000000, new Date(0), {}]) {
    assert.throws(() => remotePanel(group, at), (error) => error instanceof TypeError && /^remotePanel: at must be the time of the call, a non-empty string$/.test(error.message), String(at));
  }
  assert.throws(() => remotePanel(group), TypeError);
  // The index a bare `groups.forEach(remotePanel)` passes is not a time.
  assert.throws(() => [group].forEach(remotePanel), TypeError);
  assert.equal([group].map((g) => remotePanel(g, AT)).length, 1);
});

// ── Who made a remote row's runtimeError (#982) ──────────────────────────────
// The mark of an error the installed CLI printed is set where its answer is parsed (cli-adapter.mjs), so
// these tests get a marked error the way a client does: by parsing what the CLI printed.
import { parseEnvelope, cliRemoteRoster } from "../../client/cli-adapter.mjs";
const printedError = (error) => parseEnvelope(JSON.stringify({ schemaVersion: 1, ok: false, error })).error;
const ORIGINS = ["kernel", "terminal-probe", "roster-read"];
const STEM = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
const said = (panel) => Object.fromEntries(panel.instances.map((i) => [i.instance, [i.runtimeError, i.runtimeErrorOrigin, Object.hasOwn(i, "runtimeErrorOrigin")]]));
const NO_KEY = (text) => [text, undefined, false];

test("a remote row's runtimeError says who made it, by the place that chose the text, and the text is the base's", () => {
  const rows = [kernelRemoteRow("up"), kernelRemoteRow("lost", { running: null, runtimeState: "unreachable", runtimeError: "error connecting to /x/tmux.sock" }),
    kernelRemoteRow("empty", { running: null, runtimeError: "" })];
  // The server was read: a row's text is the host's own, relayed by this machine's OATS.
  assert.deepEqual(said(remotePanel(kernelRemoteGroup(rows), AT)),
    { up: NO_KEY(undefined), lost: ["error connecting to /x/tmux.sock", "kernel", true], empty: NO_KEY("") });
  // Not reached, with an error the installed CLI printed: the kernel's, on every row.
  const refused = printedError({ code: "E_SSH", message: "ssh: connect to host build port 22: Connection refused" });
  const [kernels] = unavailableGroups([kernelRemoteGroup(rows)], refused);
  assert.deepEqual(said(remotePanel(kernels, AT)), Object.fromEntries(rows.map((r) => [r.instance, ["ssh: connect to host build port 22: Connection refused", "kernel", true]])));
  assert.ok(remotePanel(kernels, AT).instances.every((i) => i.serverUnreached === true && i.running === null));
  // Not reached, with an error written while the roster was read: the client's.
  const [reads] = unavailableGroups([kernelRemoteGroup(rows)], { code: "E_REMOTE_ROSTER", message: "Remote roster unavailable: spawn oats ENOENT" });
  assert.deepEqual(said(remotePanel(reads, AT)), Object.fromEntries(rows.map((r) => [r.instance, ["Remote roster unavailable: spawn oats ENOENT", "roster-read", true]])));
  // Not reached and no message to show: the sentence written here, whoever made the error.
  for (const error of [undefined, null, {}, { code: "E_X" }, printedError({ code: "E_X" }), printedError({ code: "E_X", message: "" })]) {
    const [bare] = unavailableGroups([kernelRemoteGroup(rows)], error);
    assert.deepEqual(said(remotePanel(bare, AT)), Object.fromEntries(rows.map((r) => [r.instance, ["Server is unreachable", "roster-read", true]])), JSON.stringify(error));
  }
  // A message that is not a string is shown as the base shows it, and is no runtimeError: no key.
  const [odd] = unavailableGroups([kernelRemoteGroup([kernelRemoteRow("up")])], printedError({ code: "E_X", message: 5 }));
  assert.deepEqual(said(remotePanel(odd, AT)), { up: NO_KEY(5) });
});

test("a remote Herdr row: the kernel for the host's own reason, no speaker for the stand-in, and the Herdr rule wins on a server that was not reached", () => {
  const rows = [kernelRemoteRow("h-new", { running: null, runtimeState: "unsupported", runtimeError: `${STEM} (h-new)` }),
    kernelRemoteRow("h-old", { backend: "herdr", runtimeError: "Herdr snapshot unavailable" }), kernelRemoteRow("h-bare", { running: null, runtimeState: "unsupported" })];
  const expected = { "h-new": [`${STEM} (h-new)`, "kernel", true], "h-old": NO_KEY(STEM), "h-bare": NO_KEY(STEM) };
  assert.deepEqual(said(remotePanel(kernelRemoteGroup(rows), AT)), expected);
  for (const error of [printedError({ code: "E_SSH", message: "ssh: no route" }), { code: "E_REMOTE_ROSTER", message: "Remote roster unavailable" }, undefined]) {
    const [unreached] = unavailableGroups([kernelRemoteGroup(rows)], error);
    assert.deepEqual(said(remotePanel(unreached, AT)), expected, JSON.stringify(error));
  }
});

test("the hostile row: a runtimeErrorOrigin another machine sent never survives, on a server that was reached and on one that was not", () => {
  for (const sent of [...ORIGINS, "the-host-says-so", "__proto__", 7, null, { kernel: true }]) {
    const rows = [kernelRemoteRow("up", { runtimeErrorOrigin: sent }), kernelRemoteRow("lost", { running: null, runtimeError: "the host's own text", runtimeErrorOrigin: sent }),
      kernelRemoteRow("h-old", { backend: "herdr", runtimeError: "Herdr snapshot unavailable", runtimeErrorOrigin: sent }),
      kernelRemoteRow("h-new", { running: null, runtimeState: "unsupported", runtimeError: `${STEM} (h-new)`, runtimeErrorOrigin: sent })];
    const herdr = { "h-old": NO_KEY(STEM), "h-new": [`${STEM} (h-new)`, "kernel", true] }, at = JSON.stringify(sent);
    // Reached: the key is what the shared home decided, or absent. A host that says "terminal-probe" does not
    // get its own text shown as this client's check speaking.
    assert.deepEqual(said(remotePanel(kernelRemoteGroup(rows), AT)), { up: NO_KEY(undefined), lost: ["the host's own text", "kernel", true], ...herdr }, at);
    // Not reached, by each maker of the error.
    const cases = [[printedError({ code: "E_SSH", message: "ssh: no route" }), "ssh: no route", "kernel"],
      [{ code: "E_REMOTE_ROSTER", message: "Remote roster unavailable: timeout" }, "Remote roster unavailable: timeout", "roster-read"], [undefined, "Server is unreachable", "roster-read"]];
    for (const [error, text, origin] of cases) {
      const [unreached] = unavailableGroups([kernelRemoteGroup(rows)], error);
      assert.deepEqual(said(remotePanel(unreached, AT)), { up: [text, origin, true], lost: [text, origin, true], ...herdr }, `${at}, ${text}`);
    }
  }
  // And a group that says it of itself, or of its error, changes nothing: the mark is not a key an answer can carry.
  const claimed = { ...kernelRemoteGroup([kernelRemoteRow("up")]), runtimeErrorOrigin: "kernel", errorOrigin: "kernel", probe: { ok: false, origin: "kernel", error: { code: "E_SSH", message: "the host's words", origin: "kernel", runtimeErrorOrigin: "kernel" } } };
  assert.deepEqual(said(remotePanel(JSON.parse(JSON.stringify(claimed)), AT)), { up: ["the host's words", "roster-read", true] });
});

test("the kernel's mark is set where the roster is parsed, and is nothing an answer can carry or a served group shows", async () => {
  const group = (probe) => ({ ...kernelRemoteGroup([kernelRemoteRow("up")]), probe });
  const printing = (document) => (_bin, _argv, _options, done) => done(null, JSON.stringify(document));
  // An answered roster: a group this machine's OATS could not reach carries the kernel's error.
  const answered = { schemaVersion: 1, ok: true, result: { groups: [group({ ok: false, error: { code: "E_SSH", message: "ssh: no route" } }), group({ ok: true })] } };
  const envelope = await cliRemoteRoster("/abs/oats", { exec: printing(answered) });
  assert.deepEqual(envelope, answered, "the envelope is what was printed, field for field");
  assert.equal(JSON.stringify(envelope), JSON.stringify(answered), "and nothing of the mark is in what a client would serve");
  assert.deepEqual(said(remotePanel(envelope.result.groups[0], AT)), { up: ["ssh: no route", "kernel", true] });
  // A copy of the error has no mark: it reads as the client's, never as the kernel's.
  const copied = structuredClone(envelope.result.groups[0]), spread = { ...envelope.result.groups[0], probe: { ok: false, error: { ...envelope.result.groups[0].probe.error } } };
  for (const copy of [copied, spread, JSON.parse(JSON.stringify(envelope.result.groups[0]))]) assert.deepEqual(said(remotePanel(copy, AT)), { up: ["ssh: no route", "roster-read", true] });
  // A probe error that is not an object is left as it is, and a group of an odd shape does not stop the read.
  const odd = { schemaVersion: 1, ok: true, result: { groups: [group({ ok: false, error: "ssh: no route" }), null, 7, "group", { probe: null }, group({ ok: false, error: null })] } };
  assert.deepEqual(await cliRemoteRoster("/abs/oats", { exec: printing(odd) }), odd);
});
