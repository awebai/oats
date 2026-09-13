import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as brain from "../renderer/views/brain.mjs";
import { setWorkspace } from "../renderer/views/common.mjs";

const brainData = workspace => ({ soul: { agentsMd: `/${workspace}/AGENTS.md`, skills: [], knowledge: { tree: [] } }, instances: [] });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const dom = new JSDOM("<body><div id=a></div><div id=b></div></body>");
  const previous = globalThis.document; globalThis.document = dom.window.document;
  t.after(() => { brain.unmount(); globalThis.document = previous; setWorkspace(""); dom.window.close(); });
  return dom.window.document;
}

test("same-named brains coexist, remain pinned to their workspaces, and dispose independently", async t => {
  const doc = fixture(t), paths = [], requests = [];
  const api = path => {
    paths.push(path);
    if (path.startsWith("/api/agents")) return Promise.resolve({ agents: [{ name: "same-soul" }] });
    return new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
  };
  const a = doc.getElementById("a"), b = doc.getElementById("b");
  const pendingA = brain.mount(a, { api, workspace: "A", openFile() {} });
  const pendingB = brain.mount(b, { api, workspace: "B", openFile() {} });
  await tick(); assert.equal(requests.length, 2);
  requests[1].resolve(brainData("B")); const disposeB = await pendingB;
  requests[0].resolve(brainData("A")); const disposeA = await pendingA;
  assert.ok(a.querySelector('[title="/A/AGENTS.md"]'));
  assert.ok(b.querySelector('[title="/B/AGENTS.md"]'));
  assert.notEqual(a.querySelector("select").id, b.querySelector("select").id);
  const before = [...paths]; setWorkspace("C"); await tick();
  assert.deepEqual(paths, before, "retained brains must not reload as another workspace's soul");
  assert.deepEqual(paths.sort(), ["/api/agents?ws=A", "/api/agents?ws=B", "/api/brain/same-soul?ws=A", "/api/brain/same-soul?ws=B"].sort());
  disposeA();
  assert.equal(a.querySelector(".brain"), null);
  assert.ok(b.querySelector('[title="/B/AGENTS.md"]'));
  // A disposal must not invalidate B's subsequent selection request.
  b.querySelector("select").dispatchEvent(new doc.defaultView.Event("change"));
  await tick(); requests[2].resolve(brainData("B-updated")); await tick();
  assert.ok(b.querySelector('[title="/B-updated/AGENTS.md"]'));
  disposeB(); assert.equal(b.querySelector(".brain"), null);
});

for (const outcome of ["resolve", "reject"]) {
  test(`same-selection brain requests reject an older ${outcome} by generation, not just soul name`, async t => {
    const doc = fixture(t), a = doc.getElementById("a"), requests = [];
    const pending = brain.mount(a, { workspace: "A", openFile() {}, api: path => path.startsWith("/api/agents")
      ? Promise.resolve({ agents: [{ name: "same-soul" }] })
      : new Promise((resolve, reject) => requests.push({ resolve, reject })) });
    await tick();
    a.querySelector("select").dispatchEvent(new doc.defaultView.Event("change"));
    await tick(); assert.equal(requests.length, 2);
    requests[1].resolve(brainData("new")); await tick();
    if (outcome === "resolve") requests[0].resolve(brainData("old"));
    else requests[0].reject(new Error("old failure"));
    await pending;
    assert.ok(a.querySelector('[title="/new/AGENTS.md"]'));
    assert.equal(a.textContent.includes("old failure"), false);
  });

  test(`disposing a pending brain ignores its late ${outcome}`, async t => {
    const doc = fixture(t), a = doc.getElementById("a");
    let finish;
    const pending = brain.mount(a, { workspace: "A", openFile() {}, api: path => path.startsWith("/api/agents")
      ? Promise.resolve({ agents: [{ name: "same-soul" }] })
      : new Promise((resolve, reject) => { finish = outcome === "resolve" ? () => resolve(brainData("late")) : () => reject(new Error("late failure")); }) });
    await tick(); brain.unmount(); finish(); await pending;
    assert.equal(a.textContent, "");
  });
}
