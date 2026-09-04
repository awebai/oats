// Golden fixtures for spawn and retire — step 1 of the migration plan in
// docs/2026-09-03-architecture-proposal.md ("Migration plan", step 1).
//
// WHAT THIS GUARDS. The plan's later steps move code without meaning to change
// behavior: split lib/core.mjs by responsibility (step 3), extract the runtime
// providers (step 4), extract the tmux platform (step 5), extract the work
// targets and add `none` (step 10). Each of those touches the five externally
// meaningful outputs of an instance — the composed AGENTS.md, TASK.md,
// instance.json, the persisted launch command line, and the retirement outcome
// — and a refactor can change any of them silently: a reordered injection block
// changes what every agent is told; a moved launch-flag builder changes what pi
// or claude is actually run with; a relocated work-mode branch changes whether a
// retiring instance's worktree, branch, or somebody else's shared tree survives.
// None of that fails an existing behavioral test, because the existing suite
// asserts properties ("--no-skills is present"), not bytes. This suite asserts
// bytes.
//
// Eight artifacts per case: the instance home tree, the composed AGENTS.md,
// TASK.md, instance.json, the launch command line on its own, the spawn
// envelope, `oats status --json`, the retire result, and the post-retire state of
// the agent directory and the repository's worktree and branch lists. One
// property is asserted rather than frozen — that every materialized skill is
// byte- and mode-identical to the source instance.json says it came from — because
// the kernel's own skills are edited routinely and a golden over their content
// would churn without proving anything about the copy.
//
// It is a CONTRACT, not a specification: a golden that changes is not
// automatically a bug, it is a change that has to be looked at and re-approved
// by regenerating with UPDATE_GOLDEN=1 and reading the diff.
//
//   node --test test/golden-fixtures.test.mjs           # verify
//   UPDATE_GOLDEN=1 node --test test/golden-fixtures.test.mjs   # re-approve
//
// The committed goldens under test/golden/ were produced by that second path on
// this branch, so they are exactly what this kernel emits today.
//
// HERMETIC, and it has to be: a fresh HOME per run (the config/lock walk climbs
// to `/` and would otherwise union the developer's own ~/oats-config.yaml),
// every OATS_*/PI_* variable stripped (running the suite inside an OATS instance
// otherwise re-points the whole context at the real repository), an empty
// package catalog, GIT_CONFIG_GLOBAL/SYSTEM neutered, fake `pi` and `claude`
// binaries on PATH (spawn resolves the binary even under --no-launch), a fixed
// PI_AGENTS_TMUX_SESSION, and --no-launch everywhere so tmux is never contacted.
// No network, no real tmux, no developer state.
//
// THE MATRIX. runtime × work mode × knowledge slot × messaging slot = 32 cases,
// named `<runtime>-<work>-k<none|stub>-m<none|stub>` (k = knowledge slot, m =
// messaging slot), plus 4 model-preference cases named with a `-model` /
// `-modellist` suffix (see MODEL PREFERENCE below) and one `-deletebranch` case
// for the branch-deleting retire path = 37.
// NOTHING IS SKIPPED: every combination is reachable, including
// the two that need extra setup —
//   - `attached` needs `--work-dir`, so each attached case first spawns an owner
//     instance in worktree mode and attaches to its <home>/work
//     (lib/core.mjs:5017, in spawnInstance, rejects attached without workDir);
//   - `workspace` needs a declared boundary, supplied here by the `team:` block
//     in the scope config (lib/core.mjs:5487-5491, spawnInstance's workspace branch).
// The knowledge and messaging slots are STUBS DEFINED IN THIS FILE as owned
// capabilities under .agents/capabilities/owned/. Nothing here depends on
// oats-okf, oats-aweb, or any sibling checkout, so a golden cannot move because
// a package next door moved.
//
// MODEL PREFERENCE. The 32 matrix cases set no model, so on their own they would
// freeze only the "unset ⇒ --model omitted" branch — while step 4 of the plan
// extracts resolveModelPreference AND the per-runtime flag placement. Four extra
// cases close that: for each runtime, one with a single preference and one with a
// two-entry preference list, all four otherwise identical to
// `<runtime>-worktree-kstub-mstub`, so the diff against that twin is exactly what
// the model contributed. They freeze all four resolution behaviors —
// pi passes a single preference through untouched, claude strips the `anthropic/`
// provider, pi PROBES a list with `pi --list-models` and keeps the winner's
// `:thinking` suffix, claude drops non-anthropic entries and strips `:thinking`.
// The probe is answered by the fixture's own `pi` stub (see fixture()), which
// ships a fixed two-model catalog, so the resolution is machine-independent.
//
// OBSTACLES TO DETERMINISM, and what was done about each. All of these are
// normalization, not omission — the artifact is still compared in full:
//   - absolute paths. The scope root, the hermetic HOME and the kernel package
//     root are replaced by <base>, <home> and <kernel>. Both the lexical and the
//     realpath spelling of each is replaced, because macOS hands out
//     /var/folders/… while git and realpathSync answer /private/var/folders/…
//     and BOTH forms appear in the same artifact (compare instance.json `home`
//     with the workspace-mode TASK.md line, which is built from
//     realpathSync(join(home,"work")) at lib/core.mjs:5637, spawnInstance's workDesc).
//   - instance.json `createdAt` (lib/core.mjs:5777) — replaced by <createdAt>.
//   - the retirement baseline file name. retirementKey() at lib/core.mjs:6174 is
//     sha256 OF THE INSTANCE HOME PATH, so `<agent>/instances/.oats-retirement/
//     baselines/<64 hex>.json` is a hash of a temp path and can never be stable
//     across machines. The hex is replaced by <retirement-key>; that the file
//     EXISTS, and where, is what the fixture freezes.
//   - git object ids in `git worktree list --porcelain` — replaced by <sha>.
//   - tmux socket: absent by construction. meta.tmux.socket is only written on
//     the launch path (lib/core.mjs:5791), and every case here is --no-launch.
//   - capability integrity hashes: absent by construction. Owned capabilities are
//     config-owned and trusted without an integrity digest (manifestTrust,
//     lib/core.mjs:1314), so no content hash reaches a golden. Were one to
//     appear it would still be stable, since the stub bytes are fixed here.
//
// The stub retire hook deliberately reports itself through its returned `meta`
// rather than by writing a file into the instance home. A file written after the
// retirement baseline was stamped would be seen as "changed instance-home bytes"
// (inspectRetirementWork, lib/core.mjs:6326) and preserved into a recovery
// directory whose path carries a timestamp — a real behavior, but not one that
// can be frozen byte for byte. Freezing recovery output needs its own fixture
// with a controlled clock; it is not in this suite.
//
// WHAT A GREEN RUN DOES NOT PROVE. Two things above are "absent by construction",
// and absent by construction means UNTESTED, not correct. Read them as holes:
//   - the tmux socket and everything else the LAUNCH path writes. Every case is
//     --no-launch, so meta.launched is always false, meta.tmux.socket is never
//     written, and the retirement baseline's runtime authority is always the
//     `{launched:false}` shape. A full pass says nothing about launched-instance
//     metadata, about tmuxSocket(), or about the quiesce-before-recovery
//     sequence in retire — all of which step 5 (extract the platform) moves.
//     test/retire-work-safety.test.mjs drives the launched path with a fake tmux
//     and is the suite that covers it.
//   - the recovery directory. Nothing here dirties an instance home or a
//     worktree after the baseline is stamped, so `workRecovery` is absent in all
//     of them and the preserve-work path is never exercised.
//   - runtime-package verification. `composition.materialized.runtimePackages` is
//     `[]` in every golden, because neither stub capability declares a
//     `requires:` entry with a `runtime:`. So verifyRuntimePackages
//     (lib/core.mjs:4966) — which step 4 also extracts, and which can FAIL a
//     spawn outright — is frozen only in its empty case. Closing this needs a
//     stub capability requiring a fake runtime package plus a `pi list` stub in
//     the fixture pi (test/capabilities.test.mjs's fakePiWithPackages shows the
//     output shape); that is a separate fixture and deliberately not built here.
//
// FROZEN AS FOUND, not endorsed: every status.json shows a phantom instance
// named `.oats-retirement`. The retirement baselines live at
// `<agent>/instances/.oats-retirement/` (retirementStateRoot is dirname(home),
// lib/core.mjs:6167) while listInstances treats EVERY directory under
// `instances/` as an instance (lib/core.mjs:5962), so the state directory is
// reported as a live-looking roster row with no metadata. That is current
// behavior, so the goldens record it; if it is fixed, these goldens change and
// that is the correct signal, not a fixture bug.
//
// NOT A DEFECT: the stub capabilities carry no integrity digest. That is the
// documented trust model, not an oversight — an owned capability is config-owned,
// trusted by authorship rather than by hash, and manifestTrust returns
// `{trusted:true, configOwned:true}` for any `owned:` origin before any digest is
// computed (lib/core.mjs:1314). Provenance outranks location: what makes it
// trusted is that the operator wrote it into their own scope. Acquired package
// capabilities are the ones that carry integrity, and they are a different seam.
// Please do not re-file this as a gap in the fixtures.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const KERNEL_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = join(KERNEL_ROOT, "bin", "oats.mjs");
const GOLDEN_ROOT = join(KERNEL_ROOT, "test", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

// One fixed task string for every case: the task text is an INPUT, so varying it
// would only make the goldens differ from each other for no reason.
const TASK = "Freeze the externally meaningful outputs of spawn and retire.";

// ---------- the case table ----------

const RUNTIMES = ["pi", "claude"];
const WORK_MODES = ["worktree", "checkout", "attached", "workspace"];
const SLOTS = ["none", "stub"];

/** A single model preference, and a two-entry preference LIST. The same two
 *  strings are used for BOTH runtimes on purpose: resolveModelPreference
 *  (lib/core.mjs:4913) resolves them differently per runtime, and the goldens are
 *  where that asymmetry becomes visible instead of merely documented —
 *
 *    pi,     one entry   → returned verbatim, no probe: `anthropic/claude-sonnet-4-5`
 *    claude, one entry   → anthropic provider stripped: `claude-sonnet-4-5`
 *    pi,     two entries → each probed with `pi --list-models <bare id>`; the
 *                          fixture catalog does not list gpt-5, so the second
 *                          entry wins WITH its `:thinking` suffix intact
 *    claude, two entries → non-anthropic entries dropped, `:thinking` stripped:
 *                          `claude-sonnet-4-5`
 */
const MODEL_ONE = "anthropic/claude-sonnet-4-5";
const MODEL_LIST = "openai/gpt-5,anthropic/claude-sonnet-4-5:thinking";

/** Every combination. `id` is both the golden directory name and the spawn
 *  --purpose, so the instance is named `dev-<id>` and a golden can be traced to
 *  the command that produced it. */
const CASES = [];
for (const runtime of RUNTIMES) {
  for (const work of WORK_MODES) {
    for (const knowledge of SLOTS) {
      for (const messaging of SLOTS) {
        CASES.push({ id: `${runtime}-${work}-k${knowledge}-m${messaging}`, runtime, work, knowledge, messaging });
      }
    }
  }
}
// Model preference, one pair per runtime on top of the matrix. Held at
// worktree/kstub/mstub so the ONLY difference from
// `<runtime>-worktree-kstub-mstub` is the model, and the diff between the two
// goldens is exactly what the model contributed.
for (const runtime of RUNTIMES) {
  const fixed = { runtime, work: "worktree", knowledge: "stub", messaging: "stub" };
  CASES.push({ id: `${runtime}-worktree-kstub-mstub-model`, ...fixed, model: MODEL_ONE });
  CASES.push({ id: `${runtime}-worktree-kstub-mstub-modellist`, ...fixed, model: MODEL_LIST });
}
// Branch deletion. Every case above retires WITHOUT --delete-branch, so all of
// them freeze `branchDeleted: false` and a surviving `agents/dev-…` branch, and
// the deletion path — which is the one that destroys work if step 10 moves it
// wrong — was unfrozen. ONE case covers it, on pi only: branch deletion belongs
// to the work target, not to the runtime provider (retireInstance's git block,
// lib/core.mjs:6682-6685, never consults meta.runtime), so a claude twin would
// duplicate the fixture without testing anything the pi one does not.
CASES.push({
  id: "pi-worktree-kstub-mstub-deletebranch",
  runtime: "pi", work: "worktree", knowledge: "stub", messaging: "stub", deleteBranch: true,
});

// ---------- fixture construction ----------

const write = (path, content, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
};

const HERMETIC_HOME = mkdtempSync(join(tmpdir(), "oats-golden-home-"));
const BASES = [];

/** The stub knowledge capability: a knowledge layer with a soul-scaffold hook
 *  (soul/knowledge/index.md), a spawn hook (STATE.md + notes/ in the home), an
 *  injection block and one skill. Deliberately NOT oats-okf. */
function knowledgeCapability(scope) {
  const dir = join(scope, ".agents", "capabilities", "owned", "golden-knowledge");
  write(join(dir, "oats.json"), `${JSON.stringify({
    capability: "golden.knowledge",
    version: "1.0.0",
    description: "Stub knowledge layer for the golden fixtures.",
    compatibility: { oats: ">=0.6.2" },
    layer: "knowledge",
    skills: ["skills"],
    inject: "inject.md",
    hooks: { "soul-scaffold": "hooks/scaffold.mjs", spawn: "hooks/spawn.mjs" },
  }, null, 2)}\n`);
  write(join(dir, "inject.md"), "## Knowledge (stub)\n\nYour durable knowledge is at `soul/knowledge/index.md`.\nYour working state for this instance is `STATE.md` and `notes/`.\n");
  write(join(dir, "skills", "golden-knowledge", "SKILL.md"), "---\nname: golden-knowledge\ndescription: Read and write the stub knowledge base.\n---\n\n# Stub knowledge skill\n\nRead `soul/knowledge/index.md`.\n");
  write(join(dir, "hooks", "scaffold.mjs"), `#!/usr/bin/env node
// soul-scaffold: create the soul-side knowledge tree exactly once.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const soul = process.env.OATS_SOUL;
mkdirSync(join(soul, "knowledge"), { recursive: true });
writeFileSync(join(soul, "knowledge", "index.md"), "# Knowledge index\\n");
console.log(JSON.stringify({ meta: { scaffolded: ["knowledge/index.md"] } }));
`);
  write(join(dir, "hooks", "spawn.mjs"), `#!/usr/bin/env node
// spawn: this instance's own working state, inside the instance home.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(join(home, "STATE.md"), "# State\\n");
mkdirSync(join(home, "notes"), { recursive: true });
writeFileSync(join(home, "notes", ".keep"), "");
console.log(JSON.stringify({
  meta: { state: "STATE.md", notes: "notes/" },
  brief: "Knowledge: keep STATE.md current and drop working notes in notes/.",
}));
`);
}

/** The stub messaging capability: a messaging layer with a REQUIRED spawn hook
 *  that returns meta, a per-runtime launch argument and one environment variable
 *  under the GOLDEN_ vendor prefix it declares (docs/capabilities.md, "Commands
 *  and hooks"), plus a retire hook, an injection block and one skill. */
function messagingCapability(scope) {
  const dir = join(scope, ".agents", "capabilities", "owned", "golden-messaging");
  write(join(dir, "oats.json"), `${JSON.stringify({
    capability: "golden.messaging",
    version: "1.0.0",
    description: "Stub messaging layer for the golden fixtures.",
    compatibility: { oats: ">=0.6.2" },
    layer: "messaging",
    skills: ["skills"],
    inject: "inject.md",
    environment: ["GOLDEN_BROKER_ENDPOINT"],
    hooks: { spawn: { command: "hooks/spawn.mjs", required: true }, retire: "hooks/retire.mjs" },
  }, null, 2)}\n`);
  write(join(dir, "inject.md"), "## Messaging (stub)\n\nYou are reachable over the stub broker named in `$GOLDEN_BROKER_ENDPOINT`.\n");
  write(join(dir, "skills", "golden-messaging", "SKILL.md"), "---\nname: golden-messaging\ndescription: Send and receive over the stub broker.\n---\n\n# Stub messaging skill\n\nThe broker endpoint is in `$GOLDEN_BROKER_ENDPOINT`.\n");
  write(join(dir, "hooks", "spawn.mjs"), `#!/usr/bin/env node
// spawn (required): mint this instance's messaging identity. The env name is the
// exact one declared in the manifest, under this capability's GOLDEN_ prefix.
const alias = process.env.OATS_INSTANCE;
console.log(JSON.stringify({
  meta: { alias, endpoint: "stub://broker/" + alias },
  brief: "Messaging: you are reachable as " + alias + ".",
  launch: { pi: "--golden-channel stub", claude: "--golden-channel stub" },
  env: { GOLDEN_BROKER_ENDPOINT: "stub://broker/" + alias },
}));
`);
  write(join(dir, "hooks", "retire.mjs"), `#!/usr/bin/env node
// retire: records that it ran, through meta rather than by touching the home —
// see the note about the retirement baseline at the top of the test.
console.log(JSON.stringify({
  meta: { retired: true, ran: "retire", alias: process.env.OATS_INSTANCE },
}));
`);
}

/** A complete hermetic deployment for one case:
 *
 *   <base>/bin/{pi,claude}            fake runtimes on PATH
 *   <base>/scope/oats-config.yaml     team: block + the case's layer activations
 *   <base>/scope/.agents/capabilities/owned/…   the stub capabilities
 *   <base>/scope/repo/                the soul's git repo (branch `main`)
 *   <base>/scope/agents/dev/soul/     the soul, created through `oats create`
 *                                     so the soul-scaffold hook really runs
 */
function fixture(kase) {
  const base = mkdtempSync(join(tmpdir(), "oats-golden-"));
  BASES.push(base);
  const bin = join(base, "bin");
  // `claude` is never executed here: under --no-launch spawn only RESOLVES it on
  // PATH (which(), lib/core.mjs:5646), and claude's model translation is pure.
  write(join(bin, "claude"), "#!/bin/sh\nexit 0\n", 0o755);
  // `tmux` is never executed by spawn or retire under --no-launch either, but
  // `oats status` reads the roster through tmuxWindows() (lib/core.mjs:4880),
  // which shells out to `tmux has-session`. A stub keeps that read off the
  // developer's real server: no session, so nothing is ever reported RUNNING.
  write(join(bin, "tmux"), "#!/bin/sh\nexit 1\n", 0o755);
  // `pi` IS executed, by exactly one probe. resolveModelPreference runs
  // `pi --list-models <bare id>` for each entry of a preference LIST of two or
  // more (lib/core.mjs:4938) and reads whitespace columns, col 1 = provider,
  // col 2 = model id. A fixed two-model catalog makes that probe answer the same
  // on every machine — and answer NOTHING for gpt-5, so the first entry of the
  // list case is genuinely unavailable and the fallthrough to the second is what
  // the golden freezes. Single-entry preferences never reach the probe.
  write(join(bin, "pi"), `#!/bin/sh
if [ "$1" = "--list-models" ]; then
  case "$2" in
    claude-sonnet-4-5) echo "anthropic  claude-sonnet-4-5  fixture-catalog" ;;
    claude-opus-4-1) echo "anthropic  claude-opus-4-1  fixture-catalog" ;;
  esac
  exit 0
fi
exit 0
`, 0o755);

  const scope = join(base, "scope");
  const repo = join(scope, "repo");
  const root = join(scope, "agents");
  mkdirSync(repo, { recursive: true });

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  Object.assign(env, {
    HOME: HERMETIC_HOME,
    OATS_HOME_DIR: join(HERMETIC_HOME, ".oats"),
    PI_AGENTS_TMUX_SESSION: "oats-golden",
    PATH: `${bin}:${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Golden", GIT_AUTHOR_EMAIL: "golden@example.invalid",
    GIT_COMMITTER_NAME: "Golden", GIT_COMMITTER_EMAIL: "golden@example.invalid",
  });
  delete env.OATS_PACKAGE_CATALOG; // empty catalog: nothing can reach the network
  delete env.PI_AGENTS_ROOT;

  const git = (...argv) => execFileSync("git", ["-C", repo, ...argv], { env, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { env, stdio: ["ignore", "pipe", "pipe"] });
  write(join(repo, "README.md"), "# Golden fixture repo\n");
  write(join(repo, ".gitignore"), "node_modules/\n");
  git("add", "-A");
  git("commit", "-qm", "init");

  if (kase.knowledge === "stub") knowledgeCapability(scope);
  if (kase.messaging === "stub") messagingCapability(scope);

  // "none" is expressed by simply not activating a capability for that slot,
  // which is what an installation with no knowledge (or no messaging) package
  // looks like. The `team:` block is what gives `workspace` mode its boundary
  // and puts the team line into TASK.md and instance.json for every case.
  const layers = [];
  if (kase.knowledge === "stub") layers.push("    knowledge:\n      capability: golden.knowledge\n      from: owned\n      global: true\n");
  if (kase.messaging === "stub") layers.push("    messaging:\n      capability: golden.messaging\n      from: owned\n      global: true\n");
  write(join(scope, "oats-config.yaml"),
    "name: golden\n"
    + "team:\n  name: golden-team\n  id: golden-team-id\n"
    + (layers.length ? `capabilities:\n  layers:\n${layers.join("")}` : ""));

  // The soul goes through the real CLI so the knowledge stub's soul-scaffold
  // hook runs on the path an operator would take.
  mkdirSync(root, { recursive: true });
  const soulText = "# dev\n\nYou are the golden-fixture developer soul.\n\n## Operating notes\n\n- Do repository work in `./work`.\n";
  const instrFile = join(base, "soul-AGENTS.md");
  write(instrFile, soulText);
  const created = spawnSync(process.execPath, [CLI, "create", "dev",
    "--description", "Golden fixture developer soul.",
    "--repo", repo, "--work", "checkout", "--runtime", "pi",
    "--instructions-file", instrFile, "--dir", root,
  ], { encoding: "utf8", env, cwd: tmpdir() });
  assert.equal(created.status, 0, `oats create failed: ${created.stderr}${created.stdout}`);

  return { base, scope, repo, root, env };
}

function cli(f, argv) {
  return spawnSync(process.execPath, [CLI, ...argv, "--dir", f.root], { encoding: "utf8", env: f.env, cwd: tmpdir() });
}

/** `oats spawn --json` emits exactly one schema-v1 envelope. The WHOLE envelope
 *  is returned, not just `result`: the envelope itself is a frozen artifact, and
 *  the single-document check is the agent-callable contract every machine
 *  consumer depends on. */
function spawnEnvelope(f, argv) {
  const r = cli(f, argv);
  assert.equal(r.status, 0, `spawn failed (${r.status}):\n${r.stderr}\n${r.stdout}`);
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one JSON document");
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.ok, true, r.stdout);
  return doc;
}

// ---------- normalization ----------

/** Path substitutions for one case, longest pattern first so a prefix can never
 *  eat a longer match. Every path contributes BOTH its lexical and its realpath
 *  spelling: git and realpathSync answer /private/var/… on macOS while Node's
 *  tmpdir() hands out /var/…, and both spellings appear in the same artifact. */
function substitutions(f) {
  const pairs = [];
  const add = (path, placeholder) => {
    for (const form of new Set([resolve(path), (() => { try { return realpathSync(path); } catch { return resolve(path); } })()])) {
      pairs.push([form, placeholder]);
    }
  };
  add(f.base, "<base>");
  add(HERMETIC_HOME, "<home>");
  add(KERNEL_ROOT, "<kernel>");
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

function normalize(text, f) {
  let out = String(text);
  for (const [from, to] of substitutions(f)) out = out.split(from).join(to);
  // createdAt is the only volatile field in instance.json.
  out = out.replace(/("createdAt":\s*)"[^"]*"/g, '$1"<createdAt>"');
  // sha256 of the instance home path — see the header note on retirementKey().
  out = out.replace(/baselines\/[0-9a-f]{64}\.json/g, "baselines/<retirement-key>.json");
  // git object ids from `git worktree list --porcelain`.
  out = out.replace(/\b[0-9a-f]{40}\b/g, "<sha>");
  return out;
}

// ---------- artifact readers ----------

/** A directory tree as sorted relative paths, symlinks marked with their target
 *  and never followed. Directories carry a trailing slash so an empty one is
 *  still visible.
 *
 *  The sort is CODE-POINT, not localeCompare: locale collation is a property of
 *  the machine's ICU data and LANG, and it puts `soul` before `STATE.md` in en
 *  and after it in C — a golden that flips with the developer's environment is
 *  worse than no golden. (The kernel's own skill ordering does use
 *  localeCompare, lib/core.mjs:5735; that is kernel behavior this suite freezes
 *  rather than works around, and its inputs are all lowercase.) */
function treeOf(dir) {
  const lines = [];
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort(byName)) {
      const path = join(d, e.name);
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (lstatSync(path).isSymbolicLink()) lines.push(`${child} -> ${readlinkSync(path)}`);
      else if (e.isDirectory()) { lines.push(`${child}/`); walk(path, child); }
      else lines.push(child);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  else lines.push("(absent)");
  return `${lines.join("\n")}\n`;
}

/** A content fingerprint of a tree: every descendant's relative path, permission
 *  bits, and bytes (or symlink target), in code-point order. Two trees with the
 *  same fingerprint are the same tree as copyTreeSafe (lib/core.mjs:1055) defines
 *  copying — which is the comparison the materialization assertion needs, and the
 *  reason it hashes modes and link targets rather than only file contents. */
function treeFingerprint(dir) {
  const parts = [];
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort(byName)) {
      const path = join(d, e.name);
      const child = rel ? `${rel}/${e.name}` : e.name;
      const st = lstatSync(path);
      parts.push(`${child}\0${(st.mode & 0o7777).toString(8)}`);
      if (st.isSymbolicLink()) parts.push(`link\0${readlinkSync(path)}`);
      else if (st.isDirectory()) { parts.push("dir"); walk(path, child); }
      else parts.push(`file\0${readFileSync(path).toString("base64")}`);
    }
  };
  walk(dir, "");
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

/** `oats status --json` with `agents` and each agent's `instances` put in a
 *  stable order.
 *
 *  This IS a normalization of real nondeterminism, not of a volatile value, so it
 *  is called out rather than buried: listInstances reads the roster with a bare
 *  readdirSync and never sorts (lib/core.mjs:5959-5983), so the order of the
 *  `instances` array is whatever the filesystem hands back — stable on one
 *  machine, not across APFS and ext4. Ordering it here keeps every other part of
 *  the status schema frozen; the cost is that a future kernel change which starts
 *  sorting (or stops) will not show up in these goldens. */
function orderStatus(stdout) {
  const doc = JSON.parse(stdout);
  const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  doc.agents.sort(byKey("name"));
  for (const a of doc.agents) (a.instances || []).sort(byKey("instance"));
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** What retirement left behind on the repository side. Frozen because step 10 of
 *  the migration plan moves the per-mode retire branches, and "did the worktree
 *  go, did the branch stay, did somebody else's shared tree survive" is exactly
 *  what a move can get wrong. */
function gitStateOf(f) {
  const run = (...argv) => execFileSync("git", ["-C", f.repo, ...argv], { encoding: "utf8", env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  const worktrees = run("worktree", "list", "--porcelain").trim();
  const branches = run("branch", "--format=%(refname:short)").trim();
  return `# git worktree list --porcelain\n${worktrees}\n\n# git branch\n${branches}\n`;
}

// ---------- golden comparison ----------

/** Line-level LCS, rendered as a unified diff. The artifacts are small (tens to
 *  a few hundred lines), so the quadratic table is free and the output is what a
 *  reviewer actually needs: which line moved, not "strings differ". */
function unifiedDiff(expected, actual, label) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [`--- golden/${label}`, `+++ live/${label}`];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push(`-${a[i]}`); i++; }
    else { out.push(`+${b[j]}`); j++; }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  // Trim runs of unchanged context to three lines either side of a change.
  const changed = out.map((l, k) => k > 1 && (l.startsWith("+") || l.startsWith("-")));
  const keep = out.map((_, k) => k < 2 || changed.slice(Math.max(0, k - 3), k + 4).some(Boolean));
  const trimmed = [];
  let skipping = false;
  for (let k = 0; k < out.length; k++) {
    if (keep[k]) { trimmed.push(out[k]); skipping = false; }
    else if (!skipping) { trimmed.push("@@ …"); skipping = true; }
  }
  return trimmed.join("\n");
}

function golden(caseId, name, actual) {
  const file = join(GOLDEN_ROOT, caseId, name);
  if (UPDATE) { write(file, actual); return; }
  assert.ok(existsSync(file), `missing golden ${relative(KERNEL_ROOT, file)} — regenerate with UPDATE_GOLDEN=1`);
  const expected = readFileSync(file, "utf8");
  if (expected === actual) return;
  assert.fail(`golden mismatch: ${caseId}/${name}\n${unifiedDiff(expected, actual, `${caseId}/${name}`)}\n\nIf this change is intended, re-approve it with UPDATE_GOLDEN=1 and review the diff in the commit.`);
}

// UPDATE_GOLDEN rewrites from scratch so a case removed from the matrix cannot
// leave an orphan golden behind, silently still "passing".
if (UPDATE) rmSync(GOLDEN_ROOT, { recursive: true, force: true });

test.after(() => {
  for (const b of BASES.splice(0)) rmSync(b, { recursive: true, force: true });
  rmSync(HERMETIC_HOME, { recursive: true, force: true });
});

// ---------- the cases ----------

for (const kase of CASES) {
  test(`golden: ${kase.id}`, () => {
    const f = fixture(kase);

    // Attached mode operates on ANOTHER instance's work tree, so the owner has
    // to exist first. It is spawned in worktree mode with a fixed purpose, and
    // its own artifacts are not frozen — only its effect on this case is (the
    // attached instance becomes its child, and retirement must leave the owner's
    // tree and branch alone).
    const extra = [];
    if (kase.work === "attached") {
      const owner = spawnEnvelope(f, ["spawn", "dev", "--purpose", "owner", "--work", "worktree",
        "--runtime", "pi", "--task", TASK, "--no-launch", "--json"]).result;
      extra.push("--work-dir", join(owner.home, "work"));
    }

    // The model reaches the kernel through `--model` rather than a `model:` in
    // soul.yaml. Both feed the SAME call site — resolveModelPreference(o.model ||
    // agent.model || "", runtime) at lib/core.mjs:5020 — so freezing one freezes
    // the resolver; `--model` is chosen because it is the path `oats spawn` and
    // the Desktop take, it exercises the flag's precedence over the soul default,
    // and it leaves the fixture soul byte-identical across every case, so a
    // difference between a model golden and its no-model twin can only have come
    // from the model.
    if (kase.model) extra.push("--model", kase.model);

    const envelope = spawnEnvelope(f, ["spawn", "dev", "--purpose", kase.id, "--work", kase.work,
      "--runtime", kase.runtime, "--task", TASK, "--no-launch", "--json", ...extra]);
    const spawned = envelope.result;
    const home = spawned.home;

    // The soul-scaffold hook is a spawn-adjacent contract that no other artifact
    // here would witness, since the soul reaches the home as a symlink.
    assert.equal(existsSync(join(f.root, "dev", "soul", "knowledge", "index.md")), kase.knowledge === "stub",
      "the knowledge stub's soul-scaffold hook ran exactly when the slot is filled");

    // 1. the instance home tree (symlinks marked, never followed)
    golden(kase.id, "home-tree.txt", normalize(treeOf(home), f));
    // 2. the composed instructions, verbatim
    golden(kase.id, "AGENTS.md", normalize(readFileSync(join(home, "AGENTS.md"), "utf8"), f));
    // 3. the task briefing, verbatim
    golden(kase.id, "TASK.md", normalize(readFileSync(join(home, "TASK.md"), "utf8"), f));
    // 4. instance metadata, volatile fields normalized
    const meta = readFileSync(join(home, "instance.json"), "utf8");
    golden(kase.id, "instance.json", normalize(meta, f));
    // 5. the persisted launch command line, on its own so a provider extraction
    //    that changes one flag is a one-line diff and not a needle in metadata
    const parsedMeta = JSON.parse(meta);
    golden(kase.id, "command.txt", `${normalize(parsedMeta.command, f)}\n`);
    // 6. the agent-callable spawn envelope
    golden(kase.id, "spawn-envelope.json", normalize(`${JSON.stringify(envelope, null, 2)}\n`, f));
    // 7. the roster as the Desktop and any script sees it
    const status = cli(f, ["status", "--json"]);
    assert.equal(status.status, 0, `status failed (${status.status}):\n${status.stderr}\n${status.stdout}`);
    golden(kase.id, "status.json", normalize(orderStatus(status.stdout), f));

    // MATERIALIZATION FIDELITY. instance.json claims each composed skill came
    // from a particular source tree; this proves the bytes in the home ARE that
    // tree, byte for byte, mode for mode. Asserted as a PROPERTY rather than
    // frozen as a golden on purpose: the kernel's own skills are edited
    // routinely, and a golden over their content would churn on every
    // documentation fix while proving nothing about the copy. What can silently
    // break in a refactor is the copy — a skipped symlink, a dropped mode, a
    // source resolved before an override was applied — and that is what this
    // catches, at every case, without a fixture to re-approve.
    for (const s of parsedMeta.composition.materialized.skills) {
      assert.equal(
        treeFingerprint(join(home, ".agents", "skills", s.name)), treeFingerprint(s.from),
        `materialized skill "${s.name}" does not match the source instance.json records it came from (${s.from})`);
    }

    // ---- retirement ----
    const retireArgs = ["retire", spawned.instance, "--json"];
    if (kase.deleteBranch) retireArgs.push("--delete-branch");
    const retired = cli(f, retireArgs);
    assert.equal(retired.status, 0, `retire failed (${retired.status}):\n${retired.stderr}\n${retired.stdout}`);
    const retireDoc = JSON.parse(retired.stdout);
    golden(kase.id, "retire-result.json", normalize(`${JSON.stringify(retireDoc, null, 2)}\n`, f));

    // 8. what retirement left: the agent directory, and the repository's
    //    worktree and branch lists.
    golden(kase.id, "after-retire.txt", normalize(
      `# tree of <base>/scope/agents/dev\n${treeOf(join(f.root, "dev"))}\n${gitStateOf(f)}`, f));
  });
}
