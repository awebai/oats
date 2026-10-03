import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, CloneError } from "./errors.mjs";
import { parseArgs, isSlug, slugify } from "./args.mjs";
import { detectInvocation, readSettings } from "./context.mjs";
import { kernelEnvelope } from "./kernel.mjs";
import { readStatus, resolveInstance } from "./instances.mjs";
import { HARNESSES, normalizeRelation, checkGoal, clonerTask, parseRequestBlock } from "./request-format.mjs";
import { readRegularFile, writePrivate } from "./files.mjs";

const MAX_NAME = 64;

/** `--purpose clone-<source>`, cut so `<cloner prefix><purpose>` and a
 *  de-duplication suffix (`-NN`) fit the kernel's 64-character names. */
export function clonerPurpose(clonerSoul, source, maxPurpose) {
  const prefix = `${slugify(clonerSoul.replace("/", "-"))}-`;
  const budget = maxPurpose ?? Math.max(1, MAX_NAME - prefix.length - 3);
  return slugify(`clone-${source}`.slice(0, budget)) || "clone";
}

export function request(argv, deps = {}) {
  const env = deps.env ?? process.env, cwd = deps.cwd ?? process.cwd(), now = deps.now ?? (() => new Date());
  const { flags, positionals } = parseArgs(argv, {
    values: ["goal", "goal-file", "relation", "relative-to", "name", "transcript", "base", "harness", "model", "soul", "server"],
    switches: ["preview", "json"], positionals: 1,
  });
  if (flags.server !== undefined) fail("E_CLONE_REMOTE", "v1 clones only instances on this host; --server is not supported");
  const source = positionals[0];
  if (!source) fail("E_CLONE_USAGE", "usage: oats cloning request <source-instance> (--goal <text> | --goal-file <path>) --relation independent|child|sibling|parent [--relative-to <instance>] [--name <slug>] [--transcript include|exclude] [--base source|default|<ref>] [--harness pi|claude|codex] [--model <m>] [--preview] [--json]");

  const inv = detectInvocation(env, cwd);
  if (inv.problem) fail("E_CLONE_CONTEXT", inv.problem);
  const settings = readSettings(env);
  if (!settings.cloner) fail("E_CLONE_CONTEXT", "settings.cloner names no soul");

  if (flags.relation === undefined) fail("E_CLONE_RELATION_REQUIRED", "--relation is required: independent, child, sibling or parent (the requester's choice)");
  const relation = normalizeRelation(flags.relation);
  if (!relation) fail("E_CLONE_RELATION", `unknown --relation ${JSON.stringify(flags.relation)} (independent, child, sibling or parent)`);
  if (relation === "unrelated" && flags["relative-to"] !== undefined) fail("E_CLONE_RELATION", "an independent clone has no anchor: drop --relative-to");

  if (flags.goal !== undefined && flags["goal-file"] !== undefined) fail("E_CLONE_USAGE", "give --goal or --goal-file, not both");
  let goalBytes;
  if (flags.goal !== undefined) goalBytes = Buffer.from(flags.goal, "utf8");
  else if (flags["goal-file"] !== undefined) {
    const r = readRegularFile(flags["goal-file"], 8193);
    if (r.skipped === "over-file-budget") fail("E_CLONE_GOAL", "the goal file is over 8 KiB");
    if (!r.bytes) fail("E_CLONE_GOAL", `cannot read the goal file (${r.skipped})`);
    goalBytes = r.bytes;
  } else fail("E_CLONE_GOAL", "a goal is required: --goal <text> or --goal-file <path>");
  const goal = checkGoal(goalBytes);

  // Default include: the requester's request is the consent (spec §0 R2c).
  const transcript = flags.transcript ?? "include";
  if (!["include", "exclude"].includes(transcript)) fail("E_CLONE_USAGE", "--transcript is include or exclude");
  if (flags.harness !== undefined && !HARNESSES.includes(flags.harness)) fail("E_CLONE_USAGE", "--harness is pi, claude or codex");
  if (flags.model !== undefined && !flags.model.trim()) fail("E_CLONE_USAGE", "--model needs a model");
  if (flags.name !== undefined && !isSlug(flags.name)) fail("E_CLONE_USAGE", "--name must be a slug (lowercase letters and digits, single dashes), at most 64 characters");
  if (flags.base !== undefined && (!flags.base || flags.base.startsWith("-") || /\s/.test(flags.base))) fail("E_CLONE_USAGE", "--base is source, default or a ref");

  const ctx = { cwd: inv.home ?? cwd, env };
  const status = readStatus(ctx);
  const src = resolveInstance(status, source);
  const base = flags.base ?? null;
  if (base !== null && base !== "default" && src.meta.work !== "worktree") fail("E_CLONE_USAGE", `--base applies to a worktree source; ${source} works in ${src.meta.work ?? "an unknown mode"}`);
  if (base === "source" && typeof src.meta.branch !== "string") fail("E_CLONE_USAGE", `${source} records no branch to start from`);
  let relativeTo = null;
  if (relation !== "unrelated") {
    relativeTo = flags["relative-to"] ?? source;
    resolveInstance(status, relativeTo, "E_CLONE_ANCHOR", "anchor");
  }

  const req = {
    version: 1, source, goal, relation, relativeTo,
    name: flags.name ?? null, transcript, base,
    launch: { harness: flags.harness ?? null, model: flags.model ?? null },
    requestedBy: inv.kind === "instance" ? inv.instance : "operator",
    requestedAt: now().toISOString(),
  };
  const task = clonerTask(req);
  const { sha256: requestSha256 } = parseRequestBlock(task);

  const dir = mkdtempSync(join(deps.tmpdir ?? tmpdir(), "oats-cloning-"));
  chmodSync(dir, 0o700);
  try {
    const taskFile = writePrivate(join(dir, "cloner-task.md"), task);
    const spawnArgs = (purpose) => [
      "spawn", settings.cloner, "--purpose", purpose, "--task-file", taskFile, "--json",
      ...(inv.kind === "instance" ? ["--parent", inv.instance] : []),
    ];
    let purpose = clonerPurpose(settings.cloner, source);
    let preview;
    try { preview = kernelEnvelope([...spawnArgs(purpose), "--preview"], { ...ctx, timeout: 300000 }); }
    catch (e) {
      const max = e instanceof CloneError && e.code === "E_INSTANCE_NAME_INVALID" ? e.details?.kernel?.details?.maxPurpose : undefined;
      if (!Number.isInteger(max) || max < 1) throw e;
      purpose = clonerPurpose(settings.cloner, source, max);
      preview = kernelEnvelope([...spawnArgs(purpose), "--preview"], { ...ctx, timeout: 300000 });
    }
    const revision = preview?.decision?.revision;
    if (typeof preview?.instance !== "string" || typeof revision !== "string") fail("E_CLONE_KERNEL", "spawn --preview answered without an instance and decision");
    if (relativeTo !== null && relativeTo === preview.instance) fail("E_CLONE_ANCHOR", "the anchor can never be the cloner: it retires when the clone exists");
    const planned = { instance: preview.instance, home: preview.home, soul: settings.cloner, decision: revision };
    if (flags.preview) return { preview: planned, request: req, requestSha256 };

    const applied = kernelEnvelope([...spawnArgs(purpose), "--expect-decision", revision], { ...ctx, timeout: 600000 });
    return { cloner: { instance: applied.instance, home: applied.home }, request: req, requestSha256 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
