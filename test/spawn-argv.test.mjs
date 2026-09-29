// `oats spawn` reads one soul and the flags it knows; anything else is
// E_BAD_ARGS, before any side effect. A bare `key=value` after the soul
// (`oats spawn dev join=oats`) was once accepted and ignored, so the spawn
// joined nothing: the refusal names the form that was meant.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const fail = (r) => { const j = r.json(); assert.equal(j.ok, false, r.stdout + r.stderr); assert.notEqual(r.status, 0); return j.error; };

test("a bare key=value, an unknown flag and an extra positional are each refused with a message naming the argument", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  assert.deepEqual(fail(fx.cli(["spawn", "dev", "join=oats", "--json"])), { code: "E_BAD_ARGS", message: `oats spawn: unexpected argument "join=oats" after the soul "dev": a capability setting is given as --provider <capability> key=value (here: --provider <capability> join=oats)` });
  assert.deepEqual(fail(fx.cli(["spawn", "dev", "--frobnicate", "--json"])), { code: "E_BAD_ARGS", message: "oats spawn: unknown flag --frobnicate" });
  assert.deepEqual(fail(fx.cli(["spawn", "dev", "other", "--json"])), { code: "E_BAD_ARGS", message: `oats spawn: unexpected argument "other" after the soul "dev": spawn takes one soul` });
  // The inline form is the spaced one: an unknown --x=v is the unknown flag --x.
  assert.equal(fail(fx.cli(["spawn", "dev", "--frobnicate=1", "--json"])).message, "oats spawn: unknown flag --frobnicate");
  // A value flag consumes its value; a positional after it is still extra.
  assert.equal(fail(fx.cli(["spawn", "dev", "--purpose", "p", "join=oats", "--json"])).code, "E_BAD_ARGS");
  // --provider consumes its capability and its key=value.
  assert.equal(fail(fx.cli(["spawn", "dev", "--provider", "oats.aweb", "join=oats", "extra", "--json"])).message, `oats spawn: unexpected argument "extra" after the soul "dev": spawn takes one soul`);
  // Nothing was created: the refusal comes before the soul is resolved.
  assert.deepEqual(readdirSync(join(fx.dep, "agents")), []);
});

test("text mode refuses the same way, and a routed spawn is refused locally before any server is contacted", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const text = fx.cli(["spawn", "dev", "join=oats"]);
  assert.notEqual(text.status, 0);
  assert.match(text.stderr, /unexpected argument "join=oats" after the soul "dev"/);
  // No server "nowhere" is registered: the argv refusal must come first.
  assert.deepEqual(fail(fx.cli(["spawn", "dev", "join=oats", "--server", "nowhere", "--json"])).code, "E_BAD_ARGS");
  assert.equal(fail(fx.cli(["spawn", "dev", "--frobnicate", "--server", "nowhere", "--json"])).message, "oats spawn: unknown flag --frobnicate");
});

/** Every `oats spawn <soul> …` form the docs show, placeholders filled: `<x>` is a value, `…` drops.
 *  Release notes and design records are history (a release note quotes the refused form), not usage. */
function documentedSpawnForms(dir) {
  const forms = new Set();
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) { if (!["release-notes", "design"].includes(e.name)) walk(join(d, e.name)); } else if (e.name.endsWith(".md")) for (const line of readFileSync(join(d, e.name), "utf8").split("\n")) for (const m of line.matchAll(/oats spawn ([^`|#\n]*)/g)) forms.add(m[1].trim()); } };
  walk(dir);
  const out = [];
  for (const form of forms) {
    const words = [];
    // `[--flag]` is optional and kept; `[the flags of a real spawn]` describes, and drops.
    for (const m of form.replace(/\[([^\]]*)\]/g, (_, inner) => (inner.trim().startsWith("--") ? ` ${inner} ` : " ")).matchAll(/"[^"]*"|'[^']*'|\S+/g)) {
      const w = m[0];
      if (w === "…" || w === "...") continue;
      words.push(/^["']/.test(w) ? w.slice(1, -1) : w.replace(/<[^>]*>/g, "x"));
    }
    if (!words.length || words[0].startsWith("--")) continue; // a flag named in prose, not a form
    words[0] = "dev";
    out.push(words);
  }
  return out;
}

test("every spawn form the docs and skills show still gets past the argument check", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const forms = ["../docs", "../skills", "../oats-package"].flatMap((d) => documentedSpawnForms(new URL(d, import.meta.url).pathname));
  assert.ok(forms.length >= 20, `found ${forms.length} documented forms`);
  for (const words of forms) {
    const r = fx.cli(["spawn", ...words, ...(words.includes("--preview") ? [] : ["--preview"]), ...(words.includes("--json") ? [] : ["--json"])]);
    const j = r.json();
    if (!j.ok) assert.doesNotMatch(j.error.message, /^oats spawn: (unknown flag|unexpected argument)/, `oats spawn ${words.join(" ")}`);
  }
});

/** The source of `name` in bin/oats.mjs: from its declaration to the next top-level function. */
function functionSource(src, name) {
  const start = src.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, `bin/oats.mjs declares ${name}`);
  const next = src.slice(start + 1).search(/^(?:async )?function /m);
  return src.slice(start, next < 0 ? undefined : start + 1 + next);
}

test("the flags spawn accepts are exactly the flags its code path reads", () => {
  const src = readFileSync(new URL("../bin/oats.mjs", import.meta.url), "utf8");
  // spawnCmd and the readers it calls; `--json` is read once, globally (JSON_MODE).
  const path = ["spawnCmd", "dirFlag", "harnessFlag", "yoloFlag"].map((f) => functionSource(src, f)).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code only: comments name readers too
  const read = new Set(["json"]);
  for (const [, name] of path.matchAll(/\b(?:flag|valueFlag|get)\("([a-z][a-z-]*)"\)/g)) read.add(name);
  for (const [, name] of path.matchAll(/args\.includes\("--([a-z][a-z-]*)"\)/g)) read.add(name);
  for (const [, name] of path.matchAll(/args\[i\] === "--([a-z][a-z-]*)"/g)) read.add(name);
  // A reader given anything but a literal would hide a flag from this scan; the one exception
  // is the loop over retired flags, whose literal list is read here.
  const retiredLoop = /for \(const removed of \[([^\]]*)\]\) if \(flag\(removed\)/.exec(path);
  assert.ok(retiredLoop, "the retired-flag loop is where this scan expects it");
  const retired = [...retiredLoop[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  for (const call of path.matchAll(/\b(?:flag|valueFlag|get)\(([^)]*)\)/g)) {
    if (/^"[a-z][a-z-]*"$/.test(call[1]) || call[1] === "removed" || call[1] === "name") continue;
    assert.fail(`spawn reads a flag through ${call[0]}: this scan cannot see it`);
  }
  for (const r of retired) read.add(r);
  // Flags spawn reads only to refuse them with their replacement, before the argument check.
  const refusedBefore = new Set([...retired, "ephemeral"]);
  const valueFlags = /const SPAWN_VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(src), switches = /const SPAWN_SWITCHES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(valueFlags && switches, "bin/oats.mjs declares SPAWN_VALUE_FLAGS and SPAWN_SWITCHES");
  const accepted = new Set([...valueFlags[1].matchAll(/"([a-z-]+)"/g), ...switches[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
  accepted.add("provider"); // two words, handled on its own in spawnArgvProblem
  for (const name of read) if (!refusedBefore.has(name)) assert.ok(accepted.has(name), `spawn reads --${name}, but the argument check would refuse it: add it to SPAWN_VALUE_FLAGS or SPAWN_SWITCHES`);
  for (const name of accepted) assert.ok(read.has(name), `--${name} is accepted but nothing on the spawn path reads it`);
  for (const name of refusedBefore) assert.ok(!accepted.has(name), `--${name} is refused before the argument check; it is not an accepted flag`);
});
