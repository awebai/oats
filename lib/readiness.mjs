/** K5 — readiness quartet, signature status and enforced policy, as DATA.
 *
 * `installed | trusted | configured | enrolled`, each `pass | fail | unknown |
 * not-applicable` with items a human can act on: subject, whether it is
 * required, the reason, the producer of the fact, evidence, remedy. Every fact
 * is derived from what inspect already reports (capability inventory, health,
 * executable approval, activation, runtime-package requirements, soul
 * declarations) — never a second opinion. Unknown is unknown; "Ready" is the
 * consumer's word and only when every required check passes. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYamlNested } from "./core.mjs";

export const READINESS_API = 1;

function roll(items, { required = (i) => i.required !== false } = {}) {
  const req = items.filter(required);
  if (!items.length) return "not-applicable";
  if (req.some((i) => i.status === "fail")) return "fail";
  if (req.some((i) => i.status === "unknown")) return "unknown";
  if (req.every((i) => i.status === "pass" || i.status === "not-applicable")) return req.length ? "pass" : "not-applicable";
  return "unknown";
}
const item = (subject, status, { required = true, reason = null, producer = "kernel", evidence = null, remedy = null, ...rest } = {}) =>
  ({ subject, status, required, reason, producer, evidence, remedy, ...rest });

/** Verified Git signature of a source commit, named signer or nothing.
 *  Requires network (fetch) — only when the caller asks (`verify: true`);
 *  otherwise `unknown` with the reason. Never a URL, owner or hash as signer. */
export const SIGNATURE_FAILURES = Object.freeze(["transport-not-allowed", "fetch-failed", "fetch-timeout", "budget-exhausted", "verifier-failed", "verifier-timeout", "cannot-check", "no-source"]);
const ALLOWED_TRANSPORTS = /^(https:\/\/|ssh:\/\/|git@[^/:]+:)/;
/** Verified Git signature of a source commit, named signer or nothing.
 *  Requires network (fetch) — only when the caller asks (`verify: true`);
 *  otherwise `unknown` with the reason. Never a URL, owner or hash as signer.
 *  Bounded custody: one total budget per call (`budgetMs`, default 60s) shared
 *  by fetch and verify; each Git child runs in its own process group and is
 *  killed with the group on timeout; the scratch repository is removed on every
 *  exit including signals; Git reads NO global/system config and cannot prompt;
 *  only https/ssh transports are fetched. Failures carry a closed `failure`
 *  code — never stderr. */
export function signatureOf({ url, commit }, { verify = false, budgetMs = 60000 } = {}) {
  if (!url || !commit || commit === "local") return { status: "not-applicable", signer: null, reason: commit === "local" ? "path-installed capability has no source commit" : "no source recorded", failure: null };
  if (!verify) return { status: "unknown", signer: null, reason: "signature verification needs a network fetch; pass --verify-signatures", failure: null };
  if (!ALLOWED_TRANSPORTS.test(url)) return { status: "unknown", signer: null, reason: "source transport is not https or ssh; not fetched", failure: { code: "transport-not-allowed" } };
  const dir = mkdtempSync(join(tmpdir(), "oats-sig-"));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.once("exit", cleanup);
  const started = Date.now();
  const remaining = () => budgetMs - (Date.now() - started);
  const env = { PATH: process.env.PATH ?? "", HOME: dir, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ASKPASS: "/bin/false", SSH_ASKPASS: "/bin/false", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", LC_ALL: "C" };
  const git = (args, stage) => {
    const left = remaining();
    if (left <= 0) throw Object.assign(new Error("budget"), { failure: "budget-exhausted" });
    try { return execFileSync("git", ["-C", dir, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: left, killSignal: "SIGKILL", detached: true, env, shell: false }); }
    catch (e) { throw Object.assign(new Error(stage), { failure: e.killed || e.signal === "SIGKILL" ? `${stage}-timeout` : `${stage}-failed` }); }
  };
  try {
    git(["init", "-q"], "verifier");
    git(["fetch", "-q", "--depth", "1", url, commit], "fetch");
    // %G? : G good, B bad, U good-untrusted, X expired, Y expired key, R revoked, E cannot check, N none
    const out = git(["log", "-1", "--format=%G?%x00%GS%x00%GK%x00%GF", commit], "verifier").trim();
    const [code, signerName, keyId, fingerprint] = out.split("\0");
    if (code === "N") return { status: "unsigned", signer: null, reason: "commit carries no signature", failure: null };
    if (code === "G") return { status: "verified", signer: { id: fingerprint || keyId || null, label: signerName || null }, reason: null, failure: null };
    if (code === "U") return { status: "verified", signer: { id: fingerprint || keyId || null, label: signerName || null }, reason: "good signature from a key not marked trusted in the local keyring", trust: "untrusted-key", failure: null };
    if (code === "E") return { status: "unknown", signer: null, reason: "signature present but cannot be checked (missing public key)", failure: { code: "cannot-check" } };
    return { status: "invalid", signer: null, reason: { B: "bad signature", X: "good signature that has expired", Y: "good signature made by an expired key", R: "good signature made by a revoked key" }[code] || "verifier reported an unrecognised state", failure: null };
  } catch (e) {
    const code = SIGNATURE_FAILURES.includes(e.failure) ? e.failure : "verifier-failed";
    const reasons = { "fetch-failed": "the source could not be fetched", "fetch-timeout": "the fetch exceeded the verification budget", "budget-exhausted": "the verification budget was exhausted", "verifier-failed": "the local verifier failed", "verifier-timeout": "the local verifier exceeded the verification budget" };
    return { status: "unknown", signer: null, reason: reasons[code], failure: { code } };
  } finally { process.removeListener("exit", cleanup); cleanup(); }
}

function sourceOfCapability(cap, catalog) {
  // cap.source is e.g. "catalog:oats.framework" or "git:https://…@ref#path"; the
  // installed record's package commit is what we would verify.
  const src = String(cap.source || "");
  if (src.startsWith("git:")) { const m = /^git:([^@#]+)(?:@([^#]+))?/.exec(src); return { url: m?.[1] ?? null, commit: cap.commit ?? m?.[2] ?? null }; }
  if (src.startsWith("catalog:") && catalog) { const entry = catalog.packages?.[src.slice(8)]; return { url: entry?.url ?? null, commit: cap.commit ?? null }; }
  return { url: null, commit: cap.commit ?? null };
}

/** The quartet for a scope or one soul, from an inspect result. */
export function readinessOf(inspect, { soul = null, verifySignatures = false, catalog = null, deploymentDir = null, memberDocument = null, selector = null } = {}) {
  const caps = inspect.capabilities || [];
  const soulEntry = soul ? (inspect.souls || []).find((s) => s.name === soul) : null;
  const declaredRequires = soulEntry?.declarations?.requires?.capabilities ? Object.keys(soulEntry.declarations.requires.capabilities) : null;
  const required = new Set(declaredRequires ?? caps.filter((c) => c.activation?.enabled).map((c) => c.id));
  const declaredForSoul = (c) => !!c.activation?.declaredAt?.some((d) => (d.targets || []).includes(`soul:${soul}`));
  const relevant = soul ? caps.filter((c) => required.has(c.id) || declaredForSoul(c)) : caps;
  // Typed linkage for consumers (frame-level per-capability rows): WHICH
  // capability, at which config level/scope, and WHY it is in this quartet.
  const capabilityOf = (c) => ({ id: c.id, level: c.activation?.level ?? null, scope: c.activation?.target ?? null });
  const originOf = (c) => declaredRequires?.includes(c.id) ? { kind: "requires", target: `soul:${soul}` }
    : soul && declaredForSoul(c) ? { kind: "declares", target: `soul:${soul}` }
    : c.activation?.enabled ? { kind: "default", target: c.activation?.target ?? "global" } : { kind: "inventory", target: null };
  const typed = (c) => ({ capability: capabilityOf(c), origin: originOf(c) });

  // installed — the artifact's bytes are present and locked with matching integrity
  const installed = relevant.map((c) => {
    const ok = c.health?.installed === true && (c.health.integrity == null || c.health.installedIntegrity == null || c.health.integrity === c.health.installedIntegrity);
    return item(c.id, ok ? "pass" : c.health?.installed === false ? "fail" : "unknown", { required: required.has(c.id), producer: "oats list",
      reason: ok ? null : c.health?.installed === false ? "not acquired" : c.health?.code || "integrity drift", evidence: { version: c.version ?? null, integrity: c.health?.integrity ?? null, origin: c.origin ?? null },
      remedy: ok ? null : `oats install ${c.package || c.id}`, ...typed(c) });
  });
  for (const id of required) if (!caps.some((c) => c.id === id)) installed.push(item(id, "fail", { producer: "soul declaration", reason: "declared by the soul but not in the inventory", remedy: `oats install <package providing ${id}>`,
    capability: { id, level: null, scope: null }, origin: { kind: "requires", target: `soul:${soul}` } }));

  // trusted — executable approval of the exact artifact; signature separately
  const trusted = relevant.map((c) => {
    // The inspect row states whether the manifest has anything trust approves
    // (commands/hooks/launch env). No surface → trust is not-applicable, however
    // the lock records it. Older rows without the flag fall back to the old heuristic.
    const executable = typeof c.health?.executableSurface === "boolean" ? c.health.executableSurface
      : !!(c.operations?.length || c.health?.code === "untrusted-surface");
    const approved = c.health?.trusted === true;
    const sig = signatureOf(sourceOfCapability(c, catalog), { verify: verifySignatures });
    return item(c.id, !executable ? "not-applicable" : approved ? "pass" : c.health?.trusted === false ? "fail" : "unknown", { required: required.has(c.id), producer: "artifact approval",
      reason: !executable ? "no executable surface" : approved ? null : "executable surface not approved", evidence: { integrity: c.health?.integrity ?? null }, remedy: approved || !executable ? null : `oats trust ${c.id}`,
      signature: sig, ...typed(c) });
  });

  // configured — EFFECTIVE activation for the subject (a declaration at the
  // soul is not activation: `enabled` is the resolved verdict for this subject,
  // and a declared-but-disabled binding is a fail that says so) + runtime
  // package requirements + layer readiness problems
  const configured = [];
  for (const c of relevant) {
    const active = c.activation?.enabled === true;
    const declaredOnly = !active && soul && declaredForSoul(c);
    if (required.has(c.id)) configured.push(item(`${c.id} activation`, active ? "pass" : "fail", { producer: "oats-config.yaml",
      reason: active ? null : declaredOnly ? `declared for soul ${soul} but disabled${c.activation?.reason ? ` (${c.activation.reason})` : ""}` : `not active for ${soul ? `soul ${soul}` : "this scope"}`,
      evidence: { target: c.activation?.target ?? null, level: c.activation?.level ?? null, source: c.activation?.source ?? null }, remedy: active ? null : `oats use ${c.id}${soul ? ` --soul ${soul}` : ""}`, ...typed(c) }));
    for (const miss of c.missingRequires || []) configured.push(item(`${c.id} requires ${miss.command}`, "fail", { producer: "capability manifest", reason: miss.why || "required command not on PATH", remedy: miss.install || null, ...typed(c) }));
  }
  for (const p of inspect.problems || []) if (/runtime package|DISABLED|extension/i.test(p.message || "")) configured.push(item(p.capability || p.code, "fail", { producer: "runtime settings", reason: p.message, remedy: null }));
  if (soulEntry && soulEntry.readiness?.status === "undeclared") configured.push(item(`${soul} declarations`, "not-applicable", { required: false, producer: "soul.yaml", reason: "no requirements declared" }));

  // enrolled — workspace member admission (decision §3): not-applicable for
  // standalone; pass/fail when this repository declares a workspace.
  const enrolled = [];
  const member = memberDocument ?? readMemberDocument(deploymentDir);
  if (!member) enrolled.push(item("workspace membership", "not-applicable", { required: false, producer: "oats.yaml", reason: "standalone deployment: no workspace declared in oats.yaml" }));
  else if (member.unreadable) enrolled.push(item("workspace membership", "unknown", { producer: "oats.yaml", reason: "workspace member document is unreadable; membership cannot be stated", evidence: { file: member.file ?? null }, remedy: "repair oats.yaml (valid YAML) and re-run" }));
  else if (!member.workspace?.source) enrolled.push(item("workspace membership", "not-applicable", { required: false, producer: "oats.yaml", reason: "oats.yaml declares exports but no workspace backlink" }));
  else enrolled.push(item(`member of ${member.workspace.source}`, member.admitted === true ? "pass" : member.admitted === false ? "fail" : "unknown", { producer: "workspace discovery",
    reason: member.admitted === true ? null : member.admitted === false ? "this repository is not admitted in the workspace's members" : "reciprocal admission not observed: this CLI reads the backlink but does not yet fetch the workspace's members (declared, not verified)",
    evidence: { workspace: member.workspace.source, revision: member.workspace.revision ?? null }, remedy: member.admitted === true ? null : "ask the workspace maintainer to admit this repository (oats-workspace.yaml members) — enrolment is admission, not login" }));

  const checks = { installed: { status: roll(installed), items: installed }, trusted: { status: roll(trusted), items: trusted }, configured: { status: roll(configured), items: configured }, enrolled: { status: roll(enrolled), items: enrolled } };
  const requiredStatuses = Object.values(checks).flatMap((c) => c.items.filter((i) => i.required).map((i) => i.status));
  // Per-capability grouping of the same items (no second observation): each
  // capability's four verdicts, ready only if all its REQUIRED items pass.
  const byCapability = [...new Set(Object.values(checks).flatMap((c) => c.items.map((i) => i.capability?.id).filter(Boolean)))].sort().map((id) => {
    const of = (name) => checks[name].items.filter((i) => i.capability?.id === id);
    const statuses = Object.keys(checks).flatMap((name) => of(name).filter((i) => i.required).map((i) => i.status));
    const any = Object.keys(checks).flatMap((name) => of(name)).find(Boolean);
    return { capability: any?.capability ?? { id, level: null, scope: null }, origin: any?.origin ?? null, required: statuses.length > 0,
      checks: Object.fromEntries(Object.keys(checks).map((name) => [name, of(name).length ? roll(of(name)) : "not-applicable"])),
      ready: statuses.length > 0 && statuses.every((s) => s === "pass" || s === "not-applicable") };
  });
  return { readinessApi: READINESS_API, subject: { ...(soul ? { kind: "soul", name: soul } : { kind: "scope", context: inspect.scope?.context ?? null }), ...(selector ? { selector } : {}) }, at: new Date().toISOString(),
    checks, summary: { ready: requiredStatuses.length > 0 && requiredStatuses.every((s) => s === "pass" || s === "not-applicable"), required: requiredStatuses.length,
      pass: requiredStatuses.filter((s) => s === "pass").length, fail: requiredStatuses.filter((s) => s === "fail").length, unknown: requiredStatuses.filter((s) => s === "unknown").length, byCapability },
    notes: [
      ...(verifySignatures ? [] : ["signatures are unknown until --verify-signatures (network fetch)"]),
      "ready means every REQUIRED check passes; it is never inferred from an empty set",
      "enrolment is workspace member admission, not native login or team registration",
    ] };
}

function readMemberDocument(deploymentDir) {
  if (!deploymentDir) return null;
  const file = join(deploymentDir, "oats.yaml");
  if (!existsSync(file)) return null;
  try {
    const doc = parseYamlNested(readFileSync(file, "utf8"));
    // The lenient parser never throws: a `workspace:` that is present but not a
    // mapping is a document we cannot read a membership from — unreadable, not absent.
    if (doc.workspace !== undefined && (doc.workspace === null || typeof doc.workspace !== "object")) return { workspace: null, admitted: null, unreadable: true, file };
    return { workspace: doc.workspace && typeof doc.workspace === "object" ? doc.workspace : null, admitted: null, exports: doc.exports ?? null };
  } catch { return { workspace: null, admitted: null, unreadable: true, file }; }
}

/** Enforced policy for an instance (from its recorded metadata) or a soul
 *  (its declaration + default), with origins. Advisory/unknown stays unknown. */
export function policyOf({ instanceMeta = null, soul = null } = {}) {
  const child = instanceMeta?.policy?.childSpawns
    ? { allowed: instanceMeta.policy.childSpawns.allowed === true, enforced: true, origin: instanceMeta.policy.childSpawns.origin ?? { kind: "recorded" } }
    : instanceMeta ? { allowed: true, enforced: true, origin: { kind: "default", detail: "no recorded policy: children allowed (pre-0.24.8 instance)" } }
    : soul?.declarations?.children && typeof soul.declarations.children.spawn === "boolean"
      ? { allowed: soul.declarations.children.spawn, enforced: false, origin: { kind: "soul", detail: "children.spawn in soul.yaml; enforced once an instance records it" } }
      : { allowed: true, enforced: false, origin: { kind: "default", detail: "no declaration: children allowed" } };
  const worktree = instanceMeta ? { allowed: instanceMeta.work === "worktree" || instanceMeta.work === "checkout", mode: instanceMeta.work ?? null, enforced: true, origin: { kind: "work-mode", detail: `work: ${instanceMeta.work}` } }
    : soul ? { allowed: ["worktree", "checkout"].includes(soul.work), mode: soul.work ?? null, enforced: false, origin: { kind: "soul", detail: `work: ${soul.work}` } } : { allowed: null, mode: null, enforced: false, origin: { kind: "unknown" } };
  return { readinessApi: READINESS_API, policy: { childSpawns: child, worktrees: worktree }, notes: ["a lifecycle-authority claim enforced by the spawn route, not an OS sandbox"] };
}
