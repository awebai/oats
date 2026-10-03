import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fail } from "./errors.mjs";
import { parseArgs } from "./args.mjs";
import { requireInstance } from "./context.mjs";
import { kernelJson } from "./kernel.mjs";
import { filterInstance, readStatus, resolveInstance } from "./instances.mjs";
import { parseRequestBlock, readTaskRequest, sha256 } from "./request-format.mjs";
import { ensurePrivateDir, inside, readRegularFile, writeJson, writePrivate } from "./files.mjs";
import { directoryListing, gitWorkState } from "./workstate.mjs";

// `oats cloning dossier <source>`: run by the cloner, read-only on the source.
// Everything lands in <cloner home>/clone/, never work/: the transcript in a
// temporary record (clone/record), the rest beside it. Retirement (kernel
// 0.34) keeps a changed home in private recovery storage, so `spawn` deletes
// the record, clone/source/ and dossier.json, and a cloner that stops without
// spawning deletes clone/ before it retires (/spawn-clone).

export const FILE_MAX = 1024 * 1024, TOTAL_MAX = 4 * 1024 * 1024;
const TOP_FILES = ["TASK.md", "STATE.md", "log.md"];
const NOTES_MAX_DEPTH = 8, NOTES_MAX_ENTRIES = 2000;

/** The home files a dossier may copy: TASK.md, STATE.md, log.md and
 *  notes/**\/*.md. Only regular files reached through real directories, never
 *  through a symlink, contained in the home after realpath. */
export function candidateFiles(realHome) {
  const out = TOP_FILES.map((name) => ({ rel: name, abs: join(realHome, name) }));
  const notes = join(realHome, "notes");
  let st;
  try { st = lstatSync(notes); } catch { return { files: out, skipped: [] }; }
  const skipped = [];
  if (st.isSymbolicLink()) return { files: out, skipped: [{ path: "notes", skipped: "symlink" }] };
  if (!st.isDirectory()) return { files: out, skipped: [{ path: "notes", skipped: "not-a-directory" }] };
  let seen = 0;
  const walk = (abs, rel, depth) => {
    let names;
    try { names = readdirSync(abs).sort(); } catch { skipped.push({ path: rel, skipped: "unreadable" }); return; }
    for (const name of names) {
      if (++seen > NOTES_MAX_ENTRIES) { skipped.push({ path: rel, skipped: "over-entry-budget" }); return; }
      const childAbs = join(abs, name), childRel = `${rel}/${name}`;
      let cst;
      try { cst = lstatSync(childAbs); } catch { continue; }
      if (cst.isSymbolicLink()) { skipped.push({ path: childRel, skipped: "symlink" }); continue; }
      if (cst.isDirectory()) {
        if (depth >= NOTES_MAX_DEPTH) skipped.push({ path: childRel, skipped: "too-deep" });
        else walk(childAbs, childRel, depth + 1);
      } else if (name.endsWith(".md")) out.push({ rel: childRel, abs: childAbs });
    }
  };
  walk(notes, "notes", 1);
  return { files: out, skipped };
}

/** Copy the candidates into `dest`, within the per-file and total budgets. */
export function copyHomeFiles(realHome, dest) {
  const { files, skipped } = candidateFiles(realHome);
  const entries = [];
  let total = 0;
  for (const { rel, abs } of files) {
    const r = readRegularFile(abs, FILE_MAX);
    if (r.skipped === "absent") continue;
    if (!r.bytes) { entries.push({ path: rel, ...(r.size !== undefined ? { bytes: r.size } : {}), copied: false, skipped: r.skipped }); continue; }
    let real;
    try { real = realpathSync(abs); } catch { entries.push({ path: rel, copied: false, skipped: "changed" }); continue; }
    if (!inside(realHome, real)) { entries.push({ path: rel, copied: false, skipped: "outside-home" }); continue; }
    if (total + r.size > TOTAL_MAX) { entries.push({ path: rel, bytes: r.size, copied: false, skipped: "over-total-budget" }); continue; }
    total += r.size;
    writePrivate(join(dest, ...rel.split("/")), r.bytes);
    entries.push({ path: rel, bytes: r.size, sha256: sha256(r.bytes), copied: true });
  }
  for (const s of skipped) entries.push({ ...s, copied: false });
  return { entries, copiedBytes: total };
}

export function readWork(src, env) {
  const mode = src.meta.work ?? null;
  const dir = join(src.home, "work");
  if (["worktree", "checkout", "attached"].includes(mode)) {
    return { mode, ...gitWorkState(dir, { baseOid: src.meta?.decision?.base?.oid ?? null, env }) };
  }
  if (mode === "directory") {
    let st;
    try { st = lstatSync(dir); } catch { return { mode, listing: null, note: "no work directory" }; }
    if (!st.isDirectory()) return { mode, listing: null, note: st.isSymbolicLink() ? "work is a symlink; not followed" : "work is not a directory" };
    return { mode, listing: directoryListing(dir) };
  }
  return { mode, note: "not read in this work mode" };
}

/** Where the source's transcript is captured for this clone: a temporary
 *  record in the cloner's home, never the host record. The source may have
 *  been told nothing of its session is captured, and cloning keeps that true. */
export const RECORD_DIR = "record";
const IGNORE_MAX = 1024 * 1024;

/** Capture reads its ignore list from the root it writes, so the temporary
 *  record carries a copy of the host's (TURN_RECORD_ROOT, else ~/.turn-record):
 *  sessions the user excluded stay excluded. Unreadable is not "none". */
function seedIgnore(recordDir, env) {
  const hostRoot = env.TURN_RECORD_ROOT || join(env.HOME || homedir(), ".turn-record");
  let text;
  try {
    if (statSync(join(hostRoot, "ignore")).size > IGNORE_MAX) return `${join(hostRoot, "ignore")} is over 1 MiB`;
    text = readFileSync(join(hostRoot, "ignore"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return `${join(hostRoot, "ignore")} could not be read (${e.code || e.message})`;
  }
  writePrivate(join(recordDir, "ignore"), text);
  return null;
}

export function readTranscript(src, ctx, recordDir) {
  rmSync(recordDir, { recursive: true, force: true });
  ensurePrivateDir(recordDir);
  let kept = false;
  try {
    const problem = seedIgnore(recordDir, ctx.env);
    if (problem) return { included: true, status: "failed", complete: false, sessions: [], error: `${problem}; nothing was captured` };
    const { value: cap } = kernelJson(["capture", "--home", src.home, "--root", recordDir, "--quiet"], { ...ctx, timeout: 600000 });
    if (!cap || typeof cap !== "object") fail("E_CLONE_KERNEL", "oats capture --home answered no object");
    const sessions = [];
    for (const s of Array.isArray(cap.sessions) ? cap.sessions : []) {
      if (typeof s?.thread !== "string" || typeof s?.lastTurnId !== "string") continue;
      const row = { thread: s.thread, sessionId: s.sessionId ?? null, source: s.source ?? null, lastTurnId: s.lastTurnId, turns: null };
      try {
        const { value } = kernelJson(["recall", "--root", recordDir, "--thread", s.thread, "--json", "--ids-only", "--until", s.lastTurnId], { ...ctx, timeout: 120000 });
        row.turns = Array.isArray(value?.turns) ? value.turns.length : null;
      } catch (e) { row.error = e.code || "E_CLONE_KERNEL"; }
      sessions.push(row);
    }
    kept = sessions.length > 0;
    return {
      included: true,
      status: typeof cap.status === "string" ? cap.status : "unknown",
      complete: cap.complete === true,
      sessions,
      ...(kept ? { record: recordDir } : {}),
      ...(typeof cap.error === "string" ? { error: cap.error } : {}),
      ...(Array.isArray(cap.unattributed) ? { unattributed: cap.unattributed.length } : {}),
    };
  } finally {
    // Kept only while it holds something to read; `spawn` deletes it after.
    if (!kept) rmSync(recordDir, { recursive: true, force: true });
  }
}

export function dossier(argv, deps = {}) {
  const env = deps.env ?? process.env, cwd = deps.cwd ?? process.cwd(), now = deps.now ?? (() => new Date());
  const { flags, positionals } = parseArgs(argv, { values: ["transcript"], switches: ["json"], positionals: 1 });
  const source = positionals[0];
  if (!source) fail("E_CLONE_USAGE", "usage: oats cloning dossier <source-instance> [--transcript include|exclude] --json");
  const inv = requireInstance(env, cwd);
  // Crash recovery: what an earlier run left (the source copies, a transcript
  // record) goes before anything else is read, refusals included.
  for (const leftover of ["source", RECORD_DIR]) rmSync(join(inv.home, "clone", leftover), { recursive: true, force: true });
  const { request, sha256: requestSha256 } = parseRequestBlock(readTaskRequest(inv.home));
  if (request.source !== source) fail("E_CLONE_REQUEST", `the request is for ${request.source}, not ${source}`);
  const transcript = flags.transcript ?? request.transcript;
  if (!["include", "exclude"].includes(transcript)) fail("E_CLONE_USAGE", "--transcript is include or exclude");
  if (transcript === "include" && request.transcript !== "include") fail("E_CLONE_TRANSCRIPT_CONSENT", `the requester excluded ${source}'s transcript; read it only if a new request includes it`);

  const ctx = { cwd: inv.home, env };
  const status = readStatus(ctx);
  const src = resolveInstance(status, source);
  if (src.name === inv.instance) fail("E_CLONE_SOURCE", "a cloner never clones itself");

  const cloneDir = ensurePrivateDir(join(inv.home, "clone"));
  const sourceDir = join(cloneDir, "source");
  rmSync(sourceDir, { recursive: true, force: true });
  ensurePrivateDir(sourceDir);

  const files = copyHomeFiles(src.home, sourceDir);
  const work = readWork(src, env);
  const recordDir = join(cloneDir, RECORD_DIR);
  const transcriptRecord = transcript === "include" ? readTranscript(src, ctx, recordDir) : { included: false };
  const doc = {
    version: 1,
    createdAt: now().toISOString(),
    cloner: inv.instance,
    request, requestSha256,
    source: { instance: src.name, home: src.home, soul: filterInstance(src.meta).soul.name, running: src.running },
    instance: filterInstance(src.meta, { running: src.running }),
    files: files.entries,
    work,
    transcript: transcriptRecord,
  };
  const path = join(cloneDir, "dossier.json");
  try {
    writeJson(path, doc);
    writeJson(join(cloneDir, "request.json"), request);
  } catch (e) { rmSync(recordDir, { recursive: true, force: true }); throw e; }
  const copied = files.entries.filter((f) => f.copied);
  return {
    dossier: path,
    summary: {
      source: src.name, soul: doc.source.soul, running: src.running,
      files: { copied: copied.length, bytes: files.copiedBytes, notCopied: files.entries.length - copied.length },
      work: { mode: work.mode, branch: work.branch ?? null, head: work.head ?? null, uncommitted: work.status?.total ?? null },
      transcript: transcriptRecord.included
        ? { included: true, status: transcriptRecord.status, complete: transcriptRecord.complete, sessions: transcriptRecord.sessions.length, turns: transcriptRecord.sessions.reduce((n, s) => n + (s.turns ?? 0), 0), record: transcriptRecord.record ?? null }
        : { included: false },
    },
  };
}
