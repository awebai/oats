// The shared reader of this computer's deployments list (packages/client/deployment-list.mjs, #1390):
// the result of `oats deployments --json` into rows of { path, name, state }, and every refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPLOYMENT_STATES, DEPLOYMENT_VIAS, DEPLOYMENTS_LIST_FEATURE, deploymentsListSupported, listedPath, readDeploymentAdd, readDeploymentImport, readDeploymentList, readDeploymentRemove } from "../packages/client/deployment-list.mjs";

const row = (path, extra = {}) => ({ path, name: path.split("/").pop(), state: "ok", addedAt: "2026-10-19T10:00:00.000Z", via: "onboard", ...extra });
const list = (deployments, extra = {}) => ({ deploymentsApi: 1, file: "/home/me/.oats/config/deployments.json", deployments, imports: { "agents-dir": "2026-10-19T10:00:00.000Z" }, ...extra });

test("a list is read into rows of path, name and state, in the kernel's order, every state and via accepted", () => {
  const deployments = DEPLOYMENT_STATES.map((state, i) => row(`/home/me/d${i}`, { state, via: DEPLOYMENT_VIAS[i] }));
  assert.deepEqual(readDeploymentList(list(deployments)), {
    ok: true,
    rows: DEPLOYMENT_STATES.map((state, i) => ({ path: `/home/me/d${i}`, name: `d${i}`, state })),
  });
  assert.deepEqual(DEPLOYMENT_STATES, ["ok", "missing", "not-a-deployment", "unreadable"]);
  assert.deepEqual(DEPLOYMENT_VIAS, ["onboard", "tui", "desktop", "cli", "import:agents-dir", "import:desktop"]);
  for (const via of DEPLOYMENT_VIAS) assert.equal(readDeploymentList(list([row("/home/me/acme", { via })])).ok, true, via);
});

test("an empty list, and one with no import markers yet, is read as no rows", () => {
  assert.deepEqual(readDeploymentList(list([], { imports: {} })), { ok: true, rows: [] });
});

test("a document that is not the list is refused whole, with no rows", () => {
  const good = list([row("/home/me/acme")]);
  const refusals = [
    null, undefined, "text", [], 1,
    { ...good, deploymentsApi: 2 },
    { ...good, deploymentsApi: "1" },
    (({ deploymentsApi, ...rest }) => rest)(good),
    (({ imports, ...rest }) => rest)(good),
    (({ file, ...rest }) => rest)(good),
    { ...good, extra: true },
    { ...good, file: "deployments.json" },
    { ...good, imports: [] },
    { ...good, imports: { "agents-dir": 1 } },
    { ...good, deployments: {} },
    { schemaVersion: 1, ok: true, result: good }, // the envelope itself: the reader takes its result
  ];
  for (const document of refusals) {
    const read = readDeploymentList(document);
    assert.equal(read.ok, false, JSON.stringify(document));
    assert.deepEqual(read.rows, []);
    assert.equal(typeof read.reason, "string");
  }
});

test("one row the reader cannot read refuses the whole list: an unknown state, via or key, a missing key, a bad path or name, a duplicate", () => {
  const ok = row("/home/me/ok");
  const bad = [
    row("/home/me/acme", { state: "stale" }),
    row("/home/me/acme", { state: "OK" }),
    row("/home/me/acme", { state: undefined }),
    row("/home/me/acme", { via: "manual" }),
    row("/home/me/acme", { removed: true }),
    (({ addedAt, ...rest }) => rest)(row("/home/me/acme")),
    (({ via, ...rest }) => rest)(row("/home/me/acme")),
    row("/home/me/acme", { addedAt: "" }),
    row("/home/me/acme", { name: "" }),
    row("/home/me/acme", { name: 7 }),
    row("acme"),
    row("~/acme"),
    row("/home/me/acme/"),
    row("/home/me/../me/acme"),
    row("/home/me//acme"),
    row("/home/me/ac\0me"),
    "/home/me/acme",
    null,
  ];
  for (const entry of bad) {
    const read = readDeploymentList(list([ok, entry]));
    assert.equal(read.ok, false, JSON.stringify(entry));
    assert.deepEqual(read.rows, [], "never read in part");
  }
  assert.equal(readDeploymentList(list([ok, row("/home/me/ok", { state: "missing" })])).ok, false, "a path listed twice");
});

test("the feature is read from the probe's features, and a listed path is absolute and canonical in form", () => {
  assert.equal(DEPLOYMENTS_LIST_FEATURE, "deployments-list");
  assert.equal(deploymentsListSupported({ ok: true, features: ["workspace-v2", "deployments-list"] }), true);
  for (const cli of [null, {}, { features: "deployments-list" }, { features: ["workspace-v2"] }]) assert.equal(deploymentsListSupported(cli), false);
  assert.equal(listedPath("/"), true);
  assert.equal(listedPath("/home/me/acme"), true);
  for (const path of ["", "acme", "/home/me/", "/home/./me", null]) assert.equal(listedPath(path), false, String(path));
});

test("the answers of add, remove and import are read, or refused as null", () => {
  assert.deepEqual(readDeploymentAdd({ path: "/home/me/acme", added: true }), { path: "/home/me/acme", added: true });
  assert.deepEqual(readDeploymentAdd({ path: "/home/me/acme", added: false }), { path: "/home/me/acme", added: false });
  assert.deepEqual(readDeploymentRemove({ path: "/home/me/acme", removed: false }), { path: "/home/me/acme", removed: false });
  assert.deepEqual(readDeploymentImport({ imported: true, at: "2026-10-19T10:00:00.000Z", added: ["/home/me/acme"] }),
    { imported: true, at: "2026-10-19T10:00:00.000Z", added: ["/home/me/acme"] });
  assert.deepEqual(readDeploymentImport({ imported: false, at: "2026-10-19T10:00:00.000Z" }), { imported: false, at: "2026-10-19T10:00:00.000Z", added: [] });
  for (const answer of [null, [], { path: "acme", added: true }, { path: "/home/me/acme", added: "yes" }, { path: "/home/me/acme" }, { path: "/home/me/acme", added: true, extra: 1 }])
    assert.equal(readDeploymentAdd(answer), null, JSON.stringify(answer));
  for (const answer of [null, { path: "/home/me/acme" }, { path: "/home/me/acme", removed: 0 }, { removed: true }])
    assert.equal(readDeploymentRemove(answer), null, JSON.stringify(answer));
  for (const answer of [null, { imported: true, at: "x" }, { imported: true, at: "x", added: ["acme"] }, { imported: false }, { imported: false, at: "x", added: [] },
    { imported: "no", at: "x" }, { imported: true, at: "", added: [] }])
    assert.equal(readDeploymentImport(answer), null, JSON.stringify(answer));
});
