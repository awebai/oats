import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CloneError, fail } from "./errors.mjs";
import { isSlug, parseArgs } from "./args.mjs";
import { readSettings, requireInstance } from "./context.mjs";
import { kernelEnv, kernelEnvelope } from "./kernel.mjs";
import { filterInstance, identityHomeOf, instanceIndex, readInstanceJson, readStatus, resolveInstance, soulOf } from "./instances.mjs";
import { RELATIONS, HARNESSES, normalizeRelation, parseRequestBlock, sha256 } from "./request-format.mjs";
import { containedPath, ensurePrivateDir, inside, readRegularFile, writeJson, writePrivate } from "./files.mjs";
import { readTaskRequest } from "./request-format.mjs";
import { BRIEF_NAME, BRIEF_PATH, buildPreamble, checkBrief, redact } from "./brief.mjs";
import { RECORD_DIR } from "./dossier.mjs";

// `oats cloning spawn --plan <plan.json>`: run by the cloner. Validates the
// plan against the request and the source, assembles and redacts the brief,
// spawns the clone unlaunched with a preamble-only TASK.md, attaches the brief
// privately, starts the clone and verifies what it got.

const PLAN_KEYS = ["version", "dossier", "soul", "name", "purpose", "relation", "relativeTo", "launch", "work", "providers", "brief"];
const LAUNCH_KEYS = ["harness", "model", "launchConfig", "yolo", "childSpawns"];

function readJsonFile(path, code, what) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code, `${what} must be an absolute path`);
  const r = readRegularFile(path, 4 * 1024 * 1024);
  if (!r.bytes) fail(code, `cannot read ${what} (${r.skipped})`);
  try { return JSON.parse(r.bytes.toString("utf8")); } catch { fail(code, `${what} is not JSON`); }
}

export function checkPlanShape(plan) {
  const bad = (why) => fail("E_CLONE_PLAN", `plan: ${why}`);
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) bad("not an object");
  for (const k of Object.keys(plan)) if (!PLAN_KEYS.includes(k)) bad(`unknown field ${k}`);
  if (plan.version !== 1) bad("version must be 1");
  if (typeof plan.soul !== "string" || !plan.soul) bad("soul");
  for (const k of ["name", "purpose"]) if (plan[k] !== null && plan[k] !== undefined && !isSlug(plan[k])) bad(`${k} must be a slug or null`);
  if (plan.name && plan.purpose) bad("name and purpose are exclusive");
  if (!normalizeRelation(plan.relation)) bad(`relation is one of ${RELATIONS.join(", ")}`);
  if (plan.relativeTo !== null && plan.relativeTo !== undefined && !isSlug(plan.relativeTo)) bad("relativeTo must be an instance name or null");
  const l = plan.launch;
  if (!l || typeof l !== "object" || Array.isArray(l)) bad("launch");
  for (const k of Object.keys(l)) if (!LAUNCH_KEYS.includes(k)) bad(`unknown launch field ${k}`);
  if (!HARNESSES.includes(l.harness)) bad("launch.harness");
  if (l.model !== null && (typeof l.model !== "string" || !l.model.trim())) bad("launch.model");
  if (l.launchConfig !== null && (typeof l.launchConfig !== "string" || !l.launchConfig)) bad("launch.launchConfig");
  for (const k of ["yolo", "childSpawns"]) if (l[k] !== null && typeof l[k] !== "boolean") bad(`launch.${k}`);
  if (!plan.work || typeof plan.work !== "object" || Array.isArray(plan.work)) bad("work");
  for (const k of Object.keys(plan.work)) if (k !== "base") bad(`unknown work field ${k}`);
  if (plan.work.base !== null && (typeof plan.work.base !== "string" || !plan.work.base || plan.work.base.startsWith("-") || /\s/.test(plan.work.base))) bad("work.base");
  if (!Array.isArray(plan.providers)) bad("providers must be a list");
  return plan;
}

/** What the request and the source allow. A plan must say exactly this. */
export function expectedLaunch(src, request) {
  const harness = request.launch.harness ?? src.harness;
  const sameHarness = harness === src.harness;
  return {
    harness,
    model: request.launch.model ?? (sameHarness ? src.model : null),
    launchConfig: sameHarness && src.launchConfig.name && !src.launchConfig.default ? src.launchConfig.name : null,
    yolo: src.yolo,
    childSpawns: src.childSpawns,
  };
}

/** Validate the plan against the request (the requester's choices) and the
 *  source as it is now. Returns the normalized plan. */
export function checkPlan(plan, { request, src, cloner, status }) {
  checkPlanShape(plan);
  if (plan.soul !== src.soul.name) fail("E_CLONE_SOUL", `the clone's soul must be the source's (${src.soul.name}); cloning into another soul is out of scope`);
  const relation = normalizeRelation(plan.relation);
  const relativeTo = plan.relativeTo ?? null;
  if (relation !== request.relation) fail("E_CLONE_RELATION", `the requester asked for ${request.relation}, the plan says ${relation}`);
  if (relation === "unrelated" && relativeTo !== null) fail("E_CLONE_RELATION", "an independent clone has no anchor: relativeTo must be null");
  if (relation !== "unrelated") {
    if (relativeTo === cloner) fail("E_CLONE_ANCHOR", "the anchor can never be the cloner: it retires when the clone exists");
    if (relativeTo !== request.relativeTo) fail("E_CLONE_ANCHOR", `the requester anchored the clone to ${request.relativeTo}, the plan to ${relativeTo}`);
    resolveInstance(status, relativeTo, "E_CLONE_ANCHOR", "anchor");
  }
  if (request.name !== null && (plan.name !== request.name || plan.purpose)) fail("E_CLONE_PLAN", `the requester named the clone ${request.name}: plan.name must be that, with no purpose`);

  const want = expectedLaunch(src, request);
  const diff = LAUNCH_KEYS.filter((k) => (plan.launch[k] ?? null) !== want[k]);
  if (diff.length) fail("E_CLONE_PLAN", `plan.launch must keep the source's posture (and the request's overrides): ${diff.map((k) => `${k} ${JSON.stringify(want[k])}`).join(", ")}`, { expected: want });

  const base = plan.work.base;
  if (base !== null && src.work !== "worktree") fail("E_CLONE_PLAN", `work.base applies to worktree souls; ${src.soul.name} works in ${src.work}`);
  if (request.base === "default" && base !== null) fail("E_CLONE_PLAN", "the requester asked for the soul's default base: work.base must be null");
  if (request.base === "source" && base !== src.branch) fail("E_CLONE_PLAN", `the requester asked to start from the source's branch: work.base must be ${src.branch}`);
  if (request.base !== null && !["source", "default"].includes(request.base) && base !== request.base) fail("E_CLONE_PLAN", `the requester asked for base ${request.base}`);

  let harvestOff = false;
  for (const p of plan.providers) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => !["capability", "key", "value"].includes(k))) fail("E_CLONE_PLAN", "a provider entry is { capability, key, value }");
    if (p.capability === "oats.okf" && p.key === "harvest") {
      if (p.value !== "off") fail("E_CLONE_HARVEST", "a plan can only turn harvest off, never on");
      harvestOff = true;
      continue;
    }
    fail("E_CLONE_PLAN", `provider ${p.capability} ${p.key} is not allowed: the only provider setting a plan carries is oats.okf harvest=off`);
  }
  if (src.harvest === "off" && !harvestOff) fail("E_CLONE_HARVEST", "the source's harvest is off: the plan must carry { capability: oats.okf, key: harvest, value: off }");
  return { ...plan, relation, relativeTo, name: plan.name ?? null, purpose: plan.purpose ?? null, harvestOff };
}

export function spawnArgs(plan, taskFile) {
  const args = ["spawn", plan.soul, "--task-file", taskFile, "--no-launch", "--json"];
  if (plan.relation === "unrelated") args.push("--relation", "unrelated");
  else args.push("--relation", plan.relation, "--relative-to", plan.relativeTo);
  if (plan.name) args.push("--name", plan.name);
  else if (plan.purpose) args.push("--purpose", plan.purpose);
  args.push("--harness", plan.launch.harness);
  if (plan.launch.model) args.push("--model", plan.launch.model);
  if (plan.launch.launchConfig) args.push("--launch-config", plan.launch.launchConfig);
  if (plan.launch.yolo === true) args.push("--yolo");
  if (plan.launch.yolo === false) args.push("--no-yolo");
  if (plan.launch.childSpawns === false) args.push("--no-child-spawns");
  if (plan.work.base) args.push("--base", plan.work.base);
  if (plan.harvestOff) args.push("--provider", "oats.okf", "harvest=off");
  return args;
}

/** The did an aweb identity home answers with, or null. */
export function awDid(identityHome, env) {
  if (!identityHome || !isAbsolute(identityHome)) return null;
  const r = spawnSync("aw", ["--identity-home", identityHome, "whoami", "--json"], { env: kernelEnv(env), encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) return null;
  try { const o = JSON.parse(r.stdout); return typeof o?.did === "string" && o.did ? { did: o.did, alias: o.alias ?? null } : null; } catch { return null; }
}

/** The aweb identity home of an instance: the one its hooks recorded, else its
 *  own <home>/.aw when that is a real directory. A home started later with
 *  `oats session start` records none (oats.aweb 1.17.5's launch hook drops the
 *  spawn hook's AWEB_IDENTITY_HOME), but its identity still lives there. */
function identityHomeIn(meta, home) {
  const recorded = identityHomeOf(meta);
  if (recorded) return { path: recorded, recorded: true };
  if (!home) return { path: null, recorded: false };
  try { return lstatSync(join(home, ".aw")).isDirectory() ? { path: join(home, ".aw"), recorded: false } : { path: null, recorded: false }; }
  catch { return { path: null, recorded: false }; }
}

const usesAweb = (meta) => Boolean(meta?.capabilityMeta?.["oats.aweb"]) || (meta?.capabilities || []).some((c) => c?.id === "oats.aweb");
const awebIdentityMode = (meta) => meta?.capabilityMeta?.["oats.aweb"]?.identity?.mode ?? null;

/** R2d: the clone's messaging identity is its own, never the source's seat. */
export function checkIdentity(cloneMeta, srcMeta, { clone, cloneHome, srcHome, env, whoami = awDid }) {
  if (!usesAweb(srcMeta) && !usesAweb(cloneMeta)) return { ok: true, check: "identity", detail: "no aweb messaging" };
  const meta = cloneMeta?.capabilityMeta?.["oats.aweb"] || {};
  const problems = [];
  if (meta.alias !== clone) problems.push("alias is not the clone's name");
  if (awebIdentityMode(cloneMeta) === "global") problems.push("identity is a global (resident) identity");
  const cloneId = identityHomeIn(cloneMeta, cloneHome), srcId = identityHomeIn(srcMeta, srcHome);
  const cloneHomeId = cloneId.path, srcHomeId = srcId.path;
  if (!cloneHomeId) problems.push("no identity home recorded");
  else {
    let real = null;
    try { real = realpathSync(cloneHomeId); } catch { /* reported below */ }
    if (!real || !inside(cloneHome, real)) problems.push("identity home is not inside the clone's home");
    if (srcHomeId && cloneHomeId === srcHomeId) problems.push("identity home is the source's");
  }
  const mine = whoami(cloneHomeId, env), theirs = srcHomeId ? whoami(srcHomeId, env) : null;
  if (!mine) problems.push("the clone's identity did not answer aw whoami");
  else {
    if (mine.alias !== null && mine.alias !== clone) problems.push("aw whoami names another alias");
    if (theirs && mine.did === theirs.did) problems.push("the clone's did is the source's");
    if (srcHomeId && !theirs) problems.push("the source's did could not be read to compare");
  }
  const warning = cloneHomeId && !cloneId.recorded ? "the clone's session has no AWEB_IDENTITY_HOME (a later session start does not keep it); its aw works from its home, not from ./work" : undefined;
  return problems.length ? { ok: false, check: "identity", detail: problems.join("; "), ...(warning ? { warning } : {}) } : { ok: true, check: "identity", detail: "alias, identity home and did are the clone's own", ...(warning ? { warning } : {}) };
}

const mode = (path) => { try { const st = lstatSync(path); return st.isFile() ? st.mode & 0o777 : null; } catch { return null; } };

export function spawnClone(argv, deps = {}) {
  let home = null, preview = false;
  try {
    const out = spawnOnce(argv, deps, (h) => { home = h; });
    preview = out.preview !== undefined;
    return out;
  } finally {
    // The temporary transcript record outlives only a preview (the cloner may
    // still revise the brief): verified, refused or failed, it goes, so it
    // never reaches retirement's recovery storage.
    if (home && !preview) rmSync(join(home, "clone", RECORD_DIR), { recursive: true, force: true });
  }
}

function spawnOnce(argv, deps, onHome) {
  const env = deps.env ?? process.env, cwd = deps.cwd ?? process.cwd(), now = deps.now ?? (() => new Date());
  const { flags, positionals } = parseArgs(argv, { values: ["plan"], switches: ["preview", "json"], positionals: 0 });
  if (positionals.length || flags.plan === undefined) fail("E_CLONE_USAGE", "usage: oats cloning spawn --plan <plan.json> [--preview] --json");
  const inv = requireInstance(env, cwd);
  onHome(inv.home);
  const settings = readSettings(env);
  const plan0 = readJsonFile(flags.plan, "E_CLONE_PLAN", "the plan");
  checkPlanShape(plan0);

  let cloneDir;
  try { cloneDir = realpathSync(join(inv.home, "clone")); } catch { fail("E_CLONE_PLAN", "no clone/ directory: run oats cloning dossier first"); }
  if (containedPath(cloneDir, plan0.dossier) !== join(cloneDir, "dossier.json")) fail("E_CLONE_PLAN", `plan.dossier must be ${join(inv.home, "clone", "dossier.json")}`);
  const dossier = readJsonFile(plan0.dossier, "E_CLONE_PLAN", "the dossier");
  const { request, sha256: requestSha256 } = parseRequestBlock(readTaskRequest(inv.home));
  if (dossier?.version !== 1 || dossier.requestSha256 !== requestSha256) fail("E_CLONE_PLAN", "the dossier was not written for this request: run oats cloning dossier again");

  const ctx = { cwd: inv.home, env };
  const status = readStatus(ctx);
  const srcLive = resolveInstance(status, request.source);
  if (srcLive.home !== dossier.source?.home) fail("E_CLONE_SOURCE", `${request.source} no longer resolves to the home the dossier read`);
  const src = filterInstance(srcLive.meta, { running: srcLive.running });
  const plan = checkPlan(plan0, { request, src, cloner: inv.instance, status });
  if (srcLive.name === inv.instance) fail("E_CLONE_SOURCE", "a cloner never clones itself");
  if (awebIdentityMode(srcLive.meta) === "global") fail("E_CLONE_IDENTITY", `${request.source} acts through a global (resident) aweb identity; a clone of its soul would sit in the same seat`);

  // The brief body: the cloner's file, private, within budget, valid UTF-8, structured.
  if (typeof plan.brief !== "string" || containedPath(cloneDir, plan.brief) === null) fail("E_CLONE_BRIEF", `plan.brief must be a file under ${join(inv.home, "clone")}`);
  const briefPath = plan.brief;
  const br = readRegularFile(briefPath, settings.briefMaxBytes);
  if (br.skipped === "over-file-budget") fail("E_CLONE_BRIEF", `the brief is ${br.size} bytes; brief-max-bytes is ${settings.briefMaxBytes}: distil it, never truncate`);
  if (!br.bytes) fail("E_CLONE_BRIEF", `cannot read the brief (${br.skipped})`);
  chmodSync(briefPath, 0o600);
  let body;
  try { body = new TextDecoder("utf-8", { fatal: true }).decode(br.bytes); } catch { fail("E_CLONE_BRIEF", "the brief is not valid UTF-8"); }
  if (body.includes("\0")) fail("E_CLONE_BRIEF", "the brief contains NUL");
  checkBrief(body, { goal: request.goal });

  const t = dossier.transcript?.included === true ? dossier.transcript : null;
  const preamble = buildPreamble({
    goal: request.goal,
    source: { instance: srcLive.name, soul: src.soul.name, home: srcLive.home, work: { mode: dossier.work?.mode ?? src.work, branch: dossier.work?.branch ?? null, head: dossier.work?.head ?? null }, running: dossier.source?.running === true },
    transcript: t
      ? { included: true, complete: t.complete === true, threads: (t.sessions || []).map((s) => ({ thread: s.thread, until: s.lastTurnId })) }
      : { included: false },
    relation: { relation: plan.relation, relativeTo: plan.relativeTo },
    cloner: inv.instance, requestedBy: request.requestedBy, createdAt: now().toISOString(),
  });
  const pre = redact(preamble);
  const preLines = (pre.text.match(/\n/g) || []).length;
  const red = redact(body, { firstLine: preLines + 2 });
  const attachment = `${pre.text}\n${red.text}`;
  const redactions = [...pre.redactions, ...red.redactions];
  const briefDigest = { bytes: Buffer.byteLength(attachment), sha256: sha256(attachment) };

  const uploadDir = ensurePrivateDir(join(cloneDir, "upload"));
  const uploadFile = writePrivate(join(uploadDir, BRIEF_NAME), attachment);
  const taskFile = writePrivate(join(cloneDir, "clone-task.md"), pre.text);
  // Before a clone exists, a refusal is retryable: the cloner's brief and plan
  // stay. Once the apply ran, the outcome is final and retirement would
  // snapshot a changed home into recovery storage (kernel 0.34), so everything
  // in clone/ but the receipt goes: the source copies, the dossier, the brief,
  // the plan and the transcript record. The receipt holds no source text.
  const cleanup = ({ keepBrief }) => {
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(taskFile, { force: true });
    if (keepBrief) return;
    for (const entry of readdirSync(cloneDir)) if (entry !== "receipt.json") rmSync(join(cloneDir, entry), { recursive: true, force: true });
  };

  // The source's named launch configuration is passed only while it still
  // exists here; otherwise the clone takes the default, and the answer says so.
  const warnings = [];
  if (plan.launch.launchConfig) {
    let names = [];
    try { names = (kernelEnvelope(["launch-config", "list", "--json"], ctx).configurations || []).map((c) => c?.name); } catch { /* treated as absent */ }
    if (!names.includes(plan.launch.launchConfig)) {
      warnings.push(`launch configuration ${plan.launch.launchConfig} no longer exists here; the clone takes the harness default`);
      plan.launch = { ...plan.launch, launchConfig: null };
    }
  }
  const args = spawnArgs(plan, taskFile);
  let preview;
  try {
    preview = kernelEnvelope([...args, "--preview"], { ...ctx, timeout: 300000 });
    if (preview?.settings?.["oats.aweb"]?.identity?.mode === "global") fail("E_CLONE_IDENTITY", "this deployment would give the clone a global (resident) aweb identity, the source's seat; refused before spawning");
    if (typeof preview?.instance !== "string" || typeof preview?.decision?.revision !== "string") fail("E_CLONE_KERNEL", "spawn --preview answered without an instance and decision");
  } catch (e) { cleanup({ keepBrief: true }); throw e; }
  const decided = {
    instance: preview.instance, home: preview.home, soul: plan.soul, harness: preview.harness ?? null, model: preview.model ?? null,
    launchConfig: preview.launchConfig ?? null, yolo: preview.yolo ?? null, branch: preview.branch ?? null, base: preview.base ?? null,
    relation: plan.relation, relativeTo: plan.relativeTo, decision: preview.decision.revision,
  };
  if (flags.preview) {
    cleanup({ keepBrief: true });
    return { preview: decided, brief: briefDigest, redactions, source: { instance: srcLive.name, home: srcLive.home, soul: src.soul.name }, ...(warnings.length ? { warnings } : {}) };
  }

  let applied;
  try { applied = kernelEnvelope([...args, "--expect-decision", preview.decision.revision], { ...ctx, timeout: 600000 }); }
  catch (e) { cleanup({ keepBrief: true }); throw e; }
  const clone = applied.instance, cloneHome = applied.home;
  const checks = [];
  const record = (ok, check, detail) => checks.push({ ok, check, ...(detail ? { detail } : {}) });
  let uploaded = null, started = false;
  try {
    uploaded = kernelEnvelope(["session", "upload", "--home", cloneHome, "--file", uploadFile, "--json"], { ...ctx, timeout: 120000 });
    const taskMd = join(cloneHome, "TASK.md");
    if (!lstatSync(taskMd).isFile()) throw new CloneError("E_CLONE_UNVERIFIED", "TASK.md is not a regular file");
    chmodSync(taskMd, 0o600);
    kernelEnvelope(["session", "start", "--home", cloneHome, "--json"], { ...ctx, timeout: 300000 });
    started = true;
  } catch (e) {
    record(false, uploaded ? "start" : "attach", `${e.code || "error"}: ${e.message}`);
  }

  // Verify: report only what was confirmed; never retire the clone here.
  let realHome = null, cloneMeta = null;
  try { realHome = realpathSync(cloneHome); record(lstatSync(realHome).isDirectory(), "home"); } catch { record(false, "home", "absent"); }
  if (realHome) {
    try { cloneMeta = readInstanceJson(realHome); } catch { record(false, "instance.json", "unreadable"); }
    if (cloneMeta) {
      record(soulOf(cloneMeta) === plan.soul, "soul", soulOf(cloneMeta));
      // The kernel normalizes "unrelated" away: an independent clone records no link at all.
      const relOk = plan.relation === "unrelated"
        ? (!cloneMeta.relation || cloneMeta.relation === "unrelated") && !cloneMeta.relativeTo && !cloneMeta.parentInstance && !cloneMeta.siblingInstance
        : cloneMeta.relation === plan.relation && cloneMeta.relativeTo === plan.relativeTo;
      record(relOk, "relation", `${cloneMeta.relation ?? "none"}${cloneMeta.relativeTo ? ` of ${cloneMeta.relativeTo}` : ""}`);
    }
    const taskMd = join(realHome, "TASK.md");
    let taskText = "";
    try { taskText = readFileSync(taskMd, "utf8"); } catch { /* recorded below */ }
    record(taskText.includes(pre.text.trim()), "provenance", "TASK.md holds the generated preamble byte for byte");
    record(mode(taskMd) === 0o600, "task-mode", `TASK.md mode ${mode(taskMd)?.toString(8) ?? "none"}`);
    const attached = join(realHome, BRIEF_PATH);
    const uploadedAt = uploaded?.path ? containedPath(realHome, uploaded.path) : null;
    record(uploadedAt === attached, "attachment-path", uploaded?.path ? (uploadedAt === attached ? BRIEF_PATH : "the upload landed elsewhere") : "not uploaded");
    record(mode(attached) === 0o600, "attachment-mode", `mode ${mode(attached)?.toString(8) ?? "none"}`);
    let onDisk = null;
    try { onDisk = sha256(readFileSync(attached)); } catch { /* recorded below */ }
    record(onDisk === briefDigest.sha256 && uploaded?.sha256 === briefDigest.sha256, "attachment-sha256");
  }
  record(started, "started");
  try {
    const listed = instanceIndex(readStatus(ctx)).get(clone);
    record(Boolean(listed) && listed.row.home && realHome && realpathSync(listed.row.home) === realHome, "status");
  } catch { record(false, "status", "oats status failed"); }
  let identity = { ok: false, check: "identity", detail: "not checked" };
  if (cloneMeta && started) identity = checkIdentity(cloneMeta, srcLive.meta, { clone, cloneHome: realHome, srcHome: srcLive.home, env, whoami: deps.whoami });
  checks.push(identity);

  const failed = checks.filter((c) => !c.ok);
  const answer = {
    clone: { instance: clone, home: cloneHome, relation: plan.relation, relativeTo: plan.relativeTo, branch: applied.branch ?? null, base: applied.base ?? preview.base ?? null },
    brief: briefDigest,
    attachment: { path: BRIEF_PATH, sha256: briefDigest.sha256 },
    redactions,
    source: { instance: srcLive.name, home: srcLive.home, soul: src.soul.name },
    checks,
  };
  if (identity.warning) warnings.push(identity.warning);
  if (warnings.length) answer.warnings = warnings;
  const receiptPath = join(cloneDir, "receipt.json");
  writeJson(receiptPath, { version: 1, createdAt: now().toISOString(), cloner: inv.instance, requestSha256, ok: failed.length === 0, ...answer });
  cleanup({ keepBrief: false });
  if (failed.length) {
    const onlyIdentity = failed.length === 1 && failed[0].check === "identity";
    fail(onlyIdentity ? "E_CLONE_IDENTITY" : "E_CLONE_UNVERIFIED",
      `${clone} was spawned but ${failed.map((c) => c.check).join(", ")} could not be confirmed; the clone is left for the requester`,
      { clone, home: cloneHome, checks, receipt: receiptPath, redactions: redactions.length });
  }
  return { ...answer, receipt: receiptPath };
}
