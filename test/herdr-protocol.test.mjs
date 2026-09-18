import test from "node:test";
import assert from "node:assert/strict";
import {
  HERDR_PROTOCOL, HERDR_SUPPORTED_PROTOCOLS, isSupportedHerdrProtocol,
  herdrSnapshot, allocateHerdr, inspectHerdr, launchHerdr, stopHerdr, inputHerdr, validHerdrTarget,
} from "../lib/herdr.mjs";

const endpoint = protocol => ({ backend: "herdr", binary: "/inert/herdr", socket: "/owned/herdr.sock", protocol });
const pane = { workspace_id: "w38", pane_id: "w38:p12", terminal_id: "terminal-observed" };
const target = protocol => ({ ...endpoint(protocol), workspaceId: pane.workspace_id, paneId: pane.pane_id, terminalId: pane.terminal_id });
const snapshot = (protocol, panes = [pane]) => ({
  version: protocol === 22 ? "0.9.0" : "0.8.2", protocol, workspaces: [], tabs: [], layouts: [], panes,
  agents: panes.length ? [{ ...pane, agent_status: "working" }] : [],
});
function reader(value) {
  const calls = [];
  return { calls, strictHerdrTarget: true, exec(binary, args, options) {
    calls.push(args); assert.equal(binary, "/inert/herdr");
    assert.equal(options.env.HERDR_SOCKET_PATH, "/owned/herdr.sock");
    assert.equal(options.env.HERDR_SESSION, undefined);
    assert.equal(options.env.HERDR_ENV, process.env.HERDR_ENV, "adapter does not fabricate caller context");
    assert.deepEqual(args, ["api", "snapshot"], "refusal/inspection may not mutate a backend");
    return JSON.stringify({ result: { snapshot: value } });
  } };
}

test("Herdr support is exactly numeric20/22 and retains the legacy20 default", () => {
  assert.equal(HERDR_PROTOCOL, 20);
  assert.deepEqual(HERDR_SUPPORTED_PROTOCOLS, [20, 22]); assert.equal(Object.isFrozen(HERDR_SUPPORTED_PROTOCOLS), true);
  for (const protocol of [20, 22]) {
    assert.equal(isSupportedHerdrProtocol(protocol), true);
    assert.equal(validHerdrTarget(target(protocol)), true);
    const io = reader(snapshot(protocol));
    assert.equal(herdrSnapshot(endpoint(protocol), io).protocol, protocol);
    assert.equal(inspectHerdr(target(protocol), io).present, true);
  }
  for (const protocol of [undefined, null, false, "20", "22", 0, 21, 23, 22.5, NaN, Infinity]) {
    assert.equal(isSupportedHerdrProtocol(protocol), false);
    assert.equal(validHerdrTarget(target(protocol)), false);
  }
});

test("unknown or missing selected protocol refuses before any adapter command", () => {
  for (const protocol of [undefined, null, "22", 21, 23]) {
    const io = { exec() { assert.fail("unsupported selection contacted a backend"); } };
    for (const operation of [
      () => herdrSnapshot(endpoint(protocol), io),
      () => allocateHerdr(endpoint(protocol), { home: "/owned/home", instance: "fixture" }, io),
      () => launchHerdr(target(protocol), "inert", io),
      () => inputHerdr(target(protocol), "inert", io),
      () => stopHerdr(target(protocol), io),
    ]) assert.throws(operation, /explicit supported protocol 20 or 22/);
  }
});

test("snapshot protocol must match the selected endpoint exactly, with no fallback or retag", () => {
  for (const [selected, observed] of [[20, 22], [22, 20], [20, 21], [22, 23], [22, "22"], [22, null]]) {
    const selectedTarget = target(selected), before = structuredClone(selectedTarget);
    const io = reader(snapshot(observed));
    assert.throws(() => launchHerdr(selectedTarget, "never dispatch", io), new RegExp(`match selected protocol ${selected}`));
    assert.throws(() => stopHerdr(selectedTarget, io), new RegExp(`match selected protocol ${selected}`));
    assert.deepEqual(selectedTarget, before, "the saved target is not upgraded/downgraded");
    assert.equal(io.calls.length, 2);
  }
  assert.throws(() => herdrSnapshot(endpoint(22), reader({ protocol: 22, panes: null })), /no pane inventory/);
  assert.throws(() => herdrSnapshot(endpoint(22), { exec() { throw new Error("unavailable endpoint"); } }), /unavailable endpoint/);
});

test("protocol22 reuses explicit allocation/run/input/stop and retains actual returned IDs", () => {
  const calls = []; let present = true;
  const io = { strictHerdrTarget: true, exec(binary, args, options) {
    assert.equal(binary, "/inert/herdr"); assert.equal(options.env.HERDR_SOCKET_PATH, "/owned/herdr.sock");
    assert.equal(options.env.HERDR_SESSION, undefined);
    assert.equal(options.env.HERDR_ENV, process.env.HERDR_ENV);
    calls.push(args);
    if (args[0] === "api") return JSON.stringify({ result: { snapshot: snapshot(22, present ? [pane] : []) } });
    if (args[0] === "workspace") {
      assert.deepEqual(args, ["workspace", "create", "--cwd", "/owned/home", "--label", "fixture", "--no-focus"]);
      return JSON.stringify({ result: { type: "workspace_created", root_pane: pane } });
    }
    assert.equal(args[0], "pane"); assert.equal(args[2], pane.pane_id);
    if (args[1] === "close") present = false;
    else assert.equal(args[1], "run");
    return "";
  } };
  const selected = endpoint(22), allocated = allocateHerdr(selected, { home: "/owned/home", instance: "fixture" }, io);
  assert.deepEqual(allocated, target(22)); assert.deepEqual(selected, endpoint(22));
  assert.equal(validHerdrTarget(allocated), true);
  launchHerdr(allocated, "node ./entry.mjs", io);
  assert.deepEqual(calls.at(-1), ["pane", "run", pane.pane_id, "exec /bin/sh -c 'node ./entry.mjs'"]);
  const text = "literal $(not-executed); next task";
  inputHerdr(allocated, text, io); assert.deepEqual(calls.at(-1), ["pane", "run", pane.pane_id, text]);
  stopHerdr(allocated, io); assert.equal(inspectHerdr(allocated, io).present, false);
  assert.equal(calls.filter(args => args[0] === "workspace").length, 1);
  assert.deepEqual(calls.filter(args => args[1] === "close"), [["pane", "close", pane.pane_id]]);
  assert.ok(calls.every(args => ["api", "workspace", "pane"].includes(args[0])), "no daemon lifecycle or alternate backend");
});

test("protocol22 retains strict workspace/pane/terminal and replacement protections", () => {
  for (const panes of [[{ ...pane, workspace_id: "foreign" }], [pane, pane]]) {
    const io = reader(snapshot(22, panes));
    for (const operation of [() => inspectHerdr(target(22), io), () => launchHerdr(target(22), "never", io), () => stopHerdr(target(22), io)]) {
      assert.throws(operation, /workspace\/pane\/terminal/);
    }
  }
  const replaced = reader(snapshot(22, [{ ...pane, terminal_id: "replacement" }]));
  assert.equal(inspectHerdr(target(22), replaced).present, false);
  stopHerdr(target(22), replaced);
  assert.throws(() => inputHerdr(target(22), "never", replaced), /stopped or was replaced/);
  assert.throws(() => launchHerdr(target(22), "never", replaced), /disappeared/);
});
