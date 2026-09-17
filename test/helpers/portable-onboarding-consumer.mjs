/** Test-only exact-core consumer. No branch/worktree changes or network fetch.
 * Archive committed objects into owned ignored scratch; reuse local dependencies
 * only after the complete npm lock equals that at the pinned commit. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ONBOARDING_CORE_REVISION = "c5c6a3c9171e424a36a1bdbf3932b9319a3c6c72";
export const ONBOARDING_SPAWN_REVISION = "257c4b96b67001fa2bcf38436e57106c44aa797b";
const HELD_REVISION = "54b07ee";
const repository = fileURLToPath(new URL("../../", import.meta.url));

export async function pinnedOnboardingConsumer(t, { revision = ONBOARDING_CORE_REVISION } = {}) {
  assert.ok([ONBOARDING_CORE_REVISION, ONBOARDING_SPAWN_REVISION].includes(revision), "consumer requires an explicitly supported exact pin");
  const git = (...args) => execFileSync("git", args, { cwd: repository, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(git("rev-parse", `${revision}^{commit}`).toString().trim(), revision,
    "the exact core commit must exist locally; never substitute HEAD or a moving branch");
  git("rev-parse", `${HELD_REVISION}^{commit}`);
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", HELD_REVISION, revision], { cwd: repository, timeout: 30_000 });
  assert.equal(ancestry.status, 1, "held patch must not be part of the pinned consumer");
  assert.deepEqual(git("show", `${revision}:package-lock.json`), readFileSync(join(repository, "package-lock.json")),
    "pinned dependency lock must equal the locally installed worktree lock before sharing dependencies");
  const dependencies = realpathSync(join(repository, "node_modules"));
  const stage = join(repository, "stage"); mkdirSync(stage, { recursive: true });
  const root = realpathSync(mkdtempSync(join(stage, "onboarding-consumer-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const kernel = join(root, "kernel"), archive = join(root, "core.tar"); mkdirSync(kernel);
  git("archive", "--format=tar", `--output=${archive}`, revision,
    "lib", "bin", "skills", "injects", "packages/record", "package.json", "package-lock.json", "package-catalog.json");
  execFileSync("tar", ["-xf", archive, "-C", kernel], { timeout: 30_000 });
  symlinkSync(dependencies, join(kernel, "node_modules"), "dir");
  // This is the real public core export of the unchanged commit, not a copied
  // function, permissive mock, or working bytes from the lifecycle owner's tree.
  const core = await import(pathToFileURL(join(kernel, "lib/core.mjs")).href);
  t.diagnostic(`Public core consumer: ${revision}`);
  return { root, core, revision, cli: join(kernel, "bin/oats.mjs") };
}
