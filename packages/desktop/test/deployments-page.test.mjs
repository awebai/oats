// The Deployments page (UI spec, #482; it replaces the Active overview): its tabs (All, then one per
// deployment), All as the overview canvas split into one section per deployment, and a deployment's tab
// showing only that deployment's tree, or why it has none. DOM and computed-token checks in jsdom; no
// Electron, HTTP or CLI. (The first tests moved here from workspace-views-ui.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as hierarchy from "../renderer/views/hierarchy.mjs";
import { currentWorkspace, setWorkspace } from "../renderer/views/common.mjs";
import { requestDeploymentTab, rememberDeploymentTab, rememberedDeploymentTab } from "../renderer/deployment-tabs.mjs";

const theme = readFileSync(new URL("../renderer/theme.css", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const later = () => new Promise((resolve) => setTimeout(resolve, 0));
const ORIGINAL = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };

const LOCAL = { id: "/Users/op/Agents/oats", machine: "This Mac", path: "/Users/op/Agents/oats", label: "~/Agents/oats", local: true,
  reachable: true, identityFrom: "reported", primary: true };
const ALTAIR = { id: "remote:altair:5d1e0c9b8a7f", machine: "altair", path: "/home/op/Agents/tsm", label: "~/Agents/tsm", local: false,
  reachable: false, identityFrom: "remembered", primary: false, reason: "altair timed out; it is tried again on the next read.",
  short: "timed out", note: "altair now reports workspace tsm." };
const VEGA = { id: "remote:vega:9f2c1a7b3e4d", machine: "vega", path: "/home/op/Agents/lab", label: "~/Agents/lab", local: false,
  reachable: false, identityFrom: null, primary: false, reason: "ssh to vega asks for a password, and Desktop never answers a prompt.",
  short: "ssh needs a prompt", fix: ["Run `ssh vega` once in a terminal and answer its prompt (a host key or a password).", "Desktop tries again on its next read."] };
const tag = (d) => ({ id: d.id, machine: d.machine, path: d.path });
const row = (name, d, fields = {}) => ({ instance: name, agent: "soul", agentsRoot: `${d.path}/agents`, home: `${d.path}/agents/soul/instances/${name}`,
  repoName: "repo", running: true, deployment: tag(d), ...(d.local ? {} : { server: d.machine, addressable: true }), ...fields });
const view = { id: "ws:view", name: "oats" };
const panel = (deployments, instances) => ({ instances, workspace: view, workspaces: [{ ...view, deployments: deployments.map((d) => d.id) }], deployments });
const THREE = () => panel([LOCAL, ALTAIR, VEGA], [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR), row("near", LOCAL)]);

/* Mount the page on `data`; `before(window)` runs first (to seed the remembered tab). */
async function page(t, data, { before } = {}) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: "http://localhost" });
  const doc = dom.window.document, host = doc.querySelector("main");
  const old = ORIGINAL; // several pages in one test: every one restores the globals the file started with
  globalThis.window = dom.window; globalThis.document = doc;
  const polls = []; globalThis.setInterval = (fn) => { polls.push(fn); return 0; };
  setWorkspace("ws:view");
  const style = doc.createElement("style"); style.textContent = theme; doc.head.append(style);
  before?.(dom.window);
  let current = data;
  const dispose = hierarchy.mount(host, { hasWorkspaceSwitcher: true, api: async () => ({ ok: true, status: 200, json: async () => current }), openTerminal() {} });
  t.after(() => { dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick(); await tick();
  const all = (s) => [...host.querySelectorAll(s)], one = (s) => host.querySelector(s);
  const tabs = () => all('[role="tab"]');
  const tab = (label) => tabs().find((b) => b.firstChild.textContent === label);
  const key = (el, k) => el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const poll = async (next) => { current = next; polls[0](); await tick(); await tick(); };
  return { dom, doc, host, all, one, tabs, tab, key, poll, names: (el) => [...el.querySelectorAll(".hnode")].map((n) => n.dataset.name).sort() };
}

test("one deployment: only its own tab, no All, and the overview as before with no heading", async (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("solo", LOCAL)];
  const u = await page(t, panel([LOCAL], rows));
  assert.deepEqual(u.tabs().map((b) => b.textContent), ["This Mac"]);
  assert.equal(u.tabs()[0].getAttribute("aria-selected"), "true");
  assert.equal(u.all(".hier-deployment").length, 0); assert.equal(u.all(".hier-dhead").length, 0);
  assert.equal(u.all(".hier-cluster").length, 1); assert.equal(u.all(".hier-solo .hnode").length, 1);
  assert.equal(hierarchy.layoutByDeployment(rows, [LOCAL]), null);
  assert.ok(u.host.querySelector(".hier-stage > .hier-cluster"), "groups sit on the stage as always");
  assert.match(u.one(".hier-sum").textContent, /^3 running · 0 stopped · 1 group · 1 independent$/);
});

test("one deployment that is not live: its tab carries the mark and the canvas keeps its heading, so the reason is never hidden", async (t) => {
  const u = await page(t, panel([VEGA], [row("lab", VEGA)]));
  assert.deepEqual(u.tabs().map((b) => b.firstChild.textContent), ["vega"]);
  assert.equal(u.tabs()[0].querySelector(".deployment-mark").getAttribute("aria-label"), "not reached");
  assert.deepEqual(u.all(".hier-dname").map((n) => n.textContent), ["vega · ~/Agents/lab"]);
  assert.equal(u.one(".hier-dstate").textContent, "not reached"); assert.equal(u.one(".hier-dfix > summary").textContent, "How to fix");
  assert.deepEqual(u.names(u.one(".hier-deployment")), ["lab"]);
});

test("no deployments reported (an older server): no tabs, the overview as before", async (t) => {
  const u = await page(t, { instances: [row("lead", LOCAL)], workspace: view, workspaces: [view] });
  assert.equal(u.one('[role="tablist"]').hidden, true); assert.equal(u.tabs().length, 0);
  assert.equal(u.one(".hier-panel").getAttribute("role"), null, "no tabpanel without tabs");
  assert.equal(u.all(".hier-solo .hnode").length, 1);
});

test("tabs: All then each deployment in served order, the Workspace tab pattern, roving tabindex and Arrow/Home/End", async (t) => {
  const u = await page(t, THREE());
  const list = u.one('[role="tablist"]');
  assert.ok(list.classList.contains("hier-tabs")); assert.equal(list.getAttribute("aria-label"), "Deployments"); assert.equal(list.hidden, false);
  assert.ok(u.one(".hier-bar").contains(list), "the tabs lead the page header");
  assert.deepEqual(u.tabs().map((b) => b.firstChild.textContent), ["All", "This Mac", "altair", "vega"]);
  const selected = () => u.tabs().filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.firstChild.textContent);
  const tabbable = () => u.tabs().filter((b) => b.tabIndex === 0).map((b) => b.firstChild.textContent);
  assert.deepEqual(selected(), ["All"]); assert.deepEqual(tabbable(), ["All"]);
  assert.ok(u.tabs().every((b) => b.type === "button" && b.getAttribute("aria-controls") === u.one(".hier-panel").id));
  assert.equal(u.one(".hier-panel").getAttribute("role"), "tabpanel");
  assert.equal(u.one(".hier-panel").getAttribute("aria-labelledby"), u.tab("All").id);
  // A deployment that is not live: the shared status mark, its state in words (never the mark alone).
  assert.equal(u.tab("This Mac").querySelector(".deployment-mark"), null);
  assert.equal(u.tab("altair").querySelector(".deployment-mark").getAttribute("aria-label"), "remembered");
  assert.equal(u.tab("vega").querySelector(".deployment-mark").getAttribute("aria-label"), "not reached");
  assert.equal(u.tab("vega").title, "/home/op/Agents/lab — not reached", "the full path only as a tooltip");
  u.tab("All").focus();
  u.key(u.tab("All"), "ArrowRight");
  assert.deepEqual(selected(), ["This Mac"]); assert.deepEqual(tabbable(), ["This Mac"]); assert.equal(u.doc.activeElement, u.tab("This Mac"));
  assert.equal(u.one(".hier-panel").getAttribute("aria-labelledby"), u.tab("This Mac").id);
  u.key(u.tab("This Mac"), "End"); assert.deepEqual(selected(), ["vega"]); assert.equal(u.doc.activeElement, u.tab("vega"));
  u.key(u.tab("vega"), "ArrowRight"); assert.deepEqual(selected(), ["All"], "ArrowRight wraps to the first");
  u.key(u.tab("All"), "ArrowLeft"); assert.deepEqual(selected(), ["vega"], "ArrowLeft wraps to the last");
  u.key(u.tab("vega"), "Home"); assert.deepEqual(selected(), ["All"]); assert.equal(u.doc.activeElement, u.tab("All"));
  u.tab("altair").click(); assert.deepEqual(selected(), ["altair"]);
});

test("All: one section per deployment, stacked, under the group-label heading with counts; no primary chip", async (t) => {
  const u = await page(t, THREE());
  const sections = u.all(".hier-deployment");
  assert.deepEqual(sections.map((s) => s.getAttribute("aria-label")), ["This Mac · ~/Agents/oats, 3 running",
    "altair · ~/Agents/tsm, 1 running, remembered, timed out", "vega · ~/Agents/lab, no instances, not reached, ssh needs a prompt"]);
  assert.deepEqual(sections.map((s) => s.getAttribute("role")), ["group", "group", "group"]);
  const heads = u.all(".hier-dhead");
  assert.deepEqual(heads.map((h) => h.querySelector(".hier-dname").textContent), ["This Mac · ~/Agents/oats", "altair · ~/Agents/tsm", "vega · ~/Agents/lab"]);
  assert.ok(heads.every((h) => h.querySelector(".hier-dname").classList.contains("cnm")), "the overview's group-label style");
  assert.deepEqual(heads.map((h) => h.querySelector(".hier-dname").title), [LOCAL.path, ALTAIR.path, VEGA.path], "the full path is the tooltip");
  assert.deepEqual(heads.map((h) => h.querySelector(".hier-dcount").textContent), ["3 running", "1 running", "no instances"]);
  assert.doesNotMatch(u.host.textContent, /primary/); assert.equal(u.all(".hier-dtag").length, 0);
  assert.ok(sections.every((s) => !/primary/.test(s.getAttribute("aria-label"))));
  // The live deployment's heading is its label and counts only.
  assert.equal(heads[0].querySelector(".chip"), null); assert.equal(heads[0].querySelector(".hier-dfix"), null);
  // Not live: the state chip, the short reason, and the How to fix disclosure (closed) under the heading.
  assert.equal(heads[1].querySelector(".hier-dstate").textContent, "remembered"); assert.ok(heads[1].querySelector(".hier-dstate").classList.contains("chip"));
  assert.equal(heads[1].querySelector(".hier-dshort").textContent, "timed out");
  assert.equal(heads[2].querySelector(".hier-dstate").textContent, "not reached");
  assert.equal(heads[2].querySelector(".hier-dshort").textContent, "ssh needs a prompt");
  const fix = heads[2].querySelector("details.hier-dfix");
  assert.equal(fix.open, false); assert.equal(fix.querySelector("summary").textContent, "How to fix");
  // With steps, the steps are the explanation: the full sentence would repeat step 1 (live check, #482).
  assert.equal(fix.querySelector(".hier-dfix-reason"), null);
  assert.deepEqual([...fix.querySelectorAll("ol.hier-dfix-steps > li")].map((li) => li.textContent), VEGA.fix.map((step) => step.replaceAll("`", "")));
  // A command the server quotes in backticks is set as code, never shown with its backticks.
  const code = fix.querySelector("ol.hier-dfix-steps code.hier-dfix-code");
  assert.ok(code, "the quoted command is code"); assert.doesNotMatch(fix.textContent, /`/);
  // Remembered without steps: the sentence and the note, under Details (no fix to follow).
  const details = heads[1].querySelector("details.hier-dfix");
  assert.equal(details.querySelector("summary").textContent, "Details");
  assert.equal(details.querySelector(".hier-dfix-reason").textContent, `Last report, not live now. ${ALTAIR.reason}`);
  assert.equal(details.querySelector(".hier-dfix-note").textContent, ALTAIR.note);
  assert.equal(heads[1].querySelector(".hier-dline").getAttribute("aria-hidden"), "true", "the group's name says the line");
  // Stacked in the panel's order, each with its own tree (relations never cross sections).
  assert.ok(parseFloat(heads[1].style.top) > parseFloat(heads[0].style.top)); assert.ok(parseFloat(heads[2].style.top) > parseFloat(heads[1].style.top));
  assert.deepEqual(u.names(sections[0]), ["dev", "lead", "near"]); assert.deepEqual(u.names(sections[1]), ["far"]); assert.deepEqual(u.names(sections[2]), []);
  assert.deepEqual(u.all(".hier-solo").map((g) => g.dataset.ws), [`Independent:${LOCAL.id}`, `Independent:${ALTAIR.id}`]);
  assert.equal(u.all(".hier-stage").length, 1, "one canvas: pan, zoom and fit work over every section");
  assert.match(u.one(".hier-sum").textContent, /^4 running · 0 stopped · 1 group · 2 independent$/);
  const layout = hierarchy.layoutByDeployment(THREE().instances, [LOCAL, ALTAIR, VEGA]);
  const [a, b] = layout.sections;
  assert.ok(b.y >= a.y + a.height, "the second section starts below the first");
  assert.ok(a.placed.every((p) => p.y >= a.y), "blocks are in stage coordinates under their heading");
});

test("a deployment's tab: its heading and only its rows; the count line counts that tab", async (t) => {
  const u = await page(t, panel([LOCAL, ALTAIR], [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR, { running: false })]));
  u.tab("altair").click();
  assert.deepEqual(u.all(".hnode").map((n) => n.dataset.name), ["far"]);
  assert.deepEqual(u.all(".hier-dname").map((n) => n.textContent), ["altair · ~/Agents/tsm"]);
  assert.equal(u.one(".hier-dcount").textContent, "0 running · 1 stopped"); assert.equal(u.one(".hier-dstate").textContent, "remembered");
  assert.match(u.one(".hier-sum").textContent, /^0 running · 1 stopped · 0 groups · 1 independent$/);
  u.tab("This Mac").click();
  assert.deepEqual(u.all(".hnode").map((n) => n.dataset.name).sort(), ["dev", "lead"]);
  assert.deepEqual(u.all(".hier-dname").map((n) => n.textContent), ["This Mac · ~/Agents/oats"]);
  assert.match(u.one(".hier-sum").textContent, /^2 running · 0 stopped · 1 group$/);
});

test("a deployment that is not reached and has no rows: its tab shows why and how to fix it, never a silent empty", async (t) => {
  const u = await page(t, THREE());
  u.tab("vega").click();
  assert.equal(u.all(".hnode").length, 0); assert.equal(u.one(".empty"), null, "not the 'no instances' message");
  const block = u.one(".hier-empty-wrap .hier-dreason");
  assert.ok(block); assert.equal(block.getAttribute("role"), "group");
  assert.equal(block.getAttribute("aria-label"), "vega · ~/Agents/lab, no instances, not reached, ssh needs a prompt");
  assert.equal(block.querySelector(".hier-dstate.chip").textContent, "not reached");
  assert.equal(block.querySelector(".hier-dshort").textContent, "ssh needs a prompt");
  assert.equal(block.querySelector(".hier-dfix > summary").textContent, "How to fix");
  assert.deepEqual([...block.querySelectorAll(".hier-dfix-steps li")].map((li) => li.textContent), VEGA.fix.map((step) => step.replaceAll("`", "")));
  assert.match(u.one(".hier-sum").textContent, /^0 running · 0 stopped · 0 groups$/);
  // A live deployment with no rows keeps the overview's empty message.
  const v = await page(t, panel([LOCAL, VEGA], [row("far", VEGA)]));
  v.tab("This Mac").click();
  assert.ok(v.one(".empty")); assert.equal(v.one(".hier-dreason"), null);
});

test("the selected tab is remembered per view and is where the page starts", async (t) => {
  const u = await page(t, THREE());
  u.tab("altair").click();
  assert.equal(rememberedDeploymentTab("ws:view", u.dom.window.localStorage), ALTAIR.id);
  const v = await page(t, THREE(), { before: (win) => rememberDeploymentTab("ws:view", VEGA.id, win.localStorage) });
  assert.equal(v.tab("vega").getAttribute("aria-selected"), "true", "starts from the view's remembered tab");
  const w = await page(t, THREE(), { before: (win) => rememberDeploymentTab("ws:other", VEGA.id, win.localStorage) });
  assert.equal(w.tab("All").getAttribute("aria-selected"), "true", "another view's choice does not apply");
  const gone = await page(t, panel([LOCAL, ALTAIR], [row("lead", LOCAL)]), { before: (win) => rememberDeploymentTab("ws:view", VEGA.id, win.localStorage) });
  assert.equal(gone.tab("All").getAttribute("aria-selected"), "true", "a remembered deployment the view no longer has falls back to the first tab");
});

test("another surface's tab request switches the shown view's tab; a request for another view does not", async (t) => {
  const u = await page(t, THREE());
  requestDeploymentTab("ws:other", ALTAIR.id, u.dom.window.localStorage);
  assert.equal(u.tab("All").getAttribute("aria-selected"), "true");
  requestDeploymentTab("ws:view", VEGA.id, u.dom.window.localStorage);
  assert.equal(u.tab("vega").getAttribute("aria-selected"), "true"); assert.ok(u.one(".hier-dreason"));
  requestDeploymentTab("ws:view", "remote:nowhere:000000000000", u.dom.window.localStorage);
  assert.equal(u.tab("vega").getAttribute("aria-selected"), "true", "a tab the view does not have changes nothing");
});

test("How to fix: an open disclosure pushes the sections below it down, and stays open across a refresh", async (t) => {
  const u = await page(t, panel([VEGA, LOCAL], [row("lab", VEGA), row("lead", LOCAL)]));
  // jsdom lays nothing out: a heading measures 40px closed and 160px with its disclosure open.
  Object.defineProperty(u.dom.window.HTMLElement.prototype, "offsetHeight", { configurable: true,
    get() { return this.classList?.contains("hier-dhead") ? (this.querySelector("details[open]") ? 160 : 40) : 0; } });
  const tops = () => u.all(".hier-group").map((g) => parseFloat(g.style.top));
  const headTop = () => parseFloat(u.all(".hier-dhead")[1].style.top);
  const before = tops(), head = headTop();
  const fix = u.one(".hier-dfix"); fix.open = true; await later(); // jsdom fires toggle on a timer
  const after = tops();
  assert.ok(after.every((top, i) => top > before[i]), `clusters moved down: ${before} → ${after}`);
  assert.ok(headTop() > head, "the next heading moved down too");
  await u.poll(panel([VEGA, LOCAL], [row("lab", VEGA), row("lead", LOCAL), row("new", LOCAL)]));
  assert.equal(u.one(".hier-dfix").open, true, "open across a repaint");
  assert.ok(u.all(".hnode").some((n) => n.dataset.name === "new"));
});

test("no raw deployment id or view id in any text, tooltip or accessible name", async (t) => {
  const u = await page(t, THREE());
  const shown = (u) => [u.host.textContent, ...u.all("[title]").map((e) => e.title), ...u.all("[aria-label]").map((e) => e.getAttribute("aria-label"))].join("\n");
  for (const label of ["All", "This Mac", "altair", "vega"]) {
    u.tab(label).click();
    assert.doesNotMatch(shown(u), /remote:|5d1e0c9b8a7f|9f2c1a7b3e4d|ws:view/, `${label} tab`);
  }
});

/* ── contrast: every new text on its computed surface, in every theme ── */
function channels(hex) { assert.match(hex, /^#[0-9a-f]{6}$/i, hex); return hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); }
const luminance = (hex) => { const c = channels(hex); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const painted = (win, el) => { for (let p = el; p; p = p.parentElement) { const bg = win.getComputedStyle(p).background; if (/^var\(--/.test(bg)) return bg.slice(6, -1); } return null; };

for (const name of ["light", "solarized", "dark"]) test(`${name}: the tabs, deployment headings, chips and How to fix meet computed AA`, async (t) => {
  const u = await page(t, THREE());
  u.doc.documentElement.dataset.theme = name;
  for (const fix of u.all(".hier-dfix")) fix.open = true;
  const empty = await page(t, THREE(), { before: (win) => rememberDeploymentTab("ws:view", VEGA.id, win.localStorage) });
  empty.doc.documentElement.dataset.theme = name;
  const checks = [
    [u, '.hier-tabs [aria-selected="true"]', "fg"], [u, '.hier-tabs [aria-selected="false"]', "nav-fg"],
    [u, ".hier-dname", "muted"], [u, ".hier-dcount", "muted"], [u, ".hier-dshort", "muted"], [u, ".hier-dstate", "chip-fg"],
    [u, ".hier-dfix > summary", "fg"], [u, ".hier-dfix-body", "fg"], [u, ".hier-dfix-note", "muted"], [u, ".hier-dfix-code", "fg"],
    [empty, ".hier-dreason .hier-dname", "muted"], [empty, ".hier-dreason .hier-dshort", "muted"], [empty, ".hier-dreason .hier-dstate", "chip-fg"],
    [empty, ".hier-dreason .hier-dfix > summary", "fg"],
  ];
  for (const [p, selector, fg] of checks) {
    const win = p.dom.window, el = p.one(selector); assert.ok(el, selector);
    assert.equal(win.getComputedStyle(el).color, `var(--${fg})`, selector);
    const bg = painted(win, el); assert.ok(bg, `${selector} sits on a painted token surface`);
    const root = win.getComputedStyle(p.doc.documentElement);
    const r = ratio(root.getPropertyValue(`--${fg}`).trim(), root.getPropertyValue(`--${bg}`).trim());
    assert.ok(r >= 4.5, `${selector}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    for (let e = el; e; e = e.parentElement) assert.equal(win.getComputedStyle(e).opacity, "1", `${selector}: no opacity over text`);
  }
});

test("a reached deployment that is not matched says why on its tab (the switcher's Not matched entries open here)", async (t) => {
  const RIGEL = { id: "remote:rigel:cccccccccccc", machine: "rigel", path: "/srv/fixture", label: "/srv/fixture", local: false, reachable: true,
    identityFrom: null, primary: true, reason: "rigel's OATS is too old to report its workspace; update OATS there.",
    short: "OATS too old to report its workspace", fix: ["Update OATS on rigel."] };
  const u = await page(t, panel([RIGEL], []));
  assert.deepEqual(u.all(".hier-tabs [role=tab]").map((b) => b.textContent), ["rigel"]);
  assert.equal(u.all(".hier-tabs [role=tab] .deployment-mark").length, 1, "its tab carries the mark");
  assert.equal(u.one(".empty"), null, "never the plain 'no instances' message");
  const block = u.one(".hier-empty-wrap .hier-dreason");
  assert.ok(block);
  assert.equal(block.querySelector(".hier-dstate.chip").textContent, "not matched");
  assert.equal(block.querySelector(".hier-dshort").textContent, "OATS too old to report its workspace");
  assert.equal(block.querySelector(".hier-dfix > summary").textContent, "How to fix");
  assert.deepEqual([...block.querySelectorAll(".hier-dfix-steps li")].map((li) => li.textContent), ["Update OATS on rigel."]);
  // A reached, matched deployment alone still draws the overview as it always was: no heading.
  const quiet = await page(t, panel([LOCAL], [row("lead", LOCAL)]));
  assert.equal(quiet.all(".hier-dhead").length, 0);
});
