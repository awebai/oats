// Fake installed `oats` for Desktop server tests. It REPLAYS the JSON a real CLI
// produced for the hand-built Northwind deployment (packages/desktop/test/
// fixtures/workspace-v2), rebased onto the deployment directory under test.
// `souls` replays the F3 capture of `oats souls --json` (the spawn catalog).
// It never runs a kernel, runtime, tmux or network operation.
//   FAKE_OATS_DROP_FEATURES   comma-separated features to withhold from the probe
//   FAKE_OATS_LOG             append one JSON line per invocation (argv)
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { specProbe } from "../../packages/desktop/test/helpers/no-approval-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "packages", "desktop", "test", "fixtures", "workspace-v2");
const fixture = (name) => readFileSync(join(FIXTURES, `${name}.json`), "utf8");
const status = JSON.parse(fixture("status"));
const CAPTURED = dirname(status.root); // the recorded deployment directory
const args = process.argv.slice(2);
if (process.env.FAKE_OATS_LOG) appendFileSync(process.env.FAKE_OATS_LOG, JSON.stringify(args) + "\n");
const out = (value) => { process.stdout.write(typeof value === "string" ? value : JSON.stringify(value)); };
const rebase = (text, dir) => text.split(CAPTURED).join(dir);
const dirArg = () => { const i = args.indexOf("--dir"); return i >= 0 ? args[i + 1] : null; };

if (args[0] === "version" && args[1] === "--json") {
  // The kernel line without package approval (F2b), per the published spec
  // until the 0.26.0 kernel branch is captured.
  const probe = specProbe(JSON.parse(fixture("version")));
  const drop = new Set(String(process.env.FAKE_OATS_DROP_FEATURES || "").split(",").filter(Boolean));
  probe.features = probe.features.filter((f) => !drop.has(f));
  out(probe);
} else if (args[0] === "status" && args.at(-1) === "--json" && dirArg()) {
  out(rebase(fixture("status"), dirArg()));
} else if (args[0] === "workspace" && args[1] === "status" && args.at(-1) === "--json" && dirArg()) {
  out(rebase(fixture("workspace-status"), dirArg()));
} else if (args[0] === "souls" && args.at(-1) === "--json" && dirArg()) {
  // The spawn catalog: the kernel's `oats souls --json` capture (F3).
  out(fixture("f3/souls"));
} else {
  out({ schemaVersion: 1, ok: false, error: { code: "E_FAKE_UNSUPPORTED", message: `fake oats does not implement: ${args[0]}` } });
  process.exitCode = 1;
}
