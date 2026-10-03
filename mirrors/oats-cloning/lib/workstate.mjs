import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The source's work state, read-only: git never takes optional locks, never
// runs an fsmonitor, external diff or textconv, and records no diff content.
// A directory work tree is listed, never read.

export const MAX_COMMITS = 100, MAX_PATHS = 500, MAX_LISTING = 500;

function gitEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^GIT_/.test(k)) out[k] = v;
  out.GIT_OPTIONAL_LOCKS = "0";
  out.GIT_TERMINAL_PROMPT = "0";
  return out;
}

function git(dir, args, env) {
  const r = spawnSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", dir, ...args], {
    env: gitEnv(env), encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return r.status === 0 ? r.stdout : null;
}

export function gitWorkState(dir, { baseOid = null, env = process.env } = {}) {
  const head = git(dir, ["rev-parse", "--verify", "HEAD"], env)?.trim() || null;
  if (head === null) return { readable: false };
  const branchRaw = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"], env)?.trim();
  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : null;
  const upstream = git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], env)?.trim() || null;
  let ahead = null, behind = null, range;
  if (upstream) {
    const counts = git(dir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], env)?.trim().split(/\s+/);
    if (counts?.length === 2) { ahead = Number(counts[0]); behind = Number(counts[1]); }
    range = { against: "upstream", args: ["@{upstream}..HEAD"] };
  } else if (baseOid && /^[0-9a-f]{40,64}$/.test(baseOid)) range = { against: "base", args: [`${baseOid}..HEAD`] };
  else range = { against: "remotes", args: ["HEAD", "--not", "--remotes"] };
  const log = git(dir, ["log", "--no-decorate", "--no-color", "--format=%h %s", `--max-count=${MAX_COMMITS + 1}`, ...range.args], env);
  const commitLines = log === null ? [] : log.split("\n").filter(Boolean);
  const porcelain = git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], env);
  const status = [];
  let statusTotal = 0;
  if (porcelain !== null) {
    const parts = porcelain.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      if (code[0] === "R" || code[0] === "C") i++; // the rename source follows with -z
      statusTotal++;
      if (status.length < MAX_PATHS) status.push({ code, path: entry.slice(3) });
    }
  }
  const numstat = git(dir, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--numstat", "HEAD"], env);
  const diffstat = [];
  let diffTotal = 0;
  if (numstat !== null) {
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [added, deleted, ...p] = line.split("\t");
      diffTotal++;
      if (diffstat.length < MAX_PATHS) diffstat.push({ path: p.join("\t"), added: added === "-" ? null : Number(added), deleted: deleted === "-" ? null : Number(deleted) });
    }
  }
  return {
    readable: true, branch, head, upstream, ahead, behind,
    commits: { against: range.against, list: commitLines.slice(0, MAX_COMMITS), truncated: commitLines.length > MAX_COMMITS },
    status: { paths: status, total: statusTotal, truncated: statusTotal > status.length },
    diffstat: { files: diffstat, total: diffTotal, truncated: diffTotal > diffstat.length },
  };
}

/** work/ to depth 2: names, types and sizes, never contents or link targets. */
export function directoryListing(dir) {
  const entries = [];
  let truncated = false;
  const walk = (abs, rel, depth) => {
    let names;
    try { names = readdirSync(abs).sort(); } catch { return; }
    for (const name of names) {
      if (entries.length >= MAX_LISTING) { truncated = true; return; }
      const path = rel ? `${rel}/${name}` : name;
      let st;
      try { st = lstatSync(join(abs, name)); } catch { continue; }
      const type = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
      entries.push({ path, type, ...(type === "file" ? { bytes: st.size } : {}) });
      if (type === "dir" && depth < 2) walk(join(abs, name), path, depth + 1);
    }
  };
  walk(dir, "", 1);
  return { entries, truncated };
}
