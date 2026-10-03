// awebai/oats#582: the remote roster relays `waitingOnYou`, and the Desktop shows it.
// The kernel half: `rosterGroups` relays the key only when the host's status row has it,
// through the kernel's own read rule. The end-to-end half feeds that REAL `rosterGroups`
// output into the Desktop's `remotePanel` and then its `waitingClaim`. It lives in the root
// suite because it needs the kernel: the Desktop's own tests run without it (#577).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REMOTE_ROW_FACTS, rosterGroups, writeServers } from "../lib/servers.mjs";
import { remotePanel } from "../packages/desktop/server/remote-roster.mjs";
import { waitingClaim } from "../packages/desktop/renderer/waiting-on-you.mjs";

const base = mkdtempSync("/tmp/oats-rw-");
const prevHomeDir = process.env.OATS_HOME_DIR;
process.env.OATS_HOME_DIR = join(base, "oh");
test.after(() => {
  if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir;
  rmSync(base, { recursive: true, force: true });
});

const PROBE = { schemaVersion: 1, name: "@awebai/oats", version: "0.40.2", desktopApi: 1, harnesses: ["claude"], sessionBackends: ["tmux"], launchOptions: [], remote: ["session"], features: ["harness", "waiting-on-you"] };
const HOME = (name) => `/srv/ws/agents/dev/instances/${name}`;
const CLAIM = { since: "2026-10-03T12:00:00.000Z", producer: "oats.core", reason: "permission", message: "Which branch?" };
/** A running row as a host's `oats status --json` reports it; `extra` adds or omits `waitingOnYou`. */
const hostRow = (name, extra = {}) => ({ instance: name, home: HOME(name), harness: "claude", running: true, tmux: { session: "oats-agents", window: name }, ...extra });

/** The one group `rosterGroups` builds from a fake host answering `status --json` with `rows`,
 *  plus a saved route (`dev-gone`) the host does not list. */
function roster(rows, { server = "build" } = {}) {
  writeServers({ [server]: { sshHost: `${server}-host`, workspace: "/srv/ws" } });
  const snapDir = join(process.env.OATS_HOME_DIR, "remote", server);
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "dev-gone.json"), JSON.stringify({ serverId: server, instance: "dev-gone", agent: "dev", home: HOME("dev-gone"), agentsRoot: "/srv/ws/agents", target: { sshHost: `${server}-host`, workspace: "/srv/ws", oatsPath: "oats" } }));
  const status = { root: "/srv/ws/agents", agents: [{ name: "dev", harness: "claude", instances: rows }] };
  const exec = (_bin, argv) => (String(argv.at(-1)).endsWith("version --json") ? JSON.stringify(PROBE) : JSON.stringify(status));
  try {
    const out = rosterGroups({ server, io: { execFileSync: exec, serverId: `${server}-${Math.random()}` } });
    assert.equal(out.groups.length, 1); assert.deepEqual(out.groups[0].probe, { ok: true });
    return out.groups[0];
  } finally { rmSync(snapDir, { recursive: true, force: true }); }
}
const rowOf = (group, name) => group.instances.find((r) => r.instance === name);

test("rosterGroups relays a host row's waitingOnYou: the claim as the host read it, null when it has none", () => {
  const g = roster([hostRow("dev-a", { waitingOnYou: CLAIM }), hostRow("dev-b", { waitingOnYou: null })]);
  assert.deepEqual(rowOf(g, "dev-a").waitingOnYou, CLAIM);
  assert.ok(Object.hasOwn(rowOf(g, "dev-b"), "waitingOnYou")); assert.equal(rowOf(g, "dev-b").waitingOnYou, null);
  // The rest of the row is what it was.
  const { waitingOnYou: _relayed, ...rest } = rowOf(g, "dev-a");
  assert.deepEqual(Object.keys(rest).sort(), Object.keys(rowOf(roster([hostRow("dev-a")]), "dev-a")).sort());
});

test("rosterGroups: a host whose kernel does not report waitingOnYou gives a row with NO key, and a saved route the host does not list never has one", () => {
  const g = roster([hostRow("dev-old"), hostRow("dev-a", { waitingOnYou: CLAIM })]);
  assert.equal(Object.hasOwn(rowOf(g, "dev-old"), "waitingOnYou"), false, "absent stays absent: not reported is not null");
  const gone = rowOf(g, "dev-gone");
  assert.equal(gone.missingRemotely, true);
  assert.equal(Object.hasOwn(gone, "waitingOnYou"), false);
  assert.equal(REMOTE_ROW_FACTS.includes("waitingOnYou"), false, "it is not a fact that reads null when missing");
});

test("rosterGroups relays a validated shape, by the kernel's own read rule: a value that is not a claim is null; a bad reason or message is null inside a claim that still counts", () => {
  const notClaims = {
    "a string": "yes", "true": true, "a number": 1, "an array": [CLAIM], "an empty object": {},
    "no since": { producer: "oats.core", reason: "permission" },
    "a since that is not a date": { ...CLAIM, since: "soon" },
    "a since that is not a string": { ...CLAIM, since: 1759492800000 },
    "no producer": { since: CLAIM.since, reason: "permission" },
    "a producer the writer refuses": { ...CLAIM, producer: "Bad Producer!" },
    "a producer with an escape": { ...CLAIM, producer: "evil\u001b[2J" },
    "a producer that is not a string": { ...CLAIM, producer: ["agent"] },
  };
  const names = Object.keys(notClaims);
  const g = roster(names.map((why, i) => hostRow(`bad-${i}`, { waitingOnYou: notClaims[why] })));
  names.forEach((why, i) => {
    const row = rowOf(g, `bad-${i}`);
    assert.ok(Object.hasOwn(row, "waitingOnYou"), why); assert.equal(row.waitingOnYou, null, why);
  });

  const kept = roster([
    hostRow("odd-reason", { waitingOnYou: { ...CLAIM, reason: "because" } }),
    hostRow("odd-message", { waitingOnYou: { ...CLAIM, message: "two\nlines" } }),
    hostRow("long-message", { waitingOnYou: { ...CLAIM, message: "x".repeat(201) } }),
    hostRow("no-message", { waitingOnYou: { since: CLAIM.since, producer: "agent", reason: "attention" } }),
    hostRow("extra-keys", { waitingOnYou: { ...CLAIM, token: "s3cret", waiting: true } }),
    hostRow("kernel", { waitingOnYou: { ...CLAIM, producer: "kernel" } }),
  ]);
  assert.deepEqual(rowOf(kept, "odd-reason").waitingOnYou, { ...CLAIM, reason: null });
  assert.deepEqual(rowOf(kept, "odd-message").waitingOnYou, { ...CLAIM, message: null });
  assert.deepEqual(rowOf(kept, "long-message").waitingOnYou, { ...CLAIM, message: null });
  assert.deepEqual(rowOf(kept, "no-message").waitingOnYou, { since: CLAIM.since, producer: "agent", reason: "attention", message: null });
  assert.deepEqual(rowOf(kept, "extra-keys").waitingOnYou, CLAIM, "exactly since, producer, reason, message");
  assert.deepEqual(rowOf(kept, "kernel").waitingOnYou, { ...CLAIM, producer: "kernel" }, "the local read admits kernel, so the relay does");
});

// ---- end to end: the kernel's roster, the Desktop's panel, the Desktop's gate ----
const panelRows = (rows) => Object.fromEntries(remotePanel(roster(rows)).instances.map((r) => [r.instance, r]));

test("end to end: the Desktop's remote panel carries the claim rosterGroups relayed, and leaves it out when the host did not report one", () => {
  const rows = panelRows([hostRow("dev-a", { waitingOnYou: CLAIM }), hostRow("dev-b", { waitingOnYou: null }), hostRow("dev-old"), hostRow("dev-bad", { waitingOnYou: "yes" })]);
  assert.deepEqual(rows["dev-a"].waitingOnYou, CLAIM);
  assert.equal(rows["dev-a"].running, true); assert.equal(rows["dev-a"].serverUnreached, false); assert.equal(rows["dev-a"].runtimeState, null);
  assert.equal(rows["dev-b"].waitingOnYou, null);
  assert.equal(Object.hasOwn(rows["dev-old"], "waitingOnYou"), false);
  assert.equal(rows["dev-bad"].waitingOnYou, null);
  assert.equal(Object.hasOwn(rows["dev-gone"], "waitingOnYou"), false);
  // No claim shows where none was relayed.
  for (const name of ["dev-b", "dev-old", "dev-bad", "dev-gone"]) assert.equal(waitingClaim(rows[name]), null, name);
});

// The gate's half is the Desktop's fix (spec D2, awebai/oats#582): a remote row's `runtimeState`
// is null unless the host said "unreachable" or "unsupported", and the gate must read null as
// "not reported". Held as a todo until D2 is on main; then it is an ordinary test.
test("end to end: the Desktop shows the relayed claim on a running remote row (waitingClaim)", { todo: "needs the Desktop's D2 fix on main" }, () => {
  const rows = panelRows([hostRow("dev-a", { waitingOnYou: CLAIM }), hostRow("dev-stopped", { running: false, waitingOnYou: CLAIM })]);
  assert.deepEqual(waitingClaim(rows["dev-a"]), CLAIM);
  assert.equal(waitingClaim(rows["dev-stopped"]), null, "a row that is not running shows none");
});
