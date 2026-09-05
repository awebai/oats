#!/usr/bin/env node
/**
 * oats-okf — OATS knowledge-integration hooks for OKF (Open Knowledge Format).
 *
 * THE KNOWLEDGE INTEGRATION OWNS ALL MEMORY CONVENTIONS. The kernel knows
 * nothing about STATE.md, log.md, notes/, knowledge bundles, or harvest —
 * agents without a knowledge integration simply have none of this.
 *
 * Events (hook contract):
 *   soul-scaffold  scaffold the soul's OKF knowledge bundle (idempotent)
 *   spawn          scaffold instance memory (STATE.md, log.md, notes/) + brief
 *   retire         no-op (promotion is continuous — see harvest)
 *   harvest        AGENT-INITIATED (not a kernel hook): run from an instance
 *                  home; with no pending notes (or with --from-record) it
 *                  harvests the instance's own captured session turns since
 *                  the last harvest (watermark .okf-harvest-record.json)
 *                  home (`node <pkg>/capabilities/oats-okf/bin/oats-okf.mjs harvest`)
 *                  after committing with pending notes — spawns the memory-harvest
 *                  agent attached to this instance's work tree.
 *
 * Env: OATS_EVENT, OATS_INSTANCE, OATS_HOME, OATS_AGENT, OATS_SOUL (soul dir),
 *      OATS_CONTEXT, OATS_WORKSPACE, OATS_SETTINGS ({ "sections-file"? }),
 *      OATS_TASK (spawn), OATS_REPO/OATS_BRANCH/OATS_WORK (spawn), OATS_META (retire).
 * Output: JSON { meta, brief, warning } on stdout. Failures warn, never block.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawnSync } from "node:child_process";

const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(0); };
const warn = (m) => out({ warning: `oats-okf: ${String(m).slice(0, 300)}` });

// Desktop CLI API v1: `oats okf harvest --json` emits EXACTLY ONE envelope
// object on stdout — {schemaVersion:1,ok,result|error} — and a nonzero exit
// on failure. Ordinary (non---json) output keeps the hook JSON shape above.
const JSON_MODE = process.argv.includes("--json");
const jsonOk = (result) => { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result }) + "\n"); process.exit(0); };
const jsonFail = (code, message) => { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: String(message).slice(0, 300) } }) + "\n"); process.exit(1); };

const event = process.env.OATS_EVENT || process.argv[2];
const instance = process.env.OATS_INSTANCE;
const home = process.env.OATS_HOME || process.cwd();
const soulDir = process.env.OATS_SOUL;
const agentName = process.env.OATS_AGENT || "agent";
// Fallible init stays inside an error boundary: malformed inherited env must
// never produce a bare stack trace — in --json mode Desktop expects one
// envelope object on stdout even for init failures.
let settings = {};
try { settings = JSON.parse(process.env.OATS_SETTINGS || "{}"); }
catch (e) {
  if (JSON_MODE) jsonFail("E_HARVEST_FAILED", `malformed OATS_SETTINGS: ${e.message || e}`);
  process.stderr.write(`oats-okf: malformed OATS_SETTINGS (ignoring): ${e.message || e}\n`);
}
/** Model for the memory-harvest agent — promotion judgment is cheap-but-good
 *  work; default gpt-5.5, overridable via okf settings { "harvest-model": ... }. */
const DEFAULT_HARVEST_MODEL = "github-copilot/gpt-5.5";

function runtimeError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Canonical package-runtime binary supplied by capability command dispatch.
 * Never discover or resolve the kernel through PATH. */
function packageRuntimeCli() {
  const cli = process.env.OATS_CLI_BIN;
  if (!cli) throw runtimeError("E_SPAWN_FAILED", "OATS_CLI_BIN is required by the package-runtime contract");
  if (!isAbsolute(cli)) throw runtimeError("E_SPAWN_FAILED", "OATS_CLI_BIN must be an absolute path");
  return cli;
}

/** Record-fed harvest (aweb-abfz). An instance that writes no notes still
 *  leaves a record: every Claude Code, pi and Codex session on the machine is
 *  captured as session turns, and the sessions that ran inside this home are
 *  the instance's own. Ask the kernel to capture them and report exact
 *  sequence boundaries, compare with the watermark of what was already
 *  harvested, and return the windows that are new — or null when nothing is.
 *  The watermark advances only when the harvester delivers (it writes the
 *  file its briefing hands it), so a failed harvest re-reads the same window. */
const RECORD_WATERMARK = ".okf-harvest-record.json";
/** A window is what one harvester can actually read: a first harvest of a
 *  long-lived session must not hand it the whole thread (tens of MB on real
 *  homes) and then let it advance the watermark past what it never read. The
 *  plan sizes each window with an ids-only listing and stops at the turn or
 *  byte cap; the rest drains over later harvests, each with a truthful
 *  watermark. Overridable through okf settings { "record-window-turns",
 *  "record-window-bytes" }. */
// Sized to ONE tool-output read: harnesses truncate a command's output well
// under 100 KB (Claude Code around 30 KB), and the byte cap is measured on
// the JSON the harvester receives, not on the text inside it. A backlog
// drains over successive harvests; the caps are settings for operators
// whose harness reads more.
const DEFAULT_WINDOW_TURNS = 60;
const DEFAULT_WINDOW_BYTES = 96_000;
function sizeWindow(cli, thread, afterTurnId, caps) {
  const list = (after) => {
    const args = ["recall", "--thread", thread, "--json", "--ids-only", "--limit", String(caps.turns)];
    if (after) args.push("--after", after);
    const r = spawnSync(cli, args, { encoding: "utf8", env: process.env, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) return { error: String(r.stderr || r.error?.message || `recall exited ${r.status}`).trim().slice(0, 200) };
    try { return { doc: JSON.parse(String(r.stdout || "").trim()) }; } catch (e) { return { error: `recall answered no JSON: ${String(e.message).slice(0, 100)}` }; }
  };
  let { doc, error } = list(afterTurnId);
  let restarted = false;
  // The watermark's boundary turn can leave the thread (a redaction hides it
  // for good). That must not strand the thread: read from the start again,
  // bounded as always, and say so. The harvester's own fallback covers the
  // same case between plan and read.
  if (error && afterTurnId && /--after: no turn/.test(error)) { ({ doc, error } = list(null)); restarted = true; }
  if (error) return { error };
  let bytes = 0; let n = 0;
  for (const t of doc.turns || []) {
    if (n > 0 && bytes + t.bytes > caps.bytes) break; // always at least one turn, so a single huge turn still drains
    bytes += t.bytes; n++;
  }
  if (!n) return { empty: true };
  return { untilTurnId: doc.turns[n - 1].id, newTurns: n, bytes, remaining: (doc.turns.length - n) + (doc.remaining || 0), restarted };
}
function planRecordHarvest(instanceHome) {
  const watermarkPath = join(instanceHome, RECORD_WATERMARK);
  let prior = {};
  try { prior = JSON.parse(readFileSync(watermarkPath, "utf8")).threads || {}; } catch { prior = {}; }
  let report;
  try {
    const r = spawnSync(packageRuntimeCli(), ["capture", "--home", instanceHome, "--quiet"], { encoding: "utf8", env: process.env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0) return { unavailable: String(r.stderr || r.error?.message || `capture exited ${r.status}`).trim().slice(0, 200) };
    report = JSON.parse(String(r.stdout || "").trim());
  } catch (e) { return { unavailable: String(e.message || e).slice(0, 200) }; }
  const positive = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const caps = { turns: positive(settings["record-window-turns"], DEFAULT_WINDOW_TURNS), bytes: positive(settings["record-window-bytes"], DEFAULT_WINDOW_BYTES) };
  const threads = [];
  const problems = [];
  for (const s of report.sessions || []) {
    const seen = prior[s.thread];
    // Nothing new when the last visible turn is the one already harvested;
    // ids, not counts, so a redaction inside the harvested prefix neither
    // hides genuinely new turns nor re-reads old ones.
    if (seen && seen.untilTurnId === s.lastTurnId) continue;
    const win = sizeWindow(packageRuntimeCli(), s.thread, seen?.untilTurnId || null, caps);
    if (win.error) { problems.push(`${s.thread}: ${win.error}`); continue; }
    if (win.empty) { problems.push(`${s.thread}: capture reports new turns after ${seen?.untilTurnId || "the start"} but recall lists none; the two views disagree, nothing planned for it`); continue; }
    if (win.restarted) problems.push(`${s.thread}: the harvested boundary ${seen.untilTurnId} is no longer in the thread (redacted?); reading from the start again`);
    threads.push({ thread: s.thread, source: s.source, afterTurnId: win.restarted ? null : (seen?.untilTurnId || null), untilTurnId: win.untilTurnId, turns: (win.restarted ? 0 : (seen?.turns || 0)) + win.newTurns, newTurns: win.newTurns, bytes: win.bytes, remaining: win.remaining });
  }
  if (!threads.length) return problems.length ? { unavailable: problems.join("; ") } : null;
  const next = { threads: { ...prior } };
  for (const t of threads) next.threads[t.thread] = { untilTurnId: t.untilTurnId, turns: t.turns, harvestedAt: new Date().toISOString() };
  // The exact next watermark is written beside the current one by the
  // package; the harvester's delivery is a rename, nothing retyped.
  const nextPath = join(instanceHome, RECORD_WATERMARK.replace(/\.json$/, ".next.json"));
  writeFileSync(nextPath, JSON.stringify(next, null, 2) + "\n");
  return { threads, watermarkPath, nextPath, watermark: next, unattributed: (report.unattributed || []).length, problems };
}

/** Briefing block for record-fed candidates, appended to the harvest task. */
function recordBrief(plan, cli) {
  if (!plan?.threads?.length) return "";
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const lines = plan.threads.map((t) => `  - ${t.thread} (${t.newTurns} turns, ~${Math.round(t.bytes / 1024)} KB of JSON${t.remaining ? `, ${t.remaining} more wait for the next harvest` : ""}): \`${cli} recall --thread ${q(t.thread)} --json${t.afterTurnId ? ` --after ${q(t.afterTurnId)}` : ""} --until ${q(t.untilTurnId)}\``);
  return `\n- RECORD-FED CANDIDATES (the memory-harvest skill, section "Record-fed candidates"): this instance's own captured session turns since the last harvest, in windows sized for one reading (about ${Math.round(DEFAULT_WINDOW_BYTES / 1024)} KB at most). Read each window with the exact command given, never wider, and read it IN FULL. If your tool output truncates, redirect the command's output to a file in your home and read that file in parts: that is a complete reading, not a wider one. A window you could not read completely is a failed harvest, and a failed harvest leaves the watermark alone.\n${lines.join("\n")}\n  If a window command is rejected because its --after id is no longer in the thread, run it again without --after and read from the start; if its --until id is rejected, this harvest has failed (leave the watermark files alone; the next oats okf harvest replans). Extract candidate lessons from them in the same shape as notes (one candidate per insight, provenance = the turn ids it came from), then judge every candidate under the same promotion bar as a note. Session trivia, tool noise and anything derivable from the repo fail the bar; promoting nothing is a normal outcome.\n- When your judgement of every window is COMPLETE, whether or not anything was promoted, and after any delivery it needed, advance the watermark by renaming the prepared file (it records what you read, not what you promoted; a failed or abandoned harvest must leave both files as they are):\n  mv '${plan.nextPath}' '${plan.watermarkPath}'`;
}

/** Invoke the versioned package-runtime boundary. Task text crosses the
 * process boundary only through an owner-readable tempfile, removed on every
 * success/failure outcome. */
async function spawnHarvester(spawnArgs, task) {
  const temp = mkdtempSync(join(tmpdir(), "oats-okf-harvest-"));
  const taskFile = join(temp, "TASK.md");
  try {
    writeFileSync(taskFile, task, { mode: 0o600, flag: "wx" });
    const args = ["spawn", "memory-harvest", ...spawnArgs, "--task-file", taskFile, "--json"];
    const child = await new Promise((resolveChild) => {
      execFile(packageRuntimeCli(), args, {
        encoding: "utf8",
        env: process.env,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => resolveChild({ error, stdout, stderr }));
    });
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.error && !String(child.stdout || "").trim()) {
      throw runtimeError("E_SPAWN_FAILED", child.error.message || child.error);
    }
    let envelope;
    try { envelope = JSON.parse(String(child.stdout || "").trim()); }
    catch { throw runtimeError("E_SPAWN_FAILED", "oats spawn returned an invalid JSON envelope"); }
    if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== "boolean") {
      throw runtimeError("E_SPAWN_FAILED", "oats spawn returned an unsupported JSON envelope");
    }
    if (!envelope.ok) {
      throw runtimeError(envelope.error?.code || "E_SPAWN_FAILED", envelope.error?.message || "oats spawn failed");
    }
    if (child.error) throw runtimeError("E_SPAWN_FAILED", child.error.message || "oats spawn failed");
    if (!envelope.result?.instance) throw runtimeError("E_SPAWN_FAILED", "oats spawn success envelope has no instance");
    return envelope.result;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function harvestSpawnArgs({ slug, parent, repo, work, workDir, branch, model }) {
  const args = ["--purpose", slug, "--parent", parent, "--repo", repo, "--work", work];
  if (workDir) args.push("--work-dir", workDir);
  if (branch) args.push("--branch", branch);
  args.push("--model", model);
  return args;
}

/** Append a one-line entry to an OKF log.md (newest-first, date-grouped per spec §7). */
function appendLogEntry(logPath, entry, title) {
  const today = new Date().toISOString().slice(0, 10);
  let text = existsSync(logPath) ? readFileSync(logPath, "utf8") : `# ${title}\n\n`;
  const heading = `## ${today}`;
  if (text.includes(heading)) text = text.replace(`${heading}\n`, `${heading}\n* ${entry}\n`);
  else text = text.replace(/^(# [^\n]*\n\n?)/, `$1${heading}\n* ${entry}\n\n`);
  writeFileSync(logPath, text);
}

/** Scaffold the soul's OKF knowledge bundle (idempotent). */
function scaffoldSoul() {
  if (!soulDir) return false;
  const kb = join(soulDir, "knowledge");
  mkdirSync(kb, { recursive: true });
  const index = join(kb, "index.md");
  if (!existsSync(index)) {
    let seeded = "";
    const sf = settings["sections-file"];
    if (sf) {
      const abs = isAbsolute(sf) ? sf : join(process.env.OATS_CONTEXT || home, sf);
      if (existsSync(abs)) seeded = readFileSync(abs, "utf8").trim() + "\n";
    }
    writeFileSync(index, `---
okf_version: "0.1"
---

# ${agentName} knowledge base

Curated long-term knowledge for the ${agentName} agent (OKF bundle). Follow links
selectively — read what the current task needs, not everything.

# Sections

* [lessons/](lessons/) - durable lessons learned (type: Lesson).
* [decisions/](decisions/) - decisions and their rationale (type: Decision).
* [playbooks/](playbooks/) - step-by-step procedures kept as knowledge (type: Playbook).
* [references/](references/) - internal/external reference material (type: Reference).
${seeded}
Grow role-specific sections beyond these as the agent's role demands (e.g.
architecture/, codebase/) — list them here and log the growth in log.md.
`);
  }
  const log = join(kb, "log.md");
  if (!existsSync(log)) appendLogEntry(log, "**Initialization**: knowledge bundle scaffolded by oats-okf.", "Knowledge Log");
  return true;
}

if (event === "soul-scaffold") {
  try { out({ meta: { scaffolded: scaffoldSoul() } }); } catch (e) { warn(e.message || e); }
} else if (event === "spawn") {
  // Ephemeral CAPABILITY agents (reviewer, memory-harvest) carry no episodic
  // state of their own — no STATE.md/log.md/notes scaffolding, and no
  // session-protocol brief. LOCAL souls are full souls: they get everything.
  // ("tmp" is the legacy spelling of local — treat it as local, with memory.)
  if ((process.env.OATS_KIND || "") === "capability") {
    out({ meta: { memory: "none" }, brief: "Memory: none — you are ephemeral; no STATE.md/log.md/notes upkeep, no harvest." });
  }
  try {
    const task = (process.env.OATS_TASK || "").trim();
    writeFileSync(join(home, "STATE.md"), `---
type: Instance State
title: ${instance} working state
description: Live working state for instance ${instance} — rewritten as work progresses.
timestamp: ${new Date().toISOString()}
---

# Task

${task || "_No task assigned yet — await instructions._"}

# Plan

_(numbered steps once you have a plan)_

# Progress

_(what is done — commits, files touched, verified results)_

# Next

_(the single next action — keep this current; a fresh session on any model resumes from here)_

# Context

- repo: ${process.env.OATS_REPO || "?"} (branch ${process.env.OATS_BRANCH || "?"}, mode ${process.env.OATS_WORK || "?"})
- key files/paths: _(fill in as you learn them)_
`);
    appendLogEntry(join(home, "log.md"),
      `**Creation**: instance ${instance} spawned from soul ${agentName}${task ? ` — task: ${task.split("\n")[0].slice(0, 120)}` : ""}.`,
      "Instance Log");
    mkdirSync(join(home, "notes"), { recursive: true });
    out({
      meta: { memory: "okf" },
      brief: "Memory: your STATE.md/log.md/notes/ are scaffolded — your AGENTS.md's 'Knowledge: OKF' section has the session protocol.",
    });
  } catch (e) { warn(`instance memory scaffold failed: ${e.message || e}`); }
} else if (event === "harvest") {
  // AGENT-INITIATED HARVEST. An instance that committed with pending notes
  // runs `harvest` from its home: spawn the
  // memory-harvest agent ATTACHED to the same work tree — sibling home, shared
  // tree — to promote notes into the soul, commit, and retire itself.
  // Long-lived sessions thus feed the soul continuously, on the agent's call.
  try {
    // Derive context from the instance home (cwd) when hook env is absent.
    const metaFile = join(home, "instance.json");
    const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
    const inst = instance || meta.instance;
    const agName = process.env.OATS_AGENT || meta.agent || "agent";
    const sDir = soulDir || join(home, "soul");
    const context = process.env.OATS_CONTEXT || meta.repo;
    let root = process.env.OATS_ROOT;
    if (!root) { // walk up from home to the agents/ dir
      let d = home;
      while (d !== dirname(d)) { if (d.endsWith("/instances")) { root = join(d, "..", ".."); break; } d = dirname(d); }
      root = root ? realpathSync(join(root)) : undefined;
      // instances live at <root>/<agent>/instances/<inst>, at the legacy nested
      // <root>/{local,tmp}-agents/<agent>/instances/<inst>, or at the sibling
      // <scope>/local-agents/<agent>/instances/<inst> — canonical root is <scope>/agents.
      if (root && ["local-agents", "tmp-agents"].includes(root.split("/").pop())) {
        const parent = dirname(root);
        root = parent.split("/").pop() === "agents" ? parent : join(parent, "agents");
      }
    }
    const notesDir = join(home, "notes");
    const skip = (why) => (JSON_MODE ? jsonOk({ harvest: "skipped", reason: why }) : out({ meta: { harvestSpawn: "skipped", why } }));
    if (String(agName).startsWith("memory-harvest")) skip("self (loop guard)");
    const notes = existsSync(notesDir) ? readdirSync(notesDir).filter((f) => f.endsWith(".md")) : [];

    // With no notes the record path could still apply, but it needs the same
    // root, identity and context as any spawn; a home missing them answers
    // exactly as before ("no pending notes"), so nothing an operator scripted
    // against that reason changes.
    const prerequisite = (why) => skip(notes.length ? why : "no pending notes");
    if (!root || (!existsSync(root) && !existsSync(join(dirname(root), "local-agents")))) prerequisite("no agents root found above this home");
    if (!inst) prerequisite("no instance identity (run from an instance home)");
    if (!context) prerequisite("no repository context (instance metadata has no repo)");
    const slug = String(inst).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    // Debounce: one harvester per source instance at a time (canonical sibling
    // local-agents/ plus legacy nested locations). The public spawn boundary
    // derives the deterministic instance name from --purpose <slug>.
    const harvesterHomes = [
      join(dirname(root), "local-agents", "memory-harvest", "instances", `memory-harvest-${slug}`),
      join(root, "local-agents", "memory-harvest", "instances", `memory-harvest-${slug}`),
      join(root, "tmp-agents", "memory-harvest", "instances", `memory-harvest-${slug}`),
    ];
    if (harvesterHomes.some((h) => existsSync(h))) skip("harvester already running for this instance");
    // No notes is no longer the end: the record may hold this instance's own
    // sessions with turns nobody has judged yet (standing, non-coding roles
    // write few notes). --from-record asks for the record even with notes.
    // Planned only now, after every skip above: a capture pass is a real
    // write and index, and "calling it too often is safe" must stay true.
    let recordPlan = null;
    if (notes.length === 0 || process.argv.includes("--from-record")) {
      let planned = null;
      try { planned = planRecordHarvest(home); } catch { planned = null; }
      if (planned?.unavailable) {
        process.stderr.write(`oats-okf: record unavailable${notes.length ? ", harvesting notes only" : ""}: ${planned.unavailable}\n`);
        if (notes.length === 0) skip("no pending notes");
      } else recordPlan = planned;
      for (const line of recordPlan?.problems || []) process.stderr.write(`oats-okf: record: ${line}\n`);
      if (recordPlan?.unattributed) process.stderr.write(`oats-okf: record: ${recordPlan.unattributed} session file(s) carry no working directory and cannot be attributed to any home (oats capture --home <home> lists them)\n`);
      if (notes.length === 0 && !recordPlan) skip("no pending notes");
    }
    // Effective command settings are injected by capability dispatch. No
    // resolved-config read crosses the public package boundary.
    const harvestModel = settings["harvest-model"] || DEFAULT_HARVEST_MODEL;
    const workDir = realpathSync(join(home, "work"));
    const realSoul = realpathSync(sDir);
    const harvName = `memory-harvest-${slug}`;
    const gitRootOf = (start) => { let d = start; while (d !== dirname(d)) { if (existsSync(join(d, ".git"))) return d; d = dirname(d); } return undefined; };
    let r;
    const srcKind = process.env.OATS_KIND || meta.kind || "";
    if (["local", "tmp"].includes(srcKind)) {
      // LOCAL soul: uncommitted by contract (local-agents/, gitignored). The
      // harvester judges notes exactly as usual, but the deliverable is DIRECT
      // edits to the canonical soul — no commit, no PR: there is nothing to
      // version. It must not touch the owner's work tree.
      const task = `Harvest the pending notes of live LOCAL-SOUL instance "${inst}" (agent "${agName}") into its soul — by direct edits, no commit.\n\n- Source notes: ${notes.length ? `${notesDir} (${notes.join(", ")})` : "none pending"}\n- Soul knowledge bundle to update: ${join(realSoul, "knowledge")}\n- Soul skills dir (for procedure-shaped notes): ${join(realSoul, "skills")}\n- This soul is LOCAL (uncommitted, gitignored): edit those soul files IN PLACE. Do NOT run git commit — not for the soul, and not in ./work (the shared tree belongs to the working instance; leave it untouched).\n- Follow your memory-harvest skill for everything else: promote/merge/drop each note, knowledge vs skill routing, index + log discipline, validate the bundle, DELETE processed notes from the source notes/ dir.\n${recordBrief(recordPlan, packageRuntimeCli())}\n- Then run \`oats retire ${harvName} --self\`.`;
      r = await spawnHarvester(harvestSpawnArgs({
        slug, parent: inst, repo: context, work: "attached", workDir, model: harvestModel,
      }), task);
    } else if ((process.env.OATS_WORK || meta.work) === "workspace") {
      // WORKSPACE-MODE instance: ./work is the whole workspace, not a git repo —
      // the harvester may NOT commit there. The soul lives in its own home repo
      // (committed to the workspace): harvest in a WORKTREE of that repo and
      // deliver the promotion as a PR, never a direct push to its main branch.
      const soulRepo = gitRootOf(realSoul);
      if (!soulRepo) skip("workspace-mode soul is not inside a git repo — nowhere to deliver a PR");
      const relSoul = realSoul.slice(soulRepo.length + 1);
      const task = `Harvest the pending notes of live WORKSPACE-MODE instance "${inst}" (agent "${agName}") into its soul — delivered as a PR.\n\n- Source notes: ${notes.length ? `${notesDir} (${notes.join(", ")})` : "none pending"}\n- Your ./work is a dedicated worktree of the soul's home repo (${soulRepo}), branch memory-harvest/${slug}.\n- Soul knowledge bundle to update: ./work/${join(relSoul, "knowledge")}\n- Soul skills dir (for procedure-shaped notes): ./work/${join(relSoul, "skills")}\n- Follow your memory-harvest skill: promote/merge/drop each note, knowledge vs skill routing, index + log discipline, validate the bundle, DELETE processed notes from the source notes/ dir, and commit once (prefixed "memory-harvest:") if anything changed.${recordBrief(recordPlan, packageRuntimeCli())}\n- If you changed anything: push the branch and open a PR (\`git push -u origin memory-harvest/${slug}\` then \`gh pr create --fill\`). Do NOT merge it; the humans/owners of ${soulRepo} review soul changes. If gh is unavailable, push the branch and report the compare URL. A harvest that promoted nothing has nothing to commit, push or open; that is a completed harvest, not a failed one.\n- Finally run \`oats retire ${harvName} --self\` (keep the branch: --self only).`;
      r = await spawnHarvester(harvestSpawnArgs({
        slug, parent: inst, repo: soulRepo, work: "worktree",
        branch: `memory-harvest/${slug}`, model: harvestModel,
      }), task);
    } else {
      // Repo-resident souls: write to the soul AS SEEN FROM THE WORK TREE, so the
      // promotion commits onto the instance's own branch. Otherwise the canonical soul.
      const realRepo = realpathSync(context || workDir);
      const soulTarget = realSoul.startsWith(realRepo + "/")
        ? join(workDir, realSoul.slice(realRepo.length + 1))
        : realSoul;
      const task = `Harvest the pending notes of live instance "${inst}" (agent "${agName}") into its soul.\n\n- Source notes: ${notes.length ? `${notesDir} (${notes.join(", ")})` : "none pending"}\n- Soul knowledge bundle to update: ${join(soulTarget, "knowledge")}\n- Soul skills dir (for procedure-shaped notes): ${join(soulTarget, "skills")}\n- You are ATTACHED to the instance's work tree (./work) — commit your promotions there as a single commit, prefixed "memory-harvest:".\n- Follow your memory-harvest skill: promote/merge/drop each note, knowledge vs skill routing, index + log discipline, validate the bundle, DELETE processed notes from the source notes/ dir (so they are not re-harvested).${recordBrief(recordPlan, packageRuntimeCli())}\n- Commit if you changed anything (a harvest that promoted nothing has nothing to commit), then run \`oats retire ${harvName} --self\`.`;
      r = await spawnHarvester(harvestSpawnArgs({
        slug, parent: inst, repo: context, work: "attached", workDir, model: harvestModel,
      }), task);
    }
    if (JSON_MODE) jsonOk({ harvest: "spawned", instance: r.instance, window: r.tmux?.window || null, ...(recordPlan ? { record: { threads: recordPlan.threads.map((t) => t.thread), ...(recordPlan.unattributed ? { unattributed: recordPlan.unattributed } : {}), ...(recordPlan.problems?.length ? { problems: recordPlan.problems } : {}) } } : {}) });
    out({ meta: { harvestSpawn: r.instance, window: r.tmux?.window } });
  } catch (e) {
    if (JSON_MODE) jsonFail(e.code || "E_HARVEST_FAILED", `harvest spawn failed (notes are safe on disk): ${e.message || e}`);
    warn(`harvest spawn failed (notes are safe on disk): ${e.message || e}`);
  }
} else if (event === "retire") {
  // Retirement is intentionally a no-op for knowledge (for now): promotion happens
  // continuously via agent-initiated harvest. Uncommitted notes die with the home —
  // the injection tells instances to bring memory up to date, commit, and harvest
  // before finishing.
  out({ meta: {} });
} else {
  warn(`unknown event "${event}" (expected soul-scaffold|spawn|retire)`);
}
