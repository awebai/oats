// A tree object missing or unreadable in the remote cache is a listing failure, never an absent directory
// (awebai/oats#455). It was read as "souls/ is absent", so a member enumerated to zero souls with no
// problem, and that item was persisted in the parsed cache: every later command hid the member's souls
// (E_SOUL_UNKNOWN) until the cache file was moved aside.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createReadSession, listRemoteTree } from "../lib/remote.mjs";
import { discoverWorkspace } from "../lib/workspace.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const SOULS = { dev: {}, reviewer: {} };

/** The fixture with its remote cache built (one listing of souls/), then the souls/ tree object removed from
 *  the cache: its packs exploded into loose objects and that one object's file deleted. */
async function cacheMissingSoulsTree(t) {
  const fx = v2Deployment({ souls: SOULS });
  t.after(fx.cleanup);
  const commit = execFileSync("git", ["-C", fx.repo, "rev-parse", "main"], { encoding: "utf8" }).trim();
  const listed = await listRemoteTree(fx.ref, commit, "souls", { ...fx.remoteOptions, depth: 2 });
  assert.ok(listed.some((e) => e.path === "dev/soul.yaml"), "the souls list while the cache is whole");
  const cache = join(fx.remoteOptions.cacheDir, readdirSync(fx.remoteOptions.cacheDir).find((n) => !n.startsWith(".")));
  const packs = join(cache, "objects", "pack");
  for (const name of readdirSync(packs).filter((n) => n.endsWith(".pack"))) {
    const aside = join(fx.base, name);
    renameSync(join(packs, name), aside);
    for (const sib of readdirSync(packs).filter((n) => n.startsWith(name.slice(0, -5)))) rmSync(join(packs, sib));
    execFileSync("git", ["-C", cache, "unpack-objects", "-q"], { input: readFileSync(aside) });
  }
  for (const name of readdirSync(packs).filter((n) => n.startsWith("multi-pack-index"))) rmSync(join(packs, name));
  const tree = execFileSync("git", ["-C", cache, "rev-parse", `${commit}:souls`], { encoding: "utf8" }).trim();
  rmSync(join(cache, "objects", tree.slice(0, 2), tree.slice(2)));
  return { fx, commit };
}

test("a souls/ tree object missing from the cache is E_REMOTE_UNREADABLE, never an empty listing", async (t) => {
  const { fx, commit } = await cacheMissingSoulsTree(t);
  const e = await listRemoteTree(fx.ref, commit, "souls", { ...fx.remoteOptions, depth: 2 }).then((v) => ({ value: v }), (x) => x);
  assert.equal(e?.code, "E_REMOTE_UNREADABLE", `expected a refusal, got ${JSON.stringify(e?.value ?? e?.message)}`);
});

test("a directory that is really absent is still an empty listing", async (t) => {
  const fx = v2Deployment({ souls: SOULS });
  t.after(fx.cleanup);
  const commit = execFileSync("git", ["-C", fx.repo, "rev-parse", "main"], { encoding: "utf8" }).trim();
  assert.deepEqual(await listRemoteTree(fx.ref, commit, "no/such/dir", { ...fx.remoteOptions, depth: 2 }), []);
  assert.deepEqual(await listRemoteTree(fx.ref, commit, "oats-workspace.yaml/x", { ...fx.remoteOptions, depth: 2 }), [], "below a file");
});

test("discovery over a cache missing the souls/ tree reports a problem and persists no zero-soul enumerate item", async (t) => {
  const { fx, commit } = await cacheMissingSoulsTree(t);
  const session = createReadSession();
  let picture;
  try { picture = await discoverWorkspace(fx.ref, { remoteOptions: { ...fx.remoteOptions, session } }); }
  finally { await session.close(); }
  const member = picture.members.find((m) => m.commit === commit);
  assert.ok(member, JSON.stringify(picture.members));
  assert.ok(picture.problems.some((p) => p.code === "E_REMOTE_UNREADABLE" && p.path === "souls"), JSON.stringify(picture.problems));
  const parsed = join(fx.remoteOptions.cacheDir, ".parsed");
  const items = existsSync(parsed) ? readdirSync(parsed).flatMap((d) => readdirSync(join(parsed, d)).map((f) => JSON.parse(readFileSync(join(parsed, d, f), "utf8")))) : [];
  assert.ok(!items.some((i) => i.item === "enumerate" && i.commit === commit), "no enumerate item was persisted for that commit");
});
