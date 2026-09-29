// Feature session-backend-config (0.31): oats-local.yaml `session.backend` / `session.tmuxSession`,
// the resolution order of a NEW launch's backend and tmux session, and `oats status` liveness that
// reads each home's recorded endpoint with one Herdr snapshot per server.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstances, retireInstance, sessionDefaults, startInstanceSession } from "../lib/core.mjs";
import { validateLocal } from "../lib/workspace.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-session-backend-")));
// These tests read the host layers themselves: a runner's own settings must not leak in.
const savedEnv = { OATS_SESSION_BACKEND: process.env.OATS_SESSION_BACKEND };
delete process.env.OATS_SESSION_BACKEND;
test.after(() => {
  rmSync(base, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
});

/** A fake tmux on PATH: sessions → window names; every call is logged. */
function fakeTmux(dir, sessions) {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "tmux-calls.log");
  writeFileSync(log, "");
  const cases = Object.entries(sessions).map(([name, windows]) => `    ${name}) printf '%s\\n' ${windows.map((w) => `'${w}'`).join(" ")};;`).join("\n");
  writeFileSync(join(dir, "tmux"), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
target=""; prev=""
for a in "$@"; do [ "$prev" = "-t" ] && target="$a"; prev="$a"; done
case "$1" in
  has-session) case "$target" in ${Object.keys(sessions).join("|") || "__none__"}) exit 0;; *) exit 1;; esac;;
  list-windows) case "$target" in
${cases}
    *) exit 1;; esac;;
esac
exit 0
`);
  chmodSync(join(dir, "tmux"), 0o755);
  return log;
}

function deployment(name, session) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  const lines = ["schemaVersion: 2", "workspace: git:github.com/example/ws"];
  if (session) lines.push("session:", ...Object.entries(session).map(([k, v]) => `  ${k}: ${v}`));
  writeFileSync(join(dir, "oats-local.yaml"), lines.join("\n") + "\n");
  return dir;
}

test("the tmux session: session.tmuxSession, then OATS_TMUX_SESSION, then PI_AGENTS_TMUX_SESSION (still honoured), then oats-agents", async () => {
  const none = deployment("tmux-none");
  const local = deployment("tmux-local", { tmuxSession: "from-local" });
  assert.equal(sessionDefaults(none, {}, {}).tmuxSession, "oats-agents");
  assert.equal(sessionDefaults(none, {}, { PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "legacy");
  assert.equal(sessionDefaults(none, {}, { OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "new");
  assert.equal(sessionDefaults(local, {}, { OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }).tmuxSession, "from-local");
  // DEFAULT_TMUX_SESSION (status, retire and the Desktop's fallback) is fixed at load: read it in a
  // child whose environment holds only what each case sets.
  const { execFileSync } = await import("node:child_process");
  const core = new URL("../lib/core.mjs", import.meta.url).href;
  const load = (env) => execFileSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(core)}).then((m) => process.stdout.write(m.DEFAULT_TMUX_SESSION))`], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: "utf8" });
  assert.equal(load({}), "oats-agents");
  assert.equal(load({ PI_AGENTS_TMUX_SESSION: "legacy" }), "legacy");
  assert.equal(load({ OATS_TMUX_SESSION: "new", PI_AGENTS_TMUX_SESSION: "legacy" }), "new");
});

test("backend: --backend, then session.backend, then OATS_SESSION_BACKEND, then tmux, each named in backendFrom", () => {
  const none = deployment("none");
  const local = deployment("local", { backend: "herdr", tmuxSession: "team-x" });
  assert.deepEqual(sessionDefaults(none, {}, {}), { backend: "tmux", backendFrom: "default", tmuxSession: "oats-agents" });
  assert.deepEqual(sessionDefaults(none, {}, { OATS_SESSION_BACKEND: "herdr" }), { backend: "herdr", backendFrom: "env", tmuxSession: "oats-agents" });
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
    assert.equal(a.tmux?.session, plain.env.OATS_TMUX_SESSION || plain.env.PI_AGENTS_TMUX_SESSION || "oats-agents", "the spawn's own environment, read at spawn time");
    const b = await chosen.spawn("dev", { name: "chosen-1" });
    assert.equal(b.backendFrom, "local");
    assert.equal(b.backend, "herdr", "a never-launched home records the chosen backend (a later session start still needs a recorded Herdr endpoint: a known limit)");
    const c = await chosen.spawn("dev", { name: "chosen-2", backend: "tmux" });
    assert.equal(c.backendFrom, "flag");
    assert.equal(c.tmux?.session, "team-x");
  } finally { plain.cleanup(); chosen.cleanup(); }
});

test("status reads each tmux home in the session it recorded: a pre-0.31 pi-agents home still shows running", async () => {
  const fx = v2Deployment();
  const log = fakeTmux(join(base, "fake-tmux-status"), { "pi-agents": ["old-1"], "oats-agents": ["new-1"] });
  const path = process.env.PATH;
  try {
    process.env.PATH = fx.env.PATH;
    for (const [name, session] of [["old-1", "pi-agents"], ["new-1", "oats-agents"], ["gone-1", "pi-agents"]]) {
      const spawned = await fx.spawn("dev", { name, backend: "tmux" });
      const metaPath = join(spawned.home, "instance.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      writeFileSync(metaPath, JSON.stringify({ ...meta, tmux: { session, window: name } }, null, 2) + "\n");
    }
    process.env.PATH = `${join(base, "fake-tmux-status")}:${fx.env.PATH}`;
    const rows = listInstances(fx.root, "oats-agents").flatMap((a) => a.instances).filter((i) => /-1$/.test(i.instance));
    assert.deepEqual(rows.map((r) => [r.instance, r.running]).sort(), [["gone-1", false], ["new-1", true], ["old-1", true]]);
    const listed = readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("list-windows"));
    assert.equal(listed.length, 2, "each recorded session is listed once");
  } finally { process.env.PATH = path; fx.cleanup(); }
});

test("a self-retire that keeps its directory kills the window the home recorded, not one in the new default session", async () => {
  const fx = v2Deployment();
  const log = fakeTmux(join(base, "fake-tmux-retire"), {});
  const path = process.env.PATH, inst = process.env.OATS_INSTANCE;
  try {
    process.env.PATH = fx.env.PATH;
    const spawned = await fx.spawn("dev", { name: "keep-1", backend: "tmux" });
    const metaPath = join(spawned.home, "instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify({ ...meta, tmux: { session: "pi-agents", window: "keep-1" } }, null, 2) + "\n");
    process.env.PATH = `${join(base, "fake-tmux-retire")}:${fx.env.PATH}`;
    process.env.OATS_INSTANCE = "keep-1";
    const r = retireInstance(fx.root, "keep-1", { self: true, keepDir: true, selfKillDelaySec: 600 });
    assert.equal(r.selfKillScheduled, true);
    const kill = readFileSync(log, "utf8").split("\n").find((l) => l.startsWith("run-shell"));
    assert.ok(kill && kill.includes("=pi-agents:=keep-1"), `the scheduled kill targets the recorded window: ${kill}`);
  } finally {
    process.env.PATH = path;
    if (inst === undefined) delete process.env.OATS_INSTANCE; else process.env.OATS_INSTANCE = inst;
    fx.cleanup();
  }
});

test("the harvester's sequence on a herdr-default host: a --no-launch spawn, then session start, starts and records its Herdr server", async () => {
  const fx = v2Deployment({ local: { session: { backend: "herdr" } } });
  const bin = join(base, "herdr-harvest-bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "herdr"), "#!/bin/sh\nexit 1\n"); chmodSync(join(bin, "herdr"), 0o755);
  let panes = [], agent = false;
  const io = { exec: (binary, args) => {
    assert.equal(binary, join(bin, "herdr"));
    let result;
    if (args.join(" ") === "api snapshot") result = { snapshot: { protocol: 22, panes, agents: agent ? [{ terminal_id: "t1", agent_status: "working" }] : [] } };
    else if (args[0] === "workspace") { panes = [{ pane_id: "p1", terminal_id: "t1", workspace_id: "w1" }]; result = { root_pane: panes[0] }; }
    else if (args[1] === "read") return "$ \n";
    else if (args[1] === "run") { agent = true; result = {}; }
    else if (args[1] === "process-info") result = { process_info: { foreground_processes: [{ name: "sh" }] } };
    else assert.fail(`unexpected Herdr call: ${args}`);
    return JSON.stringify({ result });
  } };
  const path = process.env.PATH;
  try {
    process.env.PATH = fx.env.PATH;
    const spawned = await fx.spawn("dev", { name: "harvester-1" });
    assert.equal(spawned.backendFrom, "local");
    assert.equal(spawned.launched, false);
    process.env.PATH = `${bin}:${fx.env.PATH}`;
    const started = startInstanceSession(spawned.home, { io });
    assert.equal(started.backend, "herdr");
    assert.equal(started.target.protocol, 22);
    assert.equal(JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8")).sessionTarget.terminalId, "t1", "the endpoint is recorded at the first start");
  } finally { process.env.PATH = path; fx.cleanup(); }
});

test("oats inspect shows what a new spawn here would get (feature session-backend-config)", () => {
  const fx = v2Deployment({ local: { session: { backend: "herdr", tmuxSession: "team-x" } } });
  try {
    const r = fx.cli(["inspect", "--soul", "dev", "--json"], { env: { OATS_SESSION_BACKEND: "", OATS_TMUX_SESSION: "", PI_AGENTS_TMUX_SESSION: "" } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json().result.session, { backend: "herdr", backendFrom: "local", tmuxSession: "team-x" });
  } finally { fx.cleanup(); }
});
