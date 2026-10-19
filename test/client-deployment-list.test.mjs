// The shared reader of this computer's deployments list (packages/client/deployment-list.mjs, #1390):
// the result of `oats deployments --json` into rows of { path, name, state }, every refusal, and the
// answers of add, remove and import; and the four verbs run through the kernel (deployment-list-cli.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cliDeploymentList, deploymentListArgv, DEPLOYMENT_IMPORT_MAX, DEPLOYMENT_LIST_FAILURE_CODES, DEPLOYMENT_LIST_TIMEOUT } from "../packages/client/deployment-list-cli.mjs";
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

// ── The four verbs, through the kernel (packages/client/deployment-list-cli.mjs) ──────────────────────────
const CLI = { ok: true, bin: "/usr/local/bin/oats", features: ["workspace-v2", "deployments-list"] };
/** An `exec` that answers one envelope (or raw stdout) with an error (nonzero exit) or none, and records the call. */
const answering = (stdout, error = null) => {
  const calls = [];
  const exec = (bin, argv, options, callback) => { calls.push({ bin, argv, cwd: options.cwd, shell: options.shell, timeout: options.timeout, env: options.env }); callback(error, typeof stdout === "string" ? stdout : JSON.stringify(stdout)); };
  return { calls, exec };
};
const ok = (result) => ({ schemaVersion: 1, ok: true, result });

test("each verb's argv and working directory are fixed; anything else is not a request", () => {
  assert.deepEqual(deploymentListArgv({ action: "list" }), { argv: ["deployments", "--json"], cwd: "/" });
  assert.deepEqual(deploymentListArgv({ action: "add", path: "/home/me/acme", via: "desktop" }),
    { argv: ["deployments", "add", "/home/me/acme", "--via", "desktop", "--json"], cwd: "/home/me/acme" });
  assert.deepEqual(deploymentListArgv({ action: "remove", path: "/home/me/gone" }), { argv: ["deployments", "remove", "/home/me/gone", "--json"], cwd: "/" });
  assert.deepEqual(deploymentListArgv({ action: "import", from: "desktop", paths: ["/a", "/b"] }),
    { argv: ["deployments", "import", "--from", "desktop", "/a", "/b", "--json"], cwd: "/" });
  assert.deepEqual(deploymentListArgv({ action: "import", from: "desktop", paths: [] }).argv, ["deployments", "import", "--from", "desktop", "--json"], "no path is a valid import");
  for (const bad of [null, {}, { action: "scan" }, { action: "list", path: "/a" }, { action: "add", path: "acme", via: "desktop" }, { action: "add", path: "/a", via: "cli" },
    { action: "add", path: "/a" }, { action: "add", path: "--json", via: "desktop" }, { action: "remove", path: "/a/" }, { action: "import", from: "cli", paths: [] },
    { action: "import", from: "desktop", paths: ["relative"] }, { action: "import", from: "desktop", paths: Array.from({ length: DEPLOYMENT_IMPORT_MAX + 1 }, (_, i) => `/d${i}`) }])
    assert.equal(deploymentListArgv(bad), null, JSON.stringify(bad)?.slice(0, 80));
});

test("the list is read through the kernel into rows; argv, cwd and environment are the fixed ones", async () => {
  const kernel = answering(ok(list([row("/home/me/acme"), row("/home/me/gone", { state: "missing" })])));
  const answer = await cliDeploymentList(CLI, { action: "list" }, { exec: kernel.exec, env: { PATH: "/usr/bin", OATS_INSTANCE_HOME: "/h/i" } });
  assert.deepEqual(answer, { ok: true, value: { ok: true, rows: [{ path: "/home/me/acme", name: "acme", state: "ok" }, { path: "/home/me/gone", name: "gone", state: "missing" }] } });
  assert.deepEqual(kernel.calls.map(({ bin, argv, cwd, shell }) => ({ bin, argv, cwd, shell })), [{ bin: CLI.bin, argv: ["deployments", "--json"], cwd: "/", shell: false }]);
  assert.equal(kernel.calls[0].env.OATS_INSTANCE_HOME, undefined, "the instance environment never reaches the kernel");
  assert.equal(kernel.calls[0].timeout, DEPLOYMENT_LIST_TIMEOUT);
});

test("without a compatible CLI, or without the feature, nothing runs and nothing falls back", async () => {
  const kernel = answering(ok(list([])));
  assert.equal((await cliDeploymentList(null, { action: "list" }, { exec: kernel.exec })).reason.code, "E_CLI_UNAVAILABLE");
  assert.equal((await cliDeploymentList({ ok: true, bin: "oats", features: ["deployments-list"] }, { action: "list" }, { exec: kernel.exec })).reason.code, "E_CLI_UNAVAILABLE");
  const old = await cliDeploymentList({ ...CLI, features: ["workspace-v2"] }, { action: "list" }, { exec: kernel.exec });
  assert.deepEqual(old, { ok: false, reason: { code: "E_DEPLOYMENTS_FEATURE", message: "This oats can't list this computer's deployments. Update oats." } });
  assert.equal((await cliDeploymentList(CLI, { action: "add", path: "acme", via: "desktop" }, { exec: kernel.exec })).reason.code, "E_BAD_ARGS");
  assert.equal(kernel.calls.length, 0);
  for (const code of ["E_CLI_UNAVAILABLE", "E_DEPLOYMENTS_FEATURE", "E_BAD_ARGS", "E_CLI_FAILED", "E_CLI_PROTOCOL", "E_CLI_TIMEOUT", "E_CLI_OUTPUT_LIMIT"])
    assert.ok(DEPLOYMENT_LIST_FAILURE_CODES.includes(code), code);
});

test("a kernel refusal is its code and message; a document the reader cannot read, or a success that exited nonzero, is the adapter's own code", async () => {
  const refusal = { schemaVersion: 1, ok: false, error: { code: "E_DEPLOYMENTS_BUSY", message: "this computer's deployments list is locked", details: { lock: "/x" } } };
  assert.deepEqual(await cliDeploymentList(CLI, { action: "remove", path: "/home/me/gone" }, { exec: answering(refusal, Object.assign(new Error("exit 1"), { code: 1 })).exec }),
    { ok: false, reason: { code: "E_DEPLOYMENTS_BUSY", message: "this computer's deployments list is locked" } });
  const cases = [
    [answering(refusal), "E_CLI_PROTOCOL"],                                                     // a refusal that exited 0
    [answering(ok(list([row("/a", { state: "stale" })]))), "E_CLI_PROTOCOL"],                     // a state the reader does not know
    [answering(ok(list([])), Object.assign(new Error("exit 1"), { code: 1 })), "E_CLI_FAILED"],  // success is exit 0 only
    [answering("not json"), "E_CLI_PROTOCOL"],
    [answering("not json", Object.assign(new Error("exit 2"), { code: 2 })), "E_CLI_FAILED"],
    [answering({ schemaVersion: 2, ok: true, result: list([]) }), "E_CLI_PROTOCOL"],
    [answering({ schemaVersion: 1, ok: false, error: { code: "ENOENT", message: "x" } }, new Error("exit 1")), "E_CLI_PROTOCOL"],
    [answering("", Object.assign(new Error("killed"), { killed: true })), "E_CLI_TIMEOUT"],
    [answering("", Object.assign(new Error("big"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })), "E_CLI_OUTPUT_LIMIT"],
  ];
  for (const [kernel, code] of cases) assert.equal((await cliDeploymentList(CLI, { action: "list" }, { exec: kernel.exec })).reason.code, code, code);
  const thrown = await cliDeploymentList(CLI, { action: "list" }, { exec: () => { throw new Error("spawn EACCES"); } });
  assert.equal(thrown.reason.code, "E_CLI_FAILED");
});

test("add, remove and import answer what the reader reads of them", async () => {
  assert.deepEqual(await cliDeploymentList(CLI, { action: "add", path: "/home/me/acme", via: "desktop" }, { exec: answering(ok({ path: "/home/me/acme", added: false })).exec }),
    { ok: true, value: { path: "/home/me/acme", added: false } });
  assert.deepEqual(await cliDeploymentList(CLI, { action: "remove", path: "/home/me/gone" }, { exec: answering(ok({ path: "/home/me/gone", removed: true })).exec }),
    { ok: true, value: { path: "/home/me/gone", removed: true } });
  assert.deepEqual(await cliDeploymentList(CLI, { action: "import", from: "desktop", paths: ["/a"] }, { exec: answering(ok({ imported: false, at: "2026-10-19T10:00:00.000Z" })).exec }),
    { ok: true, value: { imported: false, at: "2026-10-19T10:00:00.000Z", added: [] } });
  assert.equal((await cliDeploymentList(CLI, { action: "add", path: "/home/me/acme", via: "desktop" }, { exec: answering(ok({ path: "/home/me/acme" })).exec })).reason.code, "E_CLI_PROTOCOL");
});
