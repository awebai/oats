/** What `oats retire` says about the work it preserved. One function renders
 *  the lines for the local and the remote path of bin/oats.mjs, from the
 *  receipt's `workRecovery` (lib/core.mjs, retireInstance); another renders
 *  its `extraWorktrees`. A receipt from an
 *  older kernel, or a stored one, may carry `workRecoveries[]` instead: one
 *  block is printed per entry. A third renders its `warnings`. Their lines hold
 *  text the kernel did not write (paths as the system or Git names them, a
 *  hook's words, the names a capability declares), so each line goes to the
 *  terminal through terminalText (lib/refused-text.mjs): a name cannot clear the
 *  screen or write a line of its own. The receipt's JSON is never passed
 *  through it. Dependency-free. */
import { terminalText } from "./refused-text.mjs";

export const formatBytes = (n) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${(n / 1024 ** 3).toFixed(1)} GiB`;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `a, b (owner); c (other)`: the `key` of each row, grouped by its owner; owners sorted, rows in their order. */
export function groupedByOwner(rows, key) {
  const groups = new Map();
  for (const row of rows) groups.set(row.owner, [...(groups.get(row.owner) || []), row[key]]);
  return [...groups].sort(([a], [b]) => byCodeUnit(String(a), String(b))).map(([owner, names]) => `${names.join(", ")}${owner ? ` (${owner})` : ""}`).join("; ");
}

/** `{ paths: [{ path, bytes }], bytes }` as one line: the first 8 with their size, then the total. */
function sizedPathsLine(label, part) {
  if (!part?.paths?.length) return [];
  const shown = part.paths.slice(0, 8).map((p) => `${p.path} (${formatBytes(p.bytes)})`);
  const more = part.paths.length > 8 ? `, and ${part.paths.length - 8} more` : "";
  return [`  ${label}: ${shown.join(", ")}${more} — ${formatBytes(part.bytes)} in total`];
}

/** The recoveries a retire receipt names: every entry of a historical `workRecoveries[]`, else its one `workRecovery`. */
export function receiptRecoveries(receipt) {
  if (Array.isArray(receipt?.workRecoveries) && receipt.workRecoveries.length) return receipt.workRecoveries;
  return receipt?.workRecovery ? [receipt.workRecovery] : [];
}

/** Where the summary sends an operator to inspect, restore or dispose of a recovery (#703). */
const RECOVERY_POINTER = "  to inspect, restore or dispose of a recovery: see docs/souls-and-instances.md#after-a-retire-inspect-restore-dispose";

/** The lines `oats retire` prints for what a receipt preserved; `host` (the
 *  remote path) names where. Per recovery: the classes, the path with its
 *  size, then, when they apply, what was copied from the home, the copied
 *  outputs, the home entries left out by a capability's declaration (names and
 *  owners only) and which parts were copied again under after-hooks/; and,
 *  after them all, where the docs say what to do with a recovery. */
export function workRecoveryLines(receipt, { host } = {}) {
  const lines = [];
  for (const recovery of receiptRecoveries(receipt)) {
    lines.push(`Work that was not committed has been preserved${host ? ` on ${host}` : ""}: ${(recovery.classes || []).join(", ")}`);
    lines.push(`  ${recovery.path}${typeof recovery.bytes === "number" ? ` (${formatBytes(recovery.bytes)})` : ""}`);
    lines.push(...sizedPathsLine("copied from the home", recovery.home));
    lines.push(...sizedPathsLine("copied outputs", recovery.outputs));
    const notCopied = Array.isArray(recovery.notCopied) ? recovery.notCopied.filter((row) => typeof row?.path === "string") : [];
    if (notCopied.length) lines.push(`  not copied: ${groupedByOwner(notCopied, "path")}`);
    const again = [recovery.afterHooks?.home === true && "home", recovery.afterHooks?.work === true && "work"].filter(Boolean);
    if (again.length) lines.push(`  after the retire hooks: ${again.join(" and ")} copied again under after-hooks/`);
  }
  if (lines.length) lines.push(RECOVERY_POINTER);
  return lines.map((line) => terminalText(line));
}

/** The lines `oats retire` prints for the home's extra trees it handled
 *  (the receipt's `extraWorktrees`): one per tree, removed or re-homed. */
export function extraWorktreeLines(receipt, { host } = {}) {
  const rows = Array.isArray(receipt?.extraWorktrees) ? receipt.extraWorktrees : [];
  return rows.map((t) => {
    const at = t.branch ? `branch ${t.branch}` : t.detachedAt ? `detached at ${t.detachedAt}` : "a HEAD that could not be read";
    return terminalText(t.outcome === "removed"
      ? `Extra worktree ${t.path} removed (${at}); its branch and commits stay in ${t.repo}${host ? ` on ${host}` : ""}`
      : `Extra worktree ${t.path} re-homed${host ? ` on ${host}` : ""} to ${t.movedTo} (${at}): ${t.reason}`);
  });
}

/** The lines `oats retire` prints for a receipt's `warnings`, one per warning. A warning can hold
 *  text the kernel did not write: a path as the system resolves it (where a link at `work/` led,
 *  awebai/oats#973; the repository Git names for a tree), a hook's own words. Each goes to the
 *  terminal through terminalText (lib/refused-text.mjs), so that a name cannot clear the screen or
 *  write a line of its own. The receipt's JSON holds each warning as it is. */
export function warningLines(receipt) {
  const warnings = Array.isArray(receipt?.warnings) ? receipt.warnings : [];
  return warnings.map((w) => `  WARNING: ${terminalText(w)}`);
}
