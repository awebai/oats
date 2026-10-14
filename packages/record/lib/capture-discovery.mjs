// Private resumable native-directory walk. The durable checkpoint is only the
// active directory stack and exact last basename, never a whole-file state map.
// Per-directory Dirent arrays retain the existing stable localeCompare order;
// readdir/sort metadata cost is separate from content bytes and can recur after
// restart. A live walker caches ONLY its active stack, releasing arrays on pop.
import { statSync } from "node:fs";
import { join } from "node:path";
import { sortedSessionEntries } from "./formats.mjs";
import { guardCapturedPath } from "./native-history.mjs";

const nameValid = value => typeof value === "string" && value && value !== "." && value !== ".." && !/[\/\\\0]/.test(value);
const identityOf = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const ccDirectory = (entry, path) => entry.isDirectory() ||
  entry.isSymbolicLink() && !entry.name.endsWith(".jsonl") && statSync(path).isDirectory();

export class NativeCaptureDiscovery {
  constructor(format, root, checkpoint = null) {
    if (!["cc", "pi", "codex"].includes(format) || typeof root !== "string" || !root) throw new Error("invalid capture discovery root");
    this.format = format; this.root = root; this.frames = [];
    if (checkpoint === null) checkpoint = { format, root, complete: false, stack: [{ name: null, after: null }] };
    if (checkpoint.format !== format || checkpoint.root !== root || typeof checkpoint.complete !== "boolean" ||
        !Array.isArray(checkpoint.stack) || checkpoint.stack.length > (format === "pi" ? 2 : 4) ||
        checkpoint.complete !== (checkpoint.stack.length === 0)) throw new Error("invalid capture discovery checkpoint");
    let path = root;
    for (const [depth, item] of checkpoint.stack.entries()) {
      if (!item || (depth === 0 ? item.name !== null : !nameValid(item.name)) ||
          depth > 0 && item.name !== checkpoint.stack[depth - 1].after ||
          item.after !== null && !nameValid(item.after) ||
          item.identity != null && (typeof item.identity.dev !== "string" || typeof item.identity.ino !== "string") ||
          format === "cc" && depth === 3 && item.name !== "subagents") throw new Error("invalid capture discovery stack");
      if (depth) path = join(path, item.name);
      this.frames.push({ name: item.name, after: item.after, identity: item.identity ?? null, path, depth,
        // A resumed selected directory cannot silently disappear as an absent
        // default. Only a newly entered optional root has that meaning.
        optional: depth === 0 && checkpoint.stack.length === 1 && item.after === null });
    }
  }

  checkpoint() {
    return { format: this.format, root: this.root, complete: this.frames.length === 0,
      stack: this.frames.map(({ name, after, identity }) => ({ name, after, identity: identity ?? null })) };
  }

  advance({ limit = 128, stopped = () => false, work } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("invalid capture discovery budget");
    if (this.closed || this.failed) throw new Error("capture discovery is closed or failed");
    const files = []; let visited = 0;
    try {
      while (this.frames.length && visited < limit && !stopped()) {
        const frame = this.frames.at(-1);
        guardCapturedPath(frame.path);
        if (!frame.entries) {
          let before;
          try { before = statSync(frame.path, { bigint: true }); }
          catch (error) {
            if (frame.optional && !frame.identity && error.code === "ENOENT") { this.frames.pop(); continue; }
            throw error;
          }
          if (frame.identity && !sameIdentity(frame.identity, identityOf(before))) throw new Error("capture discovery directory identity changed");
          frame.entries = sortedSessionEntries(frame.path);
          const after = statSync(frame.path, { bigint: true });
          if (!sameIdentity(identityOf(before), identityOf(after))) throw new Error("capture discovery directory changed during enumeration");
          frame.identity = identityOf(after);
          if (work) { work.directoriesRead = (work.directoriesRead ?? 0) + 1;
            work.directoryEntriesRead = (work.directoryEntriesRead ?? 0) + frame.entries.length; }
          const anchor = frame.after === null ? -1 : frame.entries.findIndex(entry => entry.name === frame.after);
          // Exact-name anchoring preserves stable ties. If the last name vanished,
          // replay its equivalence class conservatively; inventory insertion is
          // idempotent. Newly inserted earlier names belong to the next sweep.
          frame.position = frame.after === null ? 0 : anchor >= 0 ? anchor + 1 :
            frame.entries.findIndex(entry => entry.name.localeCompare(frame.after) >= 0);
          if (frame.position < 0) frame.position = frame.entries.length;
        }
        const entry = frame.entries[frame.position];
        if (!entry) { this.frames.pop(); continue; }
        frame.position++; frame.after = entry.name; visited++;
        const path = join(frame.path, entry.name); guardCapturedPath(path);
        let descend = false, file = false;
        if (this.format === "cc") {
          if (frame.depth < 2) {
            descend = ccDirectory(entry, path);
            file = !descend && entry.name.endsWith(".jsonl");
          } else if (frame.depth === 2) {
            if (entry.name === "subagents") {
              if (!ccDirectory(entry, path)) throw new Error(`session subagents root is not a directory: ${path}`);
              descend = true;
            }
          } else file = entry.name.endsWith(".jsonl");
        } else {
          if (entry.name.endsWith(".jsonl") && !entry.isDirectory()) file = true;
          else if (entry.isDirectory() || entry.isSymbolicLink() && statSync(path).isDirectory())
            descend = frame.depth < (this.format === "pi" ? 1 : 3);
        }
        if (file) files.push(path);
        if (descend) this.frames.push({ name: entry.name, after: null, path, depth: frame.depth + 1, optional: false });
      }
    } catch (error) { this.failed = true; this.close(); throw error; }
    if (work) work.entriesVisited = (work.entriesVisited ?? 0) + visited;
    return { files, visited, complete: this.frames.length === 0, checkpoint: this.checkpoint() };
  }

  close() {
    for (const frame of this.frames) { delete frame.entries; delete frame.position; }
    this.closed = true;
  }
}
