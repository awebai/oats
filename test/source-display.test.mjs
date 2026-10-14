// An external soul's `sourceDisplay` beside its exact `source` (#1111, feature source-display).
//
// The automations soul origin of kind `external` gains `sourceDisplay` when a row is answered
// (lib/automations.mjs soulOriginOf), built by the one reference-display policy in pinned-source
// context (lib/remote.mjs displayRepoRef); the snapshot index keeps its shape. `oats workspace
// status --json` external[] calls the same entry (test/cli-workspace.test.mjs runs it over a real
// fixture); this file holds the synthetic sources that fixture cannot read.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../lib/automations.mjs";
import { displayRepoRef } from "../lib/remote.mjs";

const C = "0123456789abcdef0123456789abcdef01234567";
const WITHHELD = "[repository reference withheld]";
// [source, its display]: user information is never shown; what cannot be rebuilt is withheld whole.
const SOURCES = [
  [`ssh://user:password@host/o/r@${C}`, `ssh://host/o/r@${C}`],
  [`git:ssh://user:password@host/o/r@${C}`, WITHHELD],
  [`git:user@host:o/r@${C}`, `ssh://host/o/r@${C}`],
  [`user@host:o/r@${C}`, `ssh://host/o/r@${C}`],
  [`ssh://user@host/o/r@${C}`, `ssh://host/o/r@${C}`],
  [`git:ssh://user@host/o/r@${C}`, WITHHELD],
  [`https://github.com/o/r@${C}`, `https://github.com/o/r@${C}`],
  [`git:github.com/o/r@${C}`, `git:github.com/o/r@${C}`],
  [`not a repository@${C}`, WITHHELD],
  [`git:github.com/o/r@abc123`, WITHHELD],
];
const memberName = (key) => key.split("/").at(-1);
const discovery = {
  members: [{ key: "github.com/acme/agents", souls: [{ name: "builder" }] }],
  packageSouls: [{ name: "helper", qualifiedName: "acme.pkg/helper", package: "acme.pkg", version: "1.0.0" }],
  external: SOURCES.map(([source], i) => ({ key: `host/o/r${i}`, source, soul: { name: `ext-${i}` } })),
};

test("an external soul origin carries sourceDisplay, the pinned display or the withheld text; source stays exact", () => {
  const index = A.soulIndexOf(discovery, memberName);
  SOURCES.forEach(([source, shown], i) => {
    for (const name of [`ext-${i}`, `r${i}/ext-${i}`]) {
      const origin = A.soulOriginOf(index, name);
      assert.deepEqual(origin, { kind: "external", repoKey: `host/o/r${i}`, source, sourceDisplay: shown }, name);
      assert.equal(origin.sourceDisplay, displayRepoRef(source, { pinned: true }), "the one entry builds it");
      assert.doesNotMatch(origin.sourceDisplay, /user|password/, source);
      assert.ok(origin.sourceDisplay === WITHHELD || /^[^@]*@[0-9a-f]{40}$/.test(origin.sourceDisplay), `no user marker, only the commit's @: ${origin.sourceDisplay}`);
    }
  });
});

test("the snapshot index keeps today's shape: sourceDisplay is built at output time, so an existing snapshot gets it", () => {
  const index = A.soulIndexOf(discovery, memberName);
  const stored = JSON.parse(JSON.stringify(index));
  for (const [i, [source]] of SOURCES.entries()) {
    assert.deepEqual(stored.byName[`ext-${i}`], [{ kind: "external", repoKey: `host/o/r${i}`, source }], "no sourceDisplay stored");
  }
  // A snapshot as read back from disk (written before the feature) answers the display too.
  assert.equal(A.soulOriginOf(stored, "ext-0").sourceDisplay, `ssh://host/o/r@${C}`);
  assert.equal("sourceDisplay" in stored.byName["ext-0"][0], false, "answering a row never writes into the index");
  // A hand-edited snapshot whose source is not a string is withheld, never echoed.
  stored.byName["ext-0"][0].source = 42;
  assert.equal(A.soulOriginOf(stored, "ext-0").sourceDisplay, WITHHELD);
});

test("member, package and ambiguous origins do not change", () => {
  const index = A.soulIndexOf({ ...discovery, external: [...discovery.external, { key: "host/o/dup", source: `https://github.com/o/dup@${C}`, soul: { name: "builder" } }] }, memberName);
  assert.deepEqual(A.soulOriginOf(index, "agents/builder"), { kind: "member", repoKey: "github.com/acme/agents", member: "agents" });
  assert.deepEqual(A.soulOriginOf(index, "helper"), { kind: "package", package: "acme.pkg", version: "1.0.0" });
  assert.deepEqual(A.soulOriginOf(index, "builder"), { kind: "ambiguous", candidates: 2 });
  assert.equal(A.soulOriginOf(index, "missing"), null);
});
