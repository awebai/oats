// bin/oats.mjs — `oats onboard` under the workspace model v2 (decision 9; design doc §4).
//
// Runs the REAL CLI as a child process over the Northwind fixture (real bare Git
// remotes, real lib/remote.mjs). `oats onboard <dir> --workspace <ref>` writes
// <dir>/oats-local.yaml + <dir>/agents/ and then runs exactly the `oats sync`
// path: lock v3 (commit + integrity per package; no approval step) and exit 0.
// It creates NO soul, spawns NOTHING, writes NO oats-config.yaml and NO installed/
// tier; a second onboard of the same directory is E_ALREADY_ONBOARDED.
// Never invokes bare `oats setup`; never touches ~/.cache (OATS_REMOTE_CACHE).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { buildNorthwind, moveMember } from "./fixtures/northwind/build.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

/** A fixture base without whitespace or "@" (repo keys embed it) under the OS temp dir. */
function fixtureBase() {
  const base = mkdtempSync(join(tmpdir(), "oats-onboard-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  return base;
}

/** Run the CLI non-interactively: stdin is /dev/null (never a TTY); HOME-side state is isolated. */
function oats(args, { cwd, env = {}, base }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", HOME: join(base, "home"), OATS_REMOTE_CACHE: join(base, "cache"), ...env },
  });
}
/** stdout must be exactly one JSON envelope. */
function envelope(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one compact JSON object");
  assert.equal(doc.schemaVersion, 1);
  return doc;
}
/** Every path under dir, relative, sorted — to prove nothing but the onboarded layout exists. */
function tree(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(e.isDirectory() ? `${rel}/` : rel);
    if (e.isDirectory()) out.push(...tree(join(dir, e.name), rel));
  }
  return out;
}

test("oats onboard <dir> --workspace <ref>: writes oats-local.yaml + agents/, runs the sync path (lock v3, exit 0), creates nothing else, refuses a repeat", { timeout: 300_000 }, async () => {
  const base = fixtureBase();
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    mkdirSync(join(base, "home"));
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile };
    const dep = join(base, "northwind-workspace");
    assert.equal(existsSync(dep), false, "the deployment directory does not exist yet — onboard creates it");

    // ---- --json, non-TTY ----
    let r = oats(["onboard", dep, "--workspace", fx.refs.agents, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 0, `onboard exits 0 once the lock is written (like sync)\n${r.stdout}\n${r.stderr}`);
    let doc = envelope(r);
    assert.equal(doc.ok, true);
    const res = doc.result;
    assert.equal(res.onboardApi, 2);
    assert.equal(res.local, join(dep, "oats-local.yaml"));
    assert.equal(res.dir, dep);
    assert.equal(res.agents, join(dep, "agents"));
    assert.equal(res.lock, join(dep, "oats-lock.json"));
    assert.deepEqual(Object.keys(res).sort(), ["agents", "dir", "hosting", "local", "lock", "next", "onboardApi", "sync"]);

    // The embedded sync result IS the `oats sync --json` result (same code path).
    const sync = res.sync;
    assert.equal(sync.syncApi, 1);
    assert.deepEqual(Object.keys(sync).sort(), ["automations", "changes", "members", "packages", "problems", "syncApi", "warnings", "workspace"]);
    assert.equal(sync.workspace.name, "northwind");
    assert.equal(sync.workspace.key, fx.keys.agents);
    assert.equal(sync.workspace.commit, fx.commits.agents);
    assert.equal(sync.workspace.local, join(dep, "oats-local.yaml"));
    assert.equal(sync.members.length, 5);
    assert.ok(sync.members.every((m) => m.confirmed && m.status === "confirmed"), JSON.stringify(sync.members.map((m) => [m.name, m.status])));
    assert.deepEqual(sync.packages.map((p) => p.id), ["nw.tools", "oats.framework", "oats.okf"]);
    assert.deepEqual(sync.problems, []);

    // Next steps: what the chosen directory now holds; clone members you work IN, then spawn. The setup-expert hint is
    // CONDITIONAL (#1314): Northwind lists no northwind-oats-setup-expert and no soul declaring oats.setup, so
    // next.spawn is null and the first three listed souls are offered instead.
    assert.equal(res.next.spawn, null);
    assert.deepEqual(res.next.souls, ["campaign-writer", "data-analyst", "platform-engineer"]);
    assert.ok(!Object.hasOwn(res, "standalone"), "a readable workspace is not standalone");
    assert.deepEqual(res.next.clone.map((c) => c.name).sort(), ["agents", "data", "marketing", "nw-tools", "platform"]);
    for (const c of res.next.clone) { assert.equal(typeof c.url, "string"); assert.ok(c.dir.startsWith(dep + "/"), c.dir); }
    assert.equal(res.next.clone.find((c) => c.name === "agents").dir, join(dep, "agents-repo"), "a member named agents is cloned beside agents/ (the instance homes), never into it");
    assert.equal(res.next.clone.find((c) => c.name === "platform").dir, join(dep, "platform"));

    // ---- what is on disk: exactly oats-local.yaml, oats-lock.json, agents/ ----
    assert.deepEqual(tree(dep), ["agents/", "oats-local.yaml", "oats-lock.json"], "onboard creates what the kernel needs and nothing else (the layout is the operator's)");
    assert.ok(statSync(join(dep, "agents")).isDirectory());
    const local = YAML.parse(readFileSync(join(dep, "oats-local.yaml"), "utf8"));
    assert.deepEqual(local, { schemaVersion: 2, workspace: fx.refs.agents });
    const lock = JSON.parse(readFileSync(join(dep, "oats-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(Object.keys(lock.packages), ["nw.tools", "oats.framework", "oats.okf"]);
    for (const [id, entry] of Object.entries(lock.packages)) {
      assert.ok(!Object.hasOwn(entry, "approved"), `${id} carries no approval record`);
      assert.match(entry.commit, /^[0-9a-f]{40}$/);
      assert.match(entry.integrity, /^sha256-[0-9a-f]{64}$/);
    }
    assert.equal(lock.packages["nw.tools"].commit, fx.commits["nw-tools"]);
    assert.equal(lock.packages["oats.okf"].commit, fx.commits["pkg-okf"]);
    // The removed v1 surface: no deployment config, no installed tier, no souls, no instances.
    assert.equal(existsSync(join(dep, "oats-config.yaml")), false, "no oats-config.yaml (removed with the installed tier)");
    assert.equal(existsSync(join(dep, ".agents")), false, "no .agents/capabilities/installed/");
    assert.equal(existsSync(join(dep, "local-agents")), false, "no local soul is created");
    assert.deepEqual(readdirSync(join(dep, "agents")), [], "agents/ is empty: nothing is spawned");
    assert.equal(existsSync(join(base, "cache")), true, "OATS_REMOTE_CACHE is honoured (nothing under ~/.cache from this test)");

    // ---- the directory now syncs like any deployment (same lock, nothing changed) ----
    r = oats(["sync", "--json", "--dir", dep], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    assert.deepEqual(doc.result.changes, [], "onboard's lock already describes the workspace");
    assert.equal(doc.result.workspace.name, "northwind");

    // ---- repeat: E_ALREADY_ONBOARDED, nothing touched ----
    const before = { local: readFileSync(join(dep, "oats-local.yaml"), "utf8"), lock: readFileSync(join(dep, "oats-lock.json"), "utf8") };
    r = oats(["onboard", dep, "--workspace", fx.refs.agents, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1);
    doc = envelope(r);
    assert.equal(doc.ok, false);
    assert.equal(doc.error.code, "E_ALREADY_ONBOARDED");
    assert.equal(doc.error.details.local, join(dep, "oats-local.yaml"));
    assert.match(doc.error.message, /oats sync/);
    assert.equal(readFileSync(join(dep, "oats-local.yaml"), "utf8"), before.local);
    assert.equal(readFileSync(join(dep, "oats-lock.json"), "utf8"), before.lock);
    // Text mode too (and with a DIFFERENT workspace ref: the mark is the file, not the ref).
    r = oats(["onboard", "--dir", dep, "--workspace", fx.refs.platform], { cwd: base, env, base });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /E_ALREADY_ONBOARDED|already exists/);
    assert.equal(r.stdout, "");
    assert.deepEqual(tree(dep), ["agents/", "oats-local.yaml", "oats-lock.json"]);

    // ---- text mode into a fresh directory (cwd = <dir>, no positional): the §4 next steps ----
    const dep2 = join(base, "nw2");
    mkdirSync(dep2);
    r = oats(["onboard", "--workspace", fx.refs.agents], { cwd: dep2, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Onboarded .*nw2 into workspace northwind/m);
    assert.match(r.stdout, /^workspace {2}northwind {2}\(/m, "the sync §8 report is printed");
    assert.match(r.stdout, /^packages {3}.*oats\.okf 2\.1\.3 ✓ \(@ [0-9a-f]{8}\)/m);
    assert.match(r.stdout, /oats-local\.yaml {5}which workspace this machine realizes/);
    assert.match(r.stdout, /agents\/ {13}instance homes/);
    assert.match(r.stdout, /Members you will work IN need a clone/);
    assert.match(r.stdout, new RegExp(`git clone \\S+platform\\.git \\S*nw2/platform`));
    assert.match(r.stdout, new RegExp(`git clone \\S+agents\\.git \\S*nw2/agents-repo`));
    assert.match(r.stdout, /^ {2}3\. No soul here holds oats\.setup — add a northwind-oats-setup-expert soul\n {5}\(the oats-getting-started skill has the template\), or spawn any listed soul:\n {7}oats spawn <soul> --dir \S*nw2 \(e\.g\. campaign-writer, data-analyst, platform-engineer\)$/m,
      "no setup soul in this workspace → the conventional name to add, and any listed soul");
    assert.doesNotMatch(r.stdout, /setup expert/);
    assert.doesNotMatch(r.stdout, /approv/i, "next steps never mention approving");
    assert.deepEqual(tree(dep2), ["agents/", "oats-local.yaml", "oats-lock.json"]);

    // ---- #1314 (c): souls NAMED oats-operator-expert or northwind-oats-setup-expert that do not declare oats.setup
    // are not the setup expert: with no holder, null ----
    await moveMember(fx, "data", async (work, { writeTree }) => {
      await writeTree({
        "souls/oats-operator-expert/soul.yaml": { yaml: { schemaVersion: 2, name: "oats-operator-expert", description: "Guides the setup of this workspace.", work: "directory", capabilities: {} } },
        "souls/oats-operator-expert/AGENTS.md": "# oats-operator-expert\n\nYou guide the setup.\n",
        "souls/northwind-oats-setup-expert/soul.yaml": { yaml: { schemaVersion: 2, name: "northwind-oats-setup-expert", description: "Named by convention, holds nothing.", work: "directory", capabilities: {} } },
        "souls/northwind-oats-setup-expert/AGENTS.md": "# northwind-oats-setup-expert\n",
      });
    }, { message: "data: add oats-operator-expert and northwind-oats-setup-expert, neither holding oats.setup" });
    const dep2c = join(base, "nw2c");
    r = oats(["onboard", dep2c, "--workspace", fx.refs.agents, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    doc = envelope(r);
    assert.equal(doc.result.next.spawn, null, "a soul's name alone, the conventional one included, never makes it the setup expert");
    assert.deepEqual(Object.keys(doc.result.next).sort(), ["clone", "souls", "spawn"], "onboardApi 2: no new field");
    r = oats(["onboard", join(base, "nw2d"), "--workspace", fx.refs.agents], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No soul here holds oats\.setup — add a northwind-oats-setup-expert soul/);
    assert.doesNotMatch(r.stdout, /oats spawn oats-operator-expert/);

    // ---- a ref that is not a workspace host: refused, and the two files are rolled back ----
    const dep3 = join(base, "nw3");
    r = oats(["onboard", dep3, "--workspace", fx.refs.knowledge, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1);
    doc = envelope(r);
    assert.equal(doc.error.code, "E_WORKSPACE_SCHEMA", doc.error.message);
    assert.equal(doc.error.details.rolledBack, true);
    assert.equal(existsSync(dep3), false, "a directory onboard created for a non-workspace is removed again");
    // A pre-existing directory stays (it is the operator's), only our files go.
    const dep4 = join(base, "nw4");
    mkdirSync(dep4);
    writeFileSync(join(dep4, "README.md"), "mine\n");
    r = oats(["onboard", dep4, "--workspace", fx.refs.knowledge, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1);
    assert.equal(envelope(r).error.code, "E_WORKSPACE_SCHEMA");
    assert.deepEqual(tree(dep4), ["README.md"], "only what onboard wrote is rolled back");

    // ---- arguments ----
    r = oats(["onboard", join(base, "nw5"), "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_BAD_ARGS");
    assert.equal(existsSync(join(base, "nw5")), false, "nothing is written before the arguments are accepted");
    r = oats(["onboard", join(base, "nw5"), "--workspace", "not a repo ref", "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_REPO_REF");
    assert.equal(existsSync(join(base, "nw5")), false);
    r = oats(["onboard", join(base, "nw5"), "--dir", join(base, "nw6"), "--workspace", fx.refs.agents, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 1); assert.equal(envelope(r).error.code, "E_BAD_ARGS", "<dir> and --dir together is ambiguous");
    r = oats(["onboard", "--help"], { cwd: base, env, base });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /oats onboard \[<dir>\] --workspace <repo ref>/);
    assert.doesNotMatch(r.stdout, /--force-existing|setup expert from official/, "the v1 usage is gone");
    assert.match(r.stdout, /setup expert \(the soul holding oats\.setup\)/);
    assert.doesNotMatch(r.stdout, /oats-operator-expert/, "help names no soul (#1314)");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---- #1314: the setup expert next.spawn names ----
// Among the souls onboarding lists: the one named `<workspace name>-oats-setup-expert`; else the first, by
// name, whose own soul.yaml declares oats.setup (`{ from: … }`, any source; `off` does not count); else
// none. Same JSON shape (onboardApi 2): text or null.
test("#1314: among souls declaring oats.setup (never one that turns it off), next.spawn names the conventional <workspace>-oats-setup-expert first, else the first by name, else null; a name alone never counts", { timeout: 300_000 }, async (t) => {
  const fx = v2Deployment({
    t, name: "west",
    souls: {
      "a-off": { soul: { capabilities: { "oats.setup": "off" } } },     // sorts first, turns oats.setup off: not a holder
      "b-guide": { soul: { capabilities: { "oats.setup": { from: "here" } } } },
      "c-guide": { soul: { capabilities: { "oats.setup": { from: "package" } } } },
      dev: {},
    },
    capabilities: { "oats.setup": { manifest: {} } },
  });
  const onboard = (name, json) => {
    const dir = join(fx.base, name);
    const r = fx.cli(["onboard", dir, "--workspace", fx.ref, ...(json ? ["--json"] : [])], { cwd: fx.base });
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    return { dir, r };
  };

  // (b) and (d): no west-oats-setup-expert, so the first holder by name; a-off sorts earlier but turns it off.
  let { dir, r } = onboard("first-holder", true);
  let next = r.json().result.next;
  assert.equal(next.spawn, `oats spawn b-guide --dir ${dir}`);
  assert.deepEqual(Object.keys(next).sort(), ["clone", "souls", "spawn"], "onboardApi 2: no new field");
  ({ dir, r } = onboard("first-holder-text", false));
  assert.match(r.stdout, /^ {2}3\. Spawn b-guide, this workspace's OATS setup expert\n {5}\(it holds oats\.setup\), to guide the rest:\n {7}oats spawn b-guide --dir \S*first-holder-text$/m);
  assert.doesNotMatch(r.stdout, /No soul here holds|spawn any listed soul/);

  // The conventional name alone does not count: a west-oats-setup-expert that does not declare oats.setup is skipped.
  const conventionalSoul = (capabilities) => ({ "souls/west-oats-setup-expert/soul.yaml": { yaml: { schemaVersion: 2, name: "west-oats-setup-expert", description: "Sets up west.", work: "directory", capabilities } },
    "souls/west-oats-setup-expert/AGENTS.md": "# west-oats-setup-expert\n" });
  fx.commit(conventionalSoul({}), "add a conventionally named soul without oats.setup");
  ({ dir, r } = onboard("conventional-undeclared", true));
  assert.equal(r.json().result.next.spawn, `oats spawn b-guide --dir ${dir}`, "a name without the declaration falls through to the first holder");

  // (a): the conventional name, declaring oats.setup, wins over holders that sort before it.
  fx.commit(conventionalSoul({ "oats.setup": { from: "package" } }), "the conventional soul declares oats.setup");
  ({ dir, r } = onboard("conventional", true));
  assert.equal(r.json().result.next.spawn, `oats spawn west-oats-setup-expert --dir ${dir}`);
  ({ r } = onboard("conventional-text", false));
  assert.match(r.stdout, /3\. Spawn west-oats-setup-expert, this workspace's OATS setup expert/);

  // (e): a workspace with no souls at all: no setup soul, and the any-soul hint without examples.
  const empty = v2Deployment({ t, name: "bare", souls: {} });
  const bareDir = join(empty.base, "empty");
  r = empty.cli(["onboard", bareDir, "--workspace", empty.ref, "--json"], { cwd: empty.base });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  next = r.json().result.next;
  assert.equal(next.spawn, null); assert.deepEqual(next.souls, []);
  r = empty.cli(["onboard", join(empty.base, "empty-text"), "--workspace", empty.ref], { cwd: empty.base });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}3\. No soul here holds oats\.setup — add a bare-oats-setup-expert soul\n {5}\(the oats-getting-started skill has the template\), or spawn any listed soul:\n {7}oats spawn <soul> --dir \S*empty-text$/m);

  // A shared name: two members whose repositories are both called ws.git each offer `guide`; only the
  // first declares oats.setup. `guide` and `ws/guide` each name both, so the hint names it by its repo key,
  // and that exact command spawns it.
  const west = v2Deployment({ t, name: "west", souls: { guide: { soul: { capabilities: { "oats.setup": { from: "here" } } } } }, capabilities: { "oats.setup": { manifest: {} } } });
  const east = v2Deployment({ t, name: "east", souls: { guide: {} } });
  east.commit({ "oats-membership.yaml": { yaml: { schemaVersion: 2, workspace: west.ref } } }, "east joins west");
  west.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "west", members: [west.ref, east.ref], defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } }, "west lists east");
  const shared = join(west.base, "shared");
  r = west.cli(["onboard", shared, "--workspace", west.ref, "--json"], { cwd: west.base });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const res = r.json().result;
  assert.ok(res.sync.members.every((m) => m.confirmed), JSON.stringify(res.sync.members));
  assert.equal(res.next.spawn, `oats spawn ${west.key}/guide --dir ${shared}`);
  r = west.cli(["spawn", `${west.key}/guide`, "--dir", shared, "--preview", "--json"]);
  assert.equal(r.status, 0, `the suggested name spawns the chosen soul: ${r.stdout}${r.stderr}`);
});

// ---- lane 3 (0.25.2) ----
// R10: (1) onboard's next steps list the HOST exactly like any other member when it is one — a clone is
// needed only if someone works IN it; there is no special "workspace clone" — and a clone already present
// (beside oats-local.yaml or named in clones:) is reported, not re-suggested. (2) The standalone header says
// WHY the view is standalone: `standalone:` in oats-local.yaml → "explicit"; an unreadable host → the access
// failure — never "cannot be read" when nothing was refused.
test("0.25.2 R10: onboard next-steps treat the host as a member like the others (clone only to work IN it; present clones reported); standalone headers say explicit vs unreadable-host", { timeout: 300_000 }, async () => {
  const base = fixtureBase();
  const { makeUnreadable } = await import("./fixtures/northwind/build.mjs");
  let unreadable = null;
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    mkdirSync(join(base, "home"));
    const catalogFile = join(base, "catalog.json");
    writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
    const env = { OATS_PACKAGE_CATALOG: catalogFile };

    // (1) host = agents (a member). Pre-place a clone of platform beside the deployment.
    const dep = join(base, "dep");
    mkdirSync(join(dep, "platform"), { recursive: true });
    spawnSync("git", ["clone", "-q", fx.refs.platform, join(dep, "platform")], { encoding: "utf8" });
    assert.ok(existsSync(join(dep, "platform", ".git")), "a platform clone is present before onboarding");
    let r = oats(["onboard", dep, "--workspace", fx.refs.agents, "--json"], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const res = envelope(r).result;
    assert.equal(res.hosting.hostIsMember, true);
    const host = res.next.clone.find((c) => c.name === "agents");
    assert.ok(host, "the host is in the clone list like every confirmed member");
    assert.equal(host.host, true); assert.equal(host.present, false);
    assert.equal(host.dir, join(dep, "agents-repo"));
    assert.ok(res.next.clone.filter((c) => c.name !== "agents").every((c) => c.host === false));
    const platform = res.next.clone.find((c) => c.name === "platform");
    assert.equal(platform.present, true); assert.equal(platform.dir, join(dep, "platform"));
    // Text: the host line is an ordinary `git clone` line plus the rule; the present clone is reported, not re-suggested.
    rmSync(join(dep, "oats-local.yaml")); rmSync(join(dep, "oats-lock.json")); // onboard again in text mode over the same directory
    r = oats(["onboard", dep, "--workspace", fx.refs.agents], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`git clone \\S+agents\\.git \\S*dep/agents-repo`), "the host is listed as a clone like the others");
    assert.match(r.stdout, /↑ the host is a member like the others: clone it only if someone works IN it — the workspace file is read over the remote/);
    assert.doesNotMatch(r.stdout, /workspace clone/i);
    assert.match(r.stdout, /dep\/platform {2}✓ already here$/m, "the pre-placed clone is reported");
    assert.doesNotMatch(r.stdout, /git clone \S+platform\.git/, "…and not suggested again");
    assert.match(r.stdout, /is itself a member\./);

    // (2a) explicit standalone (`standalone:` in oats-local.yaml, the workspace IS readable): the header says so.
    const sa = join(base, "sa");
    mkdirSync(join(sa, "agents"), { recursive: true });
    writeFileSync(join(sa, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.marketing}\nstandalone: ${fx.refs.marketing}\n`);
    r = oats(["sync", "--dir", sa], { cwd: sa, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^workspace {2}\(standalone view of marketing \(explicit in oats-local\.yaml\): its own souls \+ oats\.core\)/m, r.stdout);
    assert.doesNotMatch(r.stdout, /cannot be read/, "nothing was refused: the header must not claim the workspace cannot be read");
    r = oats(["souls", "--dir", sa], { cwd: sa, env, base });
    assert.match(r.stdout, /— standalone view of marketing \(explicit in oats-local\.yaml\)/);
    assert.doesNotMatch(r.stdout, /cannot be read/);
    r = oats(["workspace", "status", "--dir", sa], { cwd: sa, env, base });
    assert.match(r.stdout, /^ {2}\(standalone view of marketing \(explicit in oats-local\.yaml\): its own souls \+ oats\.core\)$/m);

    // (2b) unreadable host (workspace: names a member whose host cannot be read): the header names the failure.
    unreadable = await makeUnreadable(fx, "agents");
    const un = join(base, "un");
    mkdirSync(join(un, "agents"), { recursive: true });
    writeFileSync(join(un, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.data}\n`);
    r = oats(["sync", "--dir", un], { cwd: un, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^workspace {2}\(standalone — the workspace of data cannot be read \(E_REMOTE_UNREADABLE: (?:not-found|auth) — \S+agents\.git\); its own souls \+ oats\.core\)/m, r.stdout);
    r = oats(["onboard", join(base, "un2"), "--workspace", fx.refs.data], { cwd: base, env, base });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ {2}\(standalone — the workspace of data cannot be read from here \(E_REMOTE_UNREADABLE: (?:not-found|auth) — \S+agents\.git\); its own souls \+ oats\.core\)$/m, r.stdout);
    assert.match(r.stdout, /\(the host \S+agents\.git is not a member: nothing to clone|git clone \S+data\.git/, "standalone next steps still list the member");
  } finally {
    if (unreadable) await unreadable.restore();
    rmSync(base, { recursive: true, force: true });
  }
});
