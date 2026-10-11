// The word `oats tui` (preview) in the CLI: what the kernel answers before the terminal client
// is loaded, and what it leaves to it. The client's own behaviour is in packages/tui/test and,
// on a real terminal, in test/tui-terminal.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { NO_TERMINAL, USAGE } from "../packages/tui/lib/main.mjs";
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
  assert.match(text.stdout, /^Usage:\n {2}oats tui \[--ascii\] +PREVIEW: /);
  assert.equal(text.stdout.includes(`  ${USAGE} `), true, "the usage line of bin/oats.mjs is the client's own");
  const json = oats("tui", "--help", "--json");
  assert.equal(json.status, 0);
  const answer = JSON.parse(json.stdout);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.command, "tui");
  assert.equal(answer.result.usage[0].startsWith(`  ${USAGE} `), true);
  assert.match(answer.result.usage.join("\n"), /preview/i);
  assert.match(oats("--help").stdout, /\n {2}oats tui \[--ascii\] +PREVIEW: /, "and the word is in the full usage, marked preview");
});

test("oats tui with no terminal exits 1 with the one line on stderr and nothing on stdout", () => {
  const r = oats("tui");
  assert.equal(r.status, 1);
  assert.equal(r.stderr, `${NO_TERMINAL}\n`);
  assert.equal(r.stdout, "");
  assert.equal(oats("tui", "--ascii").stderr, `${NO_TERMINAL}\n`);
});

test("oats tui takes no other argument: --dir and --server are E_BAD_ARGS with the usage line, exit 1, nothing on stdout", () => {
  for (const [args, shownAs] of [[["--dir", base], "--dir"], [["--server", "build-host"], "--server"], [["--max-age", "5"], "--max-age"], [["instances"], "instances"], [["--ascii=yes"], "--ascii=yes"]]) {
    const r = oats("tui", ...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.stderr, `oats: \`oats tui\` takes no argument ${shownAs} (E_BAD_ARGS); usage: ${USAGE}\n`);
    assert.equal(r.stdout, "");
  }
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
