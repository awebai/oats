// CLI lifecycle surface — the part that survived the workspace model.
//
// Phase B triage (workspace model v2, see
// docs/design/2026-09-23-workspace-module-contracts.md): every case here that
// drove the installed-capability tier (install / restore / list / trust /
// update / remove / migrate / catalog, lock v2 refusal, `capabilities.additive`
// activation, the payload-root and standalone Git probes) was deleted with
// that tier. What remains is what does not depend on it:
//   - usage errors on the roster commands refuse BEFORE any side effect;
//   - a soul.yaml cannot annotate itself with kernel-internal fields;
//   - the Desktop version probe answers without any deployment state;
//   - retired spawn flags are refused before any instance home is scaffolded.
// Coverage GAP left for the v2 rewrite (over the Northwind fixture): canonical
// capability-command dispatch (OATS_CLI_BIN / OATS_CAPABILITY / OATS_SETTINGS /
// OATS_TEAM_NAME reaching the dispatched process) — its fixtures were the
// removed install+trust+additive path.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { OATS_LOCK_FILE, findAgent } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const temp = () => mkdtempSync(join(tmpdir(), "oats-cli-lifecycle-"));
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

function gitify(dir) {
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init", "--allow-empty"]);
  return dir;
}

/** Run the CLI hermetically: no HOME leak, no `OATS_*` / `PI_*` leak from a
 * hosting instance, and the package catalog bound to nothing. */
const HERMETIC_HOME = mkdtempSync(join(tmpdir(), "oats-cli-lifecycle-home-"));
function cli(argv, { cwd, env: extra } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  Object.assign(env, { HOME: HERMETIC_HOME, OATS_HOME_DIR: join(HERMETIC_HOME, ".oats") }, extra);
  delete env.OATS_PACKAGE_CATALOG;
  return spawnSync(process.execPath, [CLI, ...argv], { cwd: cwd || tmpdir(), env, encoding: "utf8" });
}

/** Assert stdout is EXACTLY one schema-v1 envelope and return it. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one JSON document");
  assert.equal(doc.schemaVersion, 1);
  return doc;
}
const failEnvelope = (r, code) => {
  const d = envelope(r);
  assert.equal(d.ok, false, JSON.stringify(d));
  if (code) assert.equal(d.error.code, code, d.error.message);
  return d.error;
};

/** Content hash of every file under a tree — the byte-identical oracle. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== ".git") walk(p); }
      else if (e.isFile()) out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** A scope directory with a marker file, so "nothing was written" is checkable.
 * (The v1 `oats-config.yaml` it used to carry is gone with the config surface;
 * the file content is incidental to every case below.) */
function scope(base, name = "scope", config = "name: t\n") {
  const dir = join(base, name);
  write(join(dir, "oats-config.yaml"), config);
  return dir;
}

// ---------- usage errors refuse before any side effect ----------

test("retire of an unknown instance is E_SESSION_UNKNOWN, like every lookup by name: one --json envelope, no stack", () => {
  const base = temp();
  const s = scope(base);
  mkdirSync(join(s, "agents"));
  const r = cli(["retire", "nope", "--json"], { cwd: s });
  assert.equal(r.status, 1);
  assert.match(failEnvelope(r, "E_SESSION_UNKNOWN").message, /no instance named "nope"/);
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
  const text = cli(["retire", "nope"], { cwd: s });
  assert.equal(text.status, 1);
  assert.equal(text.stderr, 'oats: no instance named "nope"\n');
  rmSync(base, { recursive: true, force: true });
});

test("a valueless --dir is refused by the roster commands too, before any scaffold", () => {
  const base = temp();
  const s = scope(base);
  const before = snapshot(s);
  for (const argv of [["status"], ["spawn", "someone"], ["retire", "someone"]]) {
    const r = cli([...argv, "--dir"], { cwd: s });
    assert.notEqual(r.status, 0, `${argv[0]} accepted a valueless --dir`);
  }
  assert.deepEqual(snapshot(s), before, "no agent home, no branch, no config write");
  rmSync(base, { recursive: true, force: true });
});

// ---------- a soul cannot annotate itself ----------

test("a soul.yaml cannot declare _soulDir or _dir about itself", () => {
  const base = temp();
  const root = join(base, "agents");
  // `_soulDir` is consumed as "the read-only soul inside a package" and `_dir`
  // as the agent home: a soul that could declare either would be redirecting
  // its own spawn.
  write(join(root, "ghost", "soul", "soul.yaml"), "name: ghost\n_soulDir: /elsewhere/soul\n_dir: /elsewhere\n");
  const agent = findAgent(root, "ghost");
  assert.equal(agent.name, "ghost");
  assert.equal(agent._soulDir, undefined, "the soul declared its own package-soul directory");
  assert.equal(agent._dir, join(root, "ghost"));
  rmSync(base, { recursive: true, force: true });
});

// ---------- the Desktop version probe ----------

test("the Desktop version probe is unchanged: `oats version --json` still answers without any deployment state", () => {
  const base = temp();
  const s = scope(base);
  // Even a scope whose lock the kernel refuses must not break the probe — it is
  // how the Desktop decides whether a kernel is usable at all.
  write(join(s, OATS_LOCK_FILE), "{ not json");
  const r = cli(["version", "--json"], { cwd: s });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "exactly one JSON document");
  assert.match(doc.version, /^\d+\.\d+\.\d+/);
  rmSync(base, { recursive: true, force: true });
});

// ---------- retired flags reject before they can scaffold ----------

test("retired spawn flags are refused BEFORE any instance home is scaffolded", () => {
  const base = temp();
  const s = gitify(scope(base, "repo", "name: repo\n"));
  const before = snapshot(s);
  for (const argv of [["spawn", "someone", "--instance", "x"], ["spawn", "someone", "--ephemeral"]]) {
    const r = cli([...argv, "--dir", s, "--json"], { cwd: s });
    assert.notEqual(r.status, 0, `${argv.join(" ")} exited 0`);
    assert.equal(failEnvelope(r, "E_BAD_ARGS").code, "E_BAD_ARGS");
    assert.deepEqual(snapshot(s), before, `${argv.join(" ")} scaffolded before refusing`);
  }
  rmSync(base, { recursive: true, force: true });
});
