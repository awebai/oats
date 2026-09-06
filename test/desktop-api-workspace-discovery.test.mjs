import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiUrl, apiInit } from "../packages/desktop/api-url.mjs";

const source = readFileSync(new URL("../packages/desktop/main.mjs", import.meta.url), "utf8");
const apiStart = source.indexOf('ipcMain.handle("api",');
const apiEnd = source.indexOf("// ---- IPC: integrated terminal", apiStart);
const invalidation = source.match(/onInvalidate: \(\) => \{([^}]+)\}/)?.[1];
assert.ok(apiStart >= 0 && apiEnd > apiStart && invalidation);

// Exercise the production IPC handler and backend-invalidation callback,
// without Electron. SSH discovery may complete after the startup allowlist.
function bridge() {
  let handler;
  let advertised = ["/"];
  let panelFails = false;
  let heldResponse = null;
  let inTransition = false;
  const requests = [];
  const fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const ok = !(panelFails && url.pathname === "/api/panel");
    const asked = url.searchParams.get("ws");
    const body = {
      workspace: { id: advertised.includes(asked) ? asked : "/" },
      workspaces: advertised.map((id) => ({ id })),
    };
    const hold = heldResponse;
    heldResponse = null;
    if (hold) await hold;
    return { ok, status: ok ? 200 : 503, text: async () => JSON.stringify(body) };
  };
  const setup = 'const base = () => "http://127.0.0.1:4820"; const wsId = "/"; let allowedWs = new Set(["/"]); let serverEpoch = 0;\n'
    + source.slice(apiStart, apiEnd) + '\nreturn () => {' + invalidation + '};';
  const invalidate = new Function("fetch", "apiUrl", "apiInit", "ipcMain", "guard", "serverHost", setup)(
    fetch, apiUrl, apiInit, { handle: (name, fn) => { assert.equal(name, "api"); handler = fn; } }, () => {},
    { inTransition: () => inTransition },
  );
  return {
    call: (path, opts) => handler({}, path, opts),
    advertise: (ids) => { advertised = ids; },
    failPanel: () => { panelFails = true; },
    holdNext: () => { let release; heldResponse = new Promise((resolve) => { release = resolve; }); return release; },
    invalidate, requests,
    beginTransition: () => { inTransition = true; invalidate(); },
    endTransition: () => { inTransition = false; },
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
  await b.call("/api/agents?ws=" + encodeURIComponent(remote));
  assert.equal(b.requests.at(-1).searchParams.get("ws"), remote);
  assert.equal(b.requests.length, 3, "menu and two requests require no additional discovery fetch");
});

test("unknown selections stay pinned without extra polling; only panel responses authorize choices", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  for (let i = 0; i < 3; i++) {
    await b.call("/api/keys/agent?ws=" + encodeURIComponent(remote), { method: "POST", body: "{}" });
    assert.equal(b.requests.at(-1).searchParams.get("ws"), "/");
  }
  assert.equal(b.requests.length, 3);
  await assert.rejects(b.call("//attacker.example/api/panel?ws=/unadvertised"), /off-origin/);
  assert.equal(b.requests.length, 3, "off-origin rejection happens before any network call");
});

test("failed panel response does not authorize advertised choices", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  b.failPanel();
  assert.equal((await b.call("/api/panel")).status, 503);
  const result = await b.call("/api/agents?ws=" + encodeURIComponent(remote));
  assert.equal(result.body.workspace.id, "/");
});

test("an outgoing backend response cannot restore its invalidated choices", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  const release = b.holdNext();
  const pending = b.call("/api/panel");
  b.invalidate();
  release();
  await pending;
  const result = await b.call("/api/agents?ws=" + encodeURIComponent(remote));
  assert.equal(result.body.workspace.id, "/");
});

test("a poll started during replacement cannot teach outgoing choices after replacement finishes", async () => {
  const b = bridge();
  b.advertise(["/", remote]);
  b.beginTransition();
  const release = b.holdNext();
  const pending = b.call("/api/panel");
  b.advertise(["/"]);
  b.endTransition();
  release();
  await pending;
  await b.call("/api/agents?ws=" + encodeURIComponent(remote));
  assert.equal(b.requests.at(-1).searchParams.get("ws"), "/");
});
