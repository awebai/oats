// Feature session-backend-config (0.31): oats-local.yaml `session.backend` / `session.tmuxSession`,
// the resolution order of a NEW launch's backend and tmux session, and `oats status` liveness that
// reads each home's recorded endpoint with one Herdr snapshot per server.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TMUX_SESSION, listInstances, sessionDefaults } from "../lib/core.mjs";
import { validateLocal } from "../lib/workspace.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-session-backend-")));
test.after(() => rmSync(base, { recursive: true, force: true }));

function deployment(name, session) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  const lines = ["schemaVersion: 2", "workspace: git:github.com/example/ws"];
  if (session) lines.push("session:", ...Object.entries(session).map(([k, v]) => `  ${k}: ${v}`));
  writeFileSync(join(dir, "oats-local.yaml"), lines.join("\n") + "\n");
  return dir;
}

test("the default tmux session is oats-agents; OATS_TMUX_SESSION, then PI_AGENTS_TMUX_SESSION, override it", () => {
  if (!process.env.OATS_TMUX_SESSION && !process.env.PI_AGENTS_TMUX_SESSION) assert.equal(DEFAULT_TMUX_SESSION, "oats-agents");
});

test("backend: --backend, then session.backend, then OATS_SESSION_BACKEND, then tmux, each named in backendFrom", () => {
  const none = deployment("none");
  const local = deployment("local", { backend: "herdr", tmuxSession: "team-x" });
  assert.deepEqual(sessionDefaults(none, {}, {}), { backend: "tmux", backendFrom: "default", tmuxSession: DEFAULT_TMUX_SESSION });
  assert.deepEqual(sessionDefaults(none, {}, { OATS_SESSION_BACKEND: "herdr" }), { backend: "herdr", backendFrom: "env", tmuxSession: DEFAULT_TMUX_SESSION });
  assert.deepEqual(sessionDefaults(local, {}, { OATS_SESSION_BACKEND: "tmux" }), { backend: "herdr", backendFrom: "local", tmuxSession: "team-x" }, "the host file wins over the environment");
  assert.deepEqual(sessionDefaults(local, { backend: "tmux" }, { OATS_SESSION_BACKEND: "herdr" }), { backend: "tmux", backendFrom: "flag", tmuxSession: "team-x" });
  assert.equal(sessionDefaults(local, { tmuxSession: "given" }, {}).tmuxSession, "given", "a caller's session wins over the host file");
  assert.equal(sessionDefaults(join(base, "no-deployment-here"), {}, {}).backendFrom, "default", "no oats-local.yaml in reach is the plain default");
});

test("a bad OATS_SESSION_BACKEND is refused by name, never read as tmux", () => {
  const none = deployment("bad-env");
  assert.throws(() => sessionDefaults(none, {}, { OATS_SESSION_BACKEND: "screen" }), (e) => e.code === "E_BAD_ARGS" && /OATS_SESSION_BACKEND must be tmux or herdr/.test(e.message));
  assert.throws(() => sessionDefaults(none, { backend: "herdr" }, { OATS_SESSION_BACKEND: "screen" }), (e) => e.code === "E_BAD_ARGS", "a broken host variable is loud even when a flag decides");
});

test("oats-local.yaml session is validated: a known backend, a tmux-safe name, no other keys", () => {
  const doc = (session) => ({ schemaVersion: 2, workspace: "git:github.com/example/ws", session });
  assert.deepEqual(validateLocal(doc({ backend: "herdr", tmuxSession: "pi-agents" })), []);
  assert.deepEqual(validateLocal(doc({})), []);
  for (const bad of [{ backend: "screen" }, { tmuxSession: "has space" }, { tmuxSession: "a:b" }, { tmuxSession: "" }, { socket: "/x" }]) {
    assert.ok(validateLocal(doc(bad)).length > 0, JSON.stringify(bad));
  }
});

test("status reads each Herdr server once, however many homes it holds, and each home's recorded tmux session", async () => {
  const fx = v2Deployment();
  const bin = join(base, "fake-bin"), log = join(base, "herdr-calls.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, "");
  const panes = ["a", "b", "c"].map((n) => ({ workspace_id: `w-${n}`, pane_id: `p-${n}`, terminal_id: `t-${n}` }));
  writeFileSync(join(bin, "herdr"), `#!/bin/sh\necho "$HERDR_SOCKET_PATH $*" >> ${JSON.stringify(log)}\necho '${JSON.stringify({ result: { snapshot: { protocol: 22, panes: panes.slice(0, 2), agents: [] } } })}'\n`);
  chmodSync(join(bin, "herdr"), 0o755);
  const path = process.env.PATH;
  try {
    process.env.PATH = fx.env.PATH;
    for (const n of ["a", "b", "c"]) {
      const spawned = await fx.spawn("dev", { name: `h-${n}`, launch: false });
      const metaPath = join(spawned.home, "instance.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const { tmux: _tmux, ...rest } = meta;
      writeFileSync(metaPath, JSON.stringify({ ...rest, backend: "herdr", sessionTarget: { backend: "herdr", binary: "/x/herdr", socket: join(base, "one.sock"), protocol: 22, workspaceId: `w-${n}`, paneId: `p-${n}`, terminalId: `t-${n}` } }, null, 2) + "\n");
    }
    process.env.PATH = `${bin}:${fx.env.PATH}`;
    const rows = listInstances(fx.root).flatMap((a) => a.instances).filter((i) => i.instance.startsWith("h-"));
    assert.deepEqual(rows.map((r) => [r.instance, r.running]).sort(), [["h-a", true], ["h-b", true], ["h-c", false]]);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [`${join(base, "one.sock")} api snapshot`], "one snapshot for three homes on one server");
  } finally {
    process.env.PATH = path;
    fx.cleanup();
  }
});

test("a spawn reports backendFrom and records the host's session.backend", async () => {
  const plain = v2Deployment();
  const chosen = v2Deployment({ local: { session: { backend: "herdr", tmuxSession: "team-x" } } });
  try {
    const a = await plain.spawn("dev", { name: "plain-1" });
    assert.equal(a.backendFrom, "default");
    assert.equal(a.tmux?.session, DEFAULT_TMUX_SESSION);
    const b = await chosen.spawn("dev", { name: "chosen-1" });
    assert.equal(b.backendFrom, "local");
    assert.equal(b.backend, "herdr", "a never-launched home records the backend a start will use");
    const c = await chosen.spawn("dev", { name: "chosen-2", backend: "tmux" });
    assert.equal(c.backendFrom, "flag");
    assert.equal(c.tmux?.session, "team-x");
  } finally { plain.cleanup(); chosen.cleanup(); }
});
