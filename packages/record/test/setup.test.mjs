// turn-record setup: the node it writes down, how each path is written for the
// reader it has, and what a run does with the files of an earlier one
// (awebai/oats#1003).
//
// SAFETY. setup.mjs writes the user's Claude settings, installs and starts a
// user service and runs a capture pass. No run in this file can reach the real
// ones:
//   - the script's environment is built from nothing, never inherited. HOME is
//     a directory of the fixture (os.homedir() reads HOME), TURN_RECORD_ROOT is
//     under it, and no session bus or runtime directory is passed;
//   - a preload intercepts manager calls with an isolated state model; PATH
//     contains only harmless stand-ins as a second guard. Everything else
//     the script starts, it starts by absolute path;
//   - run() refuses a HOME that is not inside the fixture.
// The platform is answered by a preload in the child (os.platform()), so both
// service templates are written by the script itself on one host.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readCaptureStatus } from "../lib/capture-status.mjs";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const OWNER = "fixture-owner";
const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-setup-")));
test.after(() => rmSync(base, { recursive: true, force: true }));

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
  return path;
}

// The service managers the script can reach: they append their name and
// arguments to calls.log beside them, and do nothing else.
const standins = join(base, "standins");
const calls = join(standins, "calls.log");
for (const name of ["systemctl", "launchctl"]) {
  write(join(standins, name), `#!/bin/sh\nprintf '%s\\n' "\${0##*/} $*" >> "\${0%/*}/calls.log"\n`, 0o755);
}
const managerCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);

const preload = write(
  join(base, "platform.mjs"),
  `import os from "node:os"; import cp from "node:child_process";
import { fakeCaptureManager } from ${JSON.stringify(new URL("./fixtures/capture-fake-manager.mjs", import.meta.url).href)};
import { syncBuiltinESMExports } from "node:module";
os.platform = () => process.env.FIXTURE_PLATFORM;
const spawnSync = cp.spawnSync;
cp.spawnSync = (command, args, options) => ["launchctl", "systemctl"].includes(command)
  ? fakeCaptureManager(process.env.HOME, command, args, ${JSON.stringify(calls)}) : spawnSync(command, args, options);
syncBuiltinESMExports();
`,
);

let n = 0;
/** A home of the fixture with one Claude settings file. */
function newHome(settings = {}, name = `home-${++n}`) {
  const home = join(base, name);
  write(join(home, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  return home;
}
const settingsPath = (home) => join(home, ".claude", "settings.json");
const readSettings = (home) => JSON.parse(readFileSync(settingsPath(home), "utf8"));
const unitPath = (home) => join(home, ".config", "systemd", "user", "turn-record-capture.service");
const plistPath = (home) => join(home, "Library", "LaunchAgents", "ai.aweb.turn-record-capture.plist");

/** Run setup as `turn-record setup`, from the package at `pkg`. `node` is what
 *  is handed in as OATS_NODE_BIN (undefined: the variable is absent). */
function run(home, args, { platform = "linux", node, pkg = PKG, managers = standins, status = 0 } = {}) {
  assert.ok(home.startsWith(base + "/"), `the script's HOME (${home}) is inside the fixture`);
  assert.ok(managers.startsWith(base + "/"), `the script's PATH (${managers}) is inside the fixture`);
  const env = { HOME: home, PATH: managers, TURN_RECORD_ROOT: join(home, "record"), FIXTURE_PLATFORM: platform };
  if (node !== undefined) env.OATS_NODE_BIN = node;
  const r = spawnSync(
    process.execPath,
    ["--import", preload, join(pkg, "bin", "turn-record.mjs"), "setup", "--owner", OWNER, ...args],
    { env, encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, status, r.stderr);
  return r;
}

const captureOf = (pkg = PKG) => join(pkg, "bin", "capture.mjs");
const serviceOf = (pkg = PKG) => join(pkg, "lib", "capture-service-runner.mjs");
const hookArgs = (home, pkg = PKG) => [captureOf(pkg), "--owner", OWNER, "--quiet", "--hook", "--root", join(home, "record")];
function serviceArgs(args, node, home, pkg = PKG) {
  assert.equal(args.length, 3); assert.equal(args[0], node); assert.equal(args[1], serviceOf(pkg));
  const request = JSON.parse(args[2]); assert.equal(request.owner, OWNER); assert.equal(request.root, join(home, "record"));
  assert.equal(request.plan.home, home); assert.deepEqual(request.plan.sources, ["cc", "pi", "codex", "aw"]);
}

/** A child's stderr without what Node itself prints there, so what is left is
 *  what the script said. Node 22 prints an ExperimentalWarning when the first
 *  capture pass loads node:sqlite, on the stderr the pass shares with setup;
 *  a later Node prints none. Only those lines and the hint Node adds to the
 *  first of them are taken out: anything else still fails an exact match. */
const ownStderr = (stderr) =>
  stderr
    .split("\n")
    .filter((line) => !/^\(node:\d+\) ExperimentalWarning: /.test(line) && line !== "(Use `node --trace-warnings ...` to show where the warning was created)")
    .join("\n");
assert.equal(ownStderr("(node:3849) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\n"), "");
assert.equal(ownStderr("setup: warning: the node path /x is not stable\n(node:1) Warning: something else\n"), "setup: warning: the node path /x is not stable\n(node:1) Warning: something else\n");
/** The capture commands of an event, in order. */
const commands = (home, event) => (readSettings(home).hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

/** A node that records the arguments it is started with, one a line, in `args.txt` beside it. */
function recordingNode(path) {
  return write(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "\${0%/*}/args.txt"\n`, 0o755);
}

// ---- the readers ----------------------------------------------------------

/** The hook's command as Claude Code runs it: by /bin/sh. `node` records its
 *  arguments, which is what the shell made of the rest of the command. */
function shellReads(command, node, home) {
  const out = join(dirname(node), "args.txt");
  rmSync(out, { force: true });
  // Bounded: were the command to start a real node, a watcher would never end.
  const r = spawnSync("/bin/sh", ["-c", command], { env: { HOME: home, PATH: standins }, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, `${command}: ${r.stderr}`);
  assert.ok(existsSync(out), `the shell did not start ${node} for: ${command}`);
  return readFileSync(out, "utf8").replace(/\n$/, "").split("\n");
}

const PLAIN = /^[A-Za-z0-9_./:@+,-]+$/;
/** An ExecStart line as systemd reads it, by the rules setup relies on
 *  (systemd.syntax(7) "Quoting", systemd.service(5) "Command lines"):
 *    1. items are split at whitespace outside quotes; a double-quoted item
 *       runs to the closing quote, with `\\` a backslash and `\"` a quote;
 *    2. in every item `%%` is a percent sign;
 *    3. in the arguments, and not in the executable (the first item), `$$` is a
 *       dollar sign, and `${VAR}` would be substituted.
 *  It reads only what is safe by those rules and throws on the rest: a bare
 *  item of other than plain characters, a lone `%`, a lone `$` in an argument. */
function systemdItems(line) {
  const items = [];
  for (let i = 0; i < line.length; ) {
    if (/\s/.test(line[i])) { i++; continue; }
    let item = "";
    if (line[i] === '"') {
      for (i++; line[i] !== '"'; i++) {
        if (i >= line.length) throw new Error(`open quote: ${line}`);
        if (line[i] === "\\") {
          if (line[i + 1] !== "\\" && line[i + 1] !== '"') throw new Error(`escape \\${line[i + 1]}: ${line}`);
          i++;
        }
        item += line[i];
      }
      i++;
      if (i < line.length && !/\s/.test(line[i])) throw new Error(`text after a closing quote: ${line}`);
    } else {
      while (i < line.length && !/\s/.test(line[i])) item += line[i++];
      if (!PLAIN.test(item)) throw new Error(`a bare item systemd would interpret: ${item}`);
    }
    items.push(item);
  }
  return items.map((item, index) => {
    if (/%/.test(item.replace(/%%/g, ""))) throw new Error(`a lone % (a specifier): ${item}`);
    const text = item.replace(/%%/g, "%");
    if (index === 0) return text;
    if (/\$/.test(text.replace(/\$\$/g, ""))) throw new Error(`a lone $ in an argument (a variable): ${item}`);
    return text.replace(/\$\$/g, "$");
  });
}
/** The line as systemd reads it and then starts it. It starts no executable
 *  whose path holds a quote or a backslash, however the path is written:
 *  "Executable path contains special characters", after the parsing (measured
 *  with systemd-analyze verify, systemd 261). An argument has no such rule. */
function systemdReads(line) {
  const items = systemdItems(line);
  if (/['"\\]/.test(items[0])) throw new Error(`an executable systemd refuses (a quote or a backslash): ${items[0]}`);
  return items;
}
const execStart = (home) => /^ExecStart=(.*)$/m.exec(readFileSync(unitPath(home), "utf8"))[1];

/** The <string> elements of the plist that follow `key`, as an XML parser
 *  reads their text: `&amp;`, `&lt;` and `&gt;` are the three characters; any
 *  other `&`, and any `<` inside the text, is not well-formed. */
function plistStrings(home, key) {
  const text = readFileSync(plistPath(home), "utf8");
  const after = text.slice(text.indexOf(`<key>${key}</key>`) + `<key>${key}</key>`.length);
  const section = /^\s*<array>([\s\S]*?)<\/array>|^\s*(<string>[^\n]*<\/string>)/.exec(after);
  return [...(section[1] ?? section[2]).matchAll(/<string>(.*?)<\/string>/g)].map(([, raw]) => {
    assert.doesNotMatch(raw.replace(/&(amp|lt|gt);/g, ""), /[&<>]/, `well-formed XML text: ${raw}`);
    return raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  });
}

// ---- the node --------------------------------------------------------------

test("the node handed in is the node written: both hooks, the systemd unit, the plist", () => {
  const node = recordingNode(join(base, "handed", "bin", "node"));
  const before = managerCalls().length;
  for (const platform of ["linux", "darwin"]) {
    const home = newHome();
    const r = run(home, [], { platform, node });
    assert.match(r.stdout, new RegExp(`^node:  ${node}$`, "m"));
    for (const event of ["Stop", "SessionEnd"]) {
      const [command, ...more] = commands(home, event);
      assert.deepEqual(more, [], `one capture hook for ${event}`);
      assert.deepEqual(shellReads(command, node, home), hookArgs(home));
      const hook = readSettings(home).hooks[event][0].hooks[0];
      assert.equal(hook.async, false); assert.equal(hook.timeout, 10);
    }
    if (platform === "linux") {
      serviceArgs(systemdReads(execStart(home)), node, home);
      assert.equal(existsSync(plistPath(home)), false);
    } else {
      serviceArgs(plistStrings(home, "ProgramArguments"), node, home);
      assert.equal(existsSync(unitPath(home)), false);
    }
  }
  // The stand-ins are what the script reached for a service manager.
  const uid = process.getuid();
  const changes = managerCalls().slice(before).filter(line => !/systemctl --user show |launchctl print/.test(line));
  assert.deepEqual(changes, ["systemctl --user daemon-reload", "systemctl --user enable --now turn-record-capture.timer",
    `launchctl bootstrap gui/${uid} ${plistPath(join(base, `home-${n}`))}`]);
});

test("the first capture pass runs under the node that runs setup, not under the one written down", () => {
  const node = recordingNode(join(base, "not-run", "node"));
  const home = newHome();
  const r = run(home, ["--no-service"], { node });
  assert.match(r.stdout, /running first capture pass/);
  assert.equal(existsSync(join(dirname(node), "args.txt")), false, "the written node was not started");
  assert.ok(existsSync(join(home, "record")), "the pass ran, under process.execPath");
  const status = readCaptureStatus(join(home, "record"));
  assert.equal(status.lastRun.trigger, "setup");
  assert.notEqual(status.lastRun.pid, r.pid, "the admitted worker, not setup, writes the receipt");
  assert.equal(status.lastRun.outcome, "complete");
});

test("with no variable, an empty one or a path that is not absolute, the node written is process.execPath", () => {
  for (const handed of [undefined, "", "node", "bin/node", "./node"]) {
    const home = newHome();
    const r = run(home, ["--no-service"], { node: handed });
    assert.match(r.stdout, new RegExp(`^node:  ${process.execPath}$`, "m"), JSON.stringify(handed));
    assert.equal(ownStderr(r.stderr), "", "and it says nothing of its own about it");
    assert.deepEqual(shellWordsOf(commands(home, "Stop")[0], home).slice(1), hookArgs(home));
    assert.equal(shellWordsOf(commands(home, "Stop")[0], home)[0], process.execPath, JSON.stringify(handed));
  }
});
/** The words the shell makes of a command, without running its first word. */
function shellWordsOf(command, home) {
  const r = spawnSync("/bin/sh", ["-c", `set -- ${command}; printf '%s\\n' "$@"`], { env: { HOME: home, PATH: standins }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\n$/, "").split("\n");
}

// ---- quoting ---------------------------------------------------------------

test("plain hook words stay bare and periodic manager argv keep their literal values", () => {
  assert.match(base, PLAIN, "this fixture's base is plain, or this test shows nothing");
  const node = join(base, "plain", "opt", "node@22", "bin", "node");
  const linux = newHome();
  run(linux, ["--dry-run"], { node });
  run(linux, [], { node });
  for (const event of ["Stop", "SessionEnd"]) {
    assert.deepEqual(commands(linux, event), [`${node} ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(linux, "record")}`]);
  }
  serviceArgs(systemdReads(execStart(linux)), node, linux);
  const darwin = newHome();
  run(darwin, [], { platform: "darwin", node });
  const plist = readFileSync(plistPath(darwin), "utf8");
  for (const path of [node, serviceOf(), join(darwin, "Library", "Logs", "turn-record-capture.log")]) {
    assert.ok(plist.includes(`<string>${path}</string>`), path);
  }
});

// A name with everything a reader could take for syntax: a space, both quotes,
// a specifier, a variable in both spellings, a doubled dollar, XML's three,
// a shell operator. And a backslash, where a path can hold one: node loads no
// module from a path with a backslash in it, so the install's has none.
const HOSTILE = `it's 100%h \${HOME} $HOME $$ a&b <c> "d";g`;
// The same without what systemd refuses in an executable (systemdReads).
const HOSTILE_EXECUTABLE = `100%h \${HOME} $HOME $$ a&b <c>;g`;

test("a path with a space, a quote, %, $ or & reaches each reader whole", () => {
  const nodes = {
    linux: recordingNode(join(base, `node ${HOSTILE_EXECUTABLE}`, "node")),
    darwin: recordingNode(join(base, `node ${HOSTILE} e\\f`, "node")),
  };
  const pkg = join(base, `install ${HOSTILE}`, "record");
  cpSync(join(PKG, "bin"), join(pkg, "bin"), { recursive: true });
  cpSync(join(PKG, "lib"), join(pkg, "lib"), { recursive: true });
  for (const platform of ["linux", "darwin"]) {
    const node = nodes[platform];
    const home = newHome({}, `home ${HOSTILE} e\\f ${platform}`);
    run(home, [], { platform, node, pkg });
    for (const event of ["Stop", "SessionEnd"]) {
      const found = commands(home, event);
      assert.equal(found.length, 1);
      assert.deepEqual(shellReads(found[0], node, home), hookArgs(home, pkg), event);
    }
    if (platform === "linux") {
      const line = execStart(home);
      serviceArgs(systemdReads(line), node, home, pkg);
      // The executable is not substituted and the arguments are (measured with
      // systemd-analyze verify: `$$` in the executable names another file), so
      // a dollar is doubled in the script's path and nowhere in the node's.
      const [executable, script] = line.match(/"(?:[^"\\]|\\.)*"/g);
      assert.equal(executable.split("$").length, node.split("$").length, "no dollar added to the executable");
      assert.equal(script.split("$").length - 1, 2 * (serviceOf(pkg).split("$").length - 1), "every dollar of an argument doubled");
    } else {
      serviceArgs(plistStrings(home, "ProgramArguments"), node, home, pkg);
      const log = join(home, "Library", "Logs", "turn-record-capture.log");
      assert.deepEqual(plistStrings(home, "StandardOutPath"), [log]);
      assert.deepEqual(plistStrings(home, "StandardErrorPath"), [log]);
    }
    // And a run over it finds its own hook: nothing is added.
    const before = readFileSync(settingsPath(home), "utf8");
    const again = run(home, [], { platform, node, pkg });
    assert.equal(readFileSync(settingsPath(home), "utf8"), before);
    assert.match(again.stdout, /hooks: .* already installed/);
    assert.match(again.stdout, /service: .* already installed/);
  }
});

test("an unrepresentable systemd executable refuses before any setup mutation", () => {
  const node = join(base, `it's "a" b\\c`, "node");
  const home = newHome();
  const before = readFileSync(settingsPath(home));
  const result = run(home, [], { node, status: 1 }); assert.match(result.stderr, /unrepresentable/);
  assert.equal(existsSync(unitPath(home)), false); assert.equal(existsSync(join(home, "record")), false);
  assert.deepEqual(readFileSync(settingsPath(home)), before);
});

test("where there is no service template, the line to run by hand is one a shell reads whole", () => {
  const node = recordingNode(join(base, `by hand ${HOSTILE}`, "node"));
  const home = newHome();
  const r = run(home, ["--no-hooks", "--dry-run"], { platform: "freebsd", node });
  const [, line] = /no service template for freebsd; run this in the background yourself:\n {2}(.*)\n/.exec(r.stdout);
  assert.deepEqual(shellReads(line, node, home), [captureOf(), "--watch", "--owner", OWNER, "--root", join(home, "record")]);
});

test("launchctl refusal is nonzero and names the failing action without claiming scheduling", () => {
  const home = newHome({}, `home ${HOSTILE} by hand`);
  write(join(home, ".manager-config.json"), JSON.stringify({ fail: "bootstrap" }));
  const r = run(home, ["--no-hooks"], { platform: "darwin", node: join(base, "handed", "bin", "node"), status: 1 });
  assert.match(r.stderr, /launchctl bootstrap .*fixture manager refusal.*exit 5.*re-run setup/);
  assert.doesNotMatch(r.stdout, /periodic capture scheduled|running first capture pass/);
});

// ---- a run over an earlier one's files -------------------------------------

const KEG = "/opt/homebrew/Cellar/node/22.1.0/bin/node";
const oldHook = (node = KEG, capture = captureOf()) => ({ type: "command", command: `${node} ${capture} --owner ${OWNER} --quiet`, async: true, timeout: 120 });
const oldSettings = () => ({ hooks: { Stop: [{ hooks: [oldHook()] }], SessionEnd: [{ hooks: [oldHook()] }] } });
const onlyFile = path => assert.deepEqual(readdirSync(dirname(path)).sort(), path.endsWith(".service")
  ? ["turn-record-capture.service", "turn-record-capture.timer"] : [path.split("/").pop()], "only the named periodic definitions");

test("over the old form (unquoted, the keg's path) a run replaces the hooks and the unit", () => {
  const node = join(base, "after upgrade", "node");
  for (const platform of ["linux", "darwin"]) {
    const home = newHome(oldSettings());
    const unit = platform === "linux" ? unitPath(home) : plistPath(home);
    // Actual supported legacy structure, including policy and direct argv.
    write(unit, platform === "linux"
      ? `[Unit]\nDescription=turn-record capture watcher\n\n[Service]\nExecStart=${KEG} ${captureOf()} --watch --owner ${OWNER}\nRestart=always\nRestartSec=60\n\n[Install]\nWantedBy=default.target\n`
      : `<plist version="1.0"><dict><key>Label</key><string>ai.aweb.turn-record-capture</string><key>ProgramArguments</key><array><string>${KEG}</string><string>${captureOf()}</string><string>--watch</string><string>--owner</string><string>${OWNER}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>${join(home, "Library/Logs/turn-record-capture.log")}</string><key>StandardErrorPath</key><string>${join(home, "Library/Logs/turn-record-capture.log")}</string></dict></plist>\n`);
    const r = run(home, [], { platform, node });
    assert.match(r.stdout, /hooks: installed/);
    for (const event of ["Stop", "SessionEnd"]) {
      assert.deepEqual(commands(home, event), [`'${node}' ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(home, "record")}`], event);
      assert.equal(readSettings(home).hooks[event].length, 1, "no group added");
    }
    assert.doesNotMatch(readFileSync(unit, "utf8"), /Cellar/);
    assert.ok(readFileSync(unit, "utf8").includes(node));
    onlyFile(unit);
  }
});

test("an old command with a character above U+007F bare in a path is replaced, and written quoted", () => {
  // Letters: composed, decomposed (a base letter and a combining mark),
  // another script, one outside the Basic Multilingual Plane. And what is no
  // letter and still no word's end for a shell: a Unicode space, a private-use
  // character, a format character, a C1 control.
  const olds = [
    "/home/zo\u00eb/.nvm/bin/node", "/home/zoe\u0308/.nvm/bin/node", "/home/\u5c71\u7530/bin/node", "/home/\u{20000}/bin/node",
    "/opt/old\u3000node/bin/node", "/opt/old\ue000node/bin/node", "/opt/old\u200bnode/bin/node", "/opt/old\u0085node/bin/node",
  ];
  const node = join(base, "zo\u00eb", "bin", "node");
  const current = `'${node}' ${captureOf()} --owner ${OWNER} --quiet --hook`;
  for (const old of olds) {
    const home = newHome({ hooks: { Stop: [{ hooks: [oldHook(old)] }], SessionEnd: [{ hooks: [oldHook(old, "/old/inst\u00e4ll/bin/capture.mjs")] }] } });
    run(home, ["--no-service"], { node });
    for (const event of ["Stop", "SessionEnd"]) {
      assert.deepEqual(commands(home, event), [`${current} --root ${join(home, "record")}`], `${event}, over ${old}`);
      assert.equal(readSettings(home).hooks[event].length, 1, "no group added");
    }
    // The quoted form it wrote is its own at the next run.
    const text = readFileSync(settingsPath(home), "utf8");
    run(home, ["--no-service"], { node });
    assert.equal(readFileSync(settingsPath(home), "utf8"), text);
  }
});

test("over the new form (quoted, a path with a space) a run replaces the hooks and the unit", () => {
  const first = join(base, "node one", "node");
  const second = join(base, "node two", "node");
  for (const platform of ["linux", "darwin"]) {
    const home = newHome();
    const unit = platform === "linux" ? unitPath(home) : plistPath(home);
    run(home, [], { platform, node: first });
    assert.ok(commands(home, "Stop")[0].startsWith(`'${first}' `), "the first run wrote the quoted form");
    run(home, [], { platform, node: second });
    for (const event of ["Stop", "SessionEnd"]) {
      assert.deepEqual(commands(home, event), [`'${second}' ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(home, "record")}`], event);
      assert.equal(readSettings(home).hooks[event].length, 1, "no group added");
    }
    assert.equal(readFileSync(unit, "utf8").includes(first), false);
    assert.ok(readFileSync(unit, "utf8").includes(second));
    onlyFile(unit);
  }
});

test("a command that is not provably setup's is left alone, and setup's own is added beside it", () => {
  const foreign = [
    // Lookalikes: the words are there, the shape is not.
    "echo unrelated",
    "node ~/tools/screenshot/capture.mjs --owner alice --outdir /tmp/shots",
    'echo "reminder: run capture.mjs --owner <name> --quiet later"',
    // Setup's shape on plain paths, and more that the shell would do with it:
    // rewriting the command would lose that.
    "/usr/bin/node /x/capture.mjs --owner a --quiet\n/bin/echo a second command", // a newline: two commands
    "/usr/bin/node /x/capture.mjs --owner a --quiet && say done",
    "/usr/bin/node /x/capture.mjs --owner a --quiet ; echo done",
    "/usr/bin/node /x/capture.mjs --owner a --quiet || true",
    "/usr/bin/node /x/capture.mjs --owner a --quiet | tee /tmp/log",
    "/usr/bin/node /x/capture.mjs --owner a --quiet &",
    "/usr/bin/node /x/capture.mjs --owner a --quiet > /dev/null",
    "/usr/bin/node /x/capture.mjs --owner a --quiet 2>&1",
    "/usr/bin/node /x/capture.mjs --owner a --quiet $EXTRA",
    "/usr/bin/node /x/capture.mjs --owner a --quiet `date`",
    "( /usr/bin/node /x/capture.mjs --owner a --quiet )",
    "/usr/bin/node /x/capture.mjs --owner a --quiet # for the record",
    "/home/zo\u00eb/bin/node /old/install/bin/capture.mjs --owner a --quiet && other", // beyond ASCII, and more
    // A named limit: setup's own old command with an ASCII character outside
    // the plain set bare in a path. Not read, so not replaced.
    "/opt/node~22=lts/bin/node /old/install/bin/capture.mjs --owner a --quiet",
    // The same with quoted paths:
    "'/usr/bin/node' '/x/capture.mjs' --owner a --quiet; echo done", // an operator
    "'/a b/tool' '/x/capture.mjs' --owner a --quiet $EXTRA", // an expansion
    `'/a b/node' "/x/capture.mjs" --owner a --quiet`, // a double quote
    "'/a b/node' '/x/capture.mjs' --owner a --quiet >/dev/null", // a redirection
    "'/a b/node' '/x/capture.mjs' --owner a --quiet\n/bin/echo a second command", // a newline: two commands
    "'/a b/node' '/x/capture.mjs' --owner a\r--quiet", // whitespace that is not a blank
    "'/a b/node' '/x/capture.mjs' --owner a --quiet 'and", // a quote left open
    // Read whole, and the shape is not there:
    "'/a b/node' '/x/capture.mjs --owner a --quiet'", // one word, not a script and two flags
    "'/a b/node' '/x/not-capture.mjs' --owner a --quiet",
    "'/a b/node' --owner a --quiet '/x/capture.mjs'", // the script is not the second word
  ];
  const settings = { existing: "stuff", hooks: { Stop: [{ hooks: [...foreign.map((command) => ({ type: "command", command })), { type: "prompt", prompt: `${KEG} /x/capture.mjs --owner a --quiet` }] }] } };
  const home = newHome(settings);
  const node = join(base, "handed", "bin", "node");
  run(home, ["--no-service"], { node });
  const after = readSettings(home);
  assert.equal(after.existing, "stuff");
  assert.deepEqual(after.hooks.Stop[0], settings.hooks.Stop[0], "every one of them kept as it was");
  assert.deepEqual(after.hooks.Stop.slice(1), [{ hooks: [{ type: "command", command: `${node} ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(home, "record")}`, async: false, timeout: 10 }] }]);
  assert.equal(after.hooks.SessionEnd.length, 1);
});

test("setup's hook twice in a file: both get the current command, neither is removed", () => {
  // An older stacking. The shape says "probably setup's", not "provably", so
  // nothing is deleted; two equal hooks cost at most a second capture pass.
  const settings = { hooks: { Stop: [{ hooks: [oldHook()] }, { matcher: "", hooks: [{ type: "command", command: "echo mine" }, oldHook("/usr/local/bin/node", "/old/install/bin/capture.mjs")] }] } };
  const home = newHome(settings);
  const node = join(base, "handed", "bin", "node");
  const current = `${node} ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(home, "record")}`;
  run(home, ["--no-service"], { node });
  const stop = readSettings(home).hooks.Stop;
  assert.deepEqual(stop.map((g) => g.hooks.map((h) => h.command)), [[current], ["echo mine", current]]);
  assert.equal(stop[1].matcher, "");
  assert.deepEqual(commands(home, "SessionEnd"), [current]);
});

test("matching owned hook commands still refresh scheduling fields, preserving groups and foreign fields", () => {
  const node = join(base, "handed", "bin", "node");
  const home = newHome();
  const command = `${node} ${captureOf()} --owner ${OWNER} --quiet --hook --root ${join(home, "record")}`;
  const owned = { type: "command", command, async: true, timeout: 120, description: "keep mine" };
  const foreign = { type: "command", command: "echo unrelated", async: true, timeout: 77, extra: "keep" };
  const settings = { existing: "unchanged", hooks: {
    Stop: [{ matcher: "kept", custom: 1, hooks: [owned, foreign] }],
    SessionEnd: [{ hooks: [{ ...owned, async: undefined, timeout: undefined }] }],
    OtherEvent: [{ hooks: [{ ...owned }] }],
  } };
  write(settingsPath(home), JSON.stringify(settings));
  const before = readFileSync(settingsPath(home), "utf8");
  run(home, ["--no-service", "--dry-run"], { node });
  assert.equal(readFileSync(settingsPath(home), "utf8"), before, "dry-run does not refresh persisted fields");
  run(home, ["--no-service"], { node });
  const after = readSettings(home), refreshed = { ...owned, async: false, timeout: 10 };
  assert.deepEqual(after, { existing: "unchanged", hooks: {
    Stop: [{ matcher: "kept", custom: 1, hooks: [refreshed, foreign] }],
    SessionEnd: [{ hooks: [refreshed] }], OtherEvent: settings.hooks.OtherEvent,
  } });
  const once = readFileSync(settingsPath(home), "utf8");
  const again = run(home, ["--no-service"], { node });
  assert.equal(readFileSync(settingsPath(home), "utf8"), once);
  assert.match(again.stdout, /hooks: .* already installed/);
});

test("--dry-run prints the node it would write, and writes and starts nothing", () => {
  const node = join(base, "dry run", "node");
  const before = managerCalls();
  for (const platform of ["linux", "darwin"]) {
    const home = newHome(oldSettings());
    const text = readFileSync(settingsPath(home), "utf8");
    const r = run(home, ["--dry-run"], { platform, node });
    assert.match(r.stdout, new RegExp(`^node:  ${node}$`, "m"));
    assert.match(r.stdout, /hooks: would install/);
    assert.match(r.stdout, /service: would install/);
    assert.match(r.stdout, /dry run: no first capture pass/);
    assert.equal(readFileSync(settingsPath(home), "utf8"), text);
    assert.deepEqual(readdirSync(home), [".claude"], "no unit, no record");
    assert.deepEqual(readdirSync(join(home, ".claude")), ["settings.json"]);
  }
  assert.deepEqual(managerCalls(), before, "no service manager was called");
});
