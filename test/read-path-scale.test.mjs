/** The read path stays linear in members: over an in-memory remote with M members (~3.3 souls, ~1.5
 *  capabilities each), discovery plus the souls / capabilities / status assembly (soulSpawnability per
 *  soul, memberRef + capabilityProvides per capability, driftOf / soulDriftOf per instance) calls
 *  parseRepoRef O(M) times — and every validateWorkspace parses each member once, so a validation per
 *  member (the old O(M²) path) would show here as M² calls. A call count, never a wall time. */
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { parseRepoRef } from "../lib/remote.mjs";
import { discoverWorkspace } from "../lib/workspace.mjs";
import { capabilityProvides, memberRef } from "../lib/resolve.mjs";
import { findSoulEntry, soulSpawnability } from "../lib/instance-resolution.mjs";
import { driftOf, soulDriftOf } from "../lib/materialize.mjs";

function scaleRemote(M) {
  const host = "git:example.com/org/host";
  const refs = Array.from({ length: M }, (_, i) => `git:example.com/org/svc-${String(i).padStart(4, "0")}`);
  const key = (r) => parseRepoRef(r).key;
  const repos = {};
  refs.forEach((r, i) => {
    const files = { "oats-membership.yaml": { schemaVersion: 2, workspace: host } };
    const cap = `cap-${i}`;
    files[`capabilities/${cap}/oats.json`] = { capability: cap, version: "1.0.0", compatibility: { oats: ">=0.24.0" }, skills: ["skills"] };
    files[`capabilities/${cap}/skills/s-${i}/SKILL.md`] = "skill";
    if (i % 2 === 0) files[`capabilities/${cap}-b/oats.json`] = { capability: `${cap}-b`, version: "1.0.0", compatibility: { oats: ">=0.24.0" } };
    for (let s = 0; s < 3 + (i % 10 < 3 ? 1 : 0); s++) {
      const name = `svc-${i}-soul-${s}`;
      files[`souls/${name}/soul.yaml`] = { schemaVersion: 2, name, description: "d", work: "directory", capabilities: { [cap]: { from: key(r) } } };
    }
    repos[key(r)] = { commit: (`a${i.toString(16)}`).padEnd(40, "0"), files };
  });
  repos[key(host)] = { commit: "b".repeat(40), files: { "oats-workspace.yaml": { schemaVersion: 2, name: "org", members: refs } } };
  let calls = 0;
  const encode = (path, v) => Buffer.from(path.endsWith(".json") ? JSON.stringify(v) : typeof v === "string" ? v : YAML.stringify(v));
  const remote = {
    parseRepoRef(...a) { calls++; return parseRepoRef(...a); },
    async observeRemote(ref) { const k = parseRepoRef(ref).key; return { key: k, url: ref, commit: repos[k].commit, ref: "refs/heads/main", observedAt: "2026-09-29T00:00:00.000Z" }; },
    async readRemoteFile(ref, commit, path) {
      const tree = repos[parseRepoRef(ref).key].files;
      if (!Object.hasOwn(tree, path)) throw Object.assign(new Error(`${path} missing`), { code: "E_REMOTE_PATH_MISSING", details: { path } });
      const bytes = encode(path, tree[path]); return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      const out = [], seen = new Set();
      for (const path of Object.keys(repos[parseRepoRef(ref).key].files)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const parts = path.slice(dir.length + 1).split("/");
        if (parts.length <= depth) out.push({ path: parts.join("/"), type: "blob", size: 1 });
        for (let i = 1; i < Math.min(parts.length, depth + 1); i++) { const d = parts.slice(0, i).join("/"); if (!seen.has(d)) { seen.add(d); out.push({ path: d, type: "tree" }); } }
      }
      return out;
    },
  };
  return { host, remote, count: () => calls };
}

async function readPathCalls(M) {
  const { host, remote, count } = scaleRemote(M);
  const local = { schemaVersion: 2, workspace: host };
  const discovery = await discoverWorkspace(host, { local, remote });
  assert.equal(discovery.members.filter((m) => m.confirmed).length, M);
  findSoulEntry(discovery, "svc-1-soul-0");
  const souls = discovery.members.flatMap((m) => m.souls);
  for (const s of souls) assert.equal((await soulSpawnability(local, discovery, null, s, { remote })).spawnable, true);
  for (const c of discovery.members.flatMap((m) => m.capabilities)) await capabilityProvides({ ref: memberRef(discovery, remote, c.repoKey), commit: c.commit, dir: c.path, manifest: c.manifest, remote });
  for (const s of souls.slice(0, souls.length / 5)) {
    const instance = { agent: s.name, modules: { [`cap-x`]: { from: { kind: "member", repoKey: s.repoKey, commit: s.commit } } }, workspace: { soul: { repoKey: s.repoKey, commit: s.commit } } };
    driftOf(instance, discovery, {});
    soulDriftOf(instance, discovery);
  }
  return count();
}

test("parseRepoRef (and so validateWorkspace) is called O(members) times across discovery and the souls/capabilities/status assembly", { timeout: 120_000 }, async () => {
  const M = 400;
  const calls = await readPathCalls(M);
  // One validation of the workspace, the member key set, one key per member, one backlink per member,
  // one memberRef index: 5M + a constant. The quadratic path this pins was ~M²/… (1.4 million calls at 600).
  assert.ok(calls <= 6 * M, `${calls} parseRepoRef calls for ${M} members (bound ${6 * M})`);
  const half = await readPathCalls(M / 2);
  assert.ok(calls <= 2 * half + 10, `doubling the members at most doubles the calls (${half} → ${calls})`);
});
