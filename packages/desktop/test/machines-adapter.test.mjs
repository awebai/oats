// #517: the CLI calls behind a workspace's own machines — fixed argv, the deployment's cwd, bounded time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cliServerCheck, cliServerRemove, cliServerConnect, cliAwebConnect } from "../../client/cli-adapter.mjs";

const OK = (result) => JSON.stringify({ schemaVersion: 1, ok: true, result });
function recorder(stdout = OK({})) {
  const calls = [];
  const exec = (bin, argv, opts, cb) => { calls.push({ bin, argv, cwd: opts.cwd, timeout: opts.timeout, shell: opts.shell }); process.nextTick(() => cb(null, stdout)); };
  return { calls, exec };
}

test("server check / remove: the registration id only, --json", async () => {
  const r = recorder();
  await cliServerCheck("/oats", "altair-aweb", { exec: r.exec, cwd: "/ws" });
  await cliServerRemove("/oats", "altair-aweb", { exec: r.exec, cwd: "/ws" });
  assert.deepEqual(r.calls.map((c) => c.argv), [["server", "check", "altair-aweb", "--json"], ["server", "remove", "altair-aweb", "--json"]]);
  assert.deepEqual(r.calls.map((c) => [c.cwd, c.shell]), [["/ws", false], ["/ws", false]]);
  assert.equal(r.calls[0].timeout, 60_000);
});

test("server connect: name, --ssh, --dir on the host, --install-oats only when asked; run in the deployment, 15 minutes", async () => {
  const r = recorder();
  await cliServerConnect("/oats", { id: "altair-aweb", host: "altair", folder: "~/Agents/aweb", installOats: true, workspaceDir: "/Users/j/Agents/aweb" }, { exec: r.exec });
  await cliServerConnect("/oats", { id: "altair-aweb", host: "altair", folder: "/srv/aweb", installOats: false, workspaceDir: "/Users/j/Agents/aweb" }, { exec: r.exec });
  assert.deepEqual(r.calls[0].argv, ["server", "connect", "altair-aweb", "--ssh", "altair", "--dir", "~/Agents/aweb", "--install-oats", "--json"]);
  assert.deepEqual(r.calls[1].argv, ["server", "connect", "altair-aweb", "--ssh", "altair", "--dir", "/srv/aweb", "--json"]);
  assert.equal(r.calls[0].cwd, "/Users/j/Agents/aweb");
  assert.equal(r.calls[0].timeout, 15 * 60_000);
});

test("aweb connect: the server id and --install-aw, run in the deployment, 5 minutes", async () => {
  const r = recorder();
  await cliAwebConnect("/oats", { id: "altair-aweb", workspaceDir: "/Users/j/Agents/aweb" }, { exec: r.exec });
  assert.deepEqual(r.calls[0].argv, ["aweb", "connect", "altair-aweb", "--install-aw", "--json"]);
  assert.equal(r.calls[0].cwd, "/Users/j/Agents/aweb");
  assert.equal(r.calls[0].timeout, 5 * 60_000);
});

test("anything option-shaped or malformed never reaches the CLI", async () => {
  const r = recorder();
  for (const env of [
    await cliServerCheck("/oats", "--all", { exec: r.exec, cwd: "/ws" }),
    await cliServerRemove("/oats", "Altair", { exec: r.exec, cwd: "/ws" }),
    await cliServerConnect("/oats", { id: "a", host: "-oProxyCommand=x", folder: "~/a", workspaceDir: "/ws" }, { exec: r.exec }),
    await cliServerConnect("/oats", { id: "a", host: "altair", folder: "a", workspaceDir: "/ws" }, { exec: r.exec }),
    await cliServerConnect("/oats", { id: "a", host: "altair", folder: "~/a", workspaceDir: "relative" }, { exec: r.exec }),
    await cliAwebConnect("/oats", { id: "-x", workspaceDir: "/ws" }, { exec: r.exec }),
  ]) assert.equal(env.error.code, "E_BAD_ARGS");
  assert.equal(r.calls.length, 0);
});
