import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { instanceActions } from "../renderer/instance-actions.mjs";
import { cliRetire, parseRetireEnvelope } from "../cli-adapter.mjs";

test("instance actions keep the full host reference and confirm retirement before dispatch", async () => {
  const dom = new JSDOM("<body></body>");
  const instance = { instance: "dev-one", home: "/remote/home", server: "host", savedRoute: true };
  const calls = []; let confirmed = false;
  const select = instanceActions(dom.window.document, instance, {
    invoke: async (...args) => { calls.push(args); return {}; },
    confirmRetire: () => confirmed, done: () => {}, report: (m) => assert.fail(m),
  });
  const choose = async (value) => { select.value = value; select.dispatchEvent(new dom.window.Event("change")); await new Promise((r) => setImmediate(r)); };
  await choose("retire"); assert.equal(calls.length, 0);
  await choose("harvest"); assert.deepEqual(calls[0], ["harvest", instance]);
  confirmed = true; await choose("retire"); assert.deepEqual(calls[1], ["retire", instance]);
  assert.equal(select.disabled, false);
  assert.equal(instanceActions(dom.window.document, { ...instance, savedRoute: false }, {}).disabled, true);
  dom.window.close();
});

test("retire adapter preserves incomplete local results and routes remote by saved identity", async () => {
  assert.equal(parseRetireEnvelope('{"retired":"dev-one","removedDir":true}').ok, true);
  const partial = parseRetireEnvelope('{"retired":"dev-one","removedDir":false,"rollbackIncomplete":["cleanup"]}');
  assert.equal(partial.ok, false); assert.equal(partial.error.code, "E_RETIRE_INCOMPLETE");
  assert.equal(parseRetireEnvelope(JSON.stringify({ schemaVersion: 1, ok: true, result: partial.result })).ok, false);
  let call;
  const env = await cliRetire("/installed/oats", { instance: "dev-one", home: "/remote/selected", workspaceDir: "/local", server: "host" }, {
    exec: (bin, argv, opts, cb) => { call = { bin, argv, opts }; cb(null, '{"schemaVersion":1,"ok":true,"result":{"retired":"dev-one"}}'); },
  });
  assert.equal(env.ok, true);
  assert.deepEqual(call.argv, ["retire", "dev-one", "--home", "/remote/selected", "--server", "host", "--json"]);
  assert.equal(call.opts.cwd, "/local");
});

test("roster rebuilds cannot submit a second lifecycle action while one is pending", async () => {
  const dom = new JSDOM("<body></body>");
  let finish; let calls = 0;
  const instance = { instance: "dev-pending", home: "/home/dev-pending" };
  const options = { invoke: () => { calls++; return new Promise((r) => { finish = r; }); },
    confirmRetire: () => true, done() {}, report: assert.fail };
  const first = instanceActions(dom.window.document, instance, options);
  first.value = "harvest"; first.dispatchEvent(new dom.window.Event("change"));
  const replacement = instanceActions(dom.window.document, instance, options);
  assert.equal(replacement.disabled, true);
  replacement.value = "retire"; replacement.dispatchEvent(new dom.window.Event("change"));
  assert.equal(calls, 1);
  finish({}); await new Promise((r) => setImmediate(r));
  assert.equal(instanceActions(dom.window.document, instance, options).disabled, false);
  dom.window.close();
});
