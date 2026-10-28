// The host timer's unit files (lib/schedule-host.mjs): wall-clock firing, the PATH and node they
// carry, and what status says about an installed unit. Unit files live in a fixture `unitDir` and
// the OS is a stub `exec`: the real ai.oats.schedule-tick / oats-schedule-tick is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-host-")));
process.env.OATS_HOME_DIR = join(base, "oats-home");
delete process.env.OATS_INSTANCE_HOME;
const H = await import("../lib/schedule-host.mjs");
test.after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
const dir = (...parts) => { const d = join(base, ...parts); mkdirSync(d, { recursive: true }); return d; };
function executable(path) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "#!/bin/sh\nexit 0\n"); chmodSync(path, 0o755); return path; }
/** A Homebrew-shaped prefix: <prefix>/Cellar/node/<version>/bin/node, and opt/node -> that keg. */
function brew({ opt = true } = {}) {
  const prefix = dir(`brew-${++n}`);
  const node = executable(join(prefix, "Cellar", "node", "22.1.0", "bin", "node"));
  if (opt) { mkdirSync(join(prefix, "opt"), { recursive: true }); symlinkSync(join("..", "Cellar", "node", "22.1.0"), join(prefix, "opt", "node")); }
  return { prefix, node };
}
const loaded = (b, argv) => (argv[1] === "is-active" ? "active\n" : "");
const notLoaded = () => { throw Object.assign(new Error("not loaded"), { status: 113 }); };

test("the launchd unit fires at second 0 of every minute and never on an interval", () => {
  const plist = H.renderLaunchdPlist({ node: "/usr/local/bin/node", oatsBin: "/opt/oats/bin/oats.mjs", path: "/usr/bin:/bin" });
  assert.match(plist, /<key>StartCalendarInterval<\/key><dict\/>/);
  assert.doesNotMatch(plist, /StartInterval<\/key><integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key><false\/>/);
  // Standard, not Background: under load a Background job's node started up to ~90 s after launchd fired it (#902).
  assert.match(plist, /<key>ProcessType<\/key><string>Standard<\/string>/);
  assert.doesNotMatch(plist, /Background/);
  assert.match(plist, /<key>StandardOutPath<\/key>/); assert.match(plist, /<key>StandardErrorPath<\/key>/);
});

test("the systemd timer is a calendar timer at second 0, accurate to a second, never caught up", () => {
  const { timer } = H.renderSystemdUnits({ node: "/usr/bin/node", oatsBin: "/opt/oats/bin/oats.mjs", path: "/usr/bin:/bin" });
  assert.match(timer, /^OnCalendar=\*-\*-\* \*:\*:00$/m);
  assert.match(timer, /^AccuracySec=1s$/m);
  assert.match(timer, /^Persistent=false$/m);
  assert.doesNotMatch(timer, /OnBootSec|OnUnitActiveSec/);
  assert.doesNotMatch(timer, /every \d+s/, "a calendar timer has no interval to describe");
});

test("the unit PATH drops instance homes, Homebrew kegs, relative and empty entries, and keeps missing ones", () => {
  const instanceHome = "/w/agents/dev/instances/dev-1";
  const kept = H.unitPathEntries([
    "/w/agents/dev/instances/dev-2/.oats/bin", // another instance's .oats/bin
    `${instanceHome}/work/node_modules/.bin`, // under $OATS_INSTANCE_HOME
    instanceHome,
    "/usr/local/Cellar/node/17.7.2/bin", // a versioned keg
    "/opt/homebrew/Cellar/git/2.50.0/libexec",
    "relative/bin", "", ".",
    "/does/not/exist/bin", // missing today: may exist when the tick runs
    "/x/.oats/binaries", "/x/.oatsbin/bin", "/opt/homebrew/Cellar", // not hazards
    "/Users/u/.local/bin",
  ].join(":"), { instanceHome });
  assert.deepEqual(kept, ["/does/not/exist/bin", "/x/.oats/binaries", "/x/.oatsbin/bin", "/opt/homebrew/Cellar", "/Users/u/.local/bin"]);
  // Without an instance home, only the `.oats/bin` shape identifies one.
  assert.deepEqual(H.unitPathEntries(`${instanceHome}/work/bin:/a/.oats/bin`, { instanceHome: undefined }), [`${instanceHome}/work/bin`]);
});

test("neither unit names an instance path or a keg, given an installer PATH and node that hold both", () => {
  const { prefix, node } = brew();
  const envPath = ["/w/agents/dev/instances/dev-1/.oats/bin", join(prefix, "Cellar", "node", "22.1.0", "bin"), "/w/agents/dev/instances/dev-1/work/bin", "/Users/u/.local/bin", "/usr/bin"].join(":");
  const plan = H.hostUnitPlan({ execPath: node, envPath, instanceHome: "/w/agents/dev/instances/dev-1" });
  assert.equal(plan.node, join(prefix, "opt", "node", "bin", "node"));
  assert.deepEqual(plan.warnings, []);
  const plist = H.renderLaunchdPlist({ node: plan.node, path: plan.path, oatsBin: "/opt/oats/bin/oats.mjs" });
  const units = H.renderSystemdUnits({ node: plan.node, path: plan.path, oatsBin: "/opt/oats/bin/oats.mjs" });
  for (const text of [plist, units.service, units.timer]) {
    assert.doesNotMatch(text, /\/Cellar\//); assert.doesNotMatch(text, /\/instances\//); assert.doesNotMatch(text, /\.oats\/bin/);
  }
  assert.equal(plan.path.split(":")[0], join(prefix, "opt", "node", "bin"), "the stable node's dir comes first");
  assert.ok(plan.path.split(":").includes("/Users/u/.local/bin"), "the installer's tool dirs are kept");
});

test("stableNode: a keg's opt link, else the same node on PATH, else execPath with a warning", () => {
  const keg = brew();
  assert.deepEqual(H.stableNode({ execPath: keg.node, envPath: "/usr/bin" }), { node: join(keg.prefix, "opt", "node", "bin", "node") });
  // No opt link: the first node on the filtered PATH that is the same file.
  const noOpt = brew({ opt: false });
  const links = dir(`links-${++n}`), other = dir(`other-${++n}`);
  executable(join(other, "node")); // a different node earlier on PATH is not the one running
  symlinkSync(noOpt.node, join(links, "node"));
  assert.deepEqual(H.stableNode({ execPath: noOpt.node, envPath: `${other}:${join(noOpt.prefix, "Cellar", "node", "22.1.0", "bin")}:${links}` }), { node: join(links, "node") });
  // An opt link that resolves to another version is not this node.
  const moved = brew();
  rmSync(join(moved.prefix, "opt", "node")); symlinkSync(other, join(moved.prefix, "opt", "node"));
  const fallback = H.stableNode({ execPath: moved.node, envPath: other });
  assert.equal(fallback.node, moved.node, "nothing stable: execPath as it is");
  assert.match(fallback.warning, /not stable/); assert.ok(fallback.warning.includes(moved.node));
  // The fallback keeps the node's own dir first, so a job finds the same node; the warning says so.
  const plan = H.hostUnitPlan({ execPath: moved.node, envPath: other });
  assert.equal(plan.node, moved.node); assert.equal(plan.path.split(":")[0], join(moved.prefix, "Cellar", "node", "22.1.0", "bin"));
  assert.equal(plan.warnings.length, 1); assert.match(plan.warnings[0], /not stable/);
});

test("install answers the not-stable warning, and writes the unit into the fixture dir only", () => {
  const unitDir = dir(`unit-${++n}`);
  const moved = brew({ opt: false });
  const calls = [];
  const exec = (b, argv) => { calls.push([b, ...argv].join(" ")); if (argv[0] === "print") return notLoaded(); return ""; };
  const st = H.installHostUnit({ exec, os: "darwin", unitDir, execPath: moved.node, envPath: "/usr/bin" });
  assert.equal(st.warnings.length, 1); assert.match(st.warnings[0], /not stable/);
  const plist = readFileSync(H.hostUnitPaths("darwin", { unitDir }).plist, "utf8");
  assert.ok(plist.includes(`<string>${moved.node}</string>`));
  assert.ok(calls.some((c) => c.startsWith("launchctl bootstrap")), "bootstrap is the stub's");
  const lin = H.installHostUnit({ exec: () => "", os: "linux", unitDir, execPath: brew().node, envPath: "/usr/bin" });
  assert.deepEqual(lin.warnings, []);
});

/** Status of a crafted unit: `files` are written into a fresh unit dir. */
function statusOf(os, files, exec = loaded) {
  const unitDir = dir(`status-${++n}`);
  const p = H.hostUnitPaths(os, { unitDir });
  for (const [k, text] of Object.entries(files)) writeFileSync(p[k], text);
  return H.hostUnitStatus({ exec, os, unitDir });
}
const codes = (st) => st.problems.map((p) => p.code);

test("status reports a missing node, each missing PATH entry and an outdated unit, and nothing for a fresh one", () => {
  const tools = dir("tools"), more = dir("more-tools");
  const fresh = { node: process.execPath, oatsBin: executable(join(dir("oats", "bin"), "oats.mjs")), path: `${tools}:${more}:/usr/bin`, logDir: dir("log") };
  for (const os of ["darwin", "linux"]) {
    const render = (o) => os === "darwin" ? { plist: H.renderLaunchdPlist({ ...fresh, ...o }) } : H.renderSystemdUnits({ ...fresh, ...o });
    const ok = statusOf(os, render({}));
    assert.deepEqual(ok.problems, [], `${os}: a freshly rendered unit has no problems`);
    assert.equal(ok.installed, true); assert.equal(ok.active, true);
    const node = statusOf(os, render({ node: join(base, "gone", "node") }));
    assert.deepEqual(codes(node), ["node-missing"]); assert.ok(node.problems[0].message.includes(join(base, "gone", "node")));
    // A gone node's own directory, first on the unit PATH, is the same cause: one problem, not two.
    assert.deepEqual(codes(statusOf(os, render({ node: join(base, "gone-node-dir", "node"), path: `${join(base, "gone-node-dir")}:${tools}:/usr/bin` }))), ["node-missing"]);
    const oats = statusOf(os, render({ oatsBin: join(base, "gone", "oats.mjs") }));
    assert.deepEqual(codes(oats), ["oats-bin-missing"]); assert.ok(oats.problems[0].message.includes(join(base, "gone", "oats.mjs")));
    const path = statusOf(os, render({ path: `${tools}:${join(base, "gone-a")}:${join(base, "gone-b")}:/usr/bin` }));
    assert.deepEqual(codes(path), ["path-entry-missing", "path-entry-missing"]);
    assert.ok(path.problems[0].message.includes(join(base, "gone-a"))); assert.ok(path.problems[1].message.includes(join(base, "gone-b")));
    for (const p of [...node.problems, ...oats.problems, ...path.problems]) assert.ok(p.fix, `${p.code} names its fix`);
    // The fallback prefixes every unit carries are not this host's PATH: absent ones are not reported.
    assert.deepEqual(statusOf(os, render({ path: `${tools}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` })).problems, []);
    // A changed byte, and the interval units this kernel no longer renders.
    const changed = render({});
    if (os === "darwin") changed.plist = changed.plist.replace("<key>RunAtLoad</key><false/>", "<key>RunAtLoad</key><true/>");
    else changed.timer = changed.timer.replace("AccuracySec=1s", "AccuracySec=5");
    assert.deepEqual(codes(statusOf(os, changed)), ["unit-outdated"]);
    const legacy = render({});
    if (os === "darwin") legacy.plist = legacy.plist.replace("<key>StartCalendarInterval</key><dict/>", "<key>StartInterval</key><integer>60</integer>");
    else legacy.timer = legacy.timer.replace(/^OnCalendar=.*$/m, "OnBootSec=60\nOnUnitActiveSec=60");
    const old = statusOf(os, legacy);
    assert.deepEqual(codes(old), ["unit-outdated"]); assert.match(old.problems[0].fix, /oats schedule host install/);
    // Problems are warnings: they never change installed/active.
    assert.equal(old.installed, true); assert.equal(old.active, true);
    assert.deepEqual(codes(statusOf(os, os === "darwin" ? { plist: "<plist>not ours</plist>" } : { service: "[Service]\n", timer: "[Timer]\n" })), ["unit-outdated"]);
  }
  // No unit installed: nothing to report.
  assert.deepEqual(H.hostUnitStatus({ exec: notLoaded, os: "darwin", unitDir: dir("empty") }).problems, []);
  assert.deepEqual(H.hostUnitStatus({ os: "win32" }).problems, []);
});

test("status reads only the unit: callers with another PATH, OATS_HOME_DIR or oats get the same answer", () => {
  const tools = dir("caller-tools");
  // A unit installed from a shell with OATS_HOME_DIR, and one from a shell without it ("" renders none).
  for (const [os, oatsHomeDir] of [["darwin", join(base, "operator-oats")], ["linux", join(base, "operator-oats")], ["darwin", ""], ["linux", ""]]) {
    const unit = { node: process.execPath, oatsBin: executable(join(dir("elsewhere", "oats", "bin"), "oats.mjs")), path: `${tools}:/usr/bin`, oatsHomeDir, logDir: dir("operator-log") };
    const files = os === "darwin" ? { plist: H.renderLaunchdPlist(unit) } : H.renderSystemdUnits(unit);
    const unitDir = dir(`callers-${++n}`);
    const p = H.hostUnitPaths(os, { unitDir });
    for (const [k, text] of Object.entries(files)) writeFileSync(p[k], text);
    const saved = { PATH: process.env.PATH, OATS_HOME_DIR: process.env.OATS_HOME_DIR };
    const answers = [];
    try {
      for (const [path, home] of [["/usr/bin:/bin", join(base, "desktop-oats")], [`${dir("other-shell")}:/usr/bin`, join(base, "shell-oats")]]) {
        process.env.PATH = path; process.env.OATS_HOME_DIR = home;
        answers.push(H.hostUnitStatus({ exec: loaded, os, unitDir }).problems);
      }
    } finally { process.env.PATH = saved.PATH; process.env.OATS_HOME_DIR = saved.OATS_HOME_DIR; }
    assert.deepEqual(answers[0], [], `${os}, OATS_HOME_DIR ${JSON.stringify(oatsHomeDir)}: a fresh unit`); assert.deepEqual(answers[1], answers[0], `${os}: the caller's environment never enters status`);
  }
});

test("schedulerStatus carries the unit's problems as warnings, always as an array", async () => {
  const S = await import("../lib/schedule.mjs");
  const problem = { code: "node-missing", message: "the unit runs node at /gone/node, which does not exist", fix: "run `oats schedule host install`" };
  const st = S.schedulerStatus(undefined, { hostStatus: () => ({ installed: true, active: true, unit: "/u.plist", problems: [problem] }) });
  assert.deepEqual(st.problems, [problem]);
  assert.equal(st.installed, true); assert.equal(st.active, true);
  assert.deepEqual(S.schedulerStatus(undefined, { hostStatus: () => ({ installed: false, active: false }) }).problems, []);
  assert.deepEqual(S.schedulerStatus(undefined, { hostStatus: () => { throw new Error("launchctl is gone"); } }).problems, []);
  assert.deepEqual(S.schedulerStatus(undefined).problems, []);
});

test("install --print shows exactly what install would write and changes nothing", async () => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync, readdirSync } = await import("node:fs");
  const cli = join(import.meta.dirname, "..", "bin", "oats.mjs");
  const home = dir(`print-home-${++n}`), cwd = dir(`print-cwd-${++n}`), oatsHome = join(base, `print-oats-${++n}`);
  // launchctl and systemctl that record any call: --print makes none.
  const calls = join(base, `print-calls-${n}`), stubs = dir(`print-stubs-${n}`);
  for (const name of ["launchctl", "systemctl"]) { writeFileSync(join(stubs, name), `#!/bin/sh\necho "${name} $*" >> '${calls}'\n`); chmodSync(join(stubs, name), 0o755); }
  const env = { PATH: `${stubs}:${process.env.PATH}`, HOME: home, OATS_HOME_DIR: oatsHome, LANG: "C" };
  const saved = { OATS_HOME_DIR: process.env.OATS_HOME_DIR, HOME: process.env.HOME };
  for (const [os, unitDir] of [["darwin", join(home, "Library", "LaunchAgents")], ["linux", join(home, ".config", "systemd", "user")]]) {
    const json = JSON.parse(execFileSync(process.execPath, [cli, "schedule", "host", "install", "--print", "--os", os, "--json"], { cwd, env, encoding: "utf8" })).result;
    let expected;
    try { Object.assign(process.env, { OATS_HOME_DIR: oatsHome, HOME: home }); expected = H.hostUnitFiles({ os, unitDir, envPath: env.PATH, instanceHome: undefined }); }
    finally { Object.assign(process.env, saved); }
    assert.deepEqual(json, expected, `${os}: the files install would write, at its paths`);
    assert.equal(json.kind, os === "darwin" ? "launchd" : "systemd");
    assert.deepEqual(Object.keys(json.files).sort(), os === "darwin" ? [join(unitDir, "ai.oats.schedule-tick.plist")] : [join(unitDir, "oats-schedule-tick.service"), join(unitDir, "oats-schedule-tick.timer")]);
    assert.ok(Array.isArray(json.warnings));
    // Text: each file under its own delimiter line, byte for byte.
    const text = execFileSync(process.execPath, [cli, "schedule", "host", "install", "--print", "--os", os], { cwd, env, encoding: "utf8" });
    for (const [path, content] of Object.entries(json.files)) assert.ok(text.includes(`==> ${path} <==\n${content}`), `${os}: ${path} in the text output`);
  }
  // The CLI keeps its compile cache there (lib/compile-cache.mjs); nothing of the scheduler is written.
  assert.deepEqual(readdirSync(oatsHome), ["compile-cache"], "no registry and no log dir");
  assert.deepEqual(readdirSync(home), [], "no unit file");
  assert.equal(existsSync(calls), false, "no launchctl or systemctl call");
  // --os is --print's only, and names a supported OS.
  const refused = (args) => { try { execFileSync(process.execPath, [cli, "schedule", "host", "install", ...args, "--json"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return JSON.parse(String(e.stdout).trim()).error; } return null; };
  assert.equal(refused(["--print", "--os", "win32"])?.code, "E_BAD_ARGS");
  assert.equal(refused(["--os", "linux"])?.code, "E_BAD_ARGS");
  assert.equal(refused(["--print", "--max-concurrent", "2"])?.code, "E_BAD_ARGS", "--print writes no cap");
  assert.deepEqual(readdirSync(oatsHome), ["compile-cache"]); assert.equal(existsSync(calls), false);
});

test("install warns, without refusing, when the oats it would run lives under the instance home", () => {
  const instanceHome = dir(`instance-${++n}`);
  const inHome = executable(join(instanceHome, "work", "bin", "oats.mjs"));
  for (const os of ["darwin", "linux"]) {
    const files = H.hostUnitFiles({ os, unitDir: dir(`warn-${++n}`), execPath: process.execPath, envPath: "/usr/bin", instanceHome, oatsBin: inHome });
    const warning = files.warnings.find((w) => w.includes(inHome));
    assert.ok(warning, `${os}: the warning names ${inHome}`);
    assert.match(warning, /instance home/); assert.match(warning, /operator's installed oats/);
    assert.ok(Object.values(files.files).some((text) => text.includes(inHome)), `${os}: rendered all the same`);
    // Only the instance-home warning is this test's: whether this host's node is stable is not.
    const homeWarnings = (opts) => H.hostUnitFiles({ os, unitDir: dir(`warn-${++n}`), execPath: process.execPath, envPath: "/usr/bin", ...opts }).warnings.filter((w) => w.includes("instance home"));
    const elsewhere = executable(join(dir(`installed-oats-${++n}`), "bin", "oats.mjs"));
    assert.deepEqual(homeWarnings({ instanceHome, oatsBin: elsewhere }), []);
    assert.deepEqual(homeWarnings({ instanceHome: undefined, oatsBin: inHome }), [], "no instance home, nothing to compare");
    // An attached instance's work is a symlink into its owner's home: node resolves the oats it runs to the owner's path.
    const owner = dir(`owner-${++n}`), attached = dir(`attached-${++n}`);
    const ownerOats = executable(join(owner, "work", "bin", "oats.mjs"));
    symlinkSync(join(owner, "work"), join(attached, "work"));
    assert.equal(homeWarnings({ instanceHome: attached, oatsBin: ownerOats }).length, 1, `${os}: an attached home's work is its own too`);
  }
});
