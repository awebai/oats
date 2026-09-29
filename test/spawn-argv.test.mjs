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
