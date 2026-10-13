// The command a launch answer suggests (awebai/oats#1049): `oats soul launch set|remove` is rendered by one
// function, lib/launch-preference.mjs soulLaunchCommand, and the `fix` of a launch refusal names that verb,
// never an edit of oats-local.yaml `souls.launch`. Which command a `fix` gives follows the layer that
// decided the launch (`from`): the soul's own entry, souls.launch."*" (the command for '*' first, then the
// soul's own pin), the soul's `launch:` or the host default; from a flag it names the flags. A `fix` is a
// sentence for a person: one line, within a reader's bound. Every way a `fix` names works for the command
// that was refused (awebai/oats#999): no pin where --harness decided, and under --reselect-launch the flags
// in its place.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import * as core from "../lib/core.mjs";
import * as shell from "../lib/shell-word.mjs";
import {
  LAUNCH_PROBLEM_TEXT_MAX, PANE_PATH_FIX, UNMATCHED_FIX, harnessFix, harnessNotOnPanePath, harnessUnavailable, launchConfigAmbiguous,
  launchConfigUnknown, launchConfigUnknownFix, launchKeyQuoted, launchKeysUnmatched, launchLayers, launchPreferenceUnmatched, selectionFrom,
  soulLaunchCommand, unmatchedKeyMessage,
} from "../lib/launch-preference.mjs";
import { REFUSED_TEXT } from "../lib/refused-text.mjs";
// The Desktop's released decoder is the consumer of a Launch report: a problem's texts must decode under it.
import { launchOf, REPORT_FROM } from "../packages/client/launch-contract.mjs";
import { previewFailure } from "../packages/client/spawn-preview-contract.mjs";

const LOCAL = "oats-local.yaml";
const SET = "oats soul launch set <soul> --launch-config <name> | --harness <h>";
const SET_CONFIG = "oats soul launch set <soul> --launch-config <name>";
const SET_DEFAULT = "oats soul launch set '*' --launch-config <name> | --harness <h>";
const SET_DEFAULT_CONFIG = "oats soul launch set '*' --launch-config <name>";
const ENTRY = { repoKey: "github.com/acme/agents", path: "souls/dev" };
/** The choice a new launch of `dev` makes with no flag (or `flags`), from this souls.launch and soul launch. */
const choiceOf = ({ launch = {}, soul = null, flags = {} } = {}) => {
  const layers = launchLayers({ definition: soul ? { launch: soul } : {}, entry: ENTRY, key: "dev", local: { souls: { launch } } });
  return selectionFrom({ flags, layers });
};
const count = (text, part) => text.split(part).length - 1;

test("one function renders the command: the placeholder, a key as it is, '*' quoted, and a word a shell would split", () => {
  // set: the soul is <soul> unless a key is given; a configuration or a harness, or a configuration only.
  assert.equal(soulLaunchCommand("set"), SET);
  assert.equal(soulLaunchCommand("set", { launch: "config" }), SET_CONFIG);
  assert.equal(soulLaunchCommand("set", { key: "dev" }), "oats soul launch set dev --launch-config <name> | --harness <h>");
  assert.equal(soulLaunchCommand("set", { key: "oats.engineering/code-reviewer", launch: "config" }), "oats soul launch set oats.engineering/code-reviewer --launch-config <name>");
  assert.equal(soulLaunchCommand("set", { key: "*" }), SET_DEFAULT);
  assert.equal(soulLaunchCommand("set", { key: "*", launch: "config" }), SET_DEFAULT_CONFIG);
  // remove: a key, or <key>.
  assert.equal(soulLaunchCommand("remove"), "oats soul launch remove <key>");
  assert.equal(soulLaunchCommand("remove", { key: "runer" }), "oats soul launch remove runer");
  assert.equal(soulLaunchCommand("remove", { key: "acme.okf/dev" }), "oats soul launch remove acme.okf/dev");
  assert.equal(soulLaunchCommand("remove", { key: "*" }), "oats soul launch remove '*'");
  // A key the schema would refuse still prints as one shell word.
  assert.equal(soulLaunchCommand("remove", { key: "two words" }), "oats soul launch remove 'two words'");
  assert.equal(soulLaunchCommand("remove", { key: "it's" }), "oats soul launch remove 'it'\\''s'");
  assert.equal(soulLaunchCommand("remove", { key: "~dev" }), "oats soul launch remove '~dev'");
  assert.equal(soulLaunchCommand("remove", { key: "$(id)" }), "oats soul launch remove '$(id)'");
  assert.equal(soulLaunchCommand("remove", { key: "" }), "oats soul launch remove ''");
  // One quoting rule: the kernel's, which lib/core.mjs re-exports and does not copy.
  assert.equal(core.shellWord, shell.shellWord);
  assert.equal(core.shq, shell.shq);
  for (const key of ["dev", "a/b", "*", "two words", "it's", "~x", "a:b", "a=b"]) assert.equal(soulLaunchCommand("remove", { key }), `oats soul launch remove ${core.shellWord(key)}`, key);
  // Every key the schema of oats-local.yaml admits, other than "*", prints as it is.
  const admitted = new RegExp(JSON.parse(readFileSync(new URL("../docs/oats-local.schema.json", import.meta.url), "utf8")).properties.souls.properties.launch.propertyNames.pattern);
  for (const key of ["dev", "code-reviewer", "a1", "oats.engineering/code-reviewer", "acme_x.y-z/dev-2", "0/0"]) {
    assert.ok(admitted.test(key), key);
    assert.equal(soulLaunchCommand("remove", { key }), `oats soul launch remove ${key}`);
    assert.equal(soulLaunchCommand("set", { key, launch: "config" }), `oats soul launch set ${key} --launch-config <name>`);
  }
  assert.ok(admitted.test("*"));
});

test("the answers about a key that names no soul print the command through that function, character for character", () => {
  const local = { souls: { launch: { "*": "fast", runer: "fast", "acme.okf/dev": { harness: "codex" } } } };
  const offered = { keys: ["dev", "runner"], unread: {} };
  const { unmatched } = launchKeysUnmatched({ local, offered });
  assert.deepEqual(unmatched.map((k) => k.key), ["acme.okf/dev", "runer"]);
  const layers = launchLayers({ definition: {}, entry: ENTRY, key: "dev", local, offered });
  const refusal = launchPreferenceUnmatched({ choice: selectionFrom({ layers }), layers });
  assert.ok(refusal.message.endsWith(`Pin the soul each was meant for (${SET}), then remove the key (oats soul launch remove acme.okf/dev); or name this launch (--launch-config <name> or --harness <h>).`), refusal.message);
  assert.equal(refusal.details.fix, UNMATCHED_FIX);
  assert.equal(UNMATCHED_FIX, "pin the soul each key was meant for (oats soul launch set), then remove the key (oats soul launch remove <key>); or name this launch with --launch-config <name> or --harness <h>");
  assert.ok(unmatchedKeyMessage(unmatched[1]).endsWith(`Pin the soul it was meant for (${SET}), then remove the key (oats soul launch remove runer)`));
  // A name too long to print leaves the placeholder, from the same function.
  const long = { ...unmatched[1], key: "x".repeat(2000) };
  assert.ok(unmatchedKeyMessage(long).endsWith(`then remove the key (${soulLaunchCommand("remove")})`));
});

test("a missing harness: the fix names the verb, by the layer that chose the harness", () => {
  assert.equal(harnessFix("codex", "flag"), "install codex, or choose another --harness / --launch-config", "from a flag, as before");
  assert.equal(harnessFix("codex", "local"), `install codex, or pin this soul to another launch (${SET})`);
  assert.equal(harnessFix("codex", "local-default"), `install codex, name another launch for every soul without an entry (${SET_DEFAULT}), or pin this soul to its own (${SET})`);
  assert.equal(harnessFix("codex", "soul"), `install codex, or pin this soul on this machine (${SET})`);
  assert.equal(harnessFix("codex", "host"), harnessFix("codex", "soul"));
  // The refusal carries it, in `details.fix` and at the end of its message; '*' only where "*" decided.
  for (const [given, from] of [[{ flags: { harness: "codex" } }, "flag"], [{ launch: { dev: { harness: "codex" } } }, "local"], [{ launch: { "*": { harness: "codex" } } }, "local-default"], [{ soul: { harness: "codex" } }, "soul"], [{}, "host"]]) {
    const choice = choiceOf(given);
    assert.equal(choice.from, from);
    const e = harnessUnavailable({ harness: "codex", from: choice.from, at: choice.at, why: "codex binary not found on PATH" });
    assert.equal(e.details.fix, harnessFix("codex", from));
    assert.ok(e.message.endsWith(` chose it — ${e.details.fix}`), e.message);
    assert.equal(count(e.message, "'*'"), from === "local-default" ? 1 : 0, from);
    assert.equal(count(e.details.fix, "<soul>"), from === "flag" ? 0 : 1, from);
  }
});

test("a configuration that is not declared, and several with no default: the fix names the verb, by layer", () => {
  // Unknown: only a souls.launch string names a configuration, so the layer is the soul's entry or "*".
  assert.equal(launchConfigUnknownFix("gone", "local"), `declare launch configuration gone (oats launch-config set), or pin the soul to another (${SET_CONFIG})`);
  assert.equal(launchConfigUnknownFix("gone", "local-default"), `declare launch configuration gone (oats launch-config set), name another for every soul without an entry (${SET_DEFAULT_CONFIG}), or pin the soul to one (${SET_CONFIG})`);
  // A Launch report builds its problem with it (lib/core.mjs launchReportFor).
  for (const [launch, from] of [[{ dev: "gone" }, "local"], [{ "*": "gone" }, "local-default"]]) {
    const layers = launchLayers({ definition: {}, entry: ENTRY, key: "dev", local: { souls: { launch } } });
    const report = core.launchReportFor({ layers, launchConfigs: {}, contextDir: "/nonexistent" });
    assert.deepEqual([report.from, report.problem.code, report.problem.fix], [from, "E_LAUNCH_CONFIG_UNKNOWN", launchConfigUnknownFix("gone", from)]);
    assert.equal(count(report.problem.fix, "'*'"), from === "local-default" ? 1 : 0);
    assert.notEqual(launchOf(report, REPORT_FROM), undefined, "the Desktop decodes it");
  }
  // Ambiguous: an inline or soul preference, --harness alone, or the host default chose a harness with two configurations.
  // The bare harness is asked for with its name: --launch-config none alone drops the harness a layer chose.
  const two = { personal: { harness: "claude" }, work: { harness: "claude" } };
  const flags = "name one with --launch-config <name>, ask for the bare harness with --launch-config none --harness claude";
  const reselectFlags = "without --reselect-launch, name one with --launch-config <name> or ask for the bare harness with --launch-config none --harness claude";
  const mark = "mark one default: true (oats launch-config set)";
  const FIX = {
    // A spawn, or any selection that does not reselect.
    false: {
      flag: `${flags}, or ${mark}`,
      layer: `${flags}, pin the soul to one (${SET_CONFIG}), or ${mark}`,
      "local-default": `${flags}, name one for every soul without an entry (${SET_DEFAULT_CONFIG}), pin the soul to one (${SET_CONFIG}), or ${mark}`,
    },
    // A start or restart with --reselect-launch, which refuses --launch-config beside it.
    true: {
      flag: `${reselectFlags}; or ${mark}, then reselect again`,
      layer: `${reselectFlags}; or pin the soul to one (${SET_CONFIG}) or ${mark}, then reselect again`,
      "local-default": `${reselectFlags}; or name one for every soul without an entry (${SET_DEFAULT_CONFIG}), pin the soul to one (${SET_CONFIG}), or ${mark}, then reselect again`,
    },
  };
  for (const reselect of [false, true]) for (const [given, from] of [[{ flags: { harness: "claude" } }, "flag"], [{ launch: { dev: { harness: "claude" } } }, "local"], [{ launch: { "*": { harness: "claude" } } }, "local-default"], [{ soul: { harness: "claude" } }, "soul"], [{}, "host"]]) {
    const choice = choiceOf(given);
    assert.equal(choice.from, from);
    const e = launchConfigAmbiguous({ launchConfigs: two, harness: "claude", config: null, choice, reselect });
    assert.equal(e.details.fix, FIX[reselect][from] ?? FIX[reselect].layer, `${from}, reselect ${reselect}`);
    assert.equal(e.message, `${LOCAL} declares 2 claude launch configurations (personal, work) and none is default: true, and this launch names none; ${e.details.fix}`);
    assert.deepEqual(Object.keys(e.details), ["harness", "configurations", "fix"]);
    // Where --harness decided, a pin of the soul changes nothing for that command line: none is named.
    assert.equal(e.details.fix.includes("oats soul launch"), from !== "flag", `${from}, reselect ${reselect}`);
    // What decides the sentence is what was selected, not the layer's name: the selection and the preference alone give the same.
    assert.equal(launchConfigAmbiguous({ launchConfigs: two, harness: "claude", config: null, choice: { selection: choice.selection, preference: choice.preference }, reselect }).details.fix, e.details.fix);
  }
  // The harness in the sentence is the refused one.
  const pi = launchConfigAmbiguous({ launchConfigs: { a: { harness: "pi" }, b: { harness: "pi" } }, harness: "pi", config: null, choice: choiceOf({ flags: { harness: "pi" } }) });
  assert.equal(pi.details.fix, FIX.false.flag.replace("--harness claude", "--harness pi"));
});

test("the ambiguous message stays within the bound where \"*\" decided: it names fewer configurations, never a cut one", () => {
  const worst = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`account-${String(i).padStart(5, "0")}-${"x".repeat(50)}`, { harness: "claude" }]));
  for (const n of [11, 25, 12345]) {
    const launchConfigs = worst(n), names = Object.keys(launchConfigs).sort();
    assert.ok(names.every((name) => name.length === 64), "names at the 64-character maximum");
    // Where the soul's own launch decided, the first ten, as before.
    const bySoul = launchConfigAmbiguous({ launchConfigs, harness: "claude", config: null, choice: choiceOf({ soul: { harness: "claude" } }) });
    assert.ok(bySoul.message.includes(`(${names.slice(0, 10).join(", ")}, and ${n - 10} more)`), bySoul.message);
    assert.ok(bySoul.message.length <= LAUNCH_PROBLEM_TEXT_MAX, `${bySoul.message.length} characters`);
    // The longest sentence: a reselection where "*" decided. Whole names, at least seven, the fix whole.
    const reselected = launchConfigAmbiguous({ launchConfigs, harness: "claude", config: null, choice: choiceOf({ launch: { "*": { harness: "claude" } } }), reselect: true });
    assert.ok(reselected.message.length <= LAUNCH_PROBLEM_TEXT_MAX && reselected.details.fix.length <= LAUNCH_PROBLEM_TEXT_MAX, `${reselected.message.length} characters`);
    const kept = names.filter((name) => reselected.message.includes(name));
    assert.ok(kept.length >= 7 && kept.length <= 10, `${kept.length} names`);
    assert.ok(reselected.message.includes(`(${kept.join(", ")}, and ${n - kept.length} more)`) && reselected.message.endsWith(reselected.details.fix), reselected.message);
    // Where "*" decided, the fix is longer: the message names as many whole names as fit.
    const byDefault = launchConfigAmbiguous({ launchConfigs, harness: "claude", config: null, choice: choiceOf({ launch: { "*": { harness: "claude" } } }) });
    assert.ok(byDefault.message.length <= LAUNCH_PROBLEM_TEXT_MAX, `${byDefault.message.length} characters`);
    const shown = names.filter((name) => byDefault.message.includes(name));
    assert.ok(shown.length >= 8 && shown.length <= 10, `${shown.length} names`);
    assert.deepEqual(shown, names.slice(0, shown.length));
    assert.ok(byDefault.message.includes(`(${shown.join(", ")}, and ${n - shown.length} more)`), byDefault.message);
    assert.ok(byDefault.message.endsWith(byDefault.details.fix));
    assert.deepEqual(byDefault.details.configurations, names, "details keep the full list");
  }
});

test("a missing harness whose layer has a long location: the message keeps its fix whole and stays within the bound", (t) => {
  // A PATH with no harness on it: the report below looks codex up on this process's PATH.
  const saved = process.env.PATH, empty = mkdtempSync(join(tmpdir(), "oats-fix-texts-"));
  process.env.PATH = empty;
  t.after(() => { process.env.PATH = saved; rmSync(empty, { recursive: true, force: true }); });
  // A soul's own launch in a repository whose key is long, and a soul's own entry under a long key: each
  // location is within what a client reads for `at`, and the message with it would not be.
  const deep = { repoKey: `/srv/${Array.from({ length: 8 }, () => "a".repeat(100)).join("/")}/repo`, path: "souls/dev" };
  const longKey = `${"k".repeat(900)}/dev`;
  for (const [given, from, named] of [
    [{ definition: { launch: { harness: "codex" } }, entry: deep, key: "dev", local: {} }, "soul", "the soul's own launch"],
    [{ definition: {}, entry: ENTRY, key: longKey, local: { souls: { launch: { [longKey]: { harness: "codex" } } } } }, "local", "the soul's own entry of souls.launch"],
  ]) {
    const report = core.launchReportFor({ layers: launchLayers(given), launchConfigs: {}, contextDir: empty });
    assert.deepEqual([report.from, report.problem.code, report.problem.fix], [from, "E_HARNESS_UNAVAILABLE", harnessFix("codex", from)]);
    assert.ok(report.at.length > 800 && report.at.length <= LAUNCH_PROBLEM_TEXT_MAX, `at is ${report.at.length} characters`);
    assert.equal(report.problem.message, `codex is not installed on this machine (codex binary not found on PATH); ${named} chose it — ${report.problem.fix}`);
    assert.ok(report.problem.message.length <= LAUNCH_PROBLEM_TEXT_MAX);
    assert.notEqual(launchOf(report, REPORT_FROM), undefined, "the Desktop decodes it");
    // The refusal a spawn throws is the same text, and its details keep the location.
    const e = harnessUnavailable({ harness: "codex", from, at: report.at, why: "codex binary not found on PATH" });
    assert.deepEqual([e.message, e.details.at], [report.problem.message, report.at]);
  }
  // A location that fits is named, as before.
  const short = harnessUnavailable({ harness: "codex", from: "soul", at: "github.com/acme/agents:souls/dev/soul.yaml#/launch", why: "codex binary not found on PATH" });
  assert.equal(short.message, `codex is not installed on this machine (codex binary not found on PATH); github.com/acme/agents:souls/dev/soul.yaml#/launch chose it — ${short.details.fix}`);
  // The longest location that fits is still named; one character more and the layer's name stands for it.
  for (const from of ["soul", "local", "local-default"]) {
    const room = LAUNCH_PROBLEM_TEXT_MAX - harnessUnavailable({ harness: "codex", from, at: "", why: "w" }).message.length;
    const fits = harnessUnavailable({ harness: "codex", from, at: "x".repeat(room), why: "w" });
    assert.ok(fits.message.length === LAUNCH_PROBLEM_TEXT_MAX && fits.message.includes("x".repeat(room)), from);
    const over = harnessUnavailable({ harness: "codex", from, at: "x".repeat(room + 1), why: "w" });
    assert.ok(over.message.length < LAUNCH_PROBLEM_TEXT_MAX && !over.message.includes("xx") && over.message.endsWith(` chose it — ${over.details.fix}`), from);
  }
  // A reason too long for the bound is cut, never the fix.
  for (const from of ["flag", "host", "soul", "local", "local-default"]) {
    const e = harnessUnavailable({ harness: "codex", from, at: "y".repeat(2000), why: "z".repeat(5000) });
    assert.equal(e.message.length, LAUNCH_PROBLEM_TEXT_MAX, from);
    assert.ok(e.message.startsWith("codex is not installed on this machine (zzz") && e.message.includes("z…); ") && e.message.endsWith(` chose it — ${harnessFix("codex", from)}`), from);
    assert.ok(!/[\n\r]/.test(e.message));
  }
});

/** Every `message` and `fix` a launch answer of lib/launch-preference.mjs can carry, by the layer that decided. */
function launchTexts() {
  const texts = [["UNMATCHED_FIX", UNMATCHED_FIX], ["PANE_PATH_FIX", PANE_PATH_FIX]];
  const add = (what, e) => { texts.push([`${what} message`, e.message]); if (e.details?.fix !== undefined) texts.push([`${what} fix`, e.details.fix]); };
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`account-${String(i).padStart(2, "0")}-${"x".repeat(53)}`, { harness: "claude" }]));
  const stale = { runer: "fast", "acme.okf/dev": "fast", "zz-gone": "fast", "zzz-gone": "fast" };
  const offered = { keys: ["dev", "runner"], unread: {} };
  for (const given of [{ flags: { harness: "claude" } }, { launch: { dev: { harness: "claude" } } }, { launch: { "*": { harness: "claude" } } }, { soul: { harness: "claude" } }, {}]) {
    const choice = choiceOf(given), from = choice.from;
    add(`harness unavailable (${from})`, harnessUnavailable({ harness: "claude", from, at: choice.at, why: "claude binary not found on PATH" }));
    add(`harness not on the pane's PATH (${from})`, harnessNotOnPanePath({ harness: "claude", from, at: choice.at, why: "the session's PATH has no claude" }));
    add(`unknown configuration (${from})`, launchConfigUnknown({ name: "gone", from, at: choice.at }));
    texts.push([`unknown configuration (${from}) fix`, launchConfigUnknownFix("gone", from)]);
    add(`ambiguous (${from})`, launchConfigAmbiguous({ launchConfigs: many, harness: "claude", config: null, choice }));
    add(`ambiguous under --reselect-launch (${from})`, launchConfigAmbiguous({ launchConfigs: many, harness: "claude", config: null, choice, reselect: true }));
    const layers = launchLayers({ definition: given.soul ? { launch: given.soul } : {}, entry: ENTRY, key: "dev", local: { souls: { launch: { ...stale, ...(given.launch ?? {}) } } }, offered });
    const refusal = launchPreferenceUnmatched({ choice, layers });
    if (refusal) add(`unmatched (${from})`, refusal);
  }
  for (const row of launchKeysUnmatched({ local: { souls: { launch: stale } }, offered }).unmatched) for (const lastRead of [false, true]) texts.push([`unmatched key ${row.key}${lastRead ? " (doctor)" : ""}`, unmatchedKeyMessage(row, { lastRead })]);
  return texts;
}
// The hand edit an answer must not suggest: changing souls.launch in the file. (Saying that the file's
// souls.launch names a key, or that the file declares no such configuration, describes; it does not suggest.)
const HAND_EDIT = /change oats-local\.yaml|in oats-local\.yaml souls\.launch|souls\.launch in oats-local\.yaml|override it on this machine in/;

test("no launch answer suggests an edit of souls.launch in the file; each text is one line within the bound", () => {
  const texts = launchTexts();
  assert.ok(texts.length > 40, `${texts.length} texts`);
  for (const [what, text] of texts) {
    assert.equal(typeof text, "string", what);
    assert.ok(!HAND_EDIT.test(text), `${what}: ${text}`);
    assert.ok(!/[\n\r]/.test(text), `${what} is one line`);
    assert.ok(text.length > 0 && text.length <= LAUNCH_PROBLEM_TEXT_MAX, `${what}: ${text.length} characters`);
  }
  // Every text that names the verb to set a pin names it as the function renders it.
  for (const [what, text] of texts) for (const at of [...text.matchAll(/oats soul launch set (?!\))/g)]) {
    const rest = text.slice(at.index);
    assert.ok([SET, SET_CONFIG, SET_DEFAULT, SET_DEFAULT_CONFIG].some((command) => rest.startsWith(command)), `${what}: ${rest}`);
  }
  // And no source of a launch answer holds the old wording (the texts above are built by these two files).
  for (const file of ["../lib/launch-preference.mjs", "../lib/core.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("${LOCAL_FILE}", LOCAL);
    assert.ok(!HAND_EDIT.test(source), file);
  }
});

test("through the CLI: a spawn's refusal and the soul's row carry the same fix, for each layer", (t) => {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, writer: { soul: { launch: { harness: "codex" } } } }, local: { "launch-configs": { fast: { harness: "pi" } }, souls: { launch: { dev: { harness: "codex" } } } } });
  t.after(fx.cleanup);
  // A PATH where codex does not exist: the stubs without codex, plus node and git alone.
  const stubs = join(fx.base, "runtime-stub");
  rmSync(join(stubs, "codex"));
  const minimal = join(fx.base, "node-only"); mkdirSync(minimal);
  symlinkSync(process.execPath, join(minimal, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(minimal, "git"));
  const env = { PATH: `${stubs}:${minimal}` };
  const setLaunch = (launch) => { const p = join(fx.dep, LOCAL); const v = YAML.parse(readFileSync(p, "utf8")); v.souls = { launch }; writeFileSync(p, YAML.stringify(v, { lineWidth: 0 })); };
  const preview = (soul) => { const j = fx.cli(["spawn", soul, "--preview", "--json"], { env }).json(); assert.equal(j.ok, false, JSON.stringify(j)); return j.error; };
  const row = (soul) => { const r = fx.cli(["souls", "--json"], { env }); assert.equal(r.status, 0, `${r.stdout}${r.stderr}`); return r.json().result.souls.find((s) => s.name === soul).launch; };
  const same = (soul, code, from, fix) => {
    const launch = row(soul);
    assert.deepEqual([launch.from, launch.problem.code, launch.problem.fix], [from, code, fix], `${soul} row`);
    assert.notEqual(launchOf(launch, REPORT_FROM), undefined, "the Desktop decodes it");
    const error = preview(soul);
    assert.deepEqual([error.code, error.details.from], [code, from], `${soul} preview`);
    return { launch, error };
  };
  // The soul's own entry, and another soul's own launch.
  let r = same("dev", "E_HARNESS_UNAVAILABLE", "local", `install codex, or pin this soul to another launch (${SET})`);
  assert.equal(r.error.details.fix, r.launch.problem.fix);
  assert.equal(r.error.message, r.launch.problem.message);
  assert.ok(r.error.message.endsWith(`${LOCAL}#/souls/launch/dev chose it — install codex, or pin this soul to another launch (${SET})`), r.error.message);
  r = same("writer", "E_HARNESS_UNAVAILABLE", "soul", `install codex, or pin this soul on this machine (${SET})`);
  assert.equal(r.error.details.fix, r.launch.problem.fix);
  // souls.launch."*".
  setLaunch({ "*": { harness: "codex" } });
  r = same("dev", "E_HARNESS_UNAVAILABLE", "local-default", `install codex, name another launch for every soul without an entry (${SET_DEFAULT}), or pin this soul to its own (${SET})`);
  assert.equal(r.error.details.fix, r.launch.problem.fix);
  assert.ok(r.error.message.includes(`${LOCAL}#/souls/launch/* chose it — install codex, name another launch`), r.error.message);
  // A configuration that is not declared: the refusal has no `fix` in its details; the report's problem has one.
  setLaunch({ dev: "gone" });
  r = same("dev", "E_LAUNCH_CONFIG_UNKNOWN", "local", `declare launch configuration gone (oats launch-config set), or pin the soul to another (${SET_CONFIG})`);
  assert.deepEqual(r.error.details, { name: "gone", from: "local", at: `${LOCAL}#/souls/launch/dev` });
  setLaunch({ "*": "gone" });
  r = same("dev", "E_LAUNCH_CONFIG_UNKNOWN", "local-default", `declare launch configuration gone (oats launch-config set), name another for every soul without an entry (${SET_DEFAULT_CONFIG}), or pin the soul to one (${SET_CONFIG})`);
  assert.deepEqual(r.error.details, { name: "gone", from: "local-default", at: `${LOCAL}#/souls/launch/*` });
});

/* ───────────── a key no command line can carry (awebai/oats#1064) ───────────── */

// A key of souls.launch that holds a character the kernel never prints (lib/refused-text.mjs REFUSED_TEXT).
// The schema of oats-local.yaml admits no such key, so no file brings one to a launch answer; these tests
// hand one to the constructors directly. The rule is made in soulLaunchCommand and in the one quoting of a
// key (launchKeyQuoted), not in each sentence.
const UNPRINTABLE = { "a tab": "\t", "an escape": "\x1b", "a line feed": "\n", "DEL": "\x7f", "a C1 control": "\u0085", "a bidi override": "‮", "a zero-width space": "​" };
const BY_HAND = (named) => `no command can name ${named}: delete that key from ${LOCAL} (souls.launch) by hand`;
/** A command of the verb that carries a word of its own, where a placeholder or '*' would stand. */
const COMMAND_WITH_A_WORD = /oats soul launch (?:set|remove) (?!<soul>|<key>|'\*'|\))/;

test("a key no command line can carry: the function gives no command, and names the key with the character replaced (#1064)", () => {
  for (const [what, character] of Object.entries(UNPRINTABLE)) {
    const key = `gh${character}ost`, named = `"gh�ost"`;
    assert.ok(REFUSED_TEXT.test(key), what);
    assert.equal(launchKeyQuoted(key), named, what);
    // A quoted shell word is not the answer: there is no command at all, and the key is removed by hand.
    assert.equal(soulLaunchCommand("remove", { key }), BY_HAND(named), what);
    for (const launch of ["any", "config"]) assert.equal(soulLaunchCommand("set", { key, launch }), `no command can name ${named}, and no soul has such a key`, what);
  }
  // Several such characters, each replaced; a key the schema admits is quoted as it is, and has its command.
  assert.equal(launchKeyQuoted("‮a\tb​"), `"�a�b�"`);
  for (const key of ["dev", "acme.okf/dev", "*"]) {
    assert.equal(launchKeyQuoted(key), JSON.stringify(key));
    assert.match(soulLaunchCommand("remove", { key }), /^oats soul launch remove /);
  }
});

test("every launch answer built over such a key is text the kernel prints, and the client's readers take it; the key itself stays exact in the data (#1064)", () => {
  const offered = { keys: ["dev", "runner"], unread: {} };
  const configs = { fast: { name: "fast", harness: "pi" } };
  for (const [what, character] of Object.entries(UNPRINTABLE)) {
    const key = `gh${character}ost`, named = `"gh�ost"`;
    const local = { souls: { launch: { "*": "fast", [key]: "fast" } } };
    const layers = launchLayers({ definition: {}, entry: ENTRY, key: "dev", local, offered });
    const choice = selectionFrom({ flags: {}, layers });
    const refusal = launchPreferenceUnmatched({ choice, layers });
    const report = core.launchReportFor({ layers, launchConfigs: configs, contextDir: tmpdir() });
    const [row] = launchKeysUnmatched({ local, offered }).unmatched;
    // The data is the exact key, wherever it is carried.
    assert.deepEqual([refusal.code, refusal.details.keys.map((k) => k.key), row.key], ["E_LAUNCH_PREFERENCE_UNMATCHED", [key], key], what);
    const texts = {
      "the refusal's message": refusal.message, "the refusal's fix": refusal.details.fix,
      "the report's message": report.problem.message, "the report's fix": report.problem.fix,
      "the row of oats souls": unmatchedKeyMessage(row), "the row of oats doctor": unmatchedKeyMessage(row, { lastRead: true }),
      // oats doctor's remedy and oats soul launch's own line end with what the function gives for the key.
      "the command to remove it": soulLaunchCommand("remove", { key: row.key }),
    };
    for (const [which, text] of Object.entries(texts)) {
      assert.ok(!REFUSED_TEXT.test(text), `${what}, ${which}: ${JSON.stringify(text)}`);
      assert.ok(text.length > 0 && text.length <= LAUNCH_PROBLEM_TEXT_MAX, `${what}, ${which}: ${text.length} characters`);
      assert.ok(!COMMAND_WITH_A_WORD.test(text), `${what}, ${which} carries no command with the key: ${text}`);
      if (which !== "the refusal's fix" && which !== "the report's fix") assert.ok(text.includes(named), `${what}, ${which} names the key: ${text}`);
    }
    // Where a command would have removed the key, the sentence says where it is removed by hand.
    for (const which of ["the refusal's message", "the row of oats souls", "the command to remove it"]) assert.ok(texts[which].includes(BY_HAND(named)), `${what}, ${which}: ${texts[which]}`);
    // The client's readers: a report by the Launch reader, a refusal by the preview's.
    assert.notEqual(launchOf(report, REPORT_FROM), undefined, `${what}: the Launch reader decodes the report`);
    assert.deepEqual(previewFailure(refusal.code, null, refusal.message, refusal.details.fix).reason, { code: refusal.code, message: refusal.message, fix: refusal.details.fix }, `${what}: the preview's reader keeps the kernel's words`);
    // The soul's own key and a nearest soul key are named through the same replacement.
    const odd = `de${character}v`;
    const over = launchPreferenceUnmatched({ choice, layers: { ...layers, key: odd } });
    assert.ok(!REFUSED_TEXT.test(over.message) && over.message.includes("A new launch of de�v that names no launch"), `${what}: ${JSON.stringify(over.message)}`);
    assert.equal(over.details.soul, odd, what);
    const near = unmatchedKeyMessage({ ...row, key: "ghost", suggestions: [odd] });
    assert.ok(!REFUSED_TEXT.test(near) && near.includes(`"ghost" (nearest: de�v)`), `${what}: ${JSON.stringify(near)}`);
  }
});

test("from the file such a key never reaches a launch answer: oats souls, a spawn's preview and oats doctor answer E_WORKSPACE_SCHEMA (#1064)", (t) => {
  const fx = v2Deployment({ name: "acme", souls: { dev: {} }, local: { "launch-configs": { fast: { harness: "pi" } } } });
  t.after(fx.cleanup);
  const path = join(fx.dep, LOCAL), valid = readFileSync(path, "utf8");
  for (const what of ["a tab", "an escape", "a line feed"]) {
    const key = `gh${UNPRINTABLE[what]}ost`;
    const v = YAML.parse(valid); v.souls = { launch: { "*": "fast", [key]: "fast" } };
    writeFileSync(path, YAML.stringify(v, { lineWidth: 0 }));
    assert.deepEqual(Object.keys(YAML.parse(readFileSync(path, "utf8")).souls.launch), ["*", key], `${what}: the file holds the key`);
    for (const args of [["souls", "--json"], ["spawn", "dev", "--preview", "--json"], ["doctor", "--json"]]) {
      const r = fx.cli(args), said = `${what}, oats ${args.join(" ")}: ${r.stdout}${r.stderr}`;
      assert.notEqual(r.status, 0, said);
      const j = JSON.parse(r.stdout);
      assert.deepEqual([j.ok, j.error?.code], [false, "E_WORKSPACE_SCHEMA"], said);
      // No launch answer is built: no code of one, and no command of the verb. (What the schema's own
      // message does with the character is awebai/oats#1069, and is not held here.)
      assert.ok(!/E_LAUNCH_|oats soul launch|no command can name/.test(r.stdout), said);
    }
  }
});
