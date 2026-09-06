import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiUrl, apiInit } from "../packages/desktop/api-url.mjs";

const source = readFileSync(new URL("../packages/desktop/main.mjs", import.meta.url), "utf8");
const panelStart = source.indexOf("async function panelWorkspaces()");
const panelEnd = source.indexOf("/** This checkout", panelStart);
const apiStart = source.indexOf('ipcMain.handle("api",');
const apiEnd = source.indexOf("// ---- IPC: integrated terminal", apiStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart && apiStart >= 0 && apiEnd > apiStart);

// Run the production discovery function and IPC handler, without Electron.
// The backend can discover an SSH workspace after the startup allowlist.
function bridge() {
  let handler;
  let advertised = ["/"];
  let discoveryFails = false;
  const requests = [];
  const fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const ok = !(discoveryFails && url.pathname === "/api/panel" && !url.search);
    const asked = url.searchParams.get("ws");
    const body = {
      workspace: { id: advertised.includes(asked) ? asked : "/" },
      workspaces: advertised.map((id) => ({ id })),
    };
    return { ok, status: ok ? 200 : 503, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const setup = 'const base = () => "http://127.0.0.1:4820"; const wsId = "/"; let allowedWs = new Set(["/"]);\n'
    + source.slice(panelStart, panelEnd) + source.slice(apiStart, apiEnd);
  new Function("fetch", "apiUrl", "apiInit", "ipcMain", "guard", setup)(
    fetch, apiUrl, apiInit, { handle: (name, fn) => { assert.equal(name, "api"); handler = fn; } }, () => {},
  );
  return {
    call: (path, opts) => handler({}, path, opts),
    advertise: (ids) => { advertised = ids; },
    failDiscovery: () => { discoveryFails = true; },
    requests,
  };
}

const remote = "remote:aweb-agents:late-discovery";

test("a remote workspace advertised after startup can actually be selected", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  const menu = await b.call("/api/panel");
  assert.ok(menu.body.workspaces.some((w) => w.id === remote));
  const selected = await b.call("/api/panel?ws=" + encodeURIComponent(remote));
  assert.equal(selected.body.workspace.id, remote);
  const before = b.requests.length;
  await b.call("/api/agents?ws=" + encodeURIComponent(remote));
  assert.equal(b.requests.at(-1).searchParams.get("ws"), remote);
  assert.equal(b.requests.length - before, 1, "known-workspace polls need no discovery request");
});

test("refreshing discovery still refuses unknown workspaces and off-origin requests", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  await b.call("/api/keys/agent?ws=/unadvertised", { method: "POST", body: "{}" });
  assert.equal(b.requests.at(-1).searchParams.get("ws"), "/");
  const before = b.requests.length;
  await assert.rejects(b.call("//attacker.example/api/panel?ws=/unadvertised"), /off-origin/);
  assert.equal(b.requests.length, before, "off-origin rejection happens before any network call");
});

test("failed discovery does not authorize a newly requested workspace", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  b.failDiscovery();
  const result = await b.call("/api/panel?ws=" + encodeURIComponent(remote));
  assert.equal(result.body.workspace.id, "/");
  assert.equal(b.requests.at(-1).searchParams.get("ws"), "/");
});
