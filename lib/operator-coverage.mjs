// Operator coverage (awebai/oats#671, #709): does a soul this workspace offers compose the operator
// capability, oats.setup, for the workspace and for each team? Detected by composition, never by a
// soul's name and never by a role marker (maintainer decision on #671). A warning only: readiness and
// doctor report it; nothing refuses, spawns or writes. An eligible soul is not a launched seat.
import * as remoteModule from "./remote.mjs";
import { disabledEntry, qualifiedSoulName, soulCandidates } from "./instance-resolution.mjs";
import { resolveSoul } from "./resolve.mjs";

export const OPERATOR_CAPABILITY = "oats.setup";
const SEAT = "an eligible soul is not a launched seat";
/** The core slot an operator must not empty (maintainer decision, 0.44.2): messaging, so it is reachable.
 *  Emptying knowledge or tasks (`knowledge: none`, `tasks: none`) does not disqualify an operator. Only
 *  `slot-none` is judged here: a capability the soul turns `off` is not (#671's rule, unchanged). */
const OPERATOR_SLOTS = new Set(["messaging"]);

/** The Desktop refuses a whole readiness answer whose item `reason` or `remedy` is over 1024 characters
 *  (packages/desktop/renderer/readiness-contract.mjs): each detail is clipped, lists show three and a count,
 *  and every message and remedy stays under MAX_TEXT. */
export const MAX_TEXT = 900;
const DETAIL = 160;
export const clip = (text, max = DETAIL) => { const t = String(text ?? ""); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const some = (list) => `${list.slice(0, 3).join("; ")}${list.length > 3 ? `; and ${list.length - 3} more` : ""}`;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** A source this machine could not read (an access, network or cache miss), as opposed to one the kernel refuses. */
const unreadable = (e) => e?.code === "E_REMOTE_UNREADABLE";
/** Does the soul's own declaration name the operator capability (for the remedy only, never for coverage)? */
const declaresOperator = (entry) => obj(entry?.definition?.capabilities) && Object.hasOwn(entry.definition.capabilities, OPERATOR_CAPABILITY);

/**
 * The coverage of the workspace and of `teams` (labels), from one discovery. A soul covers when it is
 * offered (soulCandidates), not disabled here (souls.disabled), resolves as a spawn would (resolveSoul),
 * composes oats.setup, and does not empty the messaging slot the workspace fills (no `slot-none` on
 * messaging in turnedOff: it stays reachable; `knowledge: none` and `tasks: none` are its own choice).
 * It covers a team when the team is among its resolved teams. Souls are resolved in turn until every question is answered.
 *
 * → { known: true, workspace: { covered, by }, teams: [{ label, covered, by }], excluded: [{ soul, code, slots? }] }
 *   | { known: false, reason }
 * A covering soul found is reported whatever else could not be read. Absence is reported only when every
 * source was read: unknown when there is no discovery, when it is the member-only view of an unreadable
 * host, or when a question stays open and a source could not be read (a member discovery dropped as
 * cannot-read, a soul file or listing it could not read, a resolution that hit E_REMOTE_UNREADABLE).
 * Any other refusal is the soul's (a spawn would meet it too): not covering. Never throws.
 */
export async function operatorCoverage({ discovery, local = null, lock = null, teams = [], remoteOptions, remote } = {}) {
  try {
    if (!discovery) return { known: false, reason: "the workspace was not read" };
    if (discovery.standalone === true && discovery.standaloneReason !== "explicit") {
      return { known: false, reason: "only this member was read: its workspace host is not readable here, so the souls it offers are not known" };
    }
    const wanted = [...new Set(teams.filter((l) => typeof l === "string"))];
    const by = { workspace: null, teams: new Map() };
    const excluded = [];
    // What discovery could not read: it drops such a member or soul and carries on.
    const missed = [
      ...(discovery.members || []).filter((m) => m.confirmed === false && m.reason === "cannot-read").map((m) => clip(m.detail || `member ${m.key}`)),
      ...(discovery.problems || []).filter(unreadable).map((p) => clip(p.message || p.path)),
    ];
    const done = () => by.workspace !== null && wanted.every((l) => by.teams.has(l));
    for (const { entry } of soulCandidates(discovery)) {
      if (done()) break;
      const soul = qualifiedSoulName(entry);
      const refuse = (code) => { if (declaresOperator(entry)) excluded.push({ soul, code }); };
      if (disabledEntry(local, entry) !== null) { refuse("E_SOUL_DISABLED"); continue; }
      if (Array.isArray(entry.collides)) { refuse("E_SOUL_AMBIGUOUS"); continue; }
      let res;
      try { res = await resolveSoul(discovery, entry, { local, lock, spawn: {}, remoteOptions, remote }); }
      catch (e) {
        if (unreadable(e)) { missed.push(clip(`${soul}: ${e.message}`)); continue; }
        if (typeof e?.code === "string" && e.code.startsWith("E_")) { refuse(e.code); continue; }
        throw e;
      }
      if (!(res.modules || []).some((m) => m.name === OPERATOR_CAPABILITY)) continue;
      const emptied = (res.turnedOff || []).filter((o) => o.reason === "slot-none" && OPERATOR_SLOTS.has(o.slot));
      if (emptied.length) { excluded.push({ soul, code: "slot-none", slots: [...new Set(emptied.map((o) => o.slot))] }); continue; }
      by.workspace ??= soul;
      for (const t of res.teams || []) if (wanted.includes(t.label) && !by.teams.has(t.label)) by.teams.set(t.label, soul);
    }
    if (!done() && missed.length) {
      return { known: false, reason: `not every source could be read (${some(missed)})` };
    }
    return { known: true, workspace: { covered: by.workspace !== null, by: by.workspace },
      teams: wanted.map((label) => ({ label, covered: by.teams.has(label), by: by.teams.get(label) ?? null })), excluded };
  } catch (e) {
    return { known: false, reason: `operator coverage could not be computed: ${clip(e?.message ?? e)}` };
  }
}

/** The warnings a coverage answer carries, as `{ code, label?, message, remedy, excluded? }` (`excluded`, the
 *  workspace-wide list, on the workspace warning only); one `operator-coverage-unknown` (its remedy
 *  `unknownRemedy`) when it is not known, never an absence; none when everything is covered. */
export function operatorProblems(coverage, { workspace = null, unknownRemedy = "oats sync, then oats souls" } = {}) {
  if (!coverage?.known) return [{ code: "operator-coverage-unknown", message: clip(`operator coverage unknown: ${clip(coverage?.reason ?? "not computed", 700)}; this says nothing about whether an operator soul exists`, MAX_TEXT), remedy: clip(unknownRemedy, MAX_TEXT) }];
  const named = workspace ? `workspace ${workspace}` : "this workspace";
  const why = coverage.excluded.length ? ` (not usable here: ${some(coverage.excluded.map((x) => clip(`${x.soul} ${x.code}${x.slots ? ` ${x.slots.join(",")}` : ""}`)))})` : "";
  const remedy = `give a soul the ${OPERATOR_CAPABILITY} capability in its soul.yaml (reviewed source), keeping the workspace's messaging (no \`messaging: none\`), then \`oats spawn <soul> --preview\``;
  const out = [];
  if (!coverage.workspace.covered) {
    out.push({ code: "operator-soul-missing", message: clip(`no soul ${clip(named)} offers composes ${OPERATOR_CAPABILITY}, so it has no operator soul${why}; ${SEAT}`, MAX_TEXT), remedy, excluded: coverage.excluded });
  }
  for (const t of coverage.teams) {
    if (t.covered) continue;
    out.push({ code: "operator-team-uncovered", label: t.label, message: clip(`no soul composing ${OPERATOR_CAPABILITY} is eligible for team ${clip(t.label)}; ${SEAT}`, MAX_TEXT),
      remedy: clip(`${remedy}, and let it join ${clip(t.label)} (the workspace's souls:)`, MAX_TEXT) });
  }
  return out;
}

/**
 * The remote contract answered from this machine's cache only (offline doctor): the head a repository was
 * last observed at (lastObservedCommit) and the parsed values kept at that commit (peekAtCommit). Never a
 * git process, never the network: any read the cache cannot answer is E_REMOTE_UNREADABLE, which
 * operatorCoverage reports as unknown. The miss carries no access reason, so it is never taken for an
 * unreadable host (no standalone fallback).
 */
export function cacheOnlyRemote() {
  const miss = (what) => Object.assign(new Error(`not in this machine's cache: ${what} (run oats sync)`), { code: "E_REMOTE_UNREADABLE" });
  return {
    parseRepoRef: remoteModule.parseRepoRef,
    observeRemote: async (ref, { at, ...options } = {}) => {
      const commit = remoteModule.lastObservedCommit(ref, { at, ...options });
      if (!commit) throw miss(`the last observed head of ${ref}`);
      const p = remoteModule.parseRepoRef(ref, options);
      return { key: p.key, url: p.url, commit, ref: null, observedAt: null };
    },
    memoAtCommit: async (ref, commit, item, _compute, options = {}) => {
      const value = remoteModule.peekAtCommit(ref, commit, item, options);
      if (value === undefined) throw miss(`${String(item).split("\0")[0]} of ${ref}`);
      return value;
    },
    lastObservedCommit: remoteModule.lastObservedCommit,
    peekAtCommit: remoteModule.peekAtCommit,
    readRemoteFile: async (ref, _commit, path) => { throw miss(`${path} of ${ref}`); },
    listRemoteTree: async (ref, _commit, dir) => { throw miss(`${dir} of ${ref}`); },
    listRemoteFiles: async (ref, _commit, dir) => { throw miss(`${dir} of ${ref}`); },
    fetchRemoteTree: async (ref, _commit, dir) => { throw miss(`${dir} of ${ref}`); },
  };
}
