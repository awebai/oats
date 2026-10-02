// The Deployments page (UI spec, #482; it replaces the Active overview): All, the overview canvas split into
// one section per deployment, and one tab per deployment showing only that deployment's tree. DOM and
// computed-token checks in jsdom; no Electron, HTTP or CLI. (The first tests moved here from
// workspace-views-ui.test.mjs, which keeps the sidebar, the switcher and the scope line.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from "../renderer/instance-action-target.mjs";
import { instanceSplitPlan } from "../renderer/instance-split.mjs";
import { runtimeState, unsupportedSession } from "../renderer/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../renderer/remote-address.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";
import * as vd from "../renderer/view-deployments.mjs";
import * as hierarchy from "../renderer/views/hierarchy.mjs";
import { createWorkspaceSwitcher, workspaceChoiceLabels, workspaceChoicePlace, UNMATCHED_SECTION } from "../renderer/workspace-switcher.mjs";
import { mountShellIcons } from "../renderer/shell-icons.mjs";
import { deploymentScopeLabel, createDeploymentScopeLine, deploymentScopeCSS } from "../renderer/deployment-scope-line.mjs";
import { createAutomationsView, automationsCSS } from "../renderer/views/automations.mjs";
import { currentWorkspace, setWorkspace } from "../renderer/views/common.mjs";
import { viewContext } from "./helpers/view-context.mjs";

const read = (name) => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), theme = read("theme.css"), html = read("index.html"), shellSource = read("shell.mjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));

const LOCAL = { id: "/Users/op/Agents/oats", machine: "This Mac", path: "/Users/op/Agents/oats", label: "~/Agents/oats", local: true,
  reachable: true, identityFrom: "reported", primary: true };
const ALTAIR = { id: "remote:altair:tsm", machine: "altair", path: "/home/op/Agents/tsm", label: "~/Agents/tsm", local: false,
  reachable: false, identityFrom: "remembered", primary: false, reason: "altair timed out; it is tried again on the next read.",
  note: "altair now reports workspace tsm." };
const tag = (d) => ({ id: d.id, machine: d.machine, path: d.path });
const row = (name, d, fields = {}) => ({ instance: name, agent: "soul", agentsRoot: `${d.path}/agents`, home: `${d.path}/agents/soul/instances/${name}`,
  repoName: "repo", running: true, deployment: tag(d), ...(d.local ? {} : { server: d.machine, addressable: true }), ...fields });


/* ── the Active overview ── */
async function overview(t, data) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: "http://localhost" });
  const doc = dom.window.document, host = doc.querySelector("main");
  const old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.window = dom.window; globalThis.document = doc; globalThis.setInterval = () => 0;
  setWorkspace("ws:view");
  const style = doc.createElement("style"); style.textContent = theme; doc.head.append(style);
  const dispose = hierarchy.mount(host, { hasWorkspaceSwitcher: true, api: async () => ({ ok: true, status: 200, json: async () => data }), openTerminal() {} });
  t.after(() => { dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick(); await tick();
  return { dom, doc, host, all: (s) => [...host.querySelectorAll(s)] };
}
const view = { id: "ws:view", name: "oats" };

test("Active overview, one deployment: no deployment section, the same layout as before", async (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("solo", LOCAL)];
  const u = await overview(t, { instances: rows, workspace: view, workspaces: [{ ...view, deployments: [LOCAL.id] }], deployments: [LOCAL] });
  assert.equal(u.all(".hier-deployment").length, 0); assert.equal(u.all(".hier-dhead").length, 0);
  assert.equal(u.all(".hier-cluster").length, 1); assert.equal(u.all(".hier-solo .hnode").length, 1);
  assert.equal(hierarchy.layoutByDeployment(rows, [LOCAL]), null);
  assert.ok(u.host.querySelector(".hier-stage > .hier-cluster"), "groups sit on the stage as always");
});

test("Active overview, two deployments: one labelled section per deployment, stacked, each with its own groups", async (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR), row("near", LOCAL)];
  const u = await overview(t, { instances: rows, workspace: view, workspaces: [{ ...view, deployments: [LOCAL.id, ALTAIR.id] }], deployments: [LOCAL, ALTAIR] });
  const sections = u.all(".hier-deployment");
  assert.deepEqual(sections.map((s) => s.getAttribute("aria-label")), ["This Mac · ~/Agents/oats, primary", "altair · ~/Agents/tsm, remembered"]);
  assert.deepEqual(sections.map((s) => s.getAttribute("role")), ["group", "group"]);
  const heads = u.all(".hier-dhead");
  assert.deepEqual(heads.map((h) => h.querySelector(".hier-dname").textContent), ["This Mac · ~/Agents/oats", "altair · ~/Agents/tsm"]);
  assert.equal(heads[0].querySelector(".hier-dtag").textContent, "primary"); assert.equal(heads[1].querySelector(".hier-dstate").textContent, "remembered");
  assert.ok(parseFloat(heads[1].style.top) > parseFloat(heads[0].style.top), "stacked in the panel's order");
  assert.deepEqual([...sections[0].querySelectorAll(".hnode")].map((n) => n.dataset.name).sort(), ["dev", "lead", "near"]);
  assert.deepEqual([...sections[1].querySelectorAll(".hnode")].map((n) => n.dataset.name), ["far"]);
  // Each deployment's Independent strip is its own keyboard group.
  assert.deepEqual(u.all(".hier-solo").map((g) => g.dataset.ws), [`Independent:${LOCAL.id}`, `Independent:${ALTAIR.id}`]);
  const layout = hierarchy.layoutByDeployment(rows, [LOCAL, ALTAIR]);
  const [a, b] = layout.sections;
  assert.ok(b.y >= a.y + a.height, "the second section starts below the first");
  assert.ok(a.placed.every((p) => p.y >= a.y), "blocks are in stage coordinates under their heading");
});

