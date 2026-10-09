// The loading proof of the shared home (packages/client): the kernel readers the Desktop shares
// with other clients load under plain Node, on a checkout with nothing of the Desktop installed.
// The Desktop's own suite proves where the package carries them (packages/desktop/test/
// inventory.test.mjs) and is omitted on a root-only checkout; this file is not.
//
// Two of the files are a program's entry and its first import, and are never imported here:
//   * own-environment.mjs changes the environment of whoever imports it (#602);
//   * liveness-main.mjs is the collector as a program: it reads stdin and writes stdout.
// They are loaded the way they are meant to be: the collector is run as a child.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOME = new URL("../packages/client/", import.meta.url);
const ENTRIES = ["liveness-main.mjs", "own-environment.mjs"];
const files = readdirSync(HOME).sort();

test("every module of packages/client, its two entries apart, loads by import under plain Node", async (t) => {
  for (const entry of ENTRIES) assert.ok(files.includes(entry), `${entry} is in the shared home`);
  const modules = files.filter((name) => name.endsWith(".mjs") && !ENTRIES.includes(name));
  assert.equal(modules.length, files.length - ENTRIES.length, "the shared home holds .mjs modules and nothing else");
  assert.ok(modules.length > 0);
  const environment = JSON.stringify(process.env);
  for (const name of modules) {
    const loaded = await import(new URL(name, HOME).href);
    assert.ok(Object.keys(loaded).length > 0, `${name} loads and exports something`);
  }
  assert.equal(JSON.stringify(process.env), environment, "loading the libraries changes nothing in the environment of the process that loads them");
  t.diagnostic(`${modules.length} modules loaded`);
});

test("the collector runs as a program: [] on stdin answers [], through both entries", () => {
  // No terminal server is consulted for no rows, and none is reachable: PATH names nothing.
  const collector = fileURLToPath(new URL("liveness-main.mjs", HOME));
  const run = (input) => spawnSync(process.execPath, [collector], { input, encoding: "utf8", timeout: 30_000, env: { PATH: "/nonexistent" } });
  // The entry's first import is the module that cleans its environment, and nothing else imports that one.
  const imports = (name) => [...readFileSync(new URL(name, HOME), "utf8").matchAll(/^[ \t]*import\b[^;'"]*?["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.equal(imports("liveness-main.mjs")[0], "./own-environment.mjs");
  assert.deepEqual(files.filter((name) => imports(name).includes("./own-environment.mjs")), ["liveness-main.mjs"]);
  const r = run("[]");
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "[]");
  // It is the program, not a module that happens to print: what is not a list of rows is refused.
  const bad = run("{}");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Invalid liveness request/);
});
