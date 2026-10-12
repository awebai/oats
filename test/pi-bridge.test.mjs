// awebai/oats#991, #852: the pi folders of a deployment, the bridge found in each and the plan
// `oats update` runs (lib/pi-bridge.mjs). The module's functions alone, on a temporary tree; the
// CLI over them is test/pi-bridge-cli.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { PI_BRIDGE, launchConfigPiFolder, piBridgeFailure, piBridgeFolders, piBridgeSkewWarnings, piBridgeState, piBridgeStepProblem, piFolders, planPiBridges, piBridgePlanLines, whyLookedAt } from "../lib/pi-bridge.mjs";

const bases = [];
test.after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });
/** A temporary host: `home`, an environment with nothing but it, and `bridge(dir, version)`. */
function host() {
  const base = fixtureBase("oats-pib-");
  bases.push(base);
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  const bridgeFile = (dir) => join(dir, "npm", "node_modules", "@awebai", "oats-pi", "package.json");
  const bridge = (dir, version, text) => { mkdirSync(join(bridgeFile(dir), ".."), { recursive: true }); writeFileSync(bridgeFile(dir), text ?? JSON.stringify({ name: PI_BRIDGE, version })); return dir; };
  return { base, home, env: { HOME: home }, defaultDir: join(home, ".pi", "agent"), bridge, bridgeFile };
}
const pi = (name, env, more = {}) => ({ name, harness: "pi", args: [], env, ...more });
const configs = (...list) => Object.fromEntries(list.map((c) => [c.name, c]));

test("launchConfigPiFolder: a literal, a reference, a leading ~, and the two problems", () => {
  const base = { HOME: "/home/u", PI_ELSEWHERE: "/srv/pi", PI_TILDE: "~/pi-b" };
  assert.equal(launchConfigPiFolder({}, base), null, "the configuration leaves it to the host");
  assert.equal(launchConfigPiFolder({ OTHER: "/x" }, base), null);
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: "/srv/a b" }, base), { dir: "/srv/a b" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: { fromEnv: "PI_ELSEWHERE" } }, base), { dir: "/srv/pi" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: "~/pi-a" }, base), { dir: "/home/u/pi-a" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: "~" }, base), { dir: "/home/u" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: { fromEnv: "PI_TILDE" } }, base), { dir: "/home/u/pi-b" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: { fromEnv: "PI_UNSET" } }, base), { problem: "PI_CODING_AGENT_DIR references PI_UNSET, not set on this host", fromEnv: "PI_UNSET" });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: "rel/pi" }, base), { problem: 'PI_CODING_AGENT_DIR "rel/pi" is not an absolute path' });
  assert.deepEqual(launchConfigPiFolder({ PI_CODING_AGENT_DIR: "~other/pi" }, base), { problem: 'PI_CODING_AGENT_DIR "~other/pi" is not an absolute path' }, "only a bare ~ is the user's home");
});

test("piFolders: the default alone, when nothing else names a folder", () => {
  const h = host();
  const folders = piFolders({ env: h.env });
  assert.deepEqual(folders, [{ dir: h.defaultDir, real: h.defaultDir, reasons: [{ kind: "default" }] }]);
  assert.equal(whyLookedAt(folders[0]), "the default");
  assert.deepEqual(piFolders({ env: { ...h.env, PI_CODING_AGENT_DIR: "" } }), folders, "an empty variable is not set");
});

test("piFolders: the default, this shell's, then each pi launch configuration's in name order; other harnesses are not read", () => {
  const h = host();
  const folders = piFolders({ env: { ...h.env, PI_CODING_AGENT_DIR: join(h.base, "shell") }, launchConfigs: configs(
    pi("zeta", { PI_CODING_AGENT_DIR: join(h.base, "z") }),
    pi("alpha", { PI_CODING_AGENT_DIR: join(h.base, "a") }),
    pi("host-folder", { OTHER: "x" }),
    { name: "claude-one", harness: "claude", args: [], env: { PI_CODING_AGENT_DIR: join(h.base, "claude") } },
  ) });
  assert.deepEqual(folders.map((f) => [f.dir, whyLookedAt(f)]), [
    [h.defaultDir, "the default"],
    [join(h.base, "shell"), "this shell's PI_CODING_AGENT_DIR"],
    [join(h.base, "a"), "launch configuration alpha"],
    [join(h.base, "z"), "launch configuration zeta"],
  ]);
});

test("piFolders: one folder keeps every reason it is listed for: two configurations, a configuration naming the default, a symlink, this shell's", () => {
  const h = host();
  const shared = join(h.base, "shared");
  mkdirSync(shared);
  mkdirSync(h.defaultDir, { recursive: true });
  symlinkSync(shared, join(h.base, "link"));
  const folders = piFolders({ env: { ...h.env, PI_CODING_AGENT_DIR: shared }, launchConfigs: configs(
    pi("a", { PI_CODING_AGENT_DIR: shared }),
    pi("b", { PI_CODING_AGENT_DIR: join(h.base, "link") }),
    pi("c", { PI_CODING_AGENT_DIR: "~/.pi/agent" }),
    pi("d", { PI_CODING_AGENT_DIR: `${shared}/` }),
  ) });
  assert.deepEqual(folders.map((f) => [f.dir, whyLookedAt(f)]), [
    [h.defaultDir, "the default, launch configuration c"],
    [shared, "this shell's PI_CODING_AGENT_DIR, launch configurations a, b, d"],
  ]);
  assert.equal(folders[1].real, shared);
});

test("piFolders: a folder that does not exist yet is deduplicated by its resolved path", () => {
  const h = host();
  const folders = piFolders({ env: h.env, launchConfigs: configs(pi("a", { PI_CODING_AGENT_DIR: join(h.base, "new") }), pi("b", { PI_CODING_AGENT_DIR: join(h.base, "x", "..", "new") })) });
  assert.deepEqual(folders.slice(1).map((f) => [f.dir, whyLookedAt(f)]), [[join(h.base, "new"), "launch configurations a, b"]]);
});

test("piFolders: a folder that cannot be resolved is listed with its problem, never dropped or merged", () => {
  const h = host();
  const folders = piFolders({ env: { ...h.env, PI_CODING_AGENT_DIR: "relative/shell" }, launchConfigs: configs(
    pi("ci", { PI_CODING_AGENT_DIR: { fromEnv: "PI_CI_DIR" } }),
    pi("ci-two", { PI_CODING_AGENT_DIR: { fromEnv: "PI_CI_DIR" } }),
    pi("rel", { PI_CODING_AGENT_DIR: "rel/pi" }),
  ) });
  assert.deepEqual(folders.slice(1), [
    { dir: null, real: null, reasons: [{ kind: "shell" }], problem: 'PI_CODING_AGENT_DIR "relative/shell" is not an absolute path' },
    { dir: null, real: null, reasons: [{ kind: "launch-config", name: "ci" }], problem: "PI_CODING_AGENT_DIR references PI_CI_DIR, not set on this host", fromEnv: "PI_CI_DIR" },
    { dir: null, real: null, reasons: [{ kind: "launch-config", name: "ci-two" }], problem: "PI_CODING_AGENT_DIR references PI_CI_DIR, not set on this host", fromEnv: "PI_CI_DIR" },
    { dir: null, real: null, reasons: [{ kind: "launch-config", name: "rel" }], problem: 'PI_CODING_AGENT_DIR "rel/pi" is not an absolute path' },
  ]);
  // The reference resolves from the environment given, not from this process's.
  assert.equal(piFolders({ env: { ...h.env, PI_CI_DIR: "/srv/ci" }, launchConfigs: configs(pi("ci", { PI_CODING_AGENT_DIR: { fromEnv: "PI_CI_DIR" } })) })[1].dir, "/srv/ci");
});

test("piFolders: a configuration's executable is kept, a relative path resolved against the deployment as a launch does", () => {
  const h = host();
  const folders = piFolders({ env: h.env, launchConfigs: configs(
    pi("abs", { PI_CODING_AGENT_DIR: "/srv/1" }, { executable: "/opt/pi-box", source: "/dep" }),
    pi("bare", { PI_CODING_AGENT_DIR: "/srv/2" }, { executable: "pi-box", source: "/dep" }),
    pi("rel", { PI_CODING_AGENT_DIR: "/srv/3" }, { executable: "bin/pi-box", source: "/dep" }),
  ) });
  assert.deepEqual(folders.slice(1).map((f) => f.reasons[0].executable), ["/opt/pi-box", "pi-box", "/dep/bin/pi-box"]);
});

test("piBridgeState: no folder, no bridge, a version, and a package.json that cannot be read", () => {
  const h = host();
  const dir = join(h.base, "pi");
  assert.deepEqual(piBridgeState(dir), { status: "no-folder", file: h.bridgeFile(dir) });
  mkdirSync(dir);
  assert.deepEqual(piBridgeState(dir), { status: "no-bridge", file: h.bridgeFile(dir) });
  h.bridge(dir, "0.52.0");
  assert.deepEqual(piBridgeState(dir), { status: "installed", file: h.bridgeFile(dir), version: "0.52.0" });
  for (const [text, problem] of [["{ not json", "cannot be read as JSON"], ["null", "cannot be read as JSON"], ["{}", "names no version"], ['{"version":7}', "names no version"], ['{"version":""}', "names no version"]]) {
    h.bridge(dir, null, text);
    assert.deepEqual(piBridgeState(dir), { status: "unreadable", file: h.bridgeFile(dir), problem: `${h.bridgeFile(dir)} ${problem}` }, text);
  }
});

/** One folder of every kind, read from disk. */
function everyKind(h, env = h.env) {
  h.bridge(h.defaultDir, "0.52.0");
  const at = (name) => join(h.base, name);
  h.bridge(at("behind dir"), "0.51.0");
  h.bridge(at("current"), "0.53.0");
  h.bridge(at("boxed"), "0.52.0");
  h.bridge(at("mixed"), "0.52.0");
  h.bridge(at("broken"), null, "{ not json");
  mkdirSync(at("empty"));
  return piBridgeFolders({ env, launchConfigs: configs(
    pi("behind", { PI_CODING_AGENT_DIR: at("behind dir") }),
    pi("boxed", { PI_CODING_AGENT_DIR: at("boxed") }, { executable: "bin/pi box", source: "/dep" }),
    pi("boxed-too", { PI_CODING_AGENT_DIR: at("boxed") }, { executable: "/opt/other-box" }),
    pi("broken", { PI_CODING_AGENT_DIR: at("broken") }),
    pi("ci", { PI_CODING_AGENT_DIR: { fromEnv: "PI_CI_DIR" } }, { executable: "/opt/ci-box" }),
    pi("current", { PI_CODING_AGENT_DIR: at("current") }),
    pi("empty", { PI_CODING_AGENT_DIR: at("empty") }),
    pi("gone", { PI_CODING_AGENT_DIR: at("gone") }),
    pi("mixed-box", { PI_CODING_AGENT_DIR: at("mixed") }, { executable: "/opt/pi-box" }),
    pi("mixed-plain", { PI_CODING_AGENT_DIR: at("mixed") }),
    pi("rel", { PI_CODING_AGENT_DIR: "rel/pi" }),
  ) });
}

test("planPiBridges: move, leave, none and skip, each with its line, its command and its step", () => {
  const h = host();
  const at = (name) => join(h.base, name);
  const plan = planPiBridges(everyKind(h), "0.53.0", { env: h.env });
  const spec = "npm:@awebai/oats-pi@0.53.0";
  assert.deepEqual(plan.map((e) => [e.reasons.map((r) => r.name ?? r.kind).join("+"), e.action, e.detail, e.command ?? null, e.step?.display ?? null]), [
    ["default", "move", "bridge 0.52.0: move to 0.53.0", null, `npm_config_prefer_online=true pi install ${spec}`],
    ["behind", "move", "bridge 0.51.0: move to 0.53.0", null, `PI_CODING_AGENT_DIR='${at("behind dir")}' npm_config_prefer_online=true pi install ${spec}`],
    ["boxed+boxed-too", "skip", "bridge 0.52.0: not touched: launch configurations boxed, boxed-too run their own executable, and `oats update` runs no wrapper", `PI_CODING_AGENT_DIR=${at("boxed")} '/dep/bin/pi box' install ${spec}`, null],
    ["broken", "skip", `bridge not read: not touched: ${h.bridgeFile(at("broken"))} cannot be read as JSON`, `PI_CODING_AGENT_DIR=${at("broken")} pi install ${spec}`, null],
    ["ci", "skip", "not touched: PI_CODING_AGENT_DIR references PI_CI_DIR, not set on this host", `PI_CODING_AGENT_DIR="$PI_CI_DIR" /opt/ci-box install ${spec}`, null],
    ["current", "leave", "bridge 0.53.0: left alone, already at 0.53.0", null, null],
    ["empty", "none", "no bridge: not touched", null, null],
    ["gone", "none", "no bridge (the folder does not exist): not touched", null, null],
    ["mixed-box+mixed-plain", "move", "bridge 0.52.0: move to 0.53.0", null, `PI_CODING_AGENT_DIR=${at("mixed")} npm_config_prefer_online=true pi install ${spec}`],
    ["rel", "skip", 'not touched: PI_CODING_AGENT_DIR "rel/pi" is not an absolute path', null, null],
  ]);
  // The step is arguments and an environment, never a shell string: a folder with a space is one value.
  assert.deepEqual(plan[1].step, { argv: ["pi", "install", spec], env: { PI_CODING_AGENT_DIR: at("behind dir"), npm_config_prefer_online: "true" }, display: plan[1].step.display });
  assert.deepEqual(plan[0].step.env, { npm_config_prefer_online: "true" }, "the default folder, when nothing sets one: pi is left to find it");
  assert.equal(plan.find((e) => e.reasons[0].name === "ci").commandWhere, "where PI_CI_DIR is set");
});

test("planPiBridges: a single configuration with its own executable, in the singular", () => {
  const h = host();
  h.bridge(join(h.base, "boxed"), "0.52.0");
  const plan = planPiBridges(piBridgeFolders({ env: h.env, launchConfigs: configs(pi("boxed", { PI_CODING_AGENT_DIR: join(h.base, "boxed") }, { executable: "pi-box" })) }), "0.53.0", { env: h.env });
  assert.equal(plan[1].detail, "bridge 0.52.0: not touched: launch configuration boxed runs its own executable, and `oats update` runs no wrapper");
  assert.equal(plan[1].command, `PI_CODING_AGENT_DIR=${join(h.base, "boxed")} pi-box install npm:@awebai/oats-pi@0.53.0`);
});

test("planPiBridges: with this shell's PI_CODING_AGENT_DIR set, the default folder's step names the default folder", () => {
  const h = host();
  h.bridge(h.defaultDir, "0.52.0");
  const shell = h.bridge(join(h.base, "shell"), "0.52.0");
  const env = { ...h.env, PI_CODING_AGENT_DIR: shell };
  const plan = planPiBridges(piBridgeFolders({ env }), "0.53.0", { env });
  assert.deepEqual(plan.map((e) => e.step.env.PI_CODING_AGENT_DIR), [h.defaultDir, shell]);
  // The shell's variable naming the default folder itself: one folder, the variable kept as it is.
  const same = { ...h.env, PI_CODING_AGENT_DIR: h.defaultDir };
  assert.deepEqual(planPiBridges(piBridgeFolders({ env: same }), "0.53.0", { env: same }).map((e) => [whyLookedAt(e), e.step.env.PI_CODING_AGENT_DIR]), [["the default, this shell's PI_CODING_AGENT_DIR", h.defaultDir]]);
});

test("planPiBridges: a bridge ahead of the target is moved to it, as one behind is", () => {
  const h = host();
  h.bridge(h.defaultDir, "0.54.0");
  assert.equal(planPiBridges(piBridgeFolders({ env: h.env }), "0.53.0", { env: h.env })[0].detail, "bridge 0.54.0: move to 0.53.0");
});

test("piBridgePlanLines: the folder and why, what happens there, and the command where update does not run it", () => {
  const h = host();
  const at = (name) => join(h.base, name);
  const lines = piBridgePlanLines(planPiBridges(everyKind(h), "0.53.0", { env: h.env }));
  assert.deepEqual(lines.slice(0, 2), [`  ${h.defaultDir}  (the default)`, "    bridge 0.52.0: move to 0.53.0"]);
  const ci = lines.indexOf("  (not resolved)  (launch configuration ci)");
  assert.deepEqual(lines.slice(ci, ci + 3), ["  (not resolved)  (launch configuration ci)", "    not touched: PI_CODING_AGENT_DIR references PI_CI_DIR, not set on this host", '    run there, where PI_CI_DIR is set: PI_CODING_AGENT_DIR="$PI_CI_DIR" /opt/ci-box install npm:@awebai/oats-pi@0.53.0']);
  const boxed = lines.indexOf(`  ${at("boxed")}  (launch configurations boxed, boxed-too)`);
  assert.equal(lines[boxed + 2], `    run there: PI_CODING_AGENT_DIR=${at("boxed")} '/dep/bin/pi box' install npm:@awebai/oats-pi@0.53.0`);
  assert.equal(lines.length, 2 * 10 + 3, "two lines a folder, a third for each command");
});

test("piBridgeSkewWarnings: one per folder whose bridge is not the kernel's version or could not be looked at; none for a folder without a bridge", () => {
  const h = host();
  const at = (name) => join(h.base, name);
  assert.deepEqual(piBridgeSkewWarnings(everyKind(h), "0.53.0"), [
    `version skew — kernel 0.53.0, pi bridge 0.52.0 in ${h.defaultDir} (the default); run \`oats update\` (they publish in lockstep)`,
    `version skew — kernel 0.53.0, pi bridge 0.51.0 in ${at("behind dir")} (launch configuration behind); run \`oats update\` (they publish in lockstep)`,
    `version skew — kernel 0.53.0, pi bridge 0.52.0 in ${at("boxed")} (launch configurations boxed, boxed-too); run \`oats update\` (they publish in lockstep)`,
    `pi bridge not checked in ${at("broken")} (launch configuration broken) — ${h.bridgeFile(at("broken"))} cannot be read as JSON; \`oats update\` says what to run there`,
    "pi bridge not checked — launch configuration ci: PI_CODING_AGENT_DIR references PI_CI_DIR, not set on this host, so its pi folder could not be looked at; `oats update` says what to run there",
    `version skew — kernel 0.53.0, pi bridge 0.52.0 in ${at("mixed")} (launch configurations mixed-box, mixed-plain); run \`oats update\` (they publish in lockstep)`,
    'pi bridge not checked — launch configuration rel: PI_CODING_AGENT_DIR "rel/pi" is not an absolute path, so its pi folder could not be looked at; `oats update` says what to run there',
  ]);
  const quiet = host();
  assert.deepEqual(piBridgeSkewWarnings(piBridgeFolders({ env: quiet.env }), "0.53.0"), [], "no pi folder at all: nothing to say");
});

test("piBridgeStepProblem and piBridgeFailure: what the folder holds is read from it after the step", () => {
  const h = host();
  h.bridge(h.defaultDir, "0.52.0");
  const a = h.bridge(join(h.base, "a"), "0.52.0"), b = h.bridge(join(h.base, "b"), "0.52.0");
  const plan = planPiBridges(piBridgeFolders({ env: h.env, launchConfigs: configs(pi("a", { PI_CODING_AGENT_DIR: a }), pi("b", { PI_CODING_AGENT_DIR: b })) }), "0.53.0", { env: h.env });
  const entry = plan[1], display = entry.step.display;
  assert.equal(piBridgeStepProblem(entry, "0.53.0", "exit 1"), "exit 1");
  assert.equal(piBridgeStepProblem(entry, "0.53.0", null), "pi ended without an error, but the bridge there is not 0.53.0");
  const failure = (problem) => piBridgeFailure({ entry, display, problem, notReached: [plan[2]] });
  assert.equal(failure("exit 1"), [
    `step failed in ${a} (launch configuration a): exit 1`,
    "  the bridge there is still 0.52.0",
    `  run it again: ${display}`,
    "  not reached (run `oats update` again for it):",
    `    ${b}  (launch configuration b)`,
  ].join("\n"));
  h.bridge(a, "0.52.5");
  assert.match(failure("exit 1"), /\n {2}the bridge there is now 0\.52\.5\n/);
  h.bridge(a, null, "{");
  assert.match(failure("exit 1"), /\n {2}the bridge there cannot be read \(.*cannot be read as JSON\)\n/);
  rmSync(join(a, "npm"), { recursive: true });
  assert.match(failure("exit 1"), /\n {2}the bridge is now ABSENT there: a pi session started with this folder has no OATS extension until the step succeeds\n/);
  h.bridge(a, "0.53.0");
  assert.equal(piBridgeStepProblem(entry, "0.53.0", null), null);
  // The CLI's own step: no folder was reached.
  assert.equal(piBridgeFailure({ display: "npm install -g @awebai/oats@0.53.0", problem: "exit 1", notReached: [plan[0], plan[1]] }), [
    "step failed: npm install -g @awebai/oats@0.53.0: exit 1",
    "  no pi folder was touched",
    "  not reached (run `oats update` again for them):",
    `    ${h.defaultDir}  (the default)`,
    `    ${a}  (launch configuration a)`,
  ].join("\n"));
  assert.equal(piBridgeFailure({ entry: plan[2], display: "x", problem: "exit 1" }).split("\n").length, 3, "the last folder: nothing was left to reach");
});
