// The Spawn view's souls grid on team model v2 (0.30): /api/agents rows carry `teams`
// [{label, team|null, default, from, mapped}] and `defaultTeam`, and no longer `team`/`labels`
// (engineer, docs audit #280). The rows here are the REAL 0.30 kernel captures
// (test/fixtures/team-model-v2: Northwind, the local default `mine`, release-manager's own
// default engineering) through soulsData → agentsData, as the server builds them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import * as remote from "../server/remote-roster.mjs";
import { normalizeSoulColor } from "../renderer/soul-colors.mjs";
import { soulsData, deploymentStatusData } from "../deployment-data.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));
const v2 = (name) => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), "utf8"));
const DEPLOYMENT = "/fixture/base/northwind-workspace";
const CLI_OK = { ok: true, bin: "/seed/oats", version: "0.18.0", source: "path", required: { desktopApi: 1, range: ">=0.18.0 <0.21.0" }, probedAt: 1, tried: [] };

/** /api/agents rows from the real 0.30 captures, built by the server's own agentsData. */
function agentRows() {
  const source = readFileSync(new URL("../server/oats-web.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function agentsData("), end = source.indexOf("/* ── Model catalog", start);
  const agentsData = new Function("workspaceById", "workspaces", "snapshot", "remote", "dirname", "resolve", "normalizeSoulColor",
    `${source.slice(start, end)}; return agentsData;`);
  const roster = deploymentStatusData(v2("status"), DEPLOYMENT), catalog = soulsData(v2("souls"));
  const snapshot = { byWs: new Map([[DEPLOYMENT, { deployment: { status: "observed", root: roster.root, souls: roster.agents.map(({ instances: _i, ...s }) => s),
    catalog: { souls: catalog.souls, ambiguous: [], reason: null } } }]]) };
  const ws = { id: DEPLOYMENT, name: "northwind", roots: [roster.root] };
  return agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents;
}

async function mountGrid(t, agents) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><div id=host></div></body></html>", { url: "http://localhost" });
  const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, setInterval: () => ({ fake: true }) });
  const common = await import("../renderer/views/common.mjs");
  const spawn = await import("../renderer/views/spawn.mjs");
  const cli = await import("../renderer/views/cli-status.mjs");
  await cli.refreshCli({ api: async () => ({ ok: true, status: 200, json: async () => CLI_OK }) });
  const previous = common.currentWorkspace(); common.setWorkspace(DEPLOYMENT);
  spawn.mount(dom.window.document.getElementById("host"), { api(pathname) {
    if (pathname === "/api/cli" || pathname === "/api/cli/reprobe") return Promise.resolve(CLI_OK);
    if (pathname.startsWith("/api/agents")) return Promise.resolve({ agents });
    return Promise.resolve({ instances: [], workspace: { id: DEPLOYMENT }, workspaces: [] });
  }, openTerminal: () => {} });
  await tick(); await tick();
  t.after(() => { spawn.unmount(); common.setWorkspace(previous); Object.assign(globalThis, saved); dom.window.close(); });
  const doc = dom.window.document;
  // Board 3: Repo is the default grouping; Team is one click away.
  const groupBy = (key) => doc.querySelector(`.souls-group-by [data-group-by="${key}"]`).click();
  const groups = () => Object.fromEntries([...doc.querySelectorAll(".souls-group")].map((g) => [
    g.querySelector(".souls-group-name").textContent, [...g.querySelectorAll(".soul-card")].map((c) => c.dataset.agent)]));
  // A card's Team chips ("Team <label>"), the default marked (not painted: the board draws them alike).
  const chips = (name) => [...doc.querySelector(`.soul-card[data-agent="${name}"]`).querySelectorAll(".schip")]
    .filter((c) => c.querySelector(".schip-key").textContent === "Team").map((c) => [c.querySelector("b").textContent, c.dataset.default === "true"]);
  return { doc, groups, chips, groupBy };
}

test("0.30 rows: souls group by their default team, never 'No team'; chips list the soul's teams, the default first and marked", async (t) => {
  const rows = agentRows();
  const rm = rows.find((a) => a.name === "release-manager");
  assert.equal(Object.hasOwn(rm, "team") || Object.hasOwn(rm, "labels"), false, "0.30 rows carry neither team nor labels");
  assert.deepEqual(rm.defaultTeam, { label: "engineering", team: null, from: "soul" }, "captured: release-manager's own (unmapped) default");
  const u = await mountGrid(t, rows);
  // In Repo grouping (the default) a card lists every team it is in, the default first.
  assert.deepEqual(u.chips("release-manager"), [["engineering", true], ["global", false], ["mine", false]]);
  assert.deepEqual(u.chips("campaign-writer"), [["mine", true], ["global", false]]);
  u.groupBy("team");
  const groups = u.groups();
  assert.equal(Object.hasOwn(groups, "No team"), false, "no soul falls into 'No team'");
  assert.deepEqual(groups.engineering, ["release-manager"]);
  assert.deepEqual(Object.keys(groups).sort(), ["engineering", "mine"]);
  assert.ok(groups.mine.includes("campaign-writer") && groups.mine.length === rows.length - 1, "every other soul is in the local default, mine");
  // Grouped by team, the group's own team is not repeated: the card names its repository instead.
  assert.deepEqual(u.chips("release-manager"), [["global", false], ["mine", false]]);
  const repo = u.doc.querySelector('.soul-card[data-agent="release-manager"] .schip');
  assert.equal(repo.querySelector(".schip-key").textContent, "Repo"); assert.ok(repo.querySelector("b").textContent);
});

test("0.30: the default chip leads even when the kernel lists it later; a v2 soul with no default team says so", async (t) => {
  const base = agentRows().find((a) => a.name === "campaign-writer");
  const later = { ...structuredClone(base), name: "later", teams: [...structuredClone(base.teams)].reverse() };
  const none = { ...structuredClone(base), name: "none", defaultTeam: null, teams: structuredClone(base.teams).map((t) => ({ ...t, default: false })) };
  const u = await mountGrid(t, [later, none]);
  assert.deepEqual(u.chips("later"), [["mine", true], ["global", false]]);
  assert.deepEqual(u.chips("none"), [["mine", false], ["global", false]], "no default: the kernel's order, none marked");
  u.groupBy("team");
  assert.deepEqual(u.groups(), { "mine": ["later"], "No default team": ["none"] });
});

test("0.29 rows (team + labels) still group and chip as before", async (t) => {
  const old = (name, labels) => ({ name, agentsRoot: "/w/agents", description: "", work: "workspace", repo: true, repoName: "r", ...(labels ? { labels, team: labels[0] } : {}) });
  const u = await mountGrid(t, [old("a", ["engineering", "global"]), old("b")]);
  assert.deepEqual(u.chips("a"), [["engineering", true], ["global", false]]);
  u.groupBy("team");
  assert.deepEqual(u.groups(), { engineering: ["a"], "No team": ["b"] });
});
