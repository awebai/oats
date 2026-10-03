import test from "node:test";
import assert from "node:assert/strict";
import { remoteWorkspace, remotePanel, remoteAgents, unavailableGroups, spawnedWorkspace } from "../server/remote-roster.mjs";
import { HERDR_REMOVED } from "../renderer/terminal-contract.mjs";
import { waitingClaim } from "../renderer/waiting-on-you.mjs";
import { kernelRemoteRow, kernelGoneRow, kernelRemoteGroup } from "./helpers/kernel-remote-row.mjs";

const group = {
  id: "host-abc", server: "host", label: "Build server", registrationPresent: true,
  target: { workspace: "/remote/project" }, probe: { ok: true }, agentsRoot: "/remote/project/agents",
  souls: [{ name: "dev", runtime: "codex" }],
  instances: [{ instance: "dev-one", agent: "dev", home: "/remote/home", running: true, savedRoute: true }],
};

test("remote roster projects server identity and souls without local path resolution", () => {
  assert.equal(remoteWorkspace(group).id, "remote:host-abc");
  const panel = remotePanel(group);
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
  assert.equal(remotePanel(removed).instances.length, 1);
  assert.equal(remotePanel(removed).workspace.registrationPresent, false);
  assert.equal(remotePanel({ ...group, registrationPresent: undefined }).workspace.registrationPresent, false);
  assert.equal(remotePanel({ ...group, registrationPresent: "true" }).workspace.registrationPresent, false);
  assert.deepEqual(remoteAgents(removed), []);
  const [unreachable] = unavailableGroups([removed], { code: "E_SSH", message: "Connection refused" });
  const panel = remotePanel(unreachable);
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
  ] });
  const [fresh, old, tmux] = panel.instances;
  assert.deepEqual([fresh.running, fresh.runtimeState, fresh.runtimeError], [null, "unsupported", `${stem} (h-new)`]);
  assert.deepEqual([old.running, old.runtimeState, old.runtimeError], [null, "unsupported", stem]);
  assert.equal(tmux.running, true); assert.equal(tmux.runtimeError, undefined);
  assert.equal(panel.running, 1);
});

test("Needs input: a remote row's waitingOnYou is validated (malformed → null), passed through when valid, never synthesized", () => {
  const claim = { since: "2026-10-03T10:00:00.000Z", producer: "pi-extension", reason: "attention", message: "Review <b>this</b>" };
  const row = waitingOnYou => remotePanel(kernelRemoteGroup([kernelRemoteRow("dev-one", { waitingOnYou })])).instances[0];
  assert.deepEqual(row({ ...claim, extra: 1 }).waitingOnYou, claim);
  assert.equal(row({ ...claim, since: "now" }).waitingOnYou, null);
  assert.equal(row({ ...claim, producer: "token=abc123" }).waitingOnYou, null);
  assert.equal(row("yes").waitingOnYou, null);
  assert.equal(row(null).waitingOnYou, null, "a reported null stays null (unknown)");
  assert.equal(row({ ...claim, message: "x".repeat(201) }).waitingOnYou.message, null, "an oversized note keeps the claim");
  assert.equal(Object.hasOwn(remotePanel(kernelRemoteGroup()).instances[0], "waitingOnYou"), false, "a remote kernel without the feature: absent stays absent");
  // An unreached server keeps last-known rows: the field rides along, and the renderer's gate (serverUnreached) hides it.
  const [group] = unavailableGroups([kernelRemoteGroup([kernelRemoteRow("dev-one", { waitingOnYou: claim })])], { code: "E_SSH", message: "Connection refused" });
  const unreached = remotePanel(group).instances[0];
  assert.deepEqual([unreached.serverUnreached, unreached.running], [true, null]);
  assert.deepEqual(unreached.waitingOnYou, claim);
});

// #582: the kernel's remote roster sends `runtimeState: null` on every row (lib/servers.mjs, rowFacts). The
// rows here are in that shape, projected by the shipped remotePanel and read through the shipped gate. The
// full rosterGroups → remotePanel → waitingClaim run lives in the kernel's suite (Desktop tests never import lib/).
test("Needs input (#582): a kernel-shaped remote row (runtimeState null) shows its claim through remotePanel and waitingClaim", () => {
  const claim = { since: "2026-10-03T10:00:00.000Z", producer: "oats.core", reason: "question", message: "Which branch?" };
  const panel = (instances, extra) => remotePanel(kernelRemoteGroup(instances, extra)).instances;
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
  assert.equal(waitingClaim(remotePanel(unreachedGroup).instances[0]), null, "last-known rows of an unreached server");
  assert.equal(waitingClaim(running, { stale: true }), null, "a row the roster holds stale");
  assert.equal(waitingClaim(panel([kernelRemoteRow("dev-one")])[0]), null, "no field (an older remote kernel): unknown");
  assert.equal(waitingClaim(panel([kernelRemoteRow("dev-one", { waitingOnYou: null })])[0]), null, "a reported null: unknown");
});
