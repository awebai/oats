// Private command preparation. Page mutations and their resume key commit
// together; this is retry intent, never source/custody or completion proof.
import { basename } from "node:path";
import { SESSION_FORMATS } from "./formats.mjs";
import { loadIgnore } from "./ignore.mjs";

const formats = ["cc", "pi", "codex", "aw"];
export class CaptureIssuePreparation {
  constructor(state, queue, { runId, sources, retry = false }) {
    if (typeof runId !== "string" || !runId || typeof retry !== "boolean" ||
        !Array.isArray(sources) || new Set(sources).size !== sources.length || sources.some(source => !formats.includes(source)) ||
        retry && sources.length !== formats.length)
      throw new Error("invalid capture issue preparation");
    this.state = state; this.queue = queue; this.runId = runId; this.retry = retry;
    this.sources = formats.filter(source => sources.includes(source));
    this.scope = queue.current().id;
  }

  current() {
    if (this.queue.current().id !== this.scope) throw new Error("capture issue preparation scope changed");
    const row = this.state.get("capture-issue-preparation", this.queue.owner);
    if (!row || row.runId !== this.runId) return null;
    if (row.scope !== this.scope || row.retry !== this.retry || JSON.stringify(row.sources) !== JSON.stringify(this.sources) ||
        row.after !== null && typeof row.after !== "string" || typeof row.complete !== "boolean")
      throw new Error("capture issue preparation selection changed");
    return row;
  }

  complete() { return this.current()?.complete === true; }

  advance(root, { stopped = () => false, finalize = false, limit = 128 } = {}) {
    if (this.state.depth || !Number.isSafeInteger(limit) || limit < 1 || limit > 128)
      throw new Error("capture issue preparation requires a bounded standalone transaction");
    if (finalize || stopped()) return { complete: false, stopped: true, checked: 0 };
    if (this.complete()) return { complete: true, checked: 0 };
    // Privacy failure must propagate; it cannot authorize opening inputs.
    const ignore = loadIgnore(root);
    return this.state.transaction(() => {
      const row = this.current() ?? { runId: this.runId, scope: this.scope, retry: this.retry,
        sources: this.sources, after: null, complete: false };
      const page = this.state.db.prepare(`SELECT key,value FROM state WHERE kind='set-aside'
        ${row.after === null ? "" : "AND key>?"} ORDER BY key LIMIT ?`)
        .all(...(row.after === null ? [limit] : [row.after, limit]));
      let checked = 0;
      for (const { key, value } of page) {
        if (stopped()) break;
        const issue = JSON.parse(value), fmt = SESSION_FORMATS[issue.source];
        if (!formats.includes(issue.source) || typeof issue.path !== "string")
          throw new Error("invalid capture issue during preparation");
        // Preserve native public reconciliation for missing/ignored inputs,
        // but do not clear another owner or an excluded format's evidence.
        const ignored = fmt && issue.owner === this.queue.owner && this.sources.includes(issue.source) &&
          ignore.ignores(issue.path, [basename(issue.path), fmt.sessionId(issue.path), ...(fmt.ignoreKeys?.(issue.path) ?? [])]);
        if (this.retry) {
          // The existing explicit all-input retry marks the root's issues,
          // including other owners, without changing their source selection.
          // Run identity stays stable across replacement and partial pages.
          this.state.set("source-retry", key, this.runId);
        }
        if (ignored) this.state.delete("set-aside", key);
        else if (this.retry) this.state.set("set-aside", key, { ...issue, retry: true });
        if ((ignored || this.retry) && issue.owner === this.queue.owner && this.sources.includes(issue.source)) {
          this.state.db.prepare("UPDATE capture_sources SET outcome='ready' WHERE scope=? AND source=? AND path=? AND outcome='set-aside'")
            .run(this.scope, issue.source, issue.path);
        }
        row.after = key; checked++;
      }
      row.complete = checked === page.length && page.length < limit;
      this.state.set("capture-issue-preparation", this.queue.owner, row);
      return { complete: row.complete, stopped: stopped(), checked };
    });
  }
}
