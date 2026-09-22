import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  initModel, collectControlPane, buildConstellation, parseTmuxWindows, readMarkdownSection, relativeAge,
} from "../packages/desktop/server/model.mjs";

test("readMarkdownSection extracts a top-level section and ignores placeholders", () => {
  const text = "# Task\n\nShip a useful pane.\n\n# Progress\n\n_(nothing yet)_\n\n# Next\n\nBuild it.\n";
  assert.equal(readMarkdownSection(text, "Task"), "Ship a useful pane.");
  assert.equal(readMarkdownSection(text, "Progress"), "");
  assert.equal(readMarkdownSection(text, "Next"), "Build it.");
  assert.equal(readMarkdownSection("# Briefing\n\n## Task\n\nNested task.\n", "Task"), "Nested task.");
});

test("parseTmuxWindows retains an exact switch target", () => {
  assert.deepEqual(parseTmuxWindows("pi-agents\tworker\t@4\t1\tnode\t0"), [{
    session: "pi-agents", window: "worker", id: "@4", active: true, command: "node", dead: false,
  }]);
});

test("collection never executes Git, even with real work directories; recorded aggregates remain unobserved", () => {
  // The actual production collector runs with real directories and an inert
  // sentinel executable as its ONLY Git. No installed Git, tmux, CLI or GUI.
  const root = mkdtempSync(join(tmpdir(), "oats-desktop-no-git-"));
  const previousPath = process.env.PATH;
  try {
    const tools = join(root, "tools"), marker = join(root, "git-called");
    mkdirSync(tools); writeFileSync(join(root, "package.json"), '{"type":"commonjs"}');
    writeFileSync(join(tools, "git"), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)}, 'unexpected Git execution\\n'); process.stdout.write('## main...origin/main\\n');\n`, { mode: 0o700 });
    process.env.PATH = tools;
    execFileSync(join(tools, "git"), ["--fixture-sentinel-check"], { stdio: "ignore", timeout: 5000 });
    assert.equal(existsSync(marker), true, "the inert execution detector is live"); rmSync(marker);
    const metadata = [
      { instance: "one", home: join(root, "one"), running: false, branch: "recorded-one", git: { branch: "forged", dirty: 0, ahead: 0, behind: 0 } },
      { instance: "two", home: join(root, "two"), running: null, git: { dirty: 99, ahead: 99, behind: 99 } },
    ];
    for (const row of metadata) mkdirSync(join(row.home, "work"), { recursive: true });
    initModel({ listInstances: () => [{ name: "dev", dir: root, instances: metadata }] });
    for (let poll = 0; poll < 3; poll++) {
      const panel = collectControlPane(root);
      assert.equal(existsSync(marker), false, "roster collection cannot execute any Git command");
      assert.deepEqual(panel.instances.map(i => i.git), [null, null], "neither stale recorded metrics nor healthy zero fallbacks survive");
      assert.equal(panel.instances[0].branch, "recorded-one", "recorded metadata is still labeled separately by its consumers");
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildConstellation nests known parents and keeps legacy/orphan instances as roots", () => {
  const parent = { instance: "lead", running: true, createdAt: "2026-01-01" };
  const child = { instance: "worker", parentInstance: "lead", running: true, createdAt: "2026-01-02" };
  const orphan = { instance: "legacy", parentInstance: "retired-parent", running: false, createdAt: "2025-01-01" };
  const rows = buildConstellation([child, orphan, parent]);
  assert.deepEqual(rows.map((row) => [row.instance.instance, row.depth]), [["lead", 0], ["worker", 1], ["legacy", 0]]);
});

test("buildConstellation cannot lose cyclic malformed metadata", () => {
  const rows = buildConstellation([
    { instance: "a", parentInstance: "b", running: true },
    { instance: "b", parentInstance: "a", running: true },
  ]);
  assert.deepEqual(new Set(rows.map((row) => row.instance.instance)), new Set(["a", "b"]));
});

test("relativeAge chooses compact stable units", () => {
  const now = new Date("2026-07-11T12:00:00Z").getTime();
  assert.equal(relativeAge("2026-07-11T11:58:00Z", now), "2m");
  assert.equal(relativeAge("2026-07-09T11:00:00Z", now), "2d");
});

test("panel collection preserves Herdr liveness instead of requiring a tmux window", () => {
  const target = { backend: "herdr", terminalId: "term_probe" };
  initModel({ listInstances: () => [{ name: "probe", dir: "/nonexistent-oats-herdr-probe", instances: [
    { instance: "live", sessionTarget: target, running: true, runtimeState: "done" },
    { instance: "gone", sessionTarget: target, running: false, runtimeState: "unknown" },
    { instance: "unreachable", sessionTarget: target, running: null, runtimeState: "unreachable", runtimeError: "socket unavailable" },
  ] }] });
  const panel = collectControlPane("/nonexistent-oats-herdr-probe");
  assert.equal(panel.running, 1);
  assert.deepEqual(panel.instances.map(i => i.running), [true, false, null]);
  for (const instance of panel.instances) {
    assert.equal(instance.tmux, null, "Herdr is not projected as a fabricated tmux target");
    assert.equal(instance.sessionTarget, target);
  }
  assert.equal(panel.instances[2].runtimeError, "socket unavailable");
});
