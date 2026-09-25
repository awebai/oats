// Visibility (human decision 2026-09-25): souls have no private mode; a private capability is
// repo-owned — listed with `private: true`, usable only by its own repo's souls.
//
// The real CLI over a v2 deployment (test/helpers/v2-deployment.mjs) plus a second member whose
// soul asks for the first repo's private capability. Never bare `oats setup`; no network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";

/** A second member repository whose soul `outsider` asks for `repo-cap` from the first repo. */
function foreignMember(fx) {
  const bare = join(fx.base, "remotes", "other.git");
  mkdirSync(bare, { recursive: true });
  git(bare, "init", "-q", "--bare");
  const seed = join(fx.base, "other-seed");
  git(fx.base, "clone", "-q", bare, seed);
  mkdirSync(join(seed, "souls", "outsider"), { recursive: true });
  writeFileSync(join(seed, "oats-membership.yaml"), `schemaVersion: 2\nworkspace: ${fx.ref}\nteam: global\n`);
  writeFileSync(join(seed, "souls", "outsider", "soul.yaml"),
    `schemaVersion: 2\nname: outsider\ndescription: Lives in another repo.\nwork: directory\ncapabilities:\n  repo-cap: { from: ${fx.key} }\n`);
  writeFileSync(join(seed, "souls", "outsider", "AGENTS.md"), "# outsider\n");
  git(seed, "add", "-A"); git(seed, "commit", "-qm", "other member"); git(seed, "push", "-q", "origin", "HEAD:main");
  return pathToFileURL(bare).href;
}

test("a soul's private: true is ignored (listed, spawnable, warned); a private capability is listed as repo-owned and refused to a foreign soul", { timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({
    souls: {
      dev: {},
      hidden: { soul: { private: true } },
      keeper: { soul: { capabilities: { "repo-cap": { from: "here" } } } },
    },
    capabilities: { "repo-cap": { manifest: { private: true } } },
  });
  t.after(fx.cleanup);

  // sync: the soul-private-ignored warning, one per soul carrying the field; never a problem.
  let r = fx.cli(["sync", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const sync = r.json().result;
  const ignored = sync.warnings.filter((w) => w.code === "soul-private-ignored"); // the fixture's unmapped `global` label warns too
  assert.deepEqual(ignored.map((w) => [w.soul, w.path]), [["hidden", `${fx.key}:souls/hidden/soul.yaml#/private`]], "one warning, only for the soul carrying the field");
  assert.equal(ignored[0].message, "`private` has no effect on a soul since 0.26.0; remove it from souls/hidden/soul.yaml");
  assert.ok(!sync.problems.some((p) => p.code === "soul-private-ignored"));
  r = fx.cli(["sync"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^souls {6}3 discovered \(3 members, 0 external, 0 disabled here\) · 1 private capability \(repo-cap, .* only\)$/m, "the private count is of capabilities");
  assert.match(r.stdout, /^warning {4}soul-private-ignored {2}`private` has no effect on a soul since 0\.26\.0; remove it from souls\/hidden\/soul\.yaml$/m);
  r = fx.cli(["workspace", "status"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Warnings:\n(?:.*\n)*?\s+soul-private-ignored\s+`private` has no effect on a soul/);

  // souls: every soul is listed; `private` on a soul row is always false.
  r = fx.cli(["souls", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const souls = r.json().result.souls;
  assert.deepEqual(souls.map((s) => [s.name, s.private]), [["dev", false], ["hidden", false], ["keeper", false]]);
  // ...and spawnable.
  r = fx.cli(["spawn", "hidden", "--preview", "--json"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const spawned = await fx.spawn("hidden");
  assert.ok(spawned?.home, "the instance home is created");

  // capabilities: the private member capability is LISTED, private: true, with its owner.
  r = fx.cli(["capabilities", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const cap = r.json().result.capabilities.find((c) => c.name === "repo-cap");
  assert.ok(cap, "a private capability is listed");
  assert.equal(cap.private, true); assert.equal(cap.kind, "member"); assert.equal(cap.repoKey, fx.key);
  r = fx.cli(["capabilities"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\s*repo-cap \(repo-owned\)\s+member /m, "the human table marks it repo-owned");
  // Its own repo's soul uses it.
  r = fx.cli(["spawn", "keeper", "--preview", "--json"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /"repo-cap"/);

  // A soul of ANOTHER member is refused (enforcement unchanged).
  const otherRef = foreignMember(fx);
  fx.commit({ "oats-workspace.yaml": `schemaVersion: 2\nname: fixture\nmembers:\n  - ${fx.ref}\n  - ${otherRef}\nteams:\n  global: { description: Fixture team }\ndefaults:\n  knowledge: none\n  messaging: none\n  tasks: none\n` }, "add the other member");
  r = fx.cli(["sync", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  r = fx.cli(["capabilities", "--json"]);
  assert.equal(r.json().result.capabilities.find((c) => c.name === "repo-cap").private, true, "still listed once another member joins");
  r = fx.cli(["spawn", "outsider", "--preview", "--json"]);
  assert.notEqual(r.status, 0);
  assert.equal(r.json().error.code, "E_CAPABILITY_PRIVATE", r.stdout);

  // The Desktop's "Repo owned" section is gated on this feature.
  r = fx.cli(["version", "--json"]);
  assert.ok(JSON.parse(r.stdout).features.includes("capabilities-private"));
});

test("standalone view: a soul's private: true is listed and warned too", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ souls: { hidden: { soul: { private: true } } }, local: {} });
  t.after(fx.cleanup);
  writeFileSync(join(fx.dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.ref}\nstandalone: ${fx.ref}\n`);
  const r = fx.cli(["souls", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = r.json().result;
  assert.equal(doc.standalone, true);
  assert.deepEqual(doc.souls.map((s) => [s.name, s.private]), [["hidden", false]]);
  const st = fx.cli(["workspace", "status", "--json"]);
  assert.equal(st.status, 0, st.stderr);
  assert.deepEqual(st.json().result.warnings.filter((w) => w.code === "soul-private-ignored").map((w) => w.soul), ["hidden"]);
});

