// lib/harness-trust.mjs — whether the configuration file a launch reads establishes folder trust
// in a new instance home (#341). The operator's harness config is only ever read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CONFIG_DIR_VAR, HARNESS_FOLDER_VAR, claudeTrusts, codexTrustsRoot, harnessConfigFile, harnessTrustWarning, launchConfigFolder } from "../lib/harness-trust.mjs";

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

test("harnessTrustWarning: the exact sentence for an uncovered claude or codex home, naming the file read; null when covered or for pi", () => {
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", file: "/u/.claude.json", covered: false }),
    "claude folder trust is not established in /u/.claude.json: oats harness trust --dir /dep");
  assert.equal(harnessTrustWarning({ harness: "codex", root: "/dep", file: "/c/config.toml", covered: false }),
    "codex folder trust is not established in /c/config.toml: oats harness trust --dir /dep");
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", file: "/u/.claude.json", covered: true }), null);
  assert.equal(harnessTrustWarning({ harness: "pi", root: "/dep", file: null, covered: false }), null);
  // Where the launch gets the variable that selects the file, when the caller knows it.
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", file: "/s/.claude.json", from: "the CLAUDE_CONFIG_DIR of tmux session s", covered: false }),
    "claude folder trust is not established in /s/.claude.json (the CLAUDE_CONFIG_DIR of tmux session s): oats harness trust --dir /dep");
  // The pane's environment could not be read: which file is not known, and nothing is said about trust.
  assert.equal(harnessTrustWarning({ harness: "codex", root: "/dep", file: null, unreadable: "the CODEX_HOME of tmux session s could not be read: make it answer", covered: false }),
    "codex folder trust: the configuration file this launch will read could not be established (the CODEX_HOME of tmux session s could not be read: make it answer); nothing is said about its trust");
  assert.equal(harnessTrustWarning({ harness: "codex", root: "/dep", file: null, unreadable: "x", covered: true }), null, "a codex launch under yolo trusts its home whatever a file says");
  // A launch whose config directory cannot be resolved names the problem instead of a file.
  assert.equal(harnessTrustWarning({ harness: "claude", root: "/dep", problem: "launch configuration work: CLAUDE_CONFIG_DIR references WORK_DIR, not set on this host", covered: false }),
    "claude folder trust is not established: launch configuration work: CLAUDE_CONFIG_DIR references WORK_DIR, not set on this host");
});

test("harness trust remedy shell-quotes a deployment path only when it needs it, without executing path content", () => {
  const warning = harnessTrustWarning({ harness: "claude", root: "/tmp/operator's deployment", file: "/u/.claude.json", covered: false });
  assert.ok(warning.endsWith("oats harness trust --dir '/tmp/operator'\"'\"'s deployment'"), warning);
});

test("harnessConfigFile: the file each harness reads under an env", () => {
  assert.equal(harnessConfigFile("claude", { HOME: "/u" }), "/u/.claude.json");
  assert.equal(harnessConfigFile("claude", { HOME: "/u", CLAUDE_CONFIG_DIR: "/cc" }), "/cc/.claude.json");
  assert.equal(harnessConfigFile("codex", { HOME: "/u" }), "/u/.codex/config.toml");
  assert.equal(harnessConfigFile("codex", { HOME: "/u", CODEX_HOME: "/cx" }), "/cx/config.toml");
});

test("launchConfigFolder: the one reader of a launch configuration's harness folder, for claude, codex and pi: a literal or a host reference; a problem when unresolvable or relative; pi's leading ~", () => {
  assert.deepEqual(HARNESS_FOLDER_VAR, { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", pi: "PI_CODING_AGENT_DIR" });
  assert.deepEqual(CONFIG_DIR_VAR, { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" }, "the harnesses that have folder trust");
  const host = { HOME: "/home/u", WORK: "/w/claude", REL: "rel/dir", PI_ELSEWHERE: "/srv/pi", PI_TILDE: "~/pi-b" };
  const claude = (env) => launchConfigFolder("CLAUDE_CONFIG_DIR", env, host), codex = (env) => launchConfigFolder("CODEX_HOME", env, host), pi = (env) => launchConfigFolder("PI_CODING_AGENT_DIR", env, host);
  assert.equal(claude({}), null, "unset: the launch reads the file its pane selects");
  assert.equal(claude({ CODEX_HOME: "/x" }), null, "another harness's variable is not this harness's");
  assert.equal(launchConfigFolder(undefined, { CLAUDE_CONFIG_DIR: "/lit" }, host), null, "no variable, no folder");
  assert.deepEqual(claude({ CLAUDE_CONFIG_DIR: "/lit" }), { dir: "/lit" });
  assert.deepEqual(claude({ CLAUDE_CONFIG_DIR: { fromEnv: "WORK" } }), { dir: "/w/claude" });
  assert.deepEqual(codex({ CODEX_HOME: { fromEnv: "MISSING" } }), { problem: "CODEX_HOME references MISSING, not set on this host", fromEnv: "MISSING" });
  assert.deepEqual(claude({ CLAUDE_CONFIG_DIR: { fromEnv: "REL" } }), { problem: 'CLAUDE_CONFIG_DIR "rel/dir" is not an absolute path' });
  assert.deepEqual(claude({ CLAUDE_CONFIG_DIR: "" }), { problem: 'CLAUDE_CONFIG_DIR "" is not an absolute path' });
  assert.deepEqual(claude({ CLAUDE_CONFIG_DIR: "~/claude" }), { problem: 'CLAUDE_CONFIG_DIR "~/claude" is not an absolute path' }, "Claude Code takes the value as it is");
  // pi expands a leading ~ itself, so its folder is read that way.
  assert.equal(pi({ OTHER: "/x" }), null);
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: "/srv/a b" }), { dir: "/srv/a b" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: { fromEnv: "PI_ELSEWHERE" } }), { dir: "/srv/pi" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: "~/pi-a" }), { dir: "/home/u/pi-a" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: "~" }), { dir: "/home/u" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: { fromEnv: "PI_TILDE" } }), { dir: "/home/u/pi-b" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: { fromEnv: "PI_UNSET" } }), { problem: "PI_CODING_AGENT_DIR references PI_UNSET, not set on this host", fromEnv: "PI_UNSET" });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: "rel/pi" }), { problem: 'PI_CODING_AGENT_DIR "rel/pi" is not an absolute path' });
  assert.deepEqual(pi({ PI_CODING_AGENT_DIR: "~other/pi" }), { problem: 'PI_CODING_AGENT_DIR "~other/pi" is not an absolute path' }, "only a bare ~ is the user's home");
});
