// `oats spawn` answers the kernel's own code (awebai/oats#1047, feature spawn-kernel-codes).
//
// The kernel stage of a spawn used to answer a regular expression and a dozen names as they were
// raised and to re-badge every other kernel code as E_SPAWN_FAILED, so a refusal with a remedy
// (a missing harness package, an unreadable tmux server) reached a client as "the spawn mechanism
// failed". A spawn now goes through the lifecycle verbs' door: a kernel code is answered as
// raised, and E_SPAWN_FAILED is for an error with no kernel code.
//
// What the tests below hold:
//   - details are not widened: for every code, each error shape gets exactly the details the
//     catch before #1047 gave it (the former answer is rebuilt here from that catch, as it was),
//     and a code with no details of its own never carries a `home` taken from the error;
//   - the two the issue is about, through a real spawn: the harness-package gate
//     (E_HARNESS_RESOURCE_MISSING, at an apply and a preview, before any home exists), and a tmux
//     server that cannot be read (E_RUNTIME_ENDPOINT_UNKNOWN at an apply, before any effect and
//     after the home, the work and the hooks; a preview reads no server and is not refused, and
//     answers no E_SESSION_UNKNOWN for it);
//   - the feature word is in the probe.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kernelCode, spawnRefusalDetails } from "../lib/errors.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

/** The answer the catch of `spawnCmd` gave before #1047, rebuilt from it as it was: `{ code,
 *  details, exit }`. A typed CLI failure was thrown on, and the shared boundary answered it with its
 *  own name and the details only when `unconfirmed` was true. */
function formerAnswer(e) {
  const general = e.details?.unconfirmed === true ? e.details : undefined;
  if (["unsafe-config-key", "unsafe-config-value"].includes(e?.code)) return { code: e.code, details: general };
  if (typeof e?.code === "string" && /^E_LAUNCH_|^E_MODEL_UNKNOWN$|^E_UNSUPPORTED_HARNESS$|^E_HARNESS_UNAVAILABLE$|^E_CLAUDE_CONFIG_REMOVED$/.test(e.code)) return { code: e.code, details: e.details };
  if (e?.code === "E_REQUIREMENT_INACTIVE") return { code: e.code, details: { soul: e.soul, capabilities: e.capabilities, context: e.context, remedy: e.remedy } };
  if (e?.code === "E_CHILD_SPAWNS_DISABLED") return { code: e.code, details: { parent: e.parent, policy: e.policy } };
  if (["E_BRANCH_EXISTS", "E_BASE_UNKNOWN"].includes(e?.code)) return { code: e.code, details: undefined };
  if (e?.code === "E_INTERRUPTED") return { code: e.code, details: e.details, exit: e.exitStatus };
  if (e?.code === "E_REQUIRED_HOOK_FAILED" || e?.code === "E_HOOK_ENVIRONMENT_CONTRACT") return { code: e.code, details: { hooks: e.details?.hooks ?? [], ...(e.details?.unconfirmed === true ? { unconfirmed: true } : {}) } };
  if (e?.code === "E_REMOTE_UNREADABLE" && e.details?.commit) return { code: e.code, details: e.details };
  if (e?.code === "E_DECISION_STALE") return { code: e.code, details: { decision: e.decision } };
  if (e?.code === "E_IDEMPOTENCY_CONFLICT") return { code: e.code, details: { instance: e.instance, home: e.home } };
  if (e?.code === "E_PLACEMENT_TAKEN") return { code: e.code, details: { instance: e.instance, home: e.home } };
  if (e?.code === "E_INSTANCE_NAME_TAKEN") return { code: e.code, details: { instance: e.instance, home: e.home ?? null, ...(e.session ? { session: e.session } : {}) } };
  if (e?.code === "E_INSTANCE_NAME_INVALID") return { code: e.code, details: e.details };
  if (e?.code === "E_SPAWN_INCOMPLETE") return { code: e.code, details: { ...e.details, instance: e.instance, home: e.home, launched: e.launched } };
  return { code: ["E_BAD_ARGS", "E_RELATIVE_AMBIGUOUS"].includes(e.code) ? e.code : "E_SPAWN_FAILED", details: general };
}

/** Every code the catch named, a launch code it passed by its pattern, codes it re-badged (the
 *  issue's two, one raised after effects, one that carries `home` in its details at a retire), and
 *  an error with no kernel code. */
const CODES = ["E_LAUNCH_EXECUTABLE", "E_LAUNCH_ENV_MISSING", "E_MODEL_UNKNOWN", "E_UNSUPPORTED_HARNESS", "E_HARNESS_UNAVAILABLE", "E_CLAUDE_CONFIG_REMOVED",
  "E_REQUIREMENT_INACTIVE", "E_CHILD_SPAWNS_DISABLED", "E_BRANCH_EXISTS", "E_BASE_UNKNOWN", "E_INTERRUPTED", "E_REQUIRED_HOOK_FAILED", "E_HOOK_ENVIRONMENT_CONTRACT",
  "E_REMOTE_UNREADABLE", "E_DECISION_STALE", "E_IDEMPOTENCY_CONFLICT", "E_PLACEMENT_TAKEN", "E_INSTANCE_NAME_TAKEN", "E_INSTANCE_NAME_INVALID", "E_SPAWN_INCOMPLETE",
  "E_BAD_ARGS", "E_RELATIVE_AMBIGUOUS", "E_SPAWN_FAILED",
  "E_HARNESS_RESOURCE_MISSING", "E_RUNTIME_ENDPOINT_UNKNOWN", "E_WORK_PRESERVATION_FAILED", "E_UNIDENTIFIED_INSTANCE_HOME",
  "unsafe-config-key", "ENOENT", undefined];
/** The shapes an error of one code comes in: bare; with properties of every kind the catch read and
 *  a `home` of its own; with details that hold a `home`, with and without `unconfirmed`, and with a
 *  commit. */
const SHAPES = [
  ["bare", () => ({})],
  ["its properties and a home", () => ({ instance: "dev-1", home: "/w/agents/dev/instances/dev-1", launched: false, decision: { revision: "r" }, parent: "p", policy: { allow: false }, session: "s", soul: "dev", capabilities: ["x"], context: "c", remedy: "r", exitStatus: 143 })],
  ["details with a home", () => ({ details: { home: "/w/agents/dev/instances/dev-1", recovery: "/w/r" } })],
  ["details with a home, unconfirmed", () => ({ home: "/w/h", details: { home: "/w/agents/dev/instances/dev-1", unconfirmed: true } })],
  ["details with hooks, unconfirmed", () => ({ details: { hooks: [{ capability: "x", ok: false }], unconfirmed: true, extra: 1 } })],
  ["details with a commit", () => ({ details: { commit: "abc", clone: "/c", repository: "r" } })],
];

test("details are not widened: every code, in every shape, carries exactly the details the catch before #1047 gave it, and the code is the kernel's own where the catch re-badged it (#1047)", () => {
  let rebadged = 0;
  for (const code of CODES) for (const [shape, make] of SHAPES) {
    const e = Object.assign(new Error(`a refusal (${code})`), make(), code === undefined ? {} : { code });
    const former = formerAnswer(e);
    const what = `${code} ${shape}`;
    assert.deepEqual(spawnRefusalDetails(e), former.details, `${what}: the details`);
    const now = kernelCode(e, "E_SPAWN_FAILED");
    if (former.code !== now) { rebadged++; assert.equal(former.code, "E_SPAWN_FAILED", `${what}: only the general code was ever another`); }
    // A code with no details of its own never carries a home of the error's, unless the error's
    // details are unconfirmed (and so carried whole, as before).
    if (former.code === "E_SPAWN_FAILED" && e.details?.unconfirmed !== true) assert.equal(spawnRefusalDetails(e), undefined, `${what}: no details, no home`);
  }
  assert.ok(rebadged > 0, "premise: some codes were re-badged before");
});

/** A deployment whose soul `dev` works in a worktree, with a capability that has spawn and retire
 *  hooks (the spawn hook arms whatever ARM_AT_HOOK names) and, when `requires` is given, that
 *  requirement. */
function deployment(t, requires) {
  const SPAWN_HOOK = `import { appendFileSync, writeFileSync } from "node:fs"; import { join } from "node:path"; appendFileSync(join(process.env.OATS_ROOT, "spawn-ran"), process.env.OATS_INSTANCE + "\\n"); if (process.env.ARM_AT_HOOK) writeFileSync(process.env.ARM_AT_HOOK, ""); console.log(JSON.stringify({ meta: { made: true } }));\n`;
  const RETIRE_HOOK = `import { appendFileSync } from "node:fs"; import { join } from "node:path"; appendFileSync(join(process.env.OATS_ROOT, "retire-ran"), process.env.OATS_INSTANCE + "\\n"); console.log(JSON.stringify({ meta: { retired: true } }));\n`;
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "worktree", capabilities: { "test.life": { from: "here" } } } } },
    capabilities: { "test.life": { manifest: { hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, ...(requires ? { requires } : {}) }, files: { "spawn.mjs": SPAWN_HOOK, "retire.mjs": RETIRE_HOOK } } },
  });
  const homes = () => (existsSync(join(fx.root, "dev", "instances")) ? readdirSync(join(fx.root, "dev", "instances")).filter((n) => !n.startsWith(".")) : []);
  const ran = (hook) => (existsSync(join(fx.root, `${hook}-ran`)) ? readFileSync(join(fx.root, `${hook}-ran`), "utf8").split("\n").filter(Boolean) : []);
  const envelope = (r) => { try { return JSON.parse(r.stdout); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  return { fx, homes, ran, envelope };
}

test("the harness-package gate answers its own code through a real spawn, at an apply and at a preview, before any home exists: E_HARNESS_RESOURCE_MISSING, not E_SPAWN_FAILED (#1047)", (t) => {
  const d = deployment(t, [{ harness: "claude", package: "chat@acme-market", why: "the fixture's" }]);
  for (const mode of ["--no-launch", "--preview"]) {
    const r = d.fx.cli(["spawn", "dev", "--name", "gated", "--harness", "claude", mode, "--json"]);
    const e = d.envelope(r);
    assert.deepEqual([r.status, e.ok, e.error?.code], [1, false, "E_HARNESS_RESOURCE_MISSING"], `${mode}: ${r.stdout}`);
    assert.match(e.error.message, /test\.life requires the claude package chat@acme-market/, mode);
    assert.equal(e.error.details, undefined, `${mode}: no details`);
    assert.deepEqual([d.homes(), d.ran("spawn")], [[], []], `${mode}: no home, no hook`);
  }
});

test("a spawn whose tmux server cannot be read answers E_RUNTIME_ENDPOINT_UNKNOWN at an apply, before any effect and after the home, the work and the hooks, and a preview does not answer E_SESSION_UNKNOWN for it (#1047)", (t) => {
  const d = deployment(t);
  // A tmux in front of the real one whose list-sessions fails, once armed, with an error that is
  // not the absence of a server: the OATS server cannot be read. The fixture's TMUX_TMPDIR is its
  // own, so the real tmux behind it only ever reaches the fixture's server.
  const real = execFileSync("sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim();
  const arm = join(d.fx.base, "tmux-armed"), dir = join(d.fx.base, "tmux-shim");
  mkdirSync(dir);
  writeFileSync(join(dir, "tmux"), `#!/bin/sh\ncase " $* " in *" list-sessions "*) [ -e ${JSON.stringify(arm)} ] && { echo 'protocol version mismatch (client 8, server 9)' >&2; exit 1; } ;; esac\nexec ${JSON.stringify(real)} "$@"\n`);
  chmodSync(join(dir, "tmux"), 0o755);
  const env = { PATH: `${dir}:${d.fx.env.PATH}` };
  const spawn = (name, extra = [], more = {}) => d.fx.cli(["spawn", "dev", "--name", name, "--harness", "claude", ...extra, "--json"], { env: { ...env, ...more } });
  const READ = /^could not read the OATS tmux server for session \S+: protocol version mismatch/;

  writeFileSync(arm, "");
  // A preview reads no server (it reports, it does not refuse on a read): no refusal at all.
  const preview = d.envelope(spawn("previewed", ["--preview"]));
  assert.equal(preview.ok, true, JSON.stringify(preview.error));
  assert.equal(preview.result.instance, "previewed");
  // Before any effect: refused, nothing created, no hook ran.
  let r = spawn("before");
  let e = d.envelope(r);
  assert.deepEqual([r.status, e.ok, e.error?.code], [1, false, "E_RUNTIME_ENDPOINT_UNKNOWN"], r.stdout);
  assert.match(e.error.message, READ);
  assert.equal(e.error.details, undefined, "no details: nothing to confirm");
  assert.deepEqual([d.homes(), d.ran("spawn")], [[], []], "no home, no hook");

  // After the home, the work and the hooks: the spawn hook arms the shim; the spawn is compensated.
  rmSync(arm);
  r = spawn("after", [], { ARM_AT_HOOK: arm });
  e = d.envelope(r);
  assert.deepEqual([r.status, e.ok, e.error?.code], [1, false, "E_RUNTIME_ENDPOINT_UNKNOWN"], r.stdout);
  assert.match(e.error.message, READ);
  assert.match(e.error.message, / — spawn rolled back$/);
  assert.equal(e.error.details, undefined, "the compensation was confirmed: no `unconfirmed`, no `home`");
  assert.deepEqual([d.ran("spawn"), d.ran("retire")], [["after"], ["after"]], "the spawn hook ran, and the retire hook compensated");
  assert.deepEqual(d.homes(), [], "no home is left");
  for (const out of [preview, e]) assert.notEqual(out.error?.code, "E_SESSION_UNKNOWN");
});

test("the feature word is in the probe (#1047)", (t) => {
  const d = deployment(t);
  const probe = d.envelope(d.fx.cli(["version", "--json"]));
  assert.ok(probe.features.includes("spawn-kernel-codes"), JSON.stringify(probe.features));
});
