/** The deployment reads' remote budget (bin/oats.mjs readBudgetMs; lib/remote.mjs DEADLINE): `oats status` and
 *  `oats workspace status` finish their remote work within it, a member not read by then degrades as any
 *  unreadable member does, and its git is gone; every other verb reads with no budget. A member that never
 *  answers is a real git against a local HTTP server that accepts and stays silent (reached through
 *  `insteadOf`, as an operator's own git config would). */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const SLOW = "https://slow.example/org/slow";

/** An HTTP server that accepts every request and never answers; `open()` counts the connections still open. */
async function silentServer() {
  const sockets = new Set();
  const server = createServer(() => { /* never answers */ });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, open: () => sockets.size, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

function run(env, args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr, elapsed: Date.now() - started }));
  });
}
const json = (r) => { try { return JSON.parse(r.stdout); } catch { assert.fail(`not JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`); } };

test("workspace status and status answer within the budget; a member that never answers is a timeout row, its git gone", { timeout: 120_000 }, async () => {
  const server = await silentServer();
  const fx = v2Deployment();
  try {
    // The workspace's members: itself and a member whose host never answers.
    fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref, SLOW], teams: { global: { description: "Fixture team" } }, defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } });
    const env = { ...fx.env, OATS_READ_REMOTE_BUDGET_MS: "2500", GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.http://127.0.0.1:${server.port}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://slow.example/" };
    let connections = 0;
    const counted = () => { connections = Math.max(connections, server.open()); };
    const poll = setInterval(counted, 20);
    const ws = await run(env, ["workspace", "status", "--dir", fx.dep, "--json"]);
    const doc = json(ws);
    assert.equal(ws.status, 0, ws.stderr);
    assert.equal(doc.ok, true);
    assert.ok(ws.elapsed < 15_000, `workspace status took ${ws.elapsed} ms`);
    assert.ok(connections > 0, "git reached the silent member");
    const row = JSON.stringify(doc);
    assert.match(row, /slow\.example\/org\/slow/);
    assert.match(row, /\(timeout\)/, "the member degrades with reason timeout");
    // The member's git (and its remote helper, which holds the connection) is gone once the command is.
    for (let i = 0; i < 100 && server.open() > 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.open(), 0, "no git outlives the command");

    const st = await run(env, ["status", "--dir", fx.dep, "--json"]);
    clearInterval(poll);
    assert.equal(st.status, 0, st.stderr);
    assert.ok(Array.isArray(json(st).agents), st.stdout);
    assert.ok(st.elapsed < 15_000, `status took ${st.elapsed} ms`);
    for (let i = 0; i < 100 && server.open() > 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.open(), 0, "no git outlives the command");
  } finally { server.close(); }
});

test("only status and workspace status have a budget: under a 1 ms one they time out, while souls, spawn (preview and apply) and sync read with no deadline", { timeout: 180_000 }, async () => {
  const fx = v2Deployment();
  const env = { ...fx.env, OATS_READ_REMOTE_BUDGET_MS: "1" };
  const ws = await run(env, ["workspace", "status", "--dir", fx.dep, "--json"]);
  const failed = json(ws);
  assert.equal(failed.ok, false, ws.stdout);
  assert.equal(failed.error.code, "E_REMOTE_UNREADABLE");
  assert.equal(failed.error.details.reason, "timeout");
  for (const args of [["souls", "--dir", fx.dep, "--json"], ["spawn", "dev", "--preview", "--dir", fx.dep, "--json"],
    ["spawn", "dev", "--no-launch", "--name", "budget-free", "--dir", fx.dep, "--json"], ["sync", "--dir", fx.dep, "--json"]]) {
    const r = await run(env, args);
    assert.equal(json(r).ok, true, `${args[0]}: ${r.stdout}\n${r.stderr}`);
  }
});
