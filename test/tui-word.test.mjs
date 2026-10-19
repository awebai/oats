// The word `oats tui` (preview) in the CLI: what the kernel answers before the terminal client
// is loaded, and what it leaves to it. The client's own behaviour is in packages/tui/test and,
// on a real terminal, in test/tui-terminal.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { NO_TERMINAL, USAGE } from "../packages/tui/lib/main.mjs";
import { LEADER_AGAIN, MACHINES, NOT_YET, PALETTE_KEYS, VIEWS } from "../packages/tui/lib/views/help.mjs";
import { fixtureBase, fixtureEnv } from "./helpers/host-fixture.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
// Outside any instance home and deployment: the word reads neither.
const base = fixtureBase("oats-tui-word-");
test.after(() => rmSync(base, { recursive: true, force: true }));
const env = fixtureEnv(base);
for (const key of Object.keys(env)) if (/^OATS_/.test(key)) delete env[key];
/** `oats <args>` with no terminal: stdin from /dev/null, stdout and stderr pipes. */
const oats = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: base, env: { ...env, TERM: "xterm-256color" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });

test("oats tui --json is refused with E_BAD_ARGS in the usual envelope, wherever the flag stands", () => {
  for (const args of [["tui", "--json"], ["tui", "--ascii", "--json"], ["tui", "--json", "--ascii"]]) {
    const r = oats(...args);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout), { schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "oats tui is interactive and has no --json form; `oats status --json` is the machine view" } });
    assert.equal(r.stderr, "");
  }
});

test("oats tui --help answers as every kernel word does, in both modes, and shows the usage the client itself prints", () => {
  const text = oats("tui", "--help");
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^Usage:\n {2}oats tui \[--dir <path>\] \[--ascii\] +PREVIEW: /);
  assert.equal(text.stdout.includes(`  ${USAGE} `), true, "the usage line of bin/oats.mjs is the client's own");
  const json = oats("tui", "--help", "--json");
  assert.equal(json.status, 0);
  const answer = JSON.parse(json.stdout);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.command, "tui");
  assert.equal(answer.result.usage[0].startsWith(`  ${USAGE} `), true);
  assert.match(answer.result.usage.join("\n"), /preview/i);
  assert.match(oats("--help").stdout, /\n {2}oats tui \[--dir <path>\] \[--ascii\] +PREVIEW: /, "and the word is in the full usage, marked preview");
  assert.equal(USAGE, "oats tui [--dir <path>] [--ascii]");
});

test("oats tui with no terminal exits 1 with the one line on stderr and nothing on stdout", () => {
  const r = oats("tui");
  assert.equal(r.status, 1);
  assert.equal(r.stderr, `${NO_TERMINAL}\n`);
  assert.equal(r.stdout, "");
  assert.equal(oats("tui", "--ascii").stderr, `${NO_TERMINAL}\n`);
});

test("oats tui takes no other argument: --server and the rest are E_BAD_ARGS with the usage line, exit 1, nothing on stdout; --dir is taken, with its path", () => {
  for (const [args, shownAs] of [[["--server", "build-host"], "--server"], [["--max-age", "5"], "--max-age"], [["instances"], "instances"], [["--ascii=yes"], "--ascii=yes"]]) {
    const r = oats("tui", ...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.stderr, `oats: \`oats tui\` takes no argument ${shownAs} (E_BAD_ARGS); usage: ${USAGE}\n`);
    assert.equal(r.stdout, "");
  }
  for (const args of [["--dir"], ["--dir="], ["--ascii", "--dir"]]) {
    const r = oats("tui", ...args);
    assert.deepEqual([r.status, r.stderr, r.stdout], [1, `oats: \`oats tui --dir\` takes a path (E_BAD_ARGS); usage: ${USAGE}\n`, ""], args.join(" "));
  }
  // The kernel hands the word its arguments untouched: --dir reaches the client, which then stops
  // at the next thing it needs, a terminal.
  for (const args of [["--dir", base], [`--dir=${base}`], ["--dir", "/nowhere/at/all"]]) assert.equal(oats("tui", ...args).stderr, `${NO_TERMINAL}\n`, args.join(" "));
});

test("every command the help names for what this version does not do is one the kernel has: its word answers --help, and its usage holds the command", () => {
  const commands = [...NOT_YET.map((entry) => entry.command), ...VIEWS.flatMap((view) => view.commands)];
  assert.equal(commands.length >= 8, true, commands.join(" | "));
  // What this version leaves to the kernel about other machines and other deployments is among
  // them, so each of the four is held to the kernel's usage below. `oats server roster` is not: the
  // TUI reads the roster itself now.
  for (const command of ["oats server connect <id> --ssh <alias> --dir <path on that machine>", "oats server check <id>", "oats server remove <id>", "oats tui --dir <path>"]) assert.equal(commands.filter((each) => each === command).length, 1, command);
  assert.deepEqual(commands.filter((command) => /\broster\b/.test(command)), []);
  // The sentences about machines name no command, nor do the leader's last line and the palette's
  // keys: a command the help names is always in one of the two tables read here.
  const names = (sentence) => typeof sentence === "string" && !/\boats [a-z]/.test(sentence) && !sentence.includes("`");
  assert.equal(MACHINES.length >= 1 && MACHINES.every(names), true);
  assert.equal(names(LEADER_AGAIN) && PALETTE_KEYS.length >= 1 && PALETTE_KEYS.flat().every(names), true, [LEADER_AGAIN, ...PALETTE_KEYS.flat()].join(" | "));
  const usageOf = new Map();
  for (const command of commands) {
    // A <placeholder> may hold spaces (`<path on that machine>`): it is one part.
    const [program, word, ...rest] = command.match(/<[^>]*>|\S+/g);
    assert.equal(program, "oats", command);
    if (!usageOf.has(word)) {
      const answer = oats(word, "--help", "--json");
      assert.equal(answer.status, 0, `oats ${word} --help: ${answer.stderr}`);
      const parsed = JSON.parse(answer.stdout);
      assert.deepEqual([parsed.ok, parsed.result.command], [true, word], `${word} is a word of the kernel`);
      usageOf.set(word, parsed.result.usage.join("\n"));
    }
    // What is literal in the help's command (the words and the flags, not its <placeholders>)
    // stands in one entry of the kernel's usage, in that order: the line that names the command
    // and the lines that go on with its flags, up to the next line that names one. (The usage puts
    // `--dir <path>` of `oats server connect` on the entry's second line, optional before the
    // kernel requires it, awebai/oats#1390 step (b), and first there after.)
    const literal = rest.filter((part) => !part.startsWith("<"));
    const entries = [];
    let open = false;
    for (const row of usageOf.get(word).split("\n")) {
      if (/\boats [a-z]/.test(row)) { open = row.includes(`oats ${word}`); if (open) entries.push(row); }
      else if (open) entries[entries.length - 1] += `\n${row}`;
    }
    const line = entries.find((entry) => {
      let from = entry.indexOf(`oats ${word}`);
      for (const part of literal) { from = entry.indexOf(part, from); if (from < 0) return false; }
      return true;
    });
    assert.ok(line, `the kernel's usage of \`oats ${word}\` has no line with ${JSON.stringify(literal)}:\n${usageOf.get(word)}`);
  }
  // The three words of `oats server` were each found in a line of its usage, and the client's own
  // word in the usage the client prints: `--dir <path>` is the flag of both.
  assert.deepEqual([...usageOf.keys()].filter((word) => word === "server" || word === "tui").sort(), ["server", "tui"]);
  for (const part of ["connect <id> --ssh <alias>", "check <id>", "remove <id>"]) assert.equal(usageOf.get("server").includes(part), true, `oats server ${part}`);
  assert.equal(usageOf.get("tui").includes(`  ${USAGE} `) && USAGE.includes("--dir <path>"), true);
  // And the reading itself refuses a command that does not exist.
  assert.notEqual(oats("no-such-word", "--help", "--json").status, 0);
});

test("oats pane still refuses, and now names the terminal client beside the Desktop", () => {
  const r = oats("pane");
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "oats: `oats pane` has been retired — the OATS Desktop app (packages/desktop) is the control panel now; in a terminal, `oats tui` (preview).\n");
});

test("the word adds no feature string: nothing gates on it", () => {
  const probe = JSON.parse(oats("version", "--json").stdout);
  assert.deepEqual(probe.features.filter((feature) => /tui/.test(feature)), []);
});
