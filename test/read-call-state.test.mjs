// The deployment reads' per-call state (awebai/oats#1630, lib/read-call.mjs READ_STATE): a process that answers
// `oats status` and `oats workspace status` many times must forget, between calls, everything a one-shot CLI
// forgets at exit. A tripwire: the reads' import closure (the leaves lib/hot-reads.mjs lists for both reads, and
// every module those import, statically or by a literal `import()`) is scanned for module-level state that is
// written, a top-level `let`/`var` or a top-level `const` Map, Set, WeakMap, WeakSet, object or array that the
// module writes, and each binding found must have its row in READ_STATE: reset per call, scoped to the call, or
// safe with a reason. A new one fails here, by module and name, until it has one. Packages (yaml) are not
// scanned: the reads only call its parser. The caches outside the closure (OUTSIDE) must stay outside it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { hotLeaves, hotRead } from "../lib/hot-reads.mjs";
import { READ_STATE, resetReadState } from "../lib/read-call.mjs";
import { noteRuntimeName, runtimeNameWarning } from "../lib/deprecation.mjs";
import { activateLocalInputs, localRevision, recordLocalInput } from "../lib/local-inputs.mjs";
import { observeResolvedDeployment, resolvedDeployment, settleResolvedDeployment } from "../lib/resolved-deployment.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const rel = (file) => relative(ROOT, file).split("\\").join("/");
/** Module-level caches the reads cannot reach, named so that a move into the closure is a decision: the scan
 *  would then find them, and they would need a READ_STATE row. */
const OUTSIDE = [
  { module: "lib/core.mjs", binding: "whichMemo" },
  { module: "lib/servers.mjs", binding: "probeCaches" },
];

/** Every module the two reads can load: the hot-read leaves, then their imports, transitively. */
function readClosure() {
  const roots = new Set();
  for (const argv of [["status"], ["workspace", "status"]]) {
    const read = hotRead(argv);
    for (const line of Object.keys(read.lines)) for (const leaf of hotLeaves(read, line)) roots.add(join(ROOT, "lib", `${leaf}.mjs`));
  }
  const seen = new Map(), queue = [...roots];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, source);
    // A specifier that is not one literal would hide a module from this scan.
    assert.doesNotMatch(source, /\bimport\s*\(\s*(?!["'])/, `${rel(file)} imports a module by a non-literal specifier`);
    for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) queue.push(resolve(dirname(file), m[1]));
  }
  return seen;
}

/** The module-level state `source` writes: `[binding]`. */
function writtenState(source) {
  const found = [];
  for (const m of source.matchAll(/^(?:export\s+)?(?:let|var)\s+([^=;]+)/gm)) {
    for (const part of m[1].split(",")) { const name = /^\s*([A-Za-z_$][\w$]*)/.exec(part)?.[1]; if (name) found.push(name); }
  }
  const esc = (name) => name.replace(/\$/g, "\\$");
  for (const m of source.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:Map|Set|WeakMap|WeakSet)\b|[[{])/gm)) {
    const name = esc(m[1]);
    const collection = m[2].startsWith("new");
    const writes = collection
      ? new RegExp(`\\b${name}\\.(?:set|add|delete|clear)\\(`)
      : new RegExp(`\\b${name}(?:\\.[\\w$]+|\\[[^\\]]+\\])+\\s*(?:=(?!=)|\\+=|-=|\\+\\+|--)|\\b${name}\\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\\(|Object\\.assign\\(\\s*${name}\\b|\\bdelete\\s+${name}[.[]`);
    if (writes.test(source)) found.push(m[1]);
  }
  return found;
}

test("every module-level state the deployment reads write has its row in READ_STATE", () => {
  const closure = readClosure();
  assert.ok(closure.size > 20, "the closure was read");
  const modules = new Set([...closure.keys()].map(rel));
  for (const leaf of ["lib/roster-read.mjs", "lib/workspace-read.mjs", "lib/read-call.mjs", "lib/member-clone.mjs", "lib/drift.mjs", "lib/deployments.mjs"]) assert.ok(modules.has(leaf), `${leaf} is in the closure`);
  // Leaves: never core.mjs, nor bin.
  for (const m of modules) assert.ok(m.startsWith("lib/") && m !== "lib/core.mjs", `${m} may not be in the reads' closure`);
  const rows = new Map(READ_STATE.map((row) => [`${row.module} ${row.binding}`, row]));
  const found = new Set();
  for (const [file, source] of closure) for (const binding of writtenState(source)) found.add(`${rel(file)} ${binding}`);
  const missing = [...found].filter((key) => !rows.has(key));
  assert.deepEqual(missing, [], `module-level state the reads can reach with no READ_STATE row in lib/read-call.mjs (reset it per call, or list it as safe with its reason): ${missing.join(", ")}`);
  const stale = [...rows.keys()].filter((key) => !found.has(key));
  assert.deepEqual(stale, [], `READ_STATE rows the scan no longer finds (remove them): ${stale.join(", ")}`);
  for (const row of READ_STATE) {
    assert.ok(["reset", "scoped", "safe"].includes(row.how), `${row.module} ${row.binding}: how`);
    if (row.how === "reset") assert.equal(typeof row.reset, "function", `${row.module} ${row.binding}: its reset`);
    else assert.ok(typeof row.why === "string" && row.why.length > 20, `${row.module} ${row.binding}: why it is ${row.how}`);
  }
});

test("the caches outside the reads' closure are found where they are, and stay outside it", () => {
  const modules = new Set([...readClosure().keys()].map(rel));
  for (const { module, binding } of OUTSIDE) {
    assert.ok(writtenState(readFileSync(join(ROOT, module), "utf8")).includes(binding), `the scan finds ${module} ${binding}`);
    assert.ok(!modules.has(module), `${module} (${binding}) entered the reads' closure: give ${binding} a READ_STATE row first`);
  }
});

test("resetReadState forgets what the last read noted", () => {
  noteRuntimeName("a test");
  activateLocalInputs();
  recordLocalInput(join(ROOT, "package.json"), "x");
  let settled = "not settled";
  observeResolvedDeployment((dir) => { settled = dir; }, { atExit: false });
  resolvedDeployment("/somewhere", { canonical: true });
  resetReadState();
  assert.equal(runtimeNameWarning(), null, "the deprecated-name sources");
  assert.equal(localRevision(), null, "the local inputs, no longer recorded");
  // The observer is kept (it is the call's to settle); what was reported before the reset is not.
  settleResolvedDeployment();
  assert.equal(settled, "not settled", "nothing reported before the reset reaches the observer");
});
