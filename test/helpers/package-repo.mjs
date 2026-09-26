// A tagged package repository for tests (package souls, trigger templates). Real git, no network.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { git } from "./v2-deployment.mjs";

/** A package repo (a bare Git repo with tags): oats-package/ with one capability (acme-tool), the
 *  given souls, extra manifest keys and extra files under oats-package/. */
export function packageRepo({ id = "acme.pkg", version = "1.0.0", souls = { keeper: {} }, manifest = {}, files = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-pkgsoul-")));
  const bare = join(base, "pkg.git");
  git(base, "init", "-q", "--bare", bare);
  const seed = join(base, "seed");
  git(base, "clone", "-q", bare, seed);
  const write = (rel, text) => { const abs = join(seed, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
  const pkg = { base, bare, seed, ref: `git:${pathToFileURL(bare).href}`, id };
  pkg.files = (v, soulDefs) => {
    write("oats-package/oats-package.json", JSON.stringify({ package: id, version: v, description: "fixture package", compatibility: { oats: ">=0.24.0" }, capabilities: ["capabilities/acme-tool"], souls: Object.keys(soulDefs).map((n) => `souls/${n}`), ...manifest }, null, 2) + "\n");
    for (const [rel, text] of Object.entries(files)) write(`oats-package/${rel}`, typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n");
    write("oats-package/capabilities/acme-tool/oats.json", JSON.stringify({ capability: "acme-tool", version: v, description: "tool", compatibility: { oats: ">=0.24.0" }, skills: ["skills"] }, null, 2) + "\n");
    write("oats-package/capabilities/acme-tool/skills/tool-skill/SKILL.md", "---\nname: tool-skill\ndescription: tool\n---\n\nuse the tool\n");
    for (const [name, def] of Object.entries(soulDefs)) {
      write(`oats-package/souls/${name}/soul.yaml`, YAML.stringify({ schemaVersion: 2, name, description: `${name} package soul.`, work: "directory", capabilities: { "acme-tool": { from: "here" } }, ...(def.soul || {}) }));
      write(`oats-package/souls/${name}/AGENTS.md`, def.agents ?? `# ${name} (package ${v})\n`);
    }
  };
  pkg.release = (v, soulDefs, { tag = `v${v}`, force = false } = {}) => {
    pkg.files(v, soulDefs);
    git(seed, "add", "-A"); git(seed, "commit", "-qm", `release ${v}`, "--allow-empty");
    git(seed, "tag", ...(force ? ["-f"] : []), tag);
    git(seed, "push", "-q", ...(force ? ["-f"] : []), "origin", "HEAD:main", tag);
    return git(seed, "rev-parse", "HEAD");
  };
  pkg.commit1 = pkg.release(version, souls);
  pkg.cleanup = () => rmSync(base, { recursive: true, force: true });
  return pkg;
}

