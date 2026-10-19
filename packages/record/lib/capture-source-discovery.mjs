// Private source-plan bridge. The caller supplies explicit roots or a stable
// default-root selection. Resolution/enumeration never opens source content.
// Pages and their positions commit together; enumeration never grants success.
import { readdirSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { NativeCaptureDiscovery } from "./capture-discovery.mjs";
import { SESSION_FORMATS } from "./formats.mjs";
import { awStream } from "./capture-aw.mjs";
import { guardCapturedPath } from "./native-history.mjs";
import { FAILURE_REASONS, retryAfterAttempt } from "./capture-failures.mjs";
import { nativeLaunchLocations } from "./session-roots.mjs";
import { captureRootDirectory } from "./capture-roots.mjs";
import { CaptureStop } from "./capture-budget.mjs";
import { captureDefaultRootPlan, resolveCaptureDefaultRoots } from "./capture-default-roots.mjs";

const sources = ["cc", "pi", "codex", "aw"];
const attemptsKind = "capture-discovery-attempt";
const text = value => typeof value === "string" && value.length > 0;
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const absolute = path => typeof path === "string" && isAbsolute(path) && !path.includes("\0");
const validIdentity = value => value && typeof value.dev === "string" && typeof value.ino === "string";
const validName = name => typeof name === "string" && name && name !== "." && name !== ".." && !/[\/\\\0]/.test(name);
const validFailure = row => row && typeof row.runId === "string" && row.runId &&
  typeof row.attemptedRun === "string" && row.attemptedRun && FAILURE_REASONS.includes(row.reason) &&
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
  constructor(queue, roots, { registered = [] } = {}) {
    this.sources = [...sources, ...registered.map(root => root.source)];
    this.registered = registered;
    if (roots?.kind === "default-roots") {
      if (Object.keys(roots).some(key => !["kind", "home", "cwd", "env", "sources"].includes(key)))
        throw new Error("invalid capture discovery root plan");
      this.defaults = captureDefaultRootPlan(roots);
    } else {
      if (!Array.isArray(roots) || roots.some(root => !root || !sources.includes(root.source) ||
          !absolute(root.path) || Object.keys(root).some(key => !["source", "path"].includes(key))))
        throw new Error("invalid capture discovery root plan");
      this.roots = sources.map(source => roots.filter(root => root.source === source).map(root => root.path));
    }
    if (!this.roots) this.roots = sources.map(() => []);
    this.roots.push(...registered.map(root => [root.path]));
    this.queue = queue;
    this.plan = createHash("sha256").update(JSON.stringify([this.defaults ?? this.roots, registered])).digest("hex");
    this.readers = new Map();
    this.current();
  }

  defaultGroup(index) { return Boolean(this.defaults) && index < sources.length; }

  current() {
    const sweep = this.queue.current();
    let row = sweep.discovery;
    if (row === null && !sweep.discovered) row = { v: this.defaults ? 2 : 1, plan: this.plan, next: 0,
      groups: this.sources.map((source, index) => this.defaultGroup(index) ?
        { root: 0, checkpoint: null, complete: !this.defaults.sources.includes(source),
          roots: this.defaults.sources.includes(source) ? null : [] } :
        { root: 0, checkpoint: null, complete: this.roots[index].length === 0 }) };
    if (!row || row.v !== (this.defaults ? 2 : 1) || row.plan !== this.plan ||
        !Number.isSafeInteger(row.next) || row.next < 0 || row.next >= this.sources.length ||
        !Array.isArray(row.groups) || row.groups.length !== this.sources.length || row.groups.some((group, index) => !this.validGroup(group, index)) ||
        sweep.discovered && row.groups.some(group => !group.complete))
      throw new Error("capture source discovery plan or checkpoint changed");
    return structuredClone(row);
  }

  healthyPending() { return this.current().groups.some(group => !group.complete && !group.failure); }

  validGroup(group, index) {
    if (!group || !Number.isSafeInteger(group.root) || group.root < 0 ||
        group.failure != null && (group.complete || !validFailure(group.failure)) ||
        group.checkpoint !== null && (group.complete || typeof group.checkpoint !== "object")) return false;
    if (this.defaultGroup(index)) {
      if (group.roots === null) return this.defaults.sources.includes(this.sources[index]) &&
        group.root === 0 && group.checkpoint === null && group.complete === false;
      if (!Array.isArray(group.roots) || group.roots.some(root => !root || !absolute(root.path) ||
          !(validIdentity(root.identity) || this.sources[index] === "aw" && root.identity === null)) ||
          !this.defaults.sources.includes(this.sources[index]) && group.roots.length !== 0) return false;
    }
    const count = this.defaultGroup(index) ? group.roots.length : this.roots[index].length;
    return group.root <= count && group.complete === (group.root === count);
  }

  pathFor(group, index) {
    return this.defaultGroup(index) ? group.roots === null ? this.defaults.home : group.roots[group.root]?.path : this.roots[index][group.root];
  }

  // Resolving one format can enumerate/sort home-directory metadata. Keep it
  // outside the admission transaction but inside the worker's bounded life.
  resolveRoots(source) {
    const registered = new Set(this.registered.filter(root => root.source === source).map(root => root.path));
    const configured = source === 'cc' ? this.defaults.env.CLAUDE_CONFIG_DIR : source === 'codex' ? this.defaults.env.CODEX_HOME :
      source === 'pi' ? this.defaults.env.PI_CODING_AGENT_SESSION_DIR || this.defaults.env.PI_CODING_AGENT_DIR : null;
    // Existing default selectors require a configured root to exist. When the
    // same location is registered, its independent group owns both absence
    // and operational failure; do not rediscover or fail it here as well.
    if (configured && source !== 'aw') {
      const harness = source === 'cc' ? 'claude' : source;
      const selected = nativeLaunchLocations(harness, { cwd: this.defaults.cwd, env: { ...this.defaults.env, HOME: this.defaults.home } });
      if (selected.every(path => registered.has(path))) return [];
    }
    return resolveCaptureDefaultRoots(this.defaults, source).filter(path => !registered.has(path)).map(path => {
      guardCapturedPath(path);
      try {
        const stat = statSync(path, { bigint: true });
        if (!stat.isDirectory()) throw new Error("capture default root is not a directory");
        return { path, identity: identity(stat) };
      } catch (error) {
        if (source === "aw" && error.code === "ENOENT") return { path, identity: null };
        throw error;
      }
    });
  }

  active() {
    const attempt = this.queue.state.get(attemptsKind, this.queue.owner);
    if (attempt !== null && (![attempt?.id, attempt?.runId, attempt?.workerNonce].every(text) ||
        attempt.scope !== this.queue.current().id || attempt.plan !== this.plan ||
        !Number.isSafeInteger(attempt.index) || attempt.index < 0 || attempt.index >= this.sources.length ||
        attempt.source !== this.sources[attempt.index] || !text(attempt.path) || !this.validGroup(attempt.group, attempt.index) ||
        attempt.group.complete !== false ||
        attempt.phase !== (this.defaults && attempt.group.roots === null ? "roots" : undefined) ||
        attempt.path !== this.pathFor(attempt.group, attempt.index)))
      throw new Error("invalid capture discovery admission");
    return attempt;
  }

  admitted(attempt) {
    if (JSON.stringify(this.active()) !== JSON.stringify(attempt) ||
        JSON.stringify(this.current().groups[attempt.index]) !== JSON.stringify(attempt.group))
      throw new Error("capture discovery admission or checkpoint changed");
  }

  failed(attempt, reason, now) {
    if (!FAILURE_REASONS.includes(reason)) throw new Error("invalid discovery interruption reason");
    this.queue.state.transaction(() => {
      this.admitted(attempt);
      const row = this.current(), group = row.groups[attempt.index];
      const attempts = (group.failure?.attempts ?? 0) + 1;
      group.failure = { runId: attempt.runId, attemptedRun: attempt.runId, reason,
        attempts, nextRetryAt: retryAfterAttempt(attempts, now) };
      row.next = (attempt.index + 1) % this.sources.length;
      this.queue.add([], row);
      this.queue.state.set("capture-discovery-failure", "last", { runId: attempt.runId, reason,
        scope: attempt.scope, source: attempt.source, path: attempt.path, registered: attempt.index >= sources.length });
      this.queue.state.delete(attemptsKind, this.queue.owner);
    });
  }

  // Owning bootstrap has registered the new worker and ended its predecessor.
  // Never infer stream/frame attribution from this metadata-only operation.
  reconcile(start, { reason = "interrupted", now = Date.now() } = {}) {
    if (this.queue.state.depth || !text(start?.workerNonce) || !text(start.pass?.runId) ||
        !Number.isSafeInteger(now) || now < 0) throw new Error("invalid discovery replacement");
    const attempt = this.active();
    if (!attempt) return null;
    if (attempt.workerNonce === start.workerNonce) throw new Error("capture discovery worker has not been replaced");
    this.failed(attempt, reason, now);
    this.clear();
    return attempt;
  }

  publish(inputs, row, complete, attempt) {
    if (!attempt) return this.queue.add(inputs, row, { complete });
    this.queue.state.transaction(() => {
      this.admitted(attempt);
      this.queue.add(inputs, row, { complete });
      this.queue.state.delete(attemptsKind, this.queue.owner);
    });
  }

  // Only the owning session supplies run identity. Direct readers keep their
  // refusal/rollback contract; discovery errors never become stream failures.
  advance({ limit = 128, stopped = () => false, work, runId = null, workerNonce = null, now = Date.now(), retry = false } = {}) {
    if (this.closed || this.queue.state.depth || !Number.isSafeInteger(limit) || limit < 1 || limit > 128 || typeof stopped !== "function")
      throw new Error("invalid capture source discovery unit");
    if (typeof retry !== "boolean" || (runId === null ? workerNonce !== null : !text(runId) || !text(workerNonce)) ||
        retry && runId === null || !Number.isSafeInteger(now) || now < 0)
      throw new Error("invalid capture discovery failure context");
    if (this.active()) throw new Error("unreconciled capture discovery admission");
    if (stopped()) return { visited: 0, added: 0, stopped: true, complete: false };
    const row = this.current();
    if (this.queue.current().discovered) return { visited: 0, added: 0, complete: true };
    let index = -1;
    for (let offset = 0; offset < this.sources.length; offset++) {
      const candidate = (row.next + offset) % this.sources.length;
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
    const group = row.groups[index], source = this.sources[index], path = this.pathFor(group, index);
    const resolving = this.defaultGroup(index) && group.roots === null;
    if (resolving && runId === null) throw new Error("capture default-root resolution requires owned discovery admission");
    const attempt = runId === null ? null : { id: randomUUID(), runId, workerNonce,
      scope: this.queue.current().id, plan: this.plan, index, source, path, group: structuredClone(group),
      ...(resolving ? { phase: "roots" } : {}) };
    if (attempt) this.queue.state.transaction(() => {
      if (this.active() || JSON.stringify(this.current()) !== JSON.stringify(row))
        throw new Error("capture discovery changed before admission");
      this.queue.state.set(attemptsKind, this.queue.owner, attempt);
    });
    try {
      if (resolving) {
        let resolved;
        try { resolved = this.resolveRoots(source); }
        catch (error) {
          if (attempt && !(error instanceof CaptureStop)) this.failed(attempt, "io", now);
          throw error;
        }
        group.roots = resolved; group.complete = resolved.length === 0;
        delete group.failure;
        row.next = (index + 1) % this.sources.length;
        const complete = row.groups.every(group => group.complete);
        this.publish([], row, complete, attempt);
        return { source, resolvedRoots: true, visited: 0, added: 0, complete };
      }
      // A registered root is an independent discovery group. A bad peer of
      // the same format cannot prevent this group from making progress.
      if (index >= sources.length) {
        try {
          guardCapturedPath(path);
          if (!captureRootDirectory(path, { readable: true })) {
            group.root++; group.checkpoint = null; group.complete = true; delete group.failure;
            row.next = (index + 1) % this.sources.length;
            this.publish([], row, row.groups.every(g => g.complete), attempt);
            return { source, visited: 0, added: 0, complete: row.groups.every(g => g.complete) };
          }
        } catch (error) {
          if (attempt && !(error instanceof CaptureStop)) this.failed(attempt, 'io', now);
          throw error;
        }
      }
      let cached = this.readers.get(index);
      const checkpoint = JSON.stringify(group.checkpoint);
      const selectedIdentity = this.defaultGroup(index) ? group.roots[group.root].identity : null;
      if (!cached || cached.root !== group.root || cached.checkpoint !== checkpoint) {
        cached?.reader.close();
        // Carry selection's witness into the first reader, not only a stat
        // before construction: the reader also checks it around enumeration.
        const initial = group.checkpoint ?? (selectedIdentity ? source === "aw" ?
          { after: null, identity: selectedIdentity, complete: false } :
          { format: source, root: path, complete: false, stack: [{ name: null, after: null, identity: selectedIdentity }] } : null);
        const reader = source === "aw" ? new AwDiscovery(path, initial) : new NativeCaptureDiscovery(source, path, initial);
        cached = { root: group.root, checkpoint, reader }; this.readers.set(index, cached);
      }
      let result;
      try {
        // A previously refused root is not a fresh optional default, even when
        // its first page failed before establishing a directory identity.
        if (retry || selectedIdentity) {
          guardCapturedPath(path);
          const stat = statSync(path, { bigint: true });
          if (!stat.isDirectory()) throw new Error("capture discovery failed root is not a directory");
          if (selectedIdentity && !sameIdentity(selectedIdentity, identity(stat)))
            throw new Error("capture default-root directory identity changed");
        }
        result = cached.reader.advance({ limit, stopped, work });
      }
      catch (error) {
        if (attempt && !(error instanceof CaptureStop)) {
          // Keep the exact rejected checkpoint/root. Publishing the failure and
          // rotation together lets a replacement reach safe independent work.
          // A storage failure here still propagates: it is not a root refusal.
          this.failed(attempt, "io", now);
        }
        throw error;
      }
      const inputs = result.files.map(path => ({ source, path,
        stream: source === "aw" ? awStream(this.queue.owner) : `${this.queue.owner}~${source}.${SESSION_FORMATS[source].sessionId(path)}` }));
      if (result.complete) {
        group.root++; group.checkpoint = null;
        group.complete = group.root === (this.defaultGroup(index) ? group.roots.length : this.roots[index].length);
        delete group.failure;
      } else group.checkpoint = result.checkpoint;
      // Partial retry remains pending and receives at most one unit per pass.
      if (group.failure) group.failure.attemptedRun = runId;
      row.next = (index + 1) % this.sources.length;
      const complete = row.groups.every(group => group.complete);
      // A transaction failure must discard the advanced volatile walker. The
      // next attempt reloads the last durable page, with idempotent insertion.
      this.publish(inputs, row, complete, attempt);
      cached.checkpoint = JSON.stringify(group.checkpoint);
      if (result.complete) { cached.reader.close(); this.readers.delete(index); }
      return { source, visited: result.visited, added: inputs.length, complete };
    } catch (error) {
      this.clear();
      if (index >= sources.length && !(error instanceof CaptureStop) && this.active() === null)
        error.code = 'E_CAPTURE_ROOTS_COVERAGE';
      throw error;
    }
  }

  clear() { for (const { reader } of this.readers.values()) reader.close(); this.readers.clear(); }
  close() { this.clear(); this.closed = true; }
}
