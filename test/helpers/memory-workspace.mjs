// A workspace held in memory, for tests that need a read of it in a state real repositories make
// awkward (a member that cannot be confirmed, a soul that fails to read, an unreadable host): an
// in-memory remote under lib/remote.mjs's contract, and one small workspace to edit.
import YAML from "yaml";
import { oatsError } from "../../lib/errors.mjs";
import { parseRepoRef } from "../../lib/remote.mjs";
import { discoverWorkspace } from "../../lib/workspace.mjs";

export const OID = (c) => c.repeat(40);
export const REF = (name) => `git:github.com/acme/${name}`;
export const KEY = (name) => parseRepoRef(REF(name)).key;
export const soulFile = (name, extra = {}) => ({ schemaVersion: 2, name, description: `${name} soul`, work: "directory", ...extra });
export const detailed = (code, message, details) => { const e = oatsError(code, message, details); e.details = details; return e; };

/** An in-memory remote (lib/remote.mjs's contract, the real parseRepoRef) over
 *  repos: { <name>: { files: { <path>: object | string }, unreadable?, faults?: { read: { <path>: Error }, list: { <dir>: Error } } } }. */
export function memoryRemote(repos) {
  const byKey = Object.fromEntries(Object.entries(repos).map(([name, repo], i) => [KEY(name), { commit: OID("0123456789abcdef"[i + 1]), ...repo }]));
  const repoOf = (ref) => {
    const parsed = parseRepoRef(ref);
    const repo = byKey[parsed.key];
    if (!repo) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${parsed.url}`, { url: parsed.url, reason: "not-found" });
    if (repo.unreadable) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${parsed.url}`, { url: parsed.url, reason: "auth" });
    return { parsed, repo };
  };
  const bytesOf = (path, value) => Buffer.from(typeof value === "string" ? value : path.endsWith(".json") ? JSON.stringify(value) : YAML.stringify(value, { lineWidth: 0 }));
  return {
    parseRepoRef,
    commitOf: (name) => byKey[KEY(name)].commit,
    async observeRemote(ref) { const { parsed, repo } = repoOf(ref); return { key: parsed.key, url: parsed.url, commit: repo.commit, ref: "refs/heads/main", observedAt: "2026-10-12T10:00:00.000Z" }; },
    async readRemoteFile(ref, commit, path) {
      const { repo } = repoOf(ref);
      if (repo.faults?.read?.[path]) throw repo.faults.read[path];
      if (!Object.hasOwn(repo.files, path)) throw detailed("E_REMOTE_PATH_MISSING", `${path} is not in ${ref}@${commit}`, { path });
      const bytes = bytesOf(path, repo.files[path]);
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      const { repo } = repoOf(ref);
      if (repo.faults?.list?.[dir]) throw repo.faults.list[dir];
      const out = [], seen = new Set();
      for (const path of Object.keys(repo.files)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const parts = path.slice(dir.length + 1).split("/");
        if (parts.length <= depth) out.push({ path: parts.join("/"), type: "blob", size: 1 });
        for (let i = 1; i < Math.min(parts.length, depth + 1); i++) { const d = parts.slice(0, i).join("/"); if (!seen.has(d)) { seen.add(d); out.push({ path: d, type: "tree" }); } }
      }
      return out;
    },
  };
}

export const MEMBERSHIP = { schemaVersion: 2, workspace: REF("agents") };
/** A workspace: `agents` hosts it and offers reviewer and planner; `platform` offers its own reviewer and
 *  builder; the package acme.pkg (declared, locked) offers keeper. `edit(repos, workspace, lock)` changes it. */
export function world(edit = () => {}) {
  const workspace = { schemaVersion: 2, name: "acme", members: [REF("agents"), REF("platform")], packages: { "acme.pkg": "v1.0.0" },
    teams: { global: { description: "Everyone" } }, defaults: { knowledge: "none", messaging: "none", tasks: "none" } };
  const repos = {
    agents: { files: { "oats-workspace.yaml": workspace, "oats-membership.yaml": MEMBERSHIP, "souls/reviewer/soul.yaml": soulFile("reviewer"), "souls/planner/soul.yaml": soulFile("planner", { launch: { harness: "claude", model: "claude-opus-5-5" } }) } },
    platform: { files: { "oats-membership.yaml": MEMBERSHIP, "souls/reviewer/soul.yaml": soulFile("reviewer"), "souls/builder/soul.yaml": soulFile("builder") } },
    pkg: { files: { "oats-package/souls/keeper/soul.yaml": soulFile("keeper") } },
  };
  const lock = { lockfileVersion: 3, packages: { "acme.pkg": { version: "1.0.0", url: REF("pkg"), commit: OID("3"), path: "oats-package", capabilities: [], souls: [{ name: "keeper", path: "souls/keeper", digest: `sha256-${"0".repeat(64)}` }] } } };
  edit(repos, workspace, lock);
  const remote = memoryRemote(repos);
  return { remote, lock, discover: () => discoverWorkspace(REF("agents"), { remote, lock }) };
}
