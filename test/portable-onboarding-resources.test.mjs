import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treeIntegrity } from "../lib/portable-digest.mjs";
import { retainPortableArtifact, verifyPortableArtifact } from "../lib/portable-artifacts.mjs";
import { renderInstructionText } from "../lib/instruction-composition.mjs";

const resources = [
  { name: "portable-instance-boundary.md", source: "kernel:instance-boundary" },
  { name: "portable-work-directory.md", source: "work-mode:directory" },
].map(entry => ({ ...entry, bytes: readFileSync(new URL(`../injects/${entry.name}`, import.meta.url)) }));

function assertPortableDoctrine(text) {
  assert.match(text, /instance\.json\.executionBinding/);
  assert.match(text, /explicit captured deployment\/resolution/);
  assert.match(text, /owned home\/incarnation/);
  assert.match(text, /--deployment/); assert.match(text, /--resolution/);
  assert.match(text, /CLAUDE\.md -> AGENTS\.md/);
  assert.match(text, /\.\/soul.*read-only|read-only retained source link/s);
  assert.match(text, /\.\/work.*instance-owned execution directory/s);
  assert.match(text, /cwd and a recorded `repo` path never select configuration/);
  assert.match(text, /No Git\s+repository or branch is created/);
  assert.match(text, /no knowledge layout, harvester, storage backend or publication\s+policy/);
  assert.match(text, /does not promise\s+implemented captured launch/);
  assert.match(text, /launchPending/);
  // Specific previously contradictory operative clauses, not a blanket word ban:
  assert.doesNotMatch(text, /They resolve their\s+scope from the directory/);
  assert.doesNotMatch(text, /context recorded as `repo` supplies configuration/);
  assert.doesNotMatch(text, /Retirement removes the execution directory only after/);
  assert.doesNotMatch(text, /oats (?:status|doctor|retire|session (?:start|restart))\b/);
  assert.doesNotMatch(text, /STATE\.md|okf-base\.json|run-source|memory-harvest/);
}

test("new portable boundary/directory resources preserve custody without legacy authority or lifecycle promises", () => {
  const text = resources.map(entry => entry.bytes.toString("utf8")).join("\n");
  assertPortableDoctrine(text);
  for (const entry of resources) {
    assert.equal(entry.bytes.includes(0), false);
    assert.ok(entry.bytes.length < 8 * 1024, "always-loaded boundary text stays focused");
  }
});

test("resource-only retention and formatting keep the exact portable doctrine after fixture source removal", t => {
  const root = mkdtempSync(join(tmpdir(), "oats-portable-boundary-resource-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source"), deployment = join(root, "deployment"); mkdirSync(source); mkdirSync(deployment);
  for (const entry of resources) writeFileSync(join(source, entry.name), entry.bytes);
  const reference = { kind: "resource", integrity: treeIntegrity(source) };
  retainPortableArtifact(deployment, source, reference);
  rmSync(source, { recursive: true });
  const retained = verifyPortableArtifact(deployment, reference);
  const blocks = resources.map(entry => {
    const file = join(retained.dir, entry.name), bytes = readFileSync(file);
    assert.deepEqual(bytes, entry.bytes);
    return { source: entry.source, file, content: bytes.toString("utf8") };
  });
  const text = renderInstructionText("# Explicit fixture body\n", blocks);
  assertPortableDoctrine(text);
  assert.match(text, /<!-- oats:kernel:instance-boundary src=/);
  assert.match(text, /<!-- oats:work-mode:directory src=/);
  assert.equal(reference.integrity.value, treeIntegrity(retained.dir).value);
  // This proves only the new resources and existing formatter/retention seam.
  // Lifecycle owner must separately wire inventory selection and test full text.
});
