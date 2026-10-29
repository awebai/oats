// The reads' own cost (#1630): one read does each piece of work once, and keeps nothing for the next.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyCapturedHomes } from "../lib/instance-listing.mjs";
import { memberCloneOf } from "../lib/member-clone.mjs";

const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), "oats-read-cost-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test("one read asks git for a clone's remotes once, however many times it verifies the clone", (t) => {
  const deployment = scratch(t);
  const clone = join(deployment, "tools");
  mkdirSync(clone);
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { stdio: "ignore" });
  git("init", "-q"); git("remote", "add", "origin", "https://github.com/acme/tools.git");
  const remotes = new Map();
  assert.deepEqual(memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes }), { path: clone, rule: "convention" });
  // The clone changes under the read: the read keeps what it saw, so git was not asked again.
  git("remote", "set-url", "origin", "https://github.com/acme/other.git");
  assert.deepEqual(memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes }), { path: clone, rule: "convention" });
  // A new read (no map, or a new one) asks git afresh.
  assert.throws(() => memberCloneOf(deployment, {}, "github.com/acme/tools", { remotes: new Map() }), { code: "E_CLONE_MISMATCH" });
  assert.throws(() => memberCloneOf(deployment, {}, "github.com/acme/tools"), { code: "E_CLONE_MISMATCH" });
});

test("legacyCapturedHomes takes a home's record from the same read's listing, and reads the rest itself", (t) => {
  const root = scratch(t);
  const homeA = join(root, "dev", "instances", "a"), homeB = join(root, "dev", "instances", "b");
  for (const h of [homeA, homeB]) mkdirSync(h, { recursive: true });
  writeFileSync(join(homeA, "instance.json"), JSON.stringify({ instance: "a" }));
  writeFileSync(join(homeB, "instance.json"), JSON.stringify({ instance: "b" }));
  assert.equal(legacyCapturedHomes(root), null);
  // What the listing read stands for the file: a captured record the listing saw is named, even if the file changed since.
  const captured = { instance: "a", captured: true, portable: true };
  const records = new Map([[homeA, captured]]);
  const withRecords = legacyCapturedHomes(root, { records });
  const direct = (() => { writeFileSync(join(homeA, "instance.json"), JSON.stringify(captured)); return legacyCapturedHomes(root); })();
  assert.deepEqual(withRecords, direct);
});
