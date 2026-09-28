/**
 * Team model v2 (docs/design/2026-09-27-team-model-v2.md, option B), pure.
 *
 * Where teams live:
 *   - the committed oats-workspace.yaml `teams.<label> = { description?, team? }`: SHARED teams (edited
 *     by PR). A shared team without `team` is declared but not yet created (unmapped);
 *   - the deployment's oats-local.yaml `teams.<label> = { team, description? }`: LOCAL teams, plus
 *     `defaultTeam: <label>`, `souls.teams: { "*" | <soul key>: [labels] }` and
 *     `souls.default: { <soul key>: <label> }`.
 * A soul key is the soul's bare name, or `<package>/<soul>` for a package soul.
 *
 * Resolution: labels = shared ∪ local (a label in both is `team-label-collision`; the SHARED definition
 * wins). defaultOf(soul) = souls.default[soul] ?? defaultTeam; a soul's teams = {defaultOf} ∪
 * souls.teams["*"] ∪ souls.teams[soul]. An undeclared label the soul reaches is E_TEAM_UNKNOWN; a
 * souls.default outside the soul's teams is E_TEAM_NOT_ELIGIBLE.
 *
 * Rows (docs/desktop-cli-api.md, Team model v2): TeamRow { label, team, default, from: shared|local },
 * the default first, then by label. Reports carry unmapped rows (team null); OATS_TEAMS and
 * instance.json carry mapped rows only. DefaultTeam { label, team, from: deployment|soul } | null.
 */
import { oatsError } from "./errors.mjs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v ? v : null);
const labelsOf = (v) => (Array.isArray(v) ? v.filter((l) => typeof l === "string") : []);
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pointerKey = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");
function fail(code, message, details) {
  const e = oatsError(code, message, details);
  e.details = details;
  return e;
}

export const LOCAL_FILE = "oats-local.yaml";
/** What 0.30 removed, named by the schema problems that replace them. */
export const TEAM_MEMBERSHIP_MOVED = "team membership is local since 0.30: `oats soul teams`";
export const BY_TEAM_REMOVED = "byTeam was removed in 0.30: a team's provider id is teams.<label>.team (oats-workspace.yaml for a shared team, oats-local.yaml for a local one)";

const UNMAPPED_FIX = "its owner runs `oats aweb setup`, then commits the id";

/** The deployment's teams from the committed workspace and oats-local.yaml (either may be null). */
export function teamModel(workspace, local, { workspaceKey = null } = {}) {
  const shared = new Map(), localTeams = new Map();
  for (const [label, def] of Object.entries(isObject(workspace?.teams) ? workspace.teams : {})) {
    shared.set(label, { label, team: str(def?.team), description: str(def?.description), from: "shared",
      at: `${workspaceKey ? `${workspaceKey}:` : ""}oats-workspace.yaml#/teams/${pointerKey(label)}` });
  }
  for (const [label, def] of Object.entries(isObject(local?.teams) ? local.teams : {})) {
    localTeams.set(label, { label, team: str(def?.team), description: str(def?.description), from: "local", at: `${LOCAL_FILE}#/teams/${pointerKey(label)}` });
  }
  const souls = isObject(local?.souls) ? local.souls : {};
  return {
    shared, local: localTeams,
    labels: new Map([...localTeams, ...shared]), // the committed definition wins a collision
    defaultTeam: str(local?.defaultTeam),
    souls: { teams: isObject(souls.teams) ? souls.teams : {}, default: isObject(souls.default) ? souls.default : {} },
  };
}

/** The key a soul has in souls.teams / souls.default. */
export function soulKeyOf(soulEntry) {
  return typeof soulEntry?.package === "string" && typeof soulEntry.qualifiedName === "string" ? soulEntry.qualifiedName : soulEntry.name;
}

const unknown = (label, at) => fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared (${at}): declare it with \`oats teams add\`, or in oats-workspace.yaml teams: for a shared team`, { label, at });

/**
 * One soul's teams here (key "*": the deployment default + souls.teams["*"]).
 * → { key, defaultTeam: DefaultTeam | null, teams: [TeamRow + via] } | throws E_TEAM_UNKNOWN / E_TEAM_NOT_ELIGIBLE.
 * `via` ⊂ ["default", "*", "soul"], in that order: why the soul has the team.
 */
export function soulTeams(model, key) {
  const known = (label, at) => { if (!model.labels.has(label)) throw unknown(label, at); };
  if (model.defaultTeam !== null) known(model.defaultTeam, `${LOCAL_FILE}#/defaultTeam`);
  const star = labelsOf(model.souls.teams["*"]);
  star.forEach((l, i) => known(l, `${LOCAL_FILE}#/souls/teams/*/${i}`));
  const own = key === "*" ? [] : labelsOf(model.souls.teams[key]);
  own.forEach((l, i) => known(l, `${LOCAL_FILE}#/souls/teams/${pointerKey(key)}/${i}`));
  const override = key === "*" ? null : str(model.souls.default[key]);
  if (override !== null) {
    const at = `${LOCAL_FILE}#/souls/default/${pointerKey(key)}`;
    known(override, at);
    if (override !== model.defaultTeam && !star.includes(override) && !own.includes(override)) {
      throw fail("E_TEAM_NOT_ELIGIBLE", `souls.default.${key} is ${JSON.stringify(override)}, which is not one of ${key}'s teams here — add it first (\`oats soul teams ${key} --add ${override}\`)`, { soul: key, label: override, at });
    }
  }
  const defaultLabel = override ?? model.defaultTeam;
  const via = new Map();
  const add = (label, why) => { const v = via.get(label) ?? []; if (!v.includes(why)) v.push(why); via.set(label, v); };
  if (defaultLabel !== null) add(defaultLabel, "default");
  for (const l of star) add(l, "*");
  for (const l of own) add(l, "soul");
  const teams = [...via].map(([label, v]) => {
    const d = model.labels.get(label);
    return { label, team: d.team, default: label === defaultLabel, from: d.from, via: v };
  }).sort((a, b) => (b.default - a.default) || byCodepoint(a.label, b.label));
  const defaultTeam = defaultLabel === null ? null : { label: defaultLabel, team: model.labels.get(defaultLabel).team, from: override !== null ? "soul" : "deployment" };
  return { key, defaultTeam, teams };
}

/** TeamRows as the reports carry them (unmapped included, no `via`). */
export const reportRows = (teams) => (teams || []).map(({ label, team, default: d, from }) => ({ label, team, default: d, from }));
/** TeamRows as OATS_TEAMS and instance.json carry them: mapped only. */
export const envRows = (teams) => reportRows(teams).filter((r) => r.team !== null);

/** Every reference to `label` in oats-local.yaml, in written order (`oats teams remove` refuses on any). */
export function teamReferences(model, label) {
  const refs = [];
  if (model.defaultTeam === label) refs.push("defaultTeam");
  for (const [key, list] of Object.entries(model.souls.teams)) if (labelsOf(list).includes(label)) refs.push(`souls.teams:${key}`);
  for (const [key, l] of Object.entries(model.souls.default)) if (l === label) refs.push(`souls.default:${key}`);
  return refs;
}

const collisionProblem = (label, shared, local) => ({
  code: "team-label-collision", label, severity: "warning",
  shared: { team: shared.team, description: shared.description, at: shared.at },
  local: { team: local.team, description: local.description, at: local.at },
  message: `team ${label} is declared in both oats-workspace.yaml (shared) and oats-local.yaml (local); the shared definition wins`,
  fix: "rename the local label in oats-local.yaml",
});
const unmappedProblem = (d, isDefault) => isDefault
  ? { code: "team-unmapped", label: d.label, default: true, severity: "failure", at: d.at, message: `the default team ${d.label} has no provider id yet`, fix: `${UNMAPPED_FIX}; or choose another default with \`oats teams default\`` }
  : { code: "team-unmapped", label: d.label, default: false, severity: "warning", at: d.at, message: `shared team ${d.label} has no provider id yet`, fix: UNMAPPED_FIX };
const unconfiguredProblem = () => ({ code: "E_TEAM_UNCONFIGURED", severity: "failure", message: "no teams configured: run `oats aweb setup`", fix: "run `oats aweb setup` (it creates the teams and sets the default), or `oats teams add <label> --team <id>`" });
const refusalProblem = (e) => ({ code: e.code, ...e.details, severity: "failure", message: e.message,
  fix: e.code === "E_TEAM_UNKNOWN" ? "declare the team (`oats teams add`), or remove the reference" : "add the label to the soul's teams (`oats soul teams … --add`), or clear its default (`--clear-default`)" });

/**
 * Readiness problems. Without `key`: the deployment's (`oats teams`): collisions, unmapped shared
 * teams (a failure when it is `defaultTeam`), every unknown reference, every ineligible
 * souls.default. With `key`: only what concerns that soul (`default` marks ITS default).
 * `messaging`: a messaging layer is active, so no default is E_TEAM_UNCONFIGURED.
 */
export function teamProblems(model, { key = null, messaging = false } = {}) {
  const problems = [];
  if (key !== null) {
    let t;
    try { t = soulTeams(model, key); }
    catch (e) { if (e.code === "E_TEAM_UNKNOWN" || e.code === "E_TEAM_NOT_ELIGIBLE") return [refusalProblem(e)]; throw e; }
    for (const r of t.teams) if (model.shared.has(r.label) && model.local.has(r.label)) problems.push(collisionProblem(r.label, model.shared.get(r.label), model.local.get(r.label)));
    for (const r of t.teams) if (r.team === null) problems.push(unmappedProblem(model.labels.get(r.label), r.default));
    if (messaging && t.defaultTeam === null) problems.push(unconfiguredProblem());
    return problems;
  }
  const labels = [...model.labels.keys()].sort(byCodepoint);
  for (const label of labels) if (model.shared.has(label) && model.local.has(label)) problems.push(collisionProblem(label, model.shared.get(label), model.local.get(label)));
  for (const label of labels) { const d = model.labels.get(label); if (d.team === null) problems.push(unmappedProblem(d, label === model.defaultTeam)); }
  const known = (label, at) => { if (!model.labels.has(label)) problems.push(refusalProblem(unknown(label, at))); };
  if (model.defaultTeam !== null) known(model.defaultTeam, `${LOCAL_FILE}#/defaultTeam`);
  for (const [k, list] of Object.entries(model.souls.teams)) labelsOf(list).forEach((l, i) => known(l, `${LOCAL_FILE}#/souls/teams/${pointerKey(k)}/${i}`));
  for (const [k, l] of Object.entries(model.souls.default)) if (typeof l === "string") known(l, `${LOCAL_FILE}#/souls/default/${pointerKey(k)}`);
  for (const [k, l] of Object.entries(model.souls.default)) {
    if (typeof l !== "string" || !model.labels.has(l)) continue;
    try { soulTeams(model, k); } catch (e) { if (e.code === "E_TEAM_NOT_ELIGIBLE" && e.details.soul === k) problems.push(refusalProblem(e)); else if (e.code !== "E_TEAM_UNKNOWN") throw e; }
  }
  if (messaging && model.defaultTeam === null) problems.push(unconfiguredProblem());
  return problems;
}

/**
 * The provider environment (docs/desktop-cli-api.md, The provider environment) from a soul's teams
 * `{ defaultTeam, teams, source: "live"|"recorded" }`, or null when they are not known. A name that
 * does not apply is `undefined`, so a child process never inherits an ambient value. The pre-0.30
 * names are always unset.
 */
export function teamsEnv(t) {
  const known = isObject(t) && Array.isArray(t.teams);
  const d = known && isObject(t.defaultTeam) ? t.defaultTeam : null;
  return {
    OATS_DEFAULT_TEAM: d?.label ?? undefined,
    OATS_DEFAULT_TEAM_ID: d?.team ?? undefined,
    OATS_DEFAULT_TEAM_FROM: d?.from ?? undefined,
    OATS_TEAMS: known ? JSON.stringify(envRows(t.teams)) : undefined,
    OATS_TEAMS_SOURCE: known && (t.source === "live" || t.source === "recorded") ? t.source : undefined,
    OATS_TEAM_LABEL: undefined, OATS_TEAM_LABELS: undefined, OATS_TEAM_ID: undefined,
  };
}

/** A home's spawn-time teams (instance.json `teams` / `defaultTeam`) → { teams, defaultTeam }; teams null
 *  when the home recorded none in this shape (spawned before 0.30: its teams are unknown, never guessed). */
export function recordedTeams(meta) {
  const rows = Array.isArray(meta?.teams) && meta.teams.every((r) => isObject(r) && typeof r.label === "string" && typeof r.default === "boolean") ? meta.teams : null;
  const d = isObject(meta?.defaultTeam) && typeof meta.defaultTeam.label === "string" ? meta.defaultTeam : null;
  return { teams: rows, defaultTeam: rows ? d : null };
}
