/** lib/install-stamp.mjs — the install stamp of the warm reader (lib/reader.mjs; docs/desktop-cli-api.md "The warm
 *  reader"): `stat` of what this kernel's code and data come from, as one string, equal for an unchanged install. A
 *  reader takes it first, before the kernel it answers with is loaded (bin/oats.mjs imports this module statically and
 *  takes the stamp before its kernel imports), so a change while the kernel loads is never part of its baseline; then
 *  again for every request. Node built-ins only: loading it loads no kernel code. Kernel-private, not exported from
 *  `./core`. */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The install root: the directory of package.json, bin/ and lib/. */
export const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The stamp of the install at `root`. The root's (dev, ino); (dev, ino, size, mtimeMs) of package.json,
 *  bin/oats.mjs, package-catalog.json, every file under lib/, docs/*.schema.json, each runtime dependency's
 *  package.json where it resolves now (dependencyManifests: a dependency newly installed nearer the root moves it) and
 *  the Node binary (realpath'd); the mtime of each directory under lib/ and of docs/ (a file added or removed). A file
 *  gone, or one that cannot be read, is part of the stamp too. No hashing: a replaced install has new inodes, an
 *  edited file a new size or mtime. */
export function installStamp(root = INSTALL_ROOT) {
  const lines = [];
  const file = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
  const add = (path, keys) => {
    const s = statSync(path, { throwIfNoEntry: false });
    lines.push(`${path}\0${s ? keys(s) : "absent"}`);
    return s;
  };
  const tree = (dir) => {
    if (!add(dir, (s) => `${s.mtimeMs}`)?.isDirectory()) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.isDirectory()) tree(join(dir, entry.name));
      else add(join(dir, entry.name), file);
    }
  };
  try {
    add(root, (s) => `${s.dev}:${s.ino}`);
    for (const name of ["package.json", join("bin", "oats.mjs"), "package-catalog.json"]) add(join(root, name), file);
    tree(join(root, "lib"));
    const docs = join(root, "docs");
    if (add(docs, (s) => `${s.mtimeMs}`)?.isDirectory()) for (const name of readdirSync(docs).filter((n) => n.endsWith(".schema.json")).sort()) add(join(docs, name), file);
    for (const manifest of dependencyManifests(root)) add(manifest, file);
    add(realpathSync(process.execPath), file);
  } catch (e) {
    lines.push(`unreadable\0${e.code ?? e.message}`); // a half-written or vanishing install reads as changed
  }
  return lines.join("\n");
}

/** The package.json of each runtime dependency in the install's package.json, where Node resolves it from the
 *  install root now: the nearest node_modules above it that holds it. (One under lib/ is in the stamp's tree.) */
export function dependencyManifests(root = INSTALL_ROOT) {
  let names = [];
  try { names = Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies ?? {}).sort(); } catch { /* the stamp has package.json */ }
  return names.map((name) => {
    for (let dir = root; ; dir = dirname(dir)) {
      const manifest = join(dir, "node_modules", name, "package.json");
      if (existsSync(manifest)) return manifest;
      if (dirname(dir) === dir) return join(root, "node_modules", name, "package.json");
    }
  });
}
