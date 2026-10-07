/**
 * The team model 3 verbs (docs/desktop-cli-api.md, `oats teams`, `oats soul teams`): CONFIG ONLY — they
 * never call a provider. Each reads the deployment's oats-local.yaml and the committed workspace file. The
 * mutations (`oats teams add|remove|default`) edit the deployment's LOCAL teams and default, so they run only
 * where the workspace allows local teams (`localTeams: true`, or the standalone view); they rewrite
 * oats-local.yaml in place (comments and every other key kept), after validating the result: the local
 * schema, and no label reference the write would leave unknown. A soul's teams are the workspace's
 * `souls:`, edited by a PR to that file: `oats soul teams` only reads them.
 */
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { teamLabelProblem, validateLocal } from "./workspace.mjs";
import { TEAM_ID_RE, localTeamsClosed, soulTeams, teamModel, teamProblems, teamReferences } from "./teams.mjs";
import { writeFileAtomic } from "./packages.mjs";

export const TEAMS_API = 2, SOUL_TEAMS_API = 2;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function fail(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** Whether a messaging layer is active in this deployment: the workspace fills the messaging slot. */
const messagingActive = (workspace) => isObject(workspace?.defaults?.messaging);

/** The default a soul without a `souls:` default gets here: the local one (where local teams are allowed),
 *  else the workspace's → DefaultTeam | null. */
function deploymentDefault(model) {
  const [label, from] = model.localDefault !== null && model.labels.has(model.localDefault) ? [model.localDefault, "deployment"]
    : model.workspaceDefault !== null ? [model.workspaceDefault, "workspace"] : [null, null];
  return label === null || !model.labels.has(label) ? null : { label, team: model.labels.get(label).team, from };
}

/** `oats teams --json`. `ctx`: { deployment, local, workspace (the committed file, or null: standalone), workspaceKey,
 *  soulKeys (the discovered souls' keys, for the `team-soul-unknown` typo guard; null when not known) }. */
export function teamsDocument(ctx) {
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  const def = deploymentDefault(model);
  const teams = [...model.labels.values()].sort((a, b) => byCodepoint(a.label, b.label))
    .map((d) => ({ label: d.label, team: d.team, description: d.description, from: d.from, default: d.label === def?.label, at: d.at }));
  return {
    teamsApi: TEAMS_API, deployment: ctx.deployment, localTeams: model.localTeams, defaultTeam: def, teams,
    souls: structuredClone(model.souls),
    problems: teamProblems(model, { messaging: messagingActive(ctx.workspace), soulKeys: ctx.soulKeys ?? null }),
  };
}

/** `oats soul teams <soul>|'*' --json`: `key` is the soul's key (teamKeyOf; "*" for the "*" pattern), `soul` its name. */
export function soulTeamsDocument(ctx, { soul, key }) {
  const t = soulTeams(teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey }), key);
  return { soulTeamsApi: SOUL_TEAMS_API, soul, key, match: t.match, defaultMatch: t.defaultMatch, defaultTeam: t.defaultTeam, teams: t.teams };
}

/* ───────────────────────────── writing oats-local.yaml ─────────────────── */

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
/** The two team keys of a local value, as plain data. */
const teamState = (local) => ({
  teams: clone(isObject(local?.teams) ? local.teams : {}),
  defaultTeam: typeof local?.defaultTeam === "string" ? local.defaultTeam : null,
});
const modelOf = (ctx, local) => teamModel(ctx.workspace, local, { workspaceKey: ctx.workspaceKey });
/** The refusals a state carries (unknown references), keyed so a write can tell new ones. */
const refusals = (ctx, local) => new Map(teamProblems(modelOf(ctx, local))
  .filter((p) => p.code === "E_TEAM_UNKNOWN").map((p) => [`${p.code} ${p.at}`, p]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readLocal = (ctx) => {
  const text = readFileSync(ctx.localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw fail("E_WORKSPACE_SCHEMA", `${ctx.localPath}: ${doc.errors[0].message}`, { path: ctx.localPath });
  return { text, doc, local: parseConfigData(text, { origin: { kind: "local", path: ctx.localPath } }).value };
};

/**
 * Edit `doc` from `before` to `next` SURGICALLY: only the entries that change are touched, so comments and
 * styles on everything else (inline comments on sibling entries) are kept. A map left empty is removed.
 */
function applyState(doc, before, next) {
  const map = (path, from, to, entry) => {
    for (const k of Object.keys(from)) if (!Object.hasOwn(to, k)) doc.deleteIn([...path, k]);
    for (const [k, v] of Object.entries(to)) if (!same(from[k], v)) entry([...path, k], from[k], v);
    const node = doc.getIn(path);
    if (YAML.isMap(node) && node.items.length === 0) doc.deleteIn(path);
  };
  // A team definition, key by key (its own comments stay on untouched keys).
  map(["teams"], before.teams, next.teams, (path, was, now) => {
    if (!isObject(was) || !YAML.isMap(doc.getIn(path))) { doc.setIn(path, now); return; }
    for (const k of Object.keys(was)) if (!Object.hasOwn(now, k)) doc.deleteIn([...path, k]);
    for (const [k, v] of Object.entries(now)) if (!same(was[k], v)) doc.setIn([...path, k], v);
  });
  if (next.defaultTeam !== before.defaultTeam) { if (next.defaultTeam === null) doc.deleteIn(["defaultTeam"]); else doc.setIn(["defaultTeam"], next.defaultTeam); }
}

/**
 * Rewrite oats-local.yaml. `mutate(state, model)` edits the plain `state` (teamState) and may throw a
 * refusal; both come from the file AS IT IS NOW (re-read here, never the command's startup snapshot), so
 * two verbs running together cannot drop each other's change: the write is compare-and-swap — when the
 * file changed after this read, the edit is redone on the new content (a few times, then E_LOCAL_CHANGED).
 * `verb` names the command and `writes` the keys it adds, for the refusal where the workspace does not
 * allow local teams (local-teams-closed); a verb that only takes local teams away (`writes: null`) runs
 * there too, since it moves the file toward what the workspace allows. → { changed, local } (the value now).
 */
function editLocal(ctx, { verb, writes }, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { text, doc, local: current } = readLocal(ctx);
    const model = modelOf(ctx, current);
    if (model.localTeams === false && writes !== null) throw localTeamsClosed(writes, { verb });
    const before = teamState(current);
    const next = teamState(current);
    mutate(next, model);
    if (same(next, before)) return { changed: false, local: current };
    applyState(doc, before, next);
    const out = doc.toString();
    const local = parseConfigData(out, { origin: { kind: "local", path: ctx.localPath } }).value;
    const problems = validateLocal(local);
    if (problems.length) throw fail("E_WORKSPACE_SCHEMA", `the rewritten oats-local.yaml would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`, { problems });
    const had = refusals(ctx, current);
    for (const [k, p] of refusals(ctx, local)) if (!had.has(k)) throw fail(p.code, `${p.message}; nothing was written`, Object.fromEntries(Object.entries(p).filter(([key]) => !["code", "severity", "message", "fix"].includes(key))));
    if (readFileSync(ctx.localPath, "utf8") !== text) continue; // changed under us: redo on the new content
    writeFileAtomic(ctx.localPath, out);
    return { changed: true, local };
  }
  throw fail("E_LOCAL_CHANGED", `${ctx.localPath} kept changing while this edit ran; nothing was written — run it again`, { path: ctx.localPath });
}

const assertLabel = (label) => {
  const problem = teamLabelProblem(label);
  if (problem) throw fail("E_BAD_ARGS", `not a team label (lowercase letters, digits, and . _ - after the first; at most 64 characters): ${problem}`, { label });
};

/** `oats teams add <label> --team <id> [--description <d>]` → { changed, local }. */
export function teamsAdd(ctx, label, { team, description } = {}) {
  assertLabel(label);
  if (typeof team !== "string" || !team.trim()) throw fail("E_BAD_ARGS", "oats teams add needs --team <provider team id>", { label });
  if (!TEAM_ID_RE.test(team.trim())) throw fail("E_BAD_ARGS", `${JSON.stringify(team)} is not a team id: it must match ${TEAM_ID_RE.source} (a letter or digit first; no whitespace or control characters; at most 256 characters)`, { label, team });
  return editLocal(ctx, { verb: "oats teams add", writes: ["teams"] }, (s, model) => {
    if (model.labels.has(label)) {
      const from = model.labels.get(label).from;
      throw fail("E_TEAM_EXISTS", `team ${label} is already declared (${from === "shared" ? "shared, in oats-workspace.yaml" : "local, in oats-local.yaml"})${from === "local" ? ": remove it first (`oats teams remove`) to redefine it" : ""}`, { label, from });
    }
    s.teams[label] = { team: team.trim(), ...(typeof description === "string" && description ? { description } : {}) };
    // The first team added becomes the deployment's default.
    if (s.defaultTeam === null) s.defaultTeam = label;
  });
}

/** `oats teams remove <label>`: a LOCAL team nothing references (no cascade). Allowed where the workspace
 *  does not allow local teams: removing them is the last step of committing them there. */
export function teamsRemove(ctx, label) {
  return editLocal(ctx, { verb: "oats teams remove", writes: null }, (s, model) => {
    if (!model.local.has(label)) {
      if (model.shared.has(label)) throw fail("E_TEAM_SHARED", `team ${label} is shared (declared in oats-workspace.yaml): it is edited by a PR to that file, never removed here`, { label, at: model.shared.get(label).at });
      throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared`, { label });
    }
    // A label also declared in the committed file still resolves after the local copy goes (the
    // collision's fix): its references stay valid, so only a purely local label must be unreferenced.
    const usedBy = model.shared.has(label) ? [] : teamReferences(model, label);
    if (usedBy.length) throw fail("E_TEAM_IN_USE", `team ${label} is still referenced (${usedBy.join(", ")}): choose another default first (\`oats teams default\`)`, { label, usedBy });
    delete s.teams[label];
  });
}

/** `oats teams default <label>`: a label of either file. */
export function teamsDefault(ctx, label) {
  return editLocal(ctx, { verb: "oats teams default", writes: ["defaultTeam"] }, (s, model) => {
    if (!model.labels.has(label)) throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared: \`oats teams add\` it first`, { label });
    s.defaultTeam = label;
  });
}
