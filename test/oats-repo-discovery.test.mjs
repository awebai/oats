// This repository as a workspace member: the kernel's member discovery
// (lib/workspace.mjs#discoverRepo), run over this checkout's tracked tree, lists
// only the repository's own capability. The package mirrors live under mirrors/
// and are offered by their packages; a copy under capabilities/ would be listed
// a second time, as a latest-state member capability of github.com/awebai/oats
// ("member and publisher never collapse", docs/workspaces.md).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { oatsError } from "../lib/errors.mjs";
import { parseRepoRef } from "../lib/remote.mjs";
import { discoverRepo } from "../lib/workspace.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The remote interface discovery reads (observeRemote, readRemoteFile, listRemoteTree)
 *  over this checkout's tracked files: the tree a commit of this branch would carry. */
function checkoutRemote() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const files = new Set(tracked);
  const commit = "0".repeat(40);
  return {
    parseRepoRef,
    async observeRemote(ref) {
      const { key, url } = parseRepoRef(ref);
      return { key, url, commit, ref: "refs/heads/main", observedAt: "2026-09-29T00:00:00.000Z" };
    },
    async readRemoteFile(ref, at, path) {
      if (!files.has(path)) throw oatsError("E_REMOTE_PATH_MISSING", `${path} is not tracked in this checkout`, { path });
      const bytes = readFileSync(join(ROOT, path));
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, at, dir, { depth = 2 } = {}) {
      const rows = new Map();
      for (const path of tracked) {
        if (!path.startsWith(`${dir}/`)) continue;
        const parts = path.slice(dir.length + 1).split("/");
        for (let i = 1; i <= Math.min(parts.length, depth); i++) {
          const rel = parts.slice(0, i).join("/");
          if (!rows.has(rel)) rows.set(rel, i === parts.length ? { path: rel, type: "blob" } : { path: rel, type: "tree" });
        }
      }
      return [...rows.values()].sort((a, b) => compare(a.path, b.path));
    },
  };
}

test("member discovery over this repository lists its two private member capabilities, oats.desktop-ui and oats.workspace-experts; every package mirror comes from its package", async () => {
  const d = await discoverRepo("git:github.com/awebai/oats", { remote: checkoutRemote() });
  assert.equal(d.key, "github.com/awebai/oats");
  assert.deepEqual(d.problems, []);
  assert.deepEqual(d.capabilities.map((c) => ({ name: c.name, path: c.path, private: c.private })),
    [{ name: "oats.desktop-ui", path: "capabilities/oats-desktop-ui", private: true },
     { name: "oats.workspace-experts", path: "capabilities/oats-workspace-experts", private: true }],
    "a package mirror under capabilities/ is discovered as a member capability of this repository");
  // What the repository publishes is reported, never enumerated as member capabilities.
  assert.equal(d.publishes?.package, "oats.framework");

  // Each mirrored capability is offered by a package this workspace declares, and by nothing else.
  const catalog = JSON.parse(readFileSync(join(ROOT, "package-catalog.json"), "utf8"));
  const declared = YAML.parse(readFileSync(join(ROOT, "oats-workspace.yaml"), "utf8")).packages;
  const mirrors = execFileSync("git", ["ls-files", "--", "mirrors/*/oats.json"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.equal(mirrors.length, 10, `the ten official package mirrors, saw ${mirrors.join(", ")}`);
  for (const file of mirrors) {
    const id = JSON.parse(readFileSync(join(ROOT, file), "utf8")).capability;
    const alias = catalog.capabilities[id];
    const pkg = typeof alias === "string" ? alias : catalog.packages[id] ? id : null;
    assert.ok(pkg && Object.hasOwn(declared, pkg), `${file}: ${id} is supplied by a package oats-workspace.yaml declares (catalog says ${pkg})`);
    assert.ok(!d.capabilities.some((c) => c.name === id), `${id} is not a member capability`);
  }
});
