// Offline installation evidence, not manager registration or schedule health.
// Refuse indeterminate evidence instead of calling it an absent installation.
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, statSync } from "node:fs";
import { join, parse, resolve, sep } from "node:path";
import { captureServiceOwnership } from "./capture-service-ownership.mjs";
import { capturePendingActivationName, captureServiceLabel, captureServiceUnit, captureServiceTimer } from "./capture-service-definition.mjs";
import { isCaptureHook, isCurrentCaptureHook } from "./capture-hook-ownership.mjs";

const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

// Limits are private reader guards, not capture policy. They bound enumeration,
// allocations and parsing; exceeding one is an unavailable diagnosis, not a
// truncated proof of absence. The existing isolated DB reader has its own hard
// timeout. Filesystem syscalls still depend on the host filesystem responding.
export function captureInstallation(root, { home, platform, check = () => {} }) {
  let remaining = 16 * 1024 * 1024;
  function stat(path) {
    const absolute = resolve(path), prefix = parse(absolute).root;
    const parts = absolute.slice(prefix.length).split(sep).filter(Boolean);
    if (parts.length > 256) throw new Error("installation path exceeds the reader component limit");
    let current = prefix, result = statSync(prefix);
    for (let i = 0; i < parts.length; i++) {
      check(); current = join(current, parts[i]);
      try { result = lstatSync(current); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      // A dangling/unreadable link is unknown, even when a descendant name
      // would otherwise produce ENOENT. Following a readable link is read-only.
      if (result.isSymbolicLink()) result = statSync(current);
      if (i < parts.length - 1 && !result.isDirectory()) throw new Error(`installation parent is not a directory: ${current}`);
    }
    return result;
  }
  function read(path) {
    const before = stat(path);
    if (!before) return null;
    if (!before.isFile() || before.size > 1024 * 1024) throw new Error(`installation evidence is not a regular file within 1 MiB: ${path}`);
    if (remaining < before.size + 1) throw new Error("installation evidence exceeds the total reader byte limit");
    let fd;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
      if (!same(before, fstatSync(fd))) throw new Error(`installation evidence changed: ${path}`);
      const bytes = Buffer.alloc(before.size + 1); let size = 0;
      while (size < bytes.length) {
        check(); const n = readSync(fd, bytes, size, bytes.length - size, size);
        if (!n) break; size += n;
      }
      remaining -= size;
      const after = stat(path);
      if (size !== before.size || !same(before, fstatSync(fd)) || !after || !same(before, after))
        throw new Error(`installation evidence changed while reading: ${path}`);
      return bytes.toString("utf8", 0, size);
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  // Settings files holding an owned capture hook in a form earlier releases
  // wrote, which this release's setup converts.
  let installed = false, legacy = false;
  const earlierHooks = new Set();
  const selected = stat(root);
  if (selected) {
    if (!selected.isDirectory()) throw new Error(`selected record root is not a directory: ${root}`);
    installed = true;
  }
  const candidates = platform === "darwin" ? [[join(home, "Library/LaunchAgents", `${captureServiceLabel}.plist`), "plist"]]
    : platform === "linux" ? [[join(home, ".config/systemd/user", captureServiceUnit), "service"],
      [join(home, ".config/systemd/user", captureServiceTimer), "timer"]] : [];
  let periodic = candidates.length > 0;
  for (const [path, kind] of candidates) {
    const text = read(path); if (text === null) { periodic = false; continue; }
    const ownership = captureServiceOwnership(text, kind);
    installed ||= ownership !== "foreign"; legacy ||= ownership === "legacy"; periodic &&= ownership === "periodic";
  }
  // File evidence only: setup's marker beside its own marked definitions is
  // an unverified activation; with no such definition the marker is stale.
  const markerPath = join(root, capturePendingActivationName);
  const pending = selected && read(markerPath) !== null ? { path: markerPath, stale: !periodic } : null;

  const beforeHome = stat(home);
  if (beforeHome) {
    if (!beforeHome.isDirectory()) throw new Error("installation home is not a directory");
    const directory = opendirSync(home); let entries = 0, settings = 0;
    try {
      for (let entry; (entry = directory.readSync()) !== null;) {
        check(); if (++entries > 4096) throw new Error("installation home exceeds the reader entry limit");
        if (!entry.name.startsWith(".claude") || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
        if (++settings > 64) throw new Error("installation hook candidates exceed the reader limit");
        const path = join(home, entry.name, "settings.json"), text = read(path);
        if (text === null) continue;
        let value;
        try { value = JSON.parse(text); } catch { throw new Error(`invalid hook settings JSON: ${path}`); }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid hook settings object: ${path}`);
        if (value.hooks === undefined) continue;
        if (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks)) throw new Error(`invalid hooks object: ${path}`);
        for (const event of ["Stop", "SessionEnd"]) {
          const groups = value.hooks[event] ?? [];
          if (!Array.isArray(groups)) throw new Error(`invalid ${event} hook groups: ${path}`);
          for (const group of groups) {
            if (!group || typeof group !== "object" || Array.isArray(group) || !Array.isArray(group.hooks ?? []))
              throw new Error(`invalid ${event} hook group: ${path}`);
            for (const hook of group.hooks ?? []) {
              if (!isCaptureHook(hook)) continue;
              installed = true;
              if (!isCurrentCaptureHook(hook)) earlierHooks.add(path);
            }
          }
        }
      }
    } finally { directory.closeSync(); }
    const afterHome = stat(home);
    if (!afterHome || !same(beforeHome, afterHome)) throw new Error("installation home changed during enumeration");
  }
  return { installed, legacy, pending, earlierHooks: [...earlierHooks].sort() };
}
