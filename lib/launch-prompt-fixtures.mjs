import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { classifyClaudeLaunchCompletion } from "./launch-prompt-completion.mjs";

const ROOT = new URL("./launch-prompt-fixtures/claude-2.1.289-darwin-arm64/", import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL("manifest.json", ROOT), "utf8"));
const PLUGIN = "plugin:aweb-channel@awebai-marketplace";
const DEVELOPMENT = "--dangerously-load-development-channels";

function executableDigest(path) {
  let fd;
  try {
    const resolved = realpathSync(path);
    fd = openSync(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = fstatSync(fd);
    if (!before.isFile() || !(before.mode & 0o111)) return null;
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    // Bound to the original file size; a growing file cannot make qualification
    // run indefinitely. Reject any change observed while reading it.
    while (offset < before.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!count) return null;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    const after = fstatSync(fd);
    const current = lstatSync(resolved);
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) return null;
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(path) !== resolved) return null;
    return { digest: hash.digest("hex"), validate() {
      try {
        const current = lstatSync(resolved);
        return current.isFile() && realpathSync(path) === resolved
          && ["dev", "ino", "size", "mode", "mtimeMs", "ctimeMs"].every(key => current[key] === before[key]);
      } catch { return false; }
    } };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

function channelEligible(argv) {
  if (!Array.isArray(argv) || argv.some(a => typeof a !== "string")) return false;
  const channelFlags = argv.filter(a => a === DEVELOPMENT || a.startsWith(DEVELOPMENT + "=") || a === "--channels" || a.startsWith("--channels="));
  if (channelFlags.length !== 1 || channelFlags[0] !== DEVELOPMENT) return false;
  const at = argv.indexOf(DEVELOPMENT);
  if (argv[at + 1] !== PLUGIN) return false;
  // Variadic channel arguments must end before another flag or end of argv.
  if (at + 2 < argv.length && !argv[at + 2].startsWith("--")) return false;
  return argv.filter(a => a.startsWith("plugin:")).length === 1;
}

function captured(name) {
  const text = readFileSync(new URL(name, ROOT), "utf8");
  const expected = MANIFEST.frames[name];
  if (!expected || Buffer.byteLength(text) !== expected.bytes || createHash("sha256").update(text).digest("hex") !== expected.sha256) throw new Error("fixture integrity");
  return text;
}

// Accepted as a completion-only finite policy, not a general claim about
// Claude's path renderer. Apart from the source-derived header/footer below,
// all surrounding bytes remain the captured frame.
// Nothing produced here can match a prompt or authorize an input action.
function completedFrames(home) {
  if (typeof home !== "string" || !/^\/[A-Za-z0-9_./-]+$/.test(home)) return [];
  const components = home.slice(1).split("/");
  if (components.some(part => !part || part === "." || part === "..")) return [];
  const paths = new Set([home]);
  const userHome = homedir();
  if (home === userHome) paths.add("~");
  else if (home.startsWith(userHome + "/")) {
    paths.add("~" + home.slice(userHome.length));
    const relative = home.slice(userHome.length + 1).split("/");
    for (let index = 0; index < relative.length; index++) paths.add("~/…/" + relative.slice(index).join("/"));
  }
  const banners = ["frame-07-after-channel-200ms.txt", "frame-08-installed-after-channel-200ms.txt"];
  const prefix = " ▝▝   ▝▝   ";
  // Source-derived billing atoms change only this header row. The complete
  // empty input/status frame remains exact; these are not account captures.
  // See launch-prompt-fixtures/README.md for the pinned source provenance.
  const billings = ["API Usage Billing", "Claude Max", "Claude Pro", "Claude Team", "Claude Enterprise"];
  return banners.flatMap(name => [...paths].filter(path => prefix.length + path.length <= MANIFEST.geometry.width).flatMap(path => billings.flatMap(billing => {
    const variant = captured(name).split("\n");
    variant[1] = "▝▜██████▀  Opus 5.5 · " + billing;
    variant[2] = prefix + path;
    const auto = variant.join("\n");
    if (billing !== "Claude Max") return [auto];
    // Source-qualified whole-frame variant, not normalization of pane output:
    // the longer non-default mode label consumes nine columns of the gap.
    const autoFooter = "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents" + " ".repeat(37) + "◐ medium · /effort";
    const footer = name === banners[0] ? 11 : 10;
    if (variant[footer] !== autoFooter) throw new Error("fixture footer integrity");
    variant[footer] = "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents" + " ".repeat(28) + "◐ medium · /effort";
    return [auto, variant.join("\n")];
  })));
}

/** Read-only qualification: no version command or harness invocation. argv is
 * the actual selected harness argv (excluding its executable). A reported
 * version, name, or environment alone is never sufficient to enable a matcher.
 * The channel frame is path-independent. Completion uses a finite accepted
 * directory-display family that cannot authorize keys.
 */
export function qualifyLaunchPromptFixtures({ home, harness, executablePath, argv = [], platform = process.platform, arch = process.arch }) {
  const name = typeof harness === "string" ? harness : harness?.name;
  const pin = `${platform}-${arch}`;
  const result = { harness: { name, platform: pin, developmentChannelEligible: false }, fixtures: [] };
  if (name !== "claude" || pin !== MANIFEST.platform) return result;
  const executable = executableDigest(executablePath);
  if (executable?.digest !== MANIFEST.binarySha256) return result;
  result.validateExecutable = executable.validate;
  result.harness.version = MANIFEST.version;
  result.geometry = { ...MANIFEST.geometry };
  result.harness.developmentChannelEligible = channelEligible(argv);
  const base = { home, harness: name, version: MANIFEST.version, platform: pin };
  const frame = (text, kind, after, rest = {}) => ({ text, kind, after, ...MANIFEST.geometry, ...rest });
  try {
    if (result.harness.developmentChannelEligible) {
      result.fixtures.push({ ...base, id: "claude-2.1.289-darwin-arm64-development-channel", frames: [
        frame(captured("frame-05-channel-seeded.txt"), "prompt", [], { class: "awebDevelopmentChannel" }),
        ...[[], ["awebDevelopmentChannel"]].flatMap(after => completedFrames(home).map(text => frame(text, "completed", after))),
      ] });
      result.classifyCompletion = classifyClaudeLaunchCompletion;
    }
  } catch {
    result.fixtures = [];
    delete result.classifyCompletion;
  }
  return result;
}
