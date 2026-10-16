// instanceSiblings / siblingText (#1312): who is whose sibling by explicit link, and the words for it.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceSiblings, instanceId, instanceLinks } from "../../client/instance-tree.mjs";
import { siblingText } from "../../client/instance-presentation.mjs";

const names = (map, inst) => (map.get(instanceId(inst)) || []).map((s) => s.instance);

test("instanceSiblings: both ends of a link name each other; the unlinked are absent", () => {
  const a = { instance: "alpha", home: "/r/alpha" }, b = { instance: "beta", home: "/r/beta", siblingInstance: "alpha" };
  const loner = { instance: "loner", home: "/r/loner" };
  const map = instanceSiblings([b, loner, a]);
  assert.deepEqual(names(map, a), ["beta"]);
  assert.deepEqual(names(map, b), ["alpha"]);
  assert.equal(map.has(instanceId(loner)), false, "an instance with no sibling is absent from the map");
  assert.equal(map.get(instanceId(a))[0], b, "the lists hold the roster's own rows");
});

test("instanceSiblings: an unknown name, an ambiguous name or another server's name gives no sibling", () => {
  assert.equal(instanceSiblings([{ instance: "b", home: "/r/b", siblingInstance: "ghost" }]).size, 0, "unknown name");
  // two same-root candidates named "alpha": ambiguous, so nothing (never the first match)
  const ambiguous = [
    { instance: "alpha", home: "/r/one/alpha", agentsRoot: "/r" },
    { instance: "alpha", home: "/r/two/alpha", agentsRoot: "/r" },
    { instance: "beta", home: "/r/beta", agentsRoot: "/r", siblingInstance: "alpha" },
  ];
  assert.equal(instanceSiblings(ambiguous).size, 0, "ambiguous name");
  const remote = [
    { instance: "alpha", home: "/r/alpha", server: "far" },
    { instance: "beta", home: "/r/beta", siblingInstance: "alpha" },
  ];
  assert.equal(instanceSiblings(remote).size, 0, "a name on another server never resolves");
});

test("instanceSiblings: a self-link is nothing; mutual links are listed once", () => {
  assert.equal(instanceSiblings([{ instance: "a", home: "/r/a", siblingInstance: "a" }]).size, 0);
  const a = { instance: "a", home: "/r/a", siblingInstance: "b" }, b = { instance: "b", home: "/r/b", siblingInstance: "a" };
  const map = instanceSiblings([a, b]);
  assert.deepEqual(names(map, a), ["b"]);
  assert.deepEqual(names(map, b), ["a"]);
});

test("instanceSiblings: direct links only — a chain C→B→A gives B [A, C], A [B], C [B]", () => {
  const a = { instance: "A", home: "/r/A" }, b = { instance: "B", home: "/r/B", siblingInstance: "A" };
  const c = { instance: "C", home: "/r/C", siblingInstance: "B" };
  const map = instanceSiblings([c, b, a]);
  assert.deepEqual(names(map, b), ["A", "C"]);
  assert.deepEqual(names(map, a), ["B"], "A and C are not inferred");
  assert.deepEqual(names(map, c), ["B"]);
});

test("instanceSiblings: co-children of one parent are not siblings here; relation/relativeTo are not read", () => {
  const roster = [
    { instance: "lead", home: "/r/lead" },
    { instance: "x", home: "/r/x", parentInstance: "lead", relation: "sibling", relativeTo: "y" },
    { instance: "y", home: "/r/y", parentInstance: "lead" },
  ];
  assert.equal(instanceSiblings(roster).size, 0);
});

test("instanceSiblings: each list is in the roster's order (name, then identity)", () => {
  const anchor = { instance: "anchor", home: "/r/anchor" };
  const roster = [
    { instance: "zeta", home: "/r/zeta", siblingInstance: "anchor" },
    { instance: "beta", home: "/r/z/beta", siblingInstance: "anchor" },
    { instance: "beta", home: "/r/a/beta", siblingInstance: "anchor" },
    { instance: "mu", home: "/r/mu", siblingInstance: "anchor" },
    anchor,
  ];
  const listed = instanceSiblings(roster).get(instanceId(anchor));
  assert.deepEqual(listed.map((s) => s.home), ["/r/a/beta", "/r/z/beta", "/r/mu", "/r/zeta"]);
});

test("instanceLinks reads the sibling link through the one reader: well-formed rows unchanged", () => {
  assert.deepEqual(instanceLinks({ instance: "b", parentInstance: "p", siblingInstance: "a" }), ["p", "a"]);
  assert.deepEqual(instanceLinks({ instance: "b", siblingInstance: "b" }), []);
  assert.deepEqual(instanceLinks({ instance: "b" }), []);
});

test("siblingText: none, one, two and three names, in the order given", () => {
  const n = (...xs) => xs.map((instance) => ({ instance }));
  assert.equal(siblingText([]), null);
  assert.equal(siblingText(undefined), null);
  assert.equal(siblingText(n("a")), "sibling of a");
  assert.equal(siblingText(n("a", "b")), "sibling of a and b");
  assert.equal(siblingText(n("a", "b", "c")), "sibling of a, b and c");
});
