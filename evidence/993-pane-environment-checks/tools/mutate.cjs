// Put each production reader back on process.env in turn; record which tests fail. Restores each file from git.
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const S = __dirname, rep = require(S + "/rep.cjs");
// WORK: a clean work tree of the #993 branch. The script edits files there and restores each with `git checkout --`.
const W = process.env.WORK || (console.error("set WORK to the #993 work tree"), process.exit(2));
process.chdir(W);
const PROC = `{ of: (n) => (n === "HOME" ? { value: process.env.HOME, source: "p" } : process.env[n] ? { value: process.env[n], source: "p" } : n === "PATH" ? { value: process.env.PATH, source: "p" } : { absent: true, source: "p" }), pane: () => null }`;
const M = [
  { name: "folder trust (launchFolderTrust) reads this process", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["  const selector = launch.of(variable);\n  // The default file is under HOME: read only when the launch has no selector.\n  const base = selector.absent ? launch.of(\"HOME\") : null;",
             "  const selector = process.env[variable] ? { value: process.env[variable], source: \"p\" } : { absent: true, source: \"p\" };\n  const base = selector.absent ? { value: process.env.HOME, source: \"p\" } : null;"]] },
  { name: "the gate's probe environment keeps this process's names (launchEffectiveEnv)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["  for (const name of PANE_ENV_NAMES) {\n    const answer = launch.of(name);", "  for (const name of []) {\n    const answer = launch.of(name);"]] },
  { name: "the gate's remedy prefix reads this process's selector", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["harness === \"claude\" && probeEnv.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${shq(resolve(probeEnv.CLAUDE_CONFIG_DIR))} ` : \"\";", "harness === \"claude\" && process.env.CLAUDE_CONFIG_DIR ? `CLAUDE_CONFIG_DIR=${shq(resolve(process.env.CLAUDE_CONFIG_DIR))} ` : \"\";"]] },
  { name: "the readiness item reads this process (folderTrustItems)", file: "lib/instance-inspect.mjs", tests: ["pane-environment"],
    pairs: [["launch: previewLaunchEnvironment({ configEnv: env, configName: name, ...(t.home ? { home: t.home, meta: t.meta } : { deployment: t.deployment }) }) });", `launch: ${PROC} });`]] },
  { name: "oats harness trust reads this process (harnessTrustCmd)", file: "bin/oats.mjs", tests: ["pane-environment"],
    pairs: [[", launch: previewLaunchEnvironment({ deployment: context.deploymentDir }) });", " });"]] },
  { name: "launch-config preview makes no read of the pane (launchPreview)", file: "bin/oats.mjs", tests: ["pane-environment", "pane-path"],
    pairs: [[", pane: () => previewPaneEnvironment(meta ? { home, meta } : { deployment: context }) });", " });"]] },
  { name: "a start's gate reads no pane (planLaunch probeLaunch)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["env, pane: launchEnv.pane, cwd: home });\n        verifyHarnessPackages", "env, pane: NO_PANE_READ, cwd: home });\n        verifyHarnessPackages"]] },
  { name: "a spawn does not judge again on the session it gets", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["        if (recipe.executable !== bin || probeNames(harness).some((name) => judged[name] !== actual[name])) {", "        if (false) {"],
            ["      const actualTrust = folderTrustOn(actualEnv);", "      const actualTrust = folderTrust;"]] },
  { name: "the spawn's checks read this process (spawnBody expectedEnv)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["launch ? () => expectedPaneEnvironment(tmuxSessionPlan, session, undefined, home) : NO_LAUNCH", "NO_LAUNCH"]] },
  { name: "a start's folder trust reads no pane (planLaunch)", file: "lib/core.mjs", tests: ["pane-environment", "harness-trust-launch"],
    pairs: [["const { trustHome } = launchFolderTrust({ harness, home, meta, yolo: recipe.yolo, launch: launchEnv,", "const { trustHome } = launchFolderTrust({ harness, home, meta, yolo: recipe.yolo, launch: launchEnvironment({ configEnv, configName: config?.name, env, pane: NO_PANE_READ, cwd: home }),"]] },
  { name: "the probe looks the harness up itself (verifyHarnessPackages ignores the selected executable)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["  const selected = typeof env === \"function\" ? env.executable : undefined;", "  const selected = undefined;"]] },
  { name: "the probe gets the pane's PATH unresolved (no panePathFrom)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["name === \"PATH\" && !answer.unestablished ? panePathFrom(answer.value, launch.cwd) : answer.value", "answer.value"]] },
  { name: "the trust writer takes a server it could not ask for no server (trustTargets ignores unread)", file: "lib/harness-trust-write.mjs", tests: ["pane-environment", "harness-trust-write"],
    pairs: [["  const unread = selector.unread ?? base?.unread;", "  const unread = undefined;"]] },
  { name: "the preview's pane drops the failed discovery (previewPaneEnvironment carries no unread)", file: "lib/core.mjs", tests: ["pane-environment"],
    pairs: [["return { unestablished: NO_PANE_READ.unestablished, unread:", "return { unestablished: NO_PANE_READ.unestablished, unreadX:"]] },
  { name: "a HOME-only launch configuration is no trust target", file: "lib/harness-trust-write.mjs", tests: ["pane-environment", "harness-trust-write"],
    pairs: [["      if (!Object.hasOwn(config.env || {}, 'HOME') || !selector.absent) continue;", "      if (true) continue;"]] },
];
const only = process.argv[2];
const out = [];
for (const [i, m] of M.entries()) {
  if (only && String(i) !== only) continue;
  let line = `M${i} ${m.name}:`;
  try {
    rep(m.file, m.pairs);
    for (const t of m.tests) {
      const r = spawnSync(S + "/t.sh", [t], { encoding: "utf8", env: process.env });
      const failed = [...new Set(r.stdout.split("\n").filter((l) => /^✖ (?!failing tests)/.test(l)).map((l) => l.replace(/ \(\d[\d.]*ms\)$/, "").slice(2, 150)))];
      line += `\n   ${t}: ${failed.length ? failed.length + " fail" : "NO TEST FAILS"}${failed.map((f) => "\n     - " + f).join("")}`;
    }
  } catch (e) { line += `\n   ERROR ${e.message.slice(0, 200)}`; }
  finally { execFileSync("git", ["checkout", "--", m.file]); }
  console.log(line); out.push(line);
}
fs.writeFileSync(process.env.OUT || S + "/mutations.txt", out.join("\n") + "\n");
