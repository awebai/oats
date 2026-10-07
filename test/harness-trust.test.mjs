// lib/harness-trust.mjs — whether a harness will stop at its folder-trust prompt
// in a new instance home (#341). The operator's harness config is only ever read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeTrusts, codexTrustsRoot, harnessTrustWarning } from "../lib/harness-trust.mjs";

function room() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "htrust-")));
  const user = join(base, "user"), root = join(base, "dep"), home = join(root, "agents", "dev", "instances", "dev-a");
  mkdirSync(user); mkdirSync(home, { recursive: true });
  return { base, user, root, home, env: { HOME: user } };
}
const unchanged = (file, body) => { const before = readFileSync(file, "utf8"), mtime = statSync(file).mtimeMs; body(); assert.equal(readFileSync(file, "utf8"), before); assert.equal(statSync(file).mtimeMs, mtime); };

test("claudeTrusts: a trusted home, deployment root or ancestor covers the home; the walk stops after a git root", () => {
  const r = room();
  try {
    const cfg = join(r.user, ".claude.json");
    assert.equal(claudeTrusts(r.home, { env: r.env }), false, "no config: not trusted");
    writeFileSync(cfg, "{not json");
    assert.equal(claudeTrusts(r.home, { env: r.env }), false, "an unreadable config is not trust");
    for (const dir of [r.home, r.root, r.base]) {
      writeFileSync(cfg, JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }));
      unchanged(cfg, () => assert.equal(claudeTrusts(r.home, { env: r.env }), true, dir));
    }
    writeFileSync(cfg, JSON.stringify({ projects: { [r.root]: { hasTrustDialogAccepted: false }, [join(r.root, "agents", "other")]: { hasTrustDialogAccepted: true } } }));
    assert.equal(claudeTrusts(r.home, { env: r.env }), false, "an unaccepted entry and a sibling's entry are not trust");
    // Claude's walk stops at a git root: an entry above it does not cover the home.
    writeFileSync(cfg, JSON.stringify({ projects: { [r.base]: { hasTrustDialogAccepted: true } } }));
    mkdirSync(join(r.root, ".git"));
    assert.equal(claudeTrusts(r.home, { env: r.env }), false);
    writeFileSync(cfg, JSON.stringify({ projects: { [r.root]: { hasTrustDialogAccepted: true } } }));
    assert.equal(claudeTrusts(r.home, { env: r.env }), true, "the git root itself still counts");
    // CLAUDE_CONFIG_DIR moves the config file.
    const dir = join(r.base, "claude-config"); mkdirSync(dir);
    assert.equal(claudeTrusts(r.home, { env: { ...r.env, CLAUDE_CONFIG_DIR: dir } }), false);
    writeFileSync(join(dir, ".claude.json"), JSON.stringify({ projects: { [r.root]: { hasTrustDialogAccepted: true } } }));
    assert.equal(claudeTrusts(r.home, { env: { ...r.env, CLAUDE_CONFIG_DIR: dir } }), true);
  } finally { rmSync(r.base, { recursive: true, force: true }); }
});

test("codexTrustsRoot: the deployment root or an ancestor trusted in config.toml, in the forms Codex writes", () => {
  const r = room();
  try {
    const dir = join(r.user, ".codex"); mkdirSync(dir);
    const cfg = join(dir, "config.toml");
    assert.equal(codexTrustsRoot(r.root, { env: r.env }), false, "no config: not trusted");
    const forms = [
      `model = "x"\n\n[projects."${r.root}"]\ntrust_level = "trusted"\n`,
      `[projects.'${r.base}']\ntrust_level = 'trusted'\n`,
      `[projects]\n"${r.root}" = { trust_level = "trusted" }\n`,
      `projects."${r.root}".trust_level = "trusted"\n[tui]\nx = 1\n`,
      `[projects."/elsewhere"]\ntrust_level = "untrusted"\n\n[projects."${r.root}"] # the root\n  trust_level   =   "trusted"   # one-time consent\n`,
    ];
    for (const body of forms) {
      writeFileSync(cfg, body);
      unchanged(cfg, () => assert.equal(codexTrustsRoot(r.root, { env: r.env }), true, body));
    }
    const untrusted = [
      `[projects."${r.root}"]\ntrust_level = "untrusted"\n`,
      `[projects."${r.home}"]\ntrust_level = "trusted"\n`, // below the root: covers only that home
      `[projects."${r.root}"]\n\n[tui]\ntrust_level = "trusted"\n`, // the key is in another table
      `[projects."${r.root}x"]\ntrust_level = "trusted"\n`,
      `[projects."${r.root}"\ntrust_level = "trusted"\n`, // malformed header
    ];
    for (const body of untrusted) { writeFileSync(cfg, body); assert.equal(codexTrustsRoot(r.root, { env: r.env }), false, body); }
    // CODEX_HOME moves the config.
    const other = join(r.base, "codex-home"); mkdirSync(other);
    writeFileSync(join(other, "config.toml"), `[projects."${r.root}"]\ntrust_level = "trusted"\n`);
    assert.equal(codexTrustsRoot(r.root, { env: { ...r.env, CODEX_HOME: other } }), true);
  } finally { rmSync(r.base, { recursive: true, force: true }); }
});

test("harnessTrustWarning: the exact sentence for an uncovered claude or codex home; null when covered or for pi", () => {
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", covered: false }),
    "the claude session will stop at its folder-trust prompt: trust /dep once (preview with `oats harness trust --dir '/dep' --harness claude --plan`, then apply with `oats harness trust --dir '/dep' --harness claude`; a nested Git boundary may still require operator inspection)");
  assert.equal(harnessTrustWarning({ harness: "codex", root: "/dep", covered: false }),
    "the codex session will stop at its folder-trust prompt: trust /dep once (preview with `oats harness trust --dir '/dep' --harness codex --plan`, then apply with `oats harness trust --dir '/dep' --harness codex`; a nested Git boundary may still require operator inspection)");
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", covered: true }), null);
  assert.equal(harnessTrustWarning({ harness: "pi", root: "/dep", covered: false }), null);
});

test('harness trust remedy shell-quotes apostrophes without executing path content', () => {
 const warning = harnessTrustWarning({ harness: 'claude', root: "/tmp/operator's deployment", covered: false });
 assert.ok(warning.includes("--dir '/tmp/operator'\"'\"'s deployment' --harness claude --plan"));
});
