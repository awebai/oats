// Operator coverage (awebai/oats#671, #709): does a soul this workspace offers compose the operator
// capability, oats.setup, for the workspace and for each team? Detected by composition, never by a
// soul's name and never by a role marker (maintainer decision on #671). A warning only: readiness and
// doctor report it; nothing refuses, spawns or writes. An eligible soul is not a launched seat.
import * as remoteModule from "./remote.mjs";
import { disabledEntry, qualifiedSoulName, soulCandidates } from "./instance-resolution.mjs";
import { resolveSoul } from "./resolve.mjs";

export const OPERATOR_CAPABILITY = "oats.setup";
const SEAT = "an eligible soul is not a launched seat";

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const unavailable = (e) => typeof e?.code === "string" && e.code.startsWith("E_REMOTE_");
/** Does the soul's own declaration name the operator capability (for the remedy only, never for coverage)? */
const declaresOperator = (entry) => obj(entry?.definition?.capabilities) && Object.hasOwn(entry.definition.capabilities, OPERATOR_CAPABILITY);

/**
 * The coverage of the workspace and of `teams` (labels), from one discovery. A soul covers when it is
 * offered (soulCandidates), not disabled here (souls.disabled), resolves as a spawn would (resolveSoul),
 * composes oats.setup, and empties no layer slot the workspace selects (no `slot-none` in turnedOff:
 * the operator keeps the workspace's chosen core, messaging and knowledge). It covers a team when the
 * team is among its resolved teams. Souls are resolved in turn until every question is answered.
 *
 * → { known: true, workspace: { covered, by }, teams: [{ label, covered, by }], excluded: [{ soul, code }] }
 *   | { known: false, reason }
 * Unknown when the inputs are not there: no discovery, the member-only view of an unreadable host, or a
 * resolution that could not read its sources (E_REMOTE_*). Never throws.
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
        if (unavailable(e)) return { known: false, reason: `${soul} could not be resolved: ${e.message}` };
        if (typeof e?.code === "string" && e.code.startsWith("E_")) { refuse(e.code); continue; }
        throw e;
      }
      if (!(res.modules || []).some((m) => m.name === OPERATOR_CAPABILITY)) continue;
      const emptied = (res.turnedOff || []).filter((o) => o.reason === "slot-none");
      if (emptied.length) { excluded.push({ soul, code: "slot-none", slots: emptied.map((o) => o.slot) }); continue; }
      by.workspace ??= soul;
      for (const t of res.teams || []) if (wanted.includes(t.label) && !by.teams.has(t.label)) by.teams.set(t.label, soul);
    }
    return { known: true, workspace: { covered: by.workspace !== null, by: by.workspace },
      teams: wanted.map((label) => ({ label, covered: by.teams.has(label), by: by.teams.get(label) ?? null })), excluded };
  } catch (e) {
    return { known: false, reason: `operator coverage could not be computed: ${e?.message ?? e}` };
  }
}

/** The warnings a coverage answer carries, as `{ code, label?, message, remedy, excluded? }`; one
 *  `operator-coverage-unknown` (its remedy `unknownRemedy`) when it is not known, never an absence;
 *  none when everything is covered. */
export function operatorProblems(coverage, { workspace = null, unknownRemedy = "oats sync" } = {}) {
  if (!coverage?.known) return [{ code: "operator-coverage-unknown", message: `operator coverage unknown: ${coverage?.reason ?? "not computed"}; this says nothing about whether an operator soul exists`, remedy: unknownRemedy }];
  const named = workspace ? `workspace ${workspace}` : "this workspace";
  const why = coverage.excluded.length ? ` (declared but not usable here: ${coverage.excluded.map((x) => `${x.soul} ${x.code}${x.slots ? ` ${x.slots.join(",")}` : ""}`).join("; ")})` : "";
  const remedy = `give a soul the ${OPERATOR_CAPABILITY} capability in its soul.yaml (reviewed source), keeping the workspace's core, messaging and knowledge, then \`oats spawn <soul> --preview\``;
  const out = [];
  if (!coverage.workspace.covered) {
    out.push({ code: "operator-soul-missing", message: `no soul ${named} offers composes ${OPERATOR_CAPABILITY}, so it has no operator soul${why}; ${SEAT}`, remedy, excluded: coverage.excluded });
  }
  for (const t of coverage.teams) {
    if (t.covered) continue;
    out.push({ code: "operator-team-uncovered", label: t.label, message: `no soul composing ${OPERATOR_CAPABILITY} is eligible for team ${t.label}${why}; ${SEAT}`,
      remedy: `${remedy}, and let it join ${t.label} (the workspace's souls:)`, excluded: coverage.excluded });
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
