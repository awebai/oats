// bin/oats.mjs + lib/core.mjs — `oats spawn <soul> --name <slug>` (human decision 2026-09-24):
// an explicit, unprefixed instance name, and deployment-wide uniqueness for every name.
//
//   - `--name` is exact: `slug(x) !== x` or a soul name of this deployment → E_INSTANCE_NAME_INVALID.
//   - `--name` and `--purpose` are mutually exclusive → E_BAD_ARGS.
//   - A taken name (any soul's instances/ under the deployment agents root, or a live tmux
//     window of that name) → E_INSTANCE_NAME_TAKEN; never a silent `-2` for an explicit name.
//   - Preview reports the final name and the same refusals; the name is part of the decision
//     revision, so --expect-decision binds it.
//   - Derived names (`<soul>-<purpose>`, `<soul>-<n>`) de-duplicate deployment-wide (still `-2`).
//
// Runs the REAL CLI over the Northwind fixture. Never bare `oats setup`; HOME, the remote cache
// and the tmux session are isolated (a fake `tmux` on PATH answers the live-window lookup).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

function oats(args, { cwd, env = {}, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PATH: `${join(base, "fake-bin")}:${inertRuntimePath(base)}`, PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "",
      OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"),
      OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`,
      ...env,
    },
  });
}
const envelope = (r) => JSON.parse(r.stdout);
const refused = (r, code, what) => {
  assert.equal(r.status, 1, `${what}: refused\n${r.stdout}\n${r.stderr}`);
  const e = envelope(r).error;
  assert.equal(e.code, code, `${what}: ${code} (got ${e.code}: ${e.message})`);
  return e;
};

test("spawn --name: exact unprefixed name, typed refusals, preview binds it, deployment-wide uniqueness for explicit and derived names", { timeout: 600_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-spawn-name-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    mkdirSync(join(base, "home"));
    // A fake tmux: the session `live-<pid>` exists and holds a window named `rm-live`.
    mkdirSync(join(base, "fake-bin"));
    writeFileSync(join(base, "fake-bin", "tmux"), `#!/bin/sh
case "$1" in
  has-session) [ "$3" = "live-${process.pid}" ] && exit 0; exit 1 ;;
  list-windows) [ "$3" = "live-${process.pid}" ] && printf 'hq\\nrm-live\\n'; exit 0 ;;
esac
exit 1
`);
    chmodSync(join(base, "fake-bin", "tmux"), 0o755);
    const env = { OATS_PACKAGE_CATALOG: catalogFile };
    const dep = join(base, "northwind-workspace");
    const agentsRoot = join(dep, "agents");
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
    let r = oats(["sync", "--dir", dep, "--json"], { cwd: dep, env, base });
    assert.equal(r.status, 0, `sync\n${r.stdout}\n${r.stderr}`);

    // release-manager resolves oats.okf (which needs a state-dir); support-triager does not.
    const providerArgs = (soul) => (soul === "release-manager" ? ["--provider", "oats.okf", "state-dir=/tmp/x"] : []);
    const spawn = (soul, ...extra) => oats(["spawn", soul, "--dir", dep, "--agents-root", agentsRoot, "--work", "directory", "--no-launch", ...providerArgs(soul), ...extra, "--json"], { cwd: dep, env, base });

    // ---- argument refusals ----
    refused(spawn("release-manager", "--name", "rm-alpha", "--purpose", "x"), "E_BAD_ARGS", "--name with --purpose");
    refused(spawn("release-manager", "--name"), "E_BAD_ARGS", "--name without a value");
    for (const bad of ["RM-Alpha", "rm_alpha", "-rm", "rm-", "rm--alpha", "rm alpha", "../x"]) {
      const e = refused(spawn("release-manager", "--name", bad), "E_INSTANCE_NAME_INVALID", `--name ${JSON.stringify(bad)}`);
      assert.match(e.message, /slug/, "the refusal says the name must already be a slug");
    }
    // A soul name of this deployment — the one spawning, and one the workspace declares but
    // no instance has fetched — keeps soul and instance references unambiguous.
    for (const soulName of ["release-manager", "support-triager"]) {
      const e = refused(spawn("release-manager", "--name", soulName), "E_INSTANCE_NAME_INVALID", `--name ${soulName} (a soul)`);
      assert.match(e.message, /soul/);
    }
    assert.equal(existsSync(join(agentsRoot, "release-manager", "instances")), false, "no refusal created a home");

    // ---- preview reports the final name; the decision binds it ----
    r = spawn("release-manager", "--name", "rm-alpha", "--preview");
    assert.equal(r.status, 0, `preview\n${r.stdout}\n${r.stderr}`);
    const preview = envelope(r).result;
    assert.equal(preview.instance, "rm-alpha", "exactly the slug, no <soul>- prefix");
    assert.equal(preview.decision.instance, "rm-alpha");
    assert.equal(preview.home, join(agentsRoot, "release-manager", "instances", "rm-alpha"));
    assert.equal(existsSync(preview.home), false, "a preview creates nothing");
    r = spawn("release-manager", "--name", "rm-beta", "--expect-decision", preview.decision.revision);
    const stale = refused(r, "E_DECISION_STALE", "another name under the confirmed decision");
    assert.equal(stale.details.decision.instance, "rm-beta", "the fresh decision carries the other name");

    // ---- apply (keyed: a retry replays the receipt instead of refusing its own name) ----
    const apply = () => spawn("release-manager", "--name", "rm-alpha", "--expect-decision", preview.decision.revision, "--idempotency-key", "k-rm-alpha");
    r = apply();
    assert.equal(r.status, 0, `apply\n${r.stdout}\n${r.stderr}`);
    const made = envelope(r).result;
    assert.equal(made.instance, "rm-alpha");
    r = apply();
    assert.equal(r.status, 0, `keyed retry\n${r.stdout}\n${r.stderr}`);
    assert.equal(envelope(r).result.replayed, true, "a keyed retry replays its receipt (name checks run after key recovery)");
    assert.equal(JSON.parse(readFileSync(join(preview.home, "instance.json"), "utf8")).instance, "rm-alpha");

    // ---- taken: the same soul, another soul (deployment-wide), a live window — preview and apply ----
    for (const [soul, extra] of [["release-manager", []], ["release-manager", ["--preview"]], ["support-triager", []], ["support-triager", ["--preview"]]]) {
      const e = refused(spawn(soul, "--name", "rm-alpha", ...extra), "E_INSTANCE_NAME_TAKEN", `${soul} --name rm-alpha ${extra.join(" ")}`);
      assert.match(e.message, /rm-alpha/);
    }
    assert.equal(existsSync(join(agentsRoot, "release-manager", "instances", "rm-alpha-2")), false, "never a silent -2 for an explicit name");
    for (const extra of [[], ["--preview"]]) {
      refused(oats(["spawn", "release-manager", "--dir", dep, "--agents-root", agentsRoot, "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/x", "--name", "rm-live", ...extra, "--json"],
        { cwd: dep, env: { ...env, OATS_TMUX_SESSION: `live-${process.pid}`, PI_AGENTS_TMUX_SESSION: `live-${process.pid}` }, base }), "E_INSTANCE_NAME_TAKEN", `a live tmux window rm-live ${extra.join(" ")}`);
    }
    // The window check is the tmux backend's: a herdr spawn is not refused by a tmux window.
    r = oats(["spawn", "release-manager", "--dir", dep, "--agents-root", agentsRoot, "--work", "directory", "--no-launch", "--backend", "herdr", "--provider", "oats.okf", "state-dir=/tmp/x", "--name", "rm-live", "--preview", "--json"],
      { cwd: dep, env: { ...env, OATS_TMUX_SESSION: `live-${process.pid}`, PI_AGENTS_TMUX_SESSION: `live-${process.pid}` }, base });
    assert.equal(r.status, 0, `herdr preview ignores tmux windows\n${r.stdout}\n${r.stderr}`);
    assert.equal(envelope(r).result.instance, "rm-live");

    // ---- derived names de-duplicate deployment-wide (the latent collision) ----
    // release-manager takes the name support-triager-x; support-triager --purpose x would derive the same.
    r = spawn("release-manager", "--name", "support-triager-x");
    assert.equal(r.status, 0, `explicit support-triager-x\n${r.stdout}\n${r.stderr}`);
    r = spawn("support-triager", "--purpose", "x", "--preview");
    assert.equal(r.status, 0, `derived preview\n${r.stdout}\n${r.stderr}`);
    assert.equal(envelope(r).result.instance, "support-triager-x-2", "a derived name skips a name another soul holds");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

/** In-process spawns read the fixture's isolated HOME, remote cache, runtimes and tmux session. */
function v2(t, opts) {
  const fx = v2Deployment(opts);
  const saved = { ...process.env };
  Object.assign(process.env, { HOME: fx.env.HOME, OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE, PATH: fx.env.PATH, OATS_TMUX_SESSION: fx.env.OATS_TMUX_SESSION, PI_AGENTS_TMUX_SESSION: fx.env.PI_AGENTS_TMUX_SESSION });
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); fx.cleanup(); });
  return fx;
}

test("kernel naming: derived names skip another soul's instance and a soul name (the latent collision); name excludes purpose and instance", async (t) => {
  const fx = v2(t, { souls: { dev: {}, "dev-foo": {} } });
  // soul "dev" + purpose "foo-1" and soul "dev-foo" + purpose "1" both derive "dev-foo-1".
  assert.equal((await fx.spawn("dev", { purpose: "foo-1" })).instance, "dev-foo-1");
  assert.equal((await fx.spawn("dev-foo", { purpose: "1" })).instance, "dev-foo-1-2", "derived-vs-derived: the second soul skips the first's name");
  // soul "dev" + purpose "foo" derives "dev-foo" — a soul name — and skips it.
  assert.equal((await fx.spawn("dev", { purpose: "foo" })).instance, "dev-foo-2", "derived-vs-soul-name");
  // An orphaned home (its soul definition removed) still holds its name.
  mkdirSync(join(fx.root, "gone", "instances", "orphan-x"), { recursive: true });
  await assert.rejects(fx.spawn("dev", { name: "orphan-x" }), { code: "E_INSTANCE_NAME_TAKEN" });
  await assert.rejects(fx.spawn("dev", { name: "x", purpose: "y" }), { code: "E_BAD_ARGS" });
  await assert.rejects(fx.spawn("dev", { name: "x", instance: "dev-x" }), { code: "E_BAD_ARGS" });
  assert.equal((await fx.spawn("dev", { name: "plain" })).instance, "plain");
});

test("instance names are at most 64 characters — explicit and derived, preview and apply; never truncated", async (t) => {
  const fx = v2(t);
  const root = fx.root;
  const n64 = "n".repeat(64), n65 = "n".repeat(65);
  // Explicit: 64 is fine, 65 is refused (kernel, preview and apply) — never truncated.
  assert.equal((await fx.spawn("dev", { name: n64, preview: true })).instance, n64);
  for (const preview of [true, false]) {
    await assert.rejects(fx.spawn("dev", { name: n65, preview }), (e) => e.code === "E_INSTANCE_NAME_INVALID" && /at most 64 characters/.test(e.message));
  }
  const cli = (...args) => fx.cli(["spawn", "dev", "--no-launch", ...args, "--json"]);
  for (const extra of [["--preview"], []]) {
    const r = cli("--name", n65, ...extra);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(r.json().error.code, "E_INSTANCE_NAME_INVALID");
  }
  assert.equal(existsSync(join(root, "dev", "instances", n65)), false);
  assert.equal(existsSync(join(root, "dev", "instances", n64)), false, "a preview created nothing");
  // Derived: "dev-" + a 60-char purpose = 64 fits; a 61-char purpose is refused, naming the purpose.
  const p60 = "p".repeat(60), p61 = "p".repeat(61);
  assert.equal((await fx.spawn("dev", { purpose: p60 })).instance, `dev-${p60}`);
  for (const preview of [true, false]) {
    await assert.rejects(fx.spawn("dev", { purpose: p61, preview }), (e) => e.code === "E_INSTANCE_NAME_INVALID" && /at most 64 characters/.test(e.message) && /purpose/.test(e.message));
  }
  const r = cli("--purpose", p61, "--preview");
  assert.equal(r.json().error.code, "E_INSTANCE_NAME_INVALID", r.stdout + r.stderr);
  // The de-duplication suffix counts too: dev-<p60> is taken, and dev-<p60>-2 (66) is refused, not truncated.
  await assert.rejects(fx.spawn("dev", { purpose: p60 }), (e) => e.code === "E_INSTANCE_NAME_INVALID" && /purpose/.test(e.message));
  assert.deepEqual(readdirSync(join(root, "dev", "instances")).filter((n) => !n.startsWith(".")), [`dev-${p60}`]);
});
