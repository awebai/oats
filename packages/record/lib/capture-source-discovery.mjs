// Private source-plan bridge. Root selection belongs to the owning command;
// this module enumerates supplied roots without opening transcript/log content.
// Pages and their positions commit together; enumeration never grants success.
import { readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { NativeCaptureDiscovery } from "./capture-discovery.mjs";
import { SESSION_FORMATS } from "./formats.mjs";
import { awStream } from "./capture-aw.mjs";
import { guardCapturedPath } from "./native-history.mjs";
import { retryAfterAttempt } from "./capture-failures.mjs";
import { CaptureStop } from "./capture-budget.mjs";

const sources = ["cc", "pi", "codex", "aw"];
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const validName = name => typeof name === "string" && name && name !== "." && name !== ".." && !/[\/\\\0]/.test(name);
const validFailure = row => row && typeof row.runId === "string" && row.runId &&
  typeof row.attemptedRun === "string" && row.attemptedRun && row.reason === "io" &&
  Number.isSafeInteger(row.attempts) && row.attempts > 0 && typeof row.nextRetryAt === "string" &&
  Number.isFinite(Date.parse(row.nextRetryAt)) && new Date(row.nextRetryAt).toISOString() === row.nextRetryAt;

// AW uses sorted code-unit basenames, not native localeCompare ordering. A
// cached name array is metadata proportional to the directory, not content.
class AwDiscovery {
  constructor(path, checkpoint) {
    this.path = path;
    this.cursor = structuredClone(checkpoint ?? { after: null, identity: null, complete: false });
    const row = this.cursor;
    if (!row || row.after !== null && !validName(row.after) || typeof row.complete !== "boolean" ||
        row.identity !== null && (!row.identity || typeof row.identity.dev !== "string" || typeof row.identity.ino !== "string"))
      throw new Error("invalid AW discovery checkpoint");
  }

  advance({ limit, stopped, work }) {
    const row = this.cursor, files = []; let visited = 0;
    if (row.complete) return { files, visited, complete: true, checkpoint: structuredClone(row) };
    guardCapturedPath(this.path);
    let before;
    try { before = statSync(this.path, { bigint: true }); }
    catch (error) {
      if (error.code !== "ENOENT" || row.identity !== null || row.after !== null) throw error;
      row.complete = true;
      return { files, visited, complete: true, checkpoint: structuredClone(row) };
    }
    if (!before.isDirectory() || row.identity && !sameIdentity(row.identity, identity(before)))
      throw new Error("AW discovery directory identity changed");
    if (!this.names) {
      this.names = readdirSync(this.path).sort();
      if (!sameIdentity(identity(before), identity(statSync(this.path, { bigint: true }))))
        throw new Error("AW discovery directory changed during enumeration");
      if (work) { work.directoriesRead = (work.directoriesRead ?? 0) + 1;
        work.directoryEntriesRead = (work.directoryEntriesRead ?? 0) + this.names.length; }
      let low = 0, high = this.names.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (row.after !== null && this.names[mid] <= row.after) low = mid + 1; else high = mid;
      }
      this.position = low;
    }
    row.identity = identity(before);
    while (this.position < this.names.length && visited < limit && !stopped()) {
      const name = this.names[this.position++]; row.after = name; visited++;
      if (name.endsWith(".jsonl")) {
        const path = join(this.path, name); guardCapturedPath(path); files.push(path);
      }
    }
    if (!sameIdentity(row.identity, identity(statSync(this.path, { bigint: true }))))
      throw new Error("AW discovery directory changed during enumeration");
    row.complete = this.position === this.names.length;
    if (work) work.entriesVisited = (work.entriesVisited ?? 0) + visited;
    return { files, visited, complete: row.complete, checkpoint: structuredClone(row) };
  }

  close() { this.names = null; }
}

export class CaptureSourceDiscovery {
  constructor(queue, roots) {
    if (!Array.isArray(roots) || roots.some(root => !root || !sources.includes(root.source) ||
        typeof root.path !== "string" || !isAbsolute(root.path) || root.path.includes("\0") ||
        Object.keys(root).some(key => !["source", "path"].includes(key))))
      throw new Error("invalid capture discovery root plan");
    this.queue = queue;
    this.roots = sources.map(source => roots.filter(root => root.source === source).map(root => root.path));
    this.plan = createHash("sha256").update(JSON.stringify(this.roots)).digest("hex");
    this.readers = new Map();
    this.current();
  }

  current() {
    const sweep = this.queue.current();
    let row = sweep.discovery;
    if (row === null && !sweep.discovered) row = { v: 1, plan: this.plan, next: 0,
      groups: this.roots.map(roots => ({ root: 0, checkpoint: null, complete: roots.length === 0 })) };
    if (!row || row.v !== 1 || row.plan !== this.plan || !Number.isSafeInteger(row.next) || row.next < 0 || row.next >= sources.length ||
        !Array.isArray(row.groups) || row.groups.length !== sources.length || row.groups.some((group, index) =>
          !group || !Number.isSafeInteger(group.root) || group.root < 0 || group.root > this.roots[index].length ||
          group.complete !== (group.root === this.roots[index].length) ||
          group.failure != null && (group.complete || !validFailure(group.failure)) ||
          group.checkpoint !== null && (group.complete || typeof group.checkpoint !== "object")) ||
        sweep.discovered && row.groups.some(group => !group.complete))
      throw new Error("capture source discovery plan or checkpoint changed");
    return structuredClone(row);
  }

  healthyPending() { return this.current().groups.some(group => !group.complete && !group.failure); }

  // Only the owning session supplies run identity. Direct readers keep their
  // refusal/rollback contract; discovery errors never become stream failures.
  advance({ limit = 128, stopped = () => false, work, runId = null, now = Date.now(), retry = false } = {}) {
    if (this.closed || this.queue.state.depth || !Number.isSafeInteger(limit) || limit < 1 || limit > 128 || typeof stopped !== "function")
      throw new Error("invalid capture source discovery unit");
    if (typeof retry !== "boolean" || runId !== null && (typeof runId !== "string" || !runId) ||
        retry && runId === null || !Number.isSafeInteger(now) || now < 0)
      throw new Error("invalid capture discovery failure context");
    if (stopped()) return { visited: 0, added: 0, stopped: true, complete: false };
    const row = this.current();
    if (this.queue.current().discovered) return { visited: 0, added: 0, complete: true };
    let index = -1;
    for (let offset = 0; offset < sources.length; offset++) {
      const candidate = (row.next + offset) % sources.length;
      const group = row.groups[candidate], failure = group.failure;
      if (!group.complete && (retry ? failure && failure.attemptedRun !== runId && now >= Date.parse(failure.nextRetryAt) : !failure)) {
        index = candidate; break;
      }
    }
    if (index < 0) {
      if (row.groups.some(group => !group.complete)) return { visited: 0, added: 0, complete: false, deferred: true };
      this.queue.add([], row, { complete: true });
      return { visited: 0, added: 0, complete: true };
    }
    const group = row.groups[index], source = sources[index], path = this.roots[index][group.root];
    try {
      let cached = this.readers.get(source);
      const checkpoint = JSON.stringify(group.checkpoint);
      if (!cached || cached.root !== group.root || cached.checkpoint !== checkpoint) {
        cached?.reader.close();
        const reader = source === "aw" ? new AwDiscovery(path, group.checkpoint) : new NativeCaptureDiscovery(source, path, group.checkpoint);
        cached = { root: group.root, checkpoint, reader }; this.readers.set(source, cached);
      }
      let result;
      try {
        // A previously refused root is not a fresh optional default, even when
        // its first page failed before establishing a directory identity.
        if (retry) {
          guardCapturedPath(path);
          if (!statSync(path).isDirectory()) throw new Error("capture discovery failed root is not a directory");
        }
        result = cached.reader.advance({ limit, stopped, work });
      }
      catch (error) {
        if (runId !== null && !(error instanceof CaptureStop)) {
          // Keep the exact rejected checkpoint/root. Publishing the failure and
          // rotation together lets a replacement reach safe independent work.
          // A storage failure here still propagates: it is not a root refusal.
          const attempts = (group.failure?.attempts ?? 0) + 1;
          group.failure = { runId, attemptedRun: runId, reason: "io", attempts, nextRetryAt: retryAfterAttempt(attempts, now) };
          row.next = (index + 1) % sources.length;
          this.queue.state.transaction(() => {
            this.queue.add([], row);
            this.queue.state.set("capture-discovery-failure", "last", { runId, reason: "io",
              scope: this.queue.current().id, source, path });
          });
        }
        throw error;
      }
      const inputs = result.files.map(path => ({ source, path,
        stream: source === "aw" ? awStream(this.queue.owner) : `${this.queue.owner}~${source}.${SESSION_FORMATS[source].sessionId(path)}` }));
      if (result.complete) {
        group.root++; group.checkpoint = null; group.complete = group.root === this.roots[index].length;
        delete group.failure;
      } else group.checkpoint = result.checkpoint;
      // Partial retry remains pending and receives at most one unit per pass.
      if (group.failure) group.failure.attemptedRun = runId;
      row.next = (index + 1) % sources.length;
      const complete = row.groups.every(group => group.complete);
      // A transaction failure must discard the advanced volatile walker. The
      // next attempt reloads the last durable page, with idempotent insertion.
      this.queue.add(inputs, row, { complete });
      cached.checkpoint = JSON.stringify(group.checkpoint);
      if (result.complete) { cached.reader.close(); this.readers.delete(source); }
      return { source, visited: result.visited, added: inputs.length, complete };
    } catch (error) { this.clear(); throw error; }
  }

  clear() { for (const { reader } of this.readers.values()) reader.close(); this.readers.clear(); }
  close() { this.clear(); this.closed = true; }
}
