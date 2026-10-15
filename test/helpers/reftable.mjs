// Whether this host's Git can store a repository's refs in the reftable format (Git 2.45 and
// later), for the tests that walk a case in both formats and skip the reftable walk, by name and
// with this reason, where it cannot.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fixtureBase } from "./host-fixture.mjs";

/** Why this host's Git cannot turn a repository with a reflog to the reftable format (`git refs
 *  migrate`), else null. A walk in that format is skipped by name with it. */
export const NO_REFTABLE = (() => {
  const base = fixtureBase("oats-reftable-probe-");
  const run = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: base, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" } }).trim();
  try {
    run("init", "-q", join(base, "r"));
    run("-C", join(base, "r"), "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "one");
    run("-C", join(base, "r"), "refs", "migrate", "--ref-format=reftable");
    return run("-C", join(base, "r"), "rev-parse", "--show-ref-format") === "reftable" ? null : "this host's Git did not turn a repository to the reftable format";
  } catch (e) {
    let version = "unknown"; try { version = run("--version"); } catch { /* said as unknown */ }
    return `this host's Git (${version}) cannot turn a repository to the reftable format: ${String(e.stderr || e.message).trim().split("\n")[0]}`;
  } finally { rmSync(base, { recursive: true, force: true }); }
})();
/** The options of a test that walks `format`: skipped, with the reason, for reftable where the
 *  host's Git cannot make one. */
export const skipFor = (format) => (format === "reftable" && NO_REFTABLE ? { skip: NO_REFTABLE } : {});
