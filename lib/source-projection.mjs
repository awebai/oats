/** One guarded filesystem writer for Git and explicit local source projections.
 * Source paths cannot introduce write-parent or leaf aliases before rejection. */
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { decodeUtf8 } from "./portable-values.mjs";
import { portablePath } from "./source-spec.mjs";
import { assertRetainableTree } from "./capability-artifacts.mjs";
import { oatsError } from "./errors.mjs";

export function validateProjectionPath(path, platform = process.platform) {
  portablePath(path);
  if (platform === "win32" && path.split("/").some((part) => /[:<>"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw oatsError("source-incomplete", "source path is not an ordinary filename on this host");
  return path;
}

export function createSourceProjection(destination) {
  if (typeof destination !== "string" || !isAbsolute(destination)) throw oatsError("invalid-source", "source projection destination must be explicit and absolute");
  mkdirSync(destination, { mode: 0o700 });
  const boundary = realpathSync(destination), directories = new Set([""]), expected = new Map(), directoryModes = new Map();
  let finished = false;
  const active = () => { if (finished) throw oatsError("source-incomplete", "source projection is already finalized"); };
  const ensureDirectory = (parts) => {
    let current = boundary, relative = "";
    for (const part of parts) {
      relative = relative ? `${relative}/${part}` : part; current = join(current, part);
      let existed = false;
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; existed = true; }
      if (!lstatSync(current).isDirectory() || (existed && !directories.has(relative))) throw oatsError("artifact-not-contained", "projection parent is a link or aliases another source path");
      directories.add(relative);
    }
    return current;
  };
  const target = (path, kind) => {
    active(); validateProjectionPath(path);
    if (expected.has(path) || directories.has(path)) throw oatsError("invalid-source", "source projection repeats a path");
    const parts = path.split("/"), parent = ensureDirectory(parts.slice(0, -1));
    expected.set(path, kind);
    return join(parent, parts.at(-1));
  };
  const modeOf = (path, mode) => {
    chmodSync(path, mode);
    if ((lstatSync(path).mode & 0o100) !== (mode & 0o100)) throw oatsError("source-incomplete", "host filesystem cannot retain the source owner-execute flag");
  };
  return {
    directory(path, mode) {
      active(); validateProjectionPath(path);
      if (expected.has(path)) throw oatsError("invalid-source", "source projection path changes kind");
      const directory = ensureDirectory(path.split("/"));
      if (mode !== undefined) directoryModes.set(directory, mode);
    },
    file(path, bytes, mode) {
      const file = target(path, "file"); writeFileSync(file, bytes, { flag: "wx", mode }); modeOf(file, mode);
    },
    copyFile(path, source, mode) {
      const file = target(path, "file"); copyFileSync(source, file, constants.COPYFILE_EXCL); modeOf(file, mode);
    },
    link(path, value) { symlinkSync(value, target(path, "link")); },
    finish() {
      active();
      const seenDirectories = new Set([""]);
      const inspect = (directory, prefix = "") => {
        for (const raw of readdirSync(directory, { encoding: "buffer" })) {
          const name = decodeUtf8(raw), path = prefix ? `${prefix}/${name}` : name, target = join(directory, name), stat = lstatSync(target);
          if (stat.isDirectory()) {
            if (!directories.has(path)) throw oatsError("source-incomplete", "host projection directory spelling differs from source");
            seenDirectories.add(path); inspect(target, path);
          } else {
            const kind = expected.get(path);
            if (!kind || (kind === "link" ? !stat.isSymbolicLink() : !stat.isFile())) throw oatsError("source-incomplete", "host projection paths differ from source");
            expected.delete(path);
          }
        }
      };
      inspect(boundary);
      if (expected.size || seenDirectories.size !== directories.size) throw oatsError("source-incomplete", "host filesystem did not retain every source path");
      assertRetainableTree(boundary);
      for (const [path, mode] of [...directoryModes].sort((a, b) => b[0].length - a[0].length)) chmodSync(path, mode);
      finished = true;
      return boundary;
    },
  };
}
