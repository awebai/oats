// CLI locator (packages/desktop/cli-locator.mjs) — Desktop CLI API v1
// discovery order, canonicalization, acceptance, and stable diagnostics.
import { requireRemoteSupport } from "../cli-locator.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { readFileSync } from "node:fs";
import {
  acceptProbe, parseSemver, parseProbeStdout, candidates, discover, DESKTOP_API,
  ACCEPT_RANGE, ACCEPT_RANGE_TEXT,
} from "../cli-locator.mjs";

const PROBE = (v = "0.25.8") => ({ schemaVersion: 1, name: "@awebai/oats", version: v, desktopApi: 1 });

test("acceptProbe: exact v1 payload accepted; every deviation rejected with a reason", () => {
  assert.equal(acceptProbe(PROBE()).ok, true);
  assert.equal(acceptProbe(PROBE("0.25.9")).ok, true);
  assert.equal(acceptProbe(PROBE("0.26.0")).ok, true, "the 0.26 kernel line is inside the band");
  assert.equal(acceptProbe(PROBE("0.26.12")).ok, true);
  const cases = [
    [null, /no probe/],
    [{ ...PROBE(), schemaVersion: 2 }, /schemaVersion/],
    [{ ...PROBE(), name: "@other/pkg" }, /not the oats CLI/],
    [{ ...PROBE(), desktopApi: 2 }, /desktopApi 2/],
    [{ ...PROBE(), desktopApi: undefined }, /desktopApi missing/],
    [PROBE("0.25.7"), /outside/],
    [PROBE("0.29.0"), /outside/],
    [PROBE("1.0.0"), /outside/],
    [PROBE("not-a-version"), /unparsable/],
  ];
  for (const [payload, re] of cases) {
    const r = acceptProbe(payload);
    assert.equal(r.ok, false, JSON.stringify(payload));
    assert.match(r.reason, re);
  }
});

test("acceptProbe: API version is authoritative — a 0.22.x CLI without desktopApi is rejected", () => {
  // Source adjacency / same version number is NOT enough: the probe field decides.
  const r = acceptProbe({ schemaVersion: 1, name: "@awebai/oats", version: "0.25.8" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /desktopApi/);
});

test("parseSemver handles pre-release/build suffixes and rejects garbage", () => {
  assert.deepEqual(parseSemver("0.18.0"), { nums: [0, 18, 0], prerelease: false });
  assert.deepEqual(parseSemver("0.18.1-rc.1"), { nums: [0, 18, 1], prerelease: true });
  assert.deepEqual(parseSemver("0.18.0+build.5"), { nums: [0, 18, 0], prerelease: false });
  assert.equal(parseSemver("v0.18.0"), null);
  assert.equal(parseSemver(""), null);
});

test("acceptProbe: prereleases are rejected — 0.26.0-rc.1 precedes 0.26.0 (review 53a20c7)", () => {
  for (const v of ["0.25.9-rc.1", "0.25.9-0", "0.25.10-beta.2", "0.26.0-rc.1", "0.26.0-0", "0.26.5-beta.2"]) {
    const r = acceptProbe(PROBE(v));
    assert.equal(r.ok, false, v);
    assert.match(r.reason, /prerelease/, v);
  }
  assert.equal(acceptProbe(PROBE("0.25.8+build.7")).ok, true, "build metadata does not affect precedence");
});

// Release-gate invariant. Desktop and the kernel ship from ONE tag, and the
// release workflow bumps packages/desktop to that tag version BEFORE running
// this suite — so an app whose band excludes its own version would be caught
// here instead of shipping an observation-only Desktop (the 0.19.0 blocker:
// the band still ended at 0.19.0 while the release published kernel 0.19.0).
test("the accepted band admits the kernel version this Desktop ships with", () => {
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const r = acceptProbe(PROBE(version));
  assert.equal(r.ok, true, `Desktop ${version} rejects the same-version oats CLI: ${r.reason} — widen ACCEPT_RANGE for this kernel minor`);
});

test("the human-readable band is derived from the enforced numbers", () => {
  assert.equal(ACCEPT_RANGE_TEXT, `>=${ACCEPT_RANGE.min.join(".")} <${ACCEPT_RANGE.maxExclusive.join(".")}`);
  assert.match(acceptProbe(PROBE("0.29.0")).reason, new RegExp(ACCEPT_RANGE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// F2b band contract, spelled with LITERALS on purpose. The tests above
// derive from ACCEPT_RANGE (so they follow any widening); these pin the exact
// edges this release promises, so a stray re-narrowing — or a widening past
// the v1 surface without a deliberate DESKTOP_API decision — fails here.
test("band edges: 0.25.8 through 0.28.x are accepted; 0.25.7 and 0.29.0 are not (the feature fences are the real gate)", () => {
  // Floor 0.25.8, not 0.26.0: main's kernel reports 0.25.8 until 0.26.0 is
  // tagged. packages-no-approval (workspace + deployment fences) decides.
  // Ceiling 0.29.0: 0.27 is the harness rename (feature `harness`); 0.28 adds package souls + triggers (additive).
  assert.deepEqual(ACCEPT_RANGE, { min: [0, 25, 8], maxExclusive: [0, 29, 0] });
  assert.equal(ACCEPT_RANGE_TEXT, ">=0.25.8 <0.29.0");
  assert.equal(DESKTOP_API, 1, "Desktop API stays v1 across the v0.25.0 kernel bump (workspace model)");
  // inside — including both edges of the newly admitted minor
  for (const v of ["0.25.8", "0.25.9", "0.25.99", "0.25.8+build.7", "0.26.0", "0.26.1", "0.26.99", "0.27.0", "0.27.99", "0.28.0", "0.28.99"]) {
    assert.equal(acceptProbe(PROBE(v)).ok, true, `${v} must be accepted`);
  }
  // outside — the exclusive ceiling and everything above it
  for (const v of ["0.22.0", "0.25.0", "0.25.7", "0.29.0", "0.29.1", "1.0.0"]) {
    const r = acceptProbe(PROBE(v));
    assert.equal(r.ok, false, `${v} must be rejected`);
    assert.match(r.reason, /outside >=0\.25\.8 <0\.29\.0/, v);
  }
  // a PRERELEASE of the new minor is still not a released kernel
  const pre = acceptProbe(PROBE("0.26.0-rc.1"));
  assert.equal(pre.ok, false);
  assert.match(pre.reason, /prerelease/);
});

test("0.24 version acceptance does not grant API2 or unadvertised execution capabilities", async () => {
  assert.equal(acceptProbe({ ...PROBE("0.25.8"), desktopApi: 2 }).ok, false);
  assert.equal(acceptProbe({ ...PROBE("0.25.8"), schemaVersion: 2 }).ok, false);
  const cli = await discover({ persisted: () => "/fixture/oats", env: { PATH: "" }, isExecutableFile: () => true },
    async () => ({ stdout: JSON.stringify(PROBE("0.25.8")) }));
  assert.equal(cli.ok, true); assert.equal(cli.version, "0.25.8");
  assert.throws(() => requireRemoteSupport(cli, "spawn"), { code: "unsupported-remote-operation" });
});

test("parseProbeStdout: only a single JSON object passes", () => {
  assert.deepEqual(parseProbeStdout(JSON.stringify(PROBE())), PROBE());
  assert.equal(parseProbeStdout("oats 0.18.0\n"), null);
  assert.equal(parseProbeStdout('{"a":1}\n{"b":2}'), null);
  assert.equal(parseProbeStdout('"just-a-string"'), null);
});

test("candidates: contract discovery order — persisted, env, PATH, npm-global, login-shell", async () => {
  const io = {
    persisted: () => "/chosen/oats",
    env: { OATS_DESKTOP_OATS_BIN: "/env/oats", PATH: ["/p1", "/p2"].join(delimiter) },
    npmGlobalBin: () => "/npmg/bin",
    loginShellWhich: () => "/login/oats",
  };
  assert.deepEqual(await candidates(io), [
    { path: "/chosen/oats", source: "persisted" },
    { path: "/env/oats", source: "env" },
    { path: "/p1/oats", source: "path" },
    { path: "/p2/oats", source: "path" },
    { path: "/npmg/bin/oats", source: "npm-global" },
    { path: "/login/oats", source: "login-shell" },
  ]);
});

test("candidates: relative and empty entries are dropped (absolute executables only)", async () => {
  const io = {
    persisted: () => "relative/oats",
    env: { OATS_DESKTOP_OATS_BIN: "", PATH: "" },
    npmGlobalBin: () => null,
    loginShellWhich: () => undefined,
  };
  assert.deepEqual(await candidates(io), []);
});

test("discover: expensive sources are LAZY and at-most-once — never invoked when an earlier candidate wins (review 53a20c7)", async () => {
  let npmCalls = 0, shellCalls = 0;
  const io = {
    persisted: () => "/chosen/oats",
    env: { PATH: "" },
    isExecutableFile: () => true,
    canonicalize: (p) => p,
    npmGlobalBin: () => { npmCalls++; return "/npmg/bin"; },
    loginShellWhich: () => { shellCalls++; return "/login/oats"; },
  };
  const r = await discover(io, async () => ({ stdout: JSON.stringify(PROBE()) }));
  assert.equal(r.ok, true);
  assert.equal(r.bin, "/chosen/oats");
  assert.equal(npmCalls, 0, "npm helper never runs when the persisted candidate wins");
  assert.equal(shellCalls, 0, "login-shell helper never runs when the persisted candidate wins");
  // full-failure sweep: each expensive source runs exactly once
  const io2 = {
    env: { PATH: "" },
    isExecutableFile: () => false,
    npmGlobalBin: () => { npmCalls++; return "/npmg/bin"; },
    loginShellWhich: () => { shellCalls++; return "/login/oats"; },
  };
  await discover(io2, async () => ({ stdout: "" }));
  assert.equal(npmCalls, 1, "npm helper invoked exactly once on a full sweep");
  assert.equal(shellCalls, 1, "login-shell helper invoked exactly once on a full sweep");
});

test("discover: a probe that REJECTS is never accepted, even with plausible stdout beforehand (review 53a20c7)", async () => {
  // The server's probeBin rejects on ANY execFile error (nonzero exit,
  // timeout) — discover must record the rejection, not accept the payload.
  const io = {
    persisted: () => "/liar/oats",
    env: { PATH: "" },
    isExecutableFile: () => true,
    canonicalize: (p) => p,
  };
  const probe = async () => { const e = new Error("exit 1 (printed probe then failed)"); throw e; };
  const r = await discover(io, probe);
  assert.equal(r.ok, false);
  assert.match(r.tried[0].reason, /probe failed/);
});

test("discover: first ACCEPTABLE candidate wins — earlier rejects are recorded diagnostics", async () => {
  const io = {
    persisted: () => "/old/oats",                       // probes as 0.20 → rejected
    env: { PATH: "/good" },                            // /good/oats → accepted
    isExecutableFile: () => true,
    canonicalize: (p) => p,
  };
  const probe = async (path) => ({
    stdout: JSON.stringify(path === "/old/oats" ? PROBE("0.21.0") : PROBE("0.25.9")),
  });
  const r = await discover(io, probe);
  assert.equal(r.ok, true);
  assert.equal(r.bin, "/good/oats");
  assert.equal(r.source, "path");
  assert.equal(r.version, "0.25.9");
});

test("discover: full failure returns per-candidate stable diagnostics", async () => {
  const io = {
    persisted: () => "/gone/oats",
    env: { OATS_DESKTOP_OATS_BIN: "/broken/oats", PATH: "/incompat" },
    isExecutableFile: (p) => p !== "/gone/oats",        // persisted: not executable
    canonicalize: (p) => p,
  };
  const probe = async (path) => {
    if (path === "/broken/oats") throw new Error("ENOENT spawn");
    return { stdout: JSON.stringify(PROBE("0.21.5")) }; // incompatible
  };
  const r = await discover(io, probe);
  assert.equal(r.ok, false);
  assert.equal(r.tried.length, 3);
  assert.match(r.tried[0].reason, /not an executable/);
  assert.match(r.tried[1].reason, /probe failed/);
  assert.match(r.tried[2].reason, /outside/);
  assert.equal(r.tried[2].version, "0.21.5", "rejected version surfaces for the degradation card");
});

test("discover: symlinked duplicates canonicalize and probe once", async () => {
  let probes = 0;
  const io = {
    persisted: () => "/usr/local/bin/oats",             // symlink → /real/oats
    env: { PATH: "/real" },
    isExecutableFile: () => true,
    canonicalize: () => "/real/oats",
  };
  const probe = async () => { probes++; return { stdout: JSON.stringify(PROBE()) }; };
  const r = await discover(io, probe);
  assert.equal(r.ok, true);
  assert.equal(r.bin, "/real/oats", "canonical absolute path is what the adapter execs");
  assert.equal(probes, 1, "identical realpath probed once");
});

test(`DESKTOP_API is ${1} (bump requires a contract revision)`, () => {
  assert.equal(DESKTOP_API, 1);
});

/* ── spawn-time relations capability gate (review f921f7d) ── */

test("supportsRelations: older accepted v1 CLIs are NOT relation-capable", async () => {
  const { supportsRelations, RELATIONS_MIN } = await import("../cli-locator.mjs");
  const min = RELATIONS_MIN.join(".");
  assert.equal(supportsRelations("0.18.0"), false, "pre-relations v1 release");
  assert.equal(supportsRelations("0.18.2"), false, "pre-relations v1 release");
  assert.equal(supportsRelations(min), true, "first relation-capable release");
  assert.equal(supportsRelations("0.18.9"), true);
  assert.equal(supportsRelations(`${min}-rc.1`), false, "prereleases never qualify");
  assert.equal(supportsRelations("garbage"), false);
  assert.equal(supportsRelations(undefined), false);
});

test("relationSupportError: related spawns fail closed on old v1 CLIs, plain spawns unaffected", async () => {
  const { relationSupportError, RELATIONS_MIN } = await import("../cli-locator.mjs");
  const oldCli = { ok: true, version: "0.18.0" };
  const newCli = { ok: true, version: RELATIONS_MIN.join(".") };
  // an older v1 CLI ignores unknown spawn options and reports success —
  // sending relation flags to it would silently create an UNRELATED instance
  const err = relationSupportError(oldCli, { relation: "child", relativeTo: "coord-1" });
  assert.ok(err instanceof Error, "related spawn on an old v1 CLI must throw, not degrade silently");
  assert.equal(err.code, "cli-no-relations", "stable code for the spawn form");
  assert.ok(relationSupportError(oldCli, { relativeTo: "coord-1" }), "anchor alone also gates");
  assert.equal(relationSupportError(oldCli, {}), null, "plain spawns keep working on the full v1 range");
  // explicit "unrelated" is the DEFAULT, not a related spawn: the adapter
  // normalizes it to absence and forwards no flags, so it must not be gated
  // on old v1 CLIs (review 9425d6a)
  assert.equal(relationSupportError(oldCli, { relation: "unrelated" }), null,
    "explicit unrelated is a plain spawn on any accepted v1 CLI");
  assert.equal(relationSupportError(oldCli, { relation: "" }), null, "empty relation is a plain spawn");
  assert.ok(relationSupportError(oldCli, { relation: "unrelated", relativeTo: "x" }),
    "a supplied anchor still gates even with relation=unrelated (adapter rejects the pair)");
  assert.equal(relationSupportError(newCli, { relation: "sibling", relativeTo: "x" }), null,
    "relation-capable CLI passes");
});

test("relations floor also covers --relative-root: the last pre-addition releases are NOT relation-capable (review cbd5bb3)", async () => {
  const { supportsRelations, relationSupportError, RELATIONS_MIN } = await import("../cli-locator.mjs");
  // 0.18.5 is the last released CLI predating BOTH the relation flags and
  // the --relative-root qualifier (it shipped from a branch WITHOUT the
  // feature); older v1 CLIs ignore unknown spawn options, so an accepted
  // pre-addition CLI would silently discard the qualifier and could link
  // the wrong same-named anchor.
  for (const v of ["0.18.3", "0.18.4", "0.18.5"]) {
    assert.equal(supportsRelations(v), false, `${v} predates the qualifier — must not receive relation flags`);
    const err = relationSupportError({ ok: true, version: v }, { relation: "child", relativeTo: "x" });
    assert.ok(err && err.code === "cli-no-relations", `${v} fails closed before any relation/qualifier flag is emitted`);
  }
  assert.equal(supportsRelations(RELATIONS_MIN.join(".")), true, "the floor release itself is capable");
});

test("requireRemoteSupport: fails closed on the probe's advertisement, never on inference", () => {
  const cli = { ok: true, bin: "/x/oats", version: "0.22.2", runtimes: ["pi", "claude", "codex"], remote: ["spawn", "retire", "status", "session"] };
  assert.doesNotThrow(() => requireRemoteSupport(cli, "spawn"));
  assert.throws(() => requireRemoteSupport({ ...cli, remote: undefined }, "spawn"), (e) => e.code === "unsupported-remote-operation" && /remote spawn/.test(e.message));
  assert.throws(() => requireRemoteSupport({ ...cli, remote: ["spawn"] }, "session"), /remote session/);
  assert.throws(() => requireRemoteSupport(undefined, "spawn"), /unsupported|does not (route|support)/);
  assert.throws(() => requireRemoteSupport({ ...cli, remote: "spawn" }, "spawn"), /remote spawn/, "a string is not an advertisement");
});

test("discovery retains remote routing capabilities for terminal preflight", async () => {
  const io = { persisted: () => "/bin/oats", env: {}, isExecutableFile: () => true };
  const cli = await discover(io, async () => ({ stdout: JSON.stringify({ ...PROBE(), scheduleApi: 2, remote: ["spawn", "session"] }) }));
  assert.deepEqual(cli.remote, ["spawn", "session"]);
  assert.equal(cli.scheduleApi, 2);
});
