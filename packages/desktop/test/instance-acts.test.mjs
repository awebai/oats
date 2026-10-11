// Which acts a roster row offers (packages/client/instance-acts.mjs): the decision every client draws its
// own menu from. Pure: a row in, verbs and reasons out; no label, icon or key.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceActs } from "../../client/instance-acts.mjs";
import { heldHome } from "../../client/instance-tree.mjs";
import { unsupportedSession } from "../../client/instance-presentation.mjs";
import { rowReason } from "../../client/remote-address.mjs";
import { ROWS } from "./helpers/instance-menu-probe.mjs";

const VERBS = ["inspect", "start", "restart", "stop", "retire"];
const LOCAL = { instance: "dev-one", home: "/agents/dev/instances/dev-one" };
const REMOTE = { ...LOCAL, home: "/remote/dev-one", server: "host", repoName: "Build box", addressable: true };
const HERDR = "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend. (dev-one)";
const on = (verb) => ({ verb, enabled: true, reason: null });
const offered = (acts) => ({ blocked: null, limited: null, acts });
const verbsOf = (row) => instanceActs(row).acts.map((act) => act.verb);

test("a row that runs, is stopped, or whose liveness is unknown: inspect, its launch act, stop, retire, in that order", () => {
  assert.deepEqual(instanceActs({ ...LOCAL, running: true }), offered([on("inspect"), on("restart"), on("stop"), on("retire")]));
  assert.deepEqual(instanceActs({ ...LOCAL, running: false }), offered([on("inspect"), on("start"), on("stop"), on("retire")]));
  // Unknown is neither: no launch act is offered for a row whose liveness nobody reported.
  for (const running of [null, undefined, "yes", 1]) assert.deepEqual(instanceActs({ ...LOCAL, running }), offered([on("inspect"), on("stop"), on("retire")]));
  assert.deepEqual(instanceActs({ ...LOCAL }), offered([on("inspect"), on("stop"), on("retire")]));
  // A remote row the kernel reports addressable is offered what a local one is.
  assert.deepEqual(instanceActs({ ...REMOTE, running: true }), instanceActs({ ...LOCAL, running: true }));
  // A local kernel before 0.31 reports no `addressable`: a row it spawned keeps its saved route.
  assert.deepEqual(verbsOf({ ...REMOTE, addressable: undefined, savedRoute: true, running: false }), ["inspect", "start", "stop", "retire"]);
});

test("a session backend OATS no longer has: Start is listed, not enabled, with the kernel's reason; never Restart; the rest as usual", () => {
  const rows = [{ ...LOCAL, running: null, runtimeState: "unsupported", runtimeError: HERDR },
    { ...LOCAL, running: true, sessionTarget: "herdr:pane-1" }, { ...REMOTE, running: true, backend: "herdr" }, { ...LOCAL, running: false, backend: "herdr" }];
  for (const row of rows) {
    const sentence = unsupportedSession(row);
    assert.ok(sentence, "the shared table has a sentence for this row");
    assert.deepEqual(instanceActs(row), offered([on("inspect"), { verb: "start", enabled: false, reason: { code: "unsupported-session", sentence } }, on("stop"), on("retire")]));
  }
  assert.equal(instanceActs(rows[0]).acts[1].reason.sentence, HERDR, "the kernel's own text when it sent one");
});

test("a home the kernel holds: nothing while it spawns, Retire alone when a spawn or a retire left it half cleaned", () => {
  const spawning = { ...LOCAL, running: false, spawnInProgress: true };
  assert.deepEqual(instanceActs(spawning), { blocked: { code: "held", kind: "spawning", sentence: "dev-one is setting up its worktree. It opens once the spawn finishes." }, limited: null, acts: [] });
  assert.deepEqual(instanceActs({ ...LOCAL, running: false, rollbackIncomplete: true }),
    { blocked: null, limited: { code: "held", kind: "spawn-incomplete", sentence: "The spawn of dev-one didn't finish. Retire it to clean up." }, acts: [on("retire")] });
  assert.deepEqual(instanceActs({ ...LOCAL, running: true, retirePending: true }),
    { blocked: null, limited: { code: "held", kind: "retire-incomplete", sentence: "The retire of dev-one didn't finish. Retire it again to complete." }, acts: [on("retire")] });
  // The kind is the held home's own (instance-tree.mjs heldHome): a spawn that is gone wins over a live one, a live one over a pending retire.
  assert.equal(instanceActs({ ...LOCAL, rollbackIncomplete: true, spawnInProgress: true }).limited.kind, "spawn-incomplete");
  assert.equal(instanceActs({ ...LOCAL, spawnInProgress: true, retirePending: true }).blocked.kind, "spawning");
  for (const row of [spawning, { ...LOCAL, rollbackIncomplete: true }, { ...LOCAL, retirePending: true }]) {
    const { blocked, limited } = instanceActs(row), held = heldHome(row);
    assert.deepEqual(blocked ?? limited, { code: "held", kind: held.kind, sentence: held.sentence(row.instance) }, "the sentence is the held home's");
  }
  // `spawnInProgress` is true or nothing: only the kernel's boolean holds a home.
  assert.deepEqual(verbsOf({ ...LOCAL, running: false, spawnInProgress: "true" }), ["inspect", "start", "stop", "retire"]);
});

test("a remote row the kernel does not report addressable: blocked with the row's reason and its key, no acts", () => {
  const cases = [
    [{ ...REMOTE, addressable: false, running: true }, "unaddressable", "Build box did not report this instance as reachable."],
    [{ ...REMOTE, addressable: undefined, running: true }, "unaddressable", "This computer's OATS does not report whether Build box can reach this instance. Update OATS here."],
    [{ ...REMOTE, addressable: false, savedRoute: true, missingRemotely: true }, "missing", "dev-one is no longer on Build box. Remove it from this computer with: oats server forget host --instance dev-one"],
    [{ ...REMOTE, addressable: false, serverUnreached: true, runtimeError: "ssh: connect to host timed out" }, "unreached", "ssh: connect to host timed out"],
    [{ ...REMOTE, addressable: false, serverUnreached: true }, "unreached", "Build box was not reached."],
    [{ ...REMOTE, addressable: false, backend: "herdr" }, "herdr", "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend."],
  ];
  for (const [row, key, sentence] of cases) {
    assert.deepEqual(instanceActs(row), { blocked: { code: "unaddressable", key, sentence }, limited: null, acts: [] });
    assert.equal(rowReason(row).key, key); assert.equal(rowReason(row).sentence, sentence, "the sentence is the row reason's");
  }
});

test("precedence: not addressable, then held, then an unsupported session", () => {
  const unaddressable = { ...REMOTE, addressable: false, running: true };
  // Not addressable and held, every kind: the row's reason, never the held home's, and no Retire.
  for (const hold of [{ spawnInProgress: true }, { rollbackIncomplete: true }, { retirePending: true }]) {
    const row = { ...unaddressable, ...hold };
    assert.ok(heldHome(row), "the home is held");
    assert.deepEqual(instanceActs(row), { blocked: { code: "unaddressable", key: "unaddressable", sentence: "Build box did not report this instance as reachable." }, limited: null, acts: [] });
  }
  // Held and an unsupported session: the hold decides; Start with its reason is not listed.
  assert.deepEqual(instanceActs({ ...LOCAL, rollbackIncomplete: true, runtimeState: "unsupported", runtimeError: HERDR }).acts, [on("retire")]);
  assert.equal(instanceActs({ ...LOCAL, spawnInProgress: true, runtimeState: "unsupported", runtimeError: HERDR }).blocked.code, "held");
  // All three at once: not addressable wins. Its key is the row reason's own, which names the removed backend first.
  for (const hold of [{ spawnInProgress: true }, { rollbackIncomplete: true }, { retirePending: true }]) {
    const all = instanceActs({ ...unaddressable, ...hold, runtimeState: "unsupported", runtimeError: HERDR });
    assert.deepEqual(all, { blocked: { code: "unaddressable", key: "herdr", sentence: HERDR }, limited: null, acts: [] });
  }
});

test("the answer's shape, on every row the menu's parity test draws: blocked and limited never both, a blocked row has no acts", () => {
  for (const [name, row] of Object.entries(ROWS)) {
    const frozen = Object.freeze({ ...row }), answer = instanceActs(frozen);
    assert.deepEqual(Object.keys(answer), ["blocked", "limited", "acts"], name);
    assert.ok(!(answer.blocked && answer.limited), `${name}: blocked and limited are never both set`);
    if (answer.blocked) assert.deepEqual(answer.acts, [], `${name}: a blocked row offers nothing`);
    else assert.ok(answer.acts.length > 0, `${name}: a row that is not blocked offers something`);
    if (answer.limited) assert.ok(answer.acts.length < 3, `${name}: a limited row offers fewer acts than a home normally does`);
    assert.deepEqual(answer.acts.map((act) => act.verb), [...new Set(answer.acts.map((act) => act.verb))], `${name}: no verb twice`);
    for (const act of answer.acts) {
      assert.deepEqual(Object.keys(act), ["verb", "enabled", "reason"], name);
      assert.ok(VERBS.includes(act.verb), `${name}: ${act.verb} is one of the five verbs`);
      assert.equal(act.enabled, act.reason === null, `${name}: an act is enabled exactly when it has no reason`);
    }
    for (const reason of [answer.blocked, answer.limited, ...answer.acts.map((act) => act.reason)].filter(Boolean)) {
      assert.ok(["unaddressable", "held", "unsupported-session"].includes(reason.code), `${name}: ${reason.code}`);
      assert.deepEqual(Object.keys(reason), { unaddressable: ["code", "key", "sentence"], held: ["code", "kind", "sentence"], "unsupported-session": ["code", "sentence"] }[reason.code], name);
      assert.ok(typeof reason.sentence === "string" && reason.sentence.length > 0, `${name}: a reason has a sentence`);
    }
    assert.deepEqual(instanceActs(frozen), answer, `${name}: the same row answers the same`);
  }
});

test("no sentence it returns names the Desktop, its window or its menus", () => {
  for (const [name, row] of Object.entries(ROWS)) {
    const { blocked, limited, acts } = instanceActs(row);
    for (const reason of [blocked, limited, ...acts.map((act) => act.reason)].filter(Boolean))
      assert.doesNotMatch(reason.sentence, /\b(desktop|window|menu|sidebar|click|tab)\b/i, `${name}: ${reason.sentence}`);
  }
});
