/**
 * The team model v2 verbs (docs/desktop-cli-api.md, `oats teams`, `oats soul teams`): CONFIG ONLY — they
 * never call a provider. Each reads the deployment's oats-local.yaml and the committed shared teams, and a
 * mutation rewrites oats-local.yaml in place (comments and every other key kept), after validating the
 * result: the local schema, and no label reference the write would leave unknown or ineligible.
 */
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { validateLocal } from "./workspace.mjs";
import { soulTeams, teamModel, teamProblems, teamReferences } from "./teams.mjs";
import { writeFileAtomic } from "./packages.mjs";

export const TEAMS_API = 1, SOUL_TEAMS_API = 1;
const LABEL_RE = /^[a-z0-9][a-z0-9._-]*$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function fail(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** Whether a messaging layer is active in this deployment: the workspace fills the messaging slot. */
const messagingActive = (workspace) => isObject(workspace?.defaults?.messaging);

/** `oats teams --json`. `ctx`: { deployment, local, workspace (the committed file, or null), workspaceKey }. */
export function teamsDocument(ctx) {
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  const teams = [...model.labels.values()].sort((a, b) => byCodepoint(a.label, b.label))
    .map((d) => ({ label: d.label, team: d.team, description: d.description, from: d.from, default: d.label === model.defaultTeam, at: d.at }));
  return {
    teamsApi: TEAMS_API, deployment: ctx.deployment, defaultTeam: model.defaultTeam, teams,
    souls: { teams: structuredClone(model.souls.teams), default: structuredClone(model.souls.default) },
    problems: teamProblems(model, { messaging: messagingActive(ctx.workspace) }),
  };
}

/** `oats soul teams <soul>|'*' --json`: `key` is the soul's key ("*" for every soul), `soul` its name. */
export function soulTeamsDocument(ctx, { soul, key }) {
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  const t = soulTeams(model, key);
  const list = (v) => (Array.isArray(v) ? [...v] : []);
  return {
    soulTeamsApi: SOUL_TEAMS_API, soul, key, defaultTeam: t.defaultTeam, teams: t.teams,
    local: { teams: list(model.souls.teams[key]), default: key === "*" ? null : model.souls.default[key] ?? null },
    all: list(model.souls.teams["*"]),
  };
}

/* ───────────────────────────── writing oats-local.yaml ─────────────────── */

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
/** The four team keys of a local value, as plain data. */
const teamState = (local) => ({
  teams: clone(isObject(local?.teams) ? local.teams : {}),
  defaultTeam: typeof local?.defaultTeam === "string" ? local.defaultTeam : null,
  soulsTeams: clone(isObject(local?.souls?.teams) ? local.souls.teams : {}),
  soulsDefault: clone(isObject(local?.souls?.default) ? local.souls.default : {}),
});
/** The refusals a state carries (unknown / ineligible references), keyed so a write can tell new ones. */
const refusals = (ctx, local) => new Map(teamProblems(teamModel(ctx.workspace, local, { workspaceKey: ctx.workspaceKey }))
  .filter((p) => p.code === "E_TEAM_UNKNOWN" || p.code === "E_TEAM_NOT_ELIGIBLE").map((p) => [`${p.code} ${p.at}`, p]));

/**
 * Apply `mutate(state)` (it edits the plain `state` from teamState and may throw a refusal) and rewrite
 * oats-local.yaml in place; `check(local)` may refuse the result before anything is written.
 * → { changed, local } (the local value after the write).
 */
function editLocal(ctx, mutate, { check } = {}) {
  const before = teamState(ctx.local);
  const next = teamState(ctx.local);
  mutate(next);
  if (JSON.stringify(next) === JSON.stringify(before)) return { changed: false, local: ctx.local };
  const text = readFileSync(ctx.localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw fail("E_WORKSPACE_SCHEMA", `${ctx.localPath}: ${doc.errors[0].message}`, { path: ctx.localPath });
  const put = (path, value, empty) => {
    if (JSON.stringify(value) === JSON.stringify(path.reduce((o, k) => (isObject(o) ? o[k] : undefined), ctx.local) ?? empty)) return;
    if (value === null || (isObject(value) && !Object.keys(value).length)) { if (doc.hasIn(path)) doc.deleteIn(path); }
    else doc.setIn(path, value);
  };
  put(["teams"], next.teams, {});
  put(["defaultTeam"], next.defaultTeam, null);
  put(["souls", "teams"], next.soulsTeams, {});
  put(["souls", "default"], next.soulsDefault, {});
  const souls = doc.get("souls");
  if (souls && typeof souls.toJSON === "function" && !Object.keys(souls.toJSON() || {}).length) doc.delete("souls");
  const out = doc.toString();
  const local = parseConfigData(out, { origin: { kind: "local", path: ctx.localPath } }).value;
  const problems = validateLocal(local);
  if (problems.length) throw fail("E_WORKSPACE_SCHEMA", `the rewritten oats-local.yaml would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`, { problems });
  const had = refusals(ctx, ctx.local);
  for (const [k, p] of refusals(ctx, local)) if (!had.has(k)) throw fail(p.code, `${p.message}; nothing was written`, Object.fromEntries(Object.entries(p).filter(([key]) => !["code", "severity", "message", "fix"].includes(key))));
  if (check) check(local);
  writeFileAtomic(ctx.localPath, out);
  return { changed: true, local };
}

const assertLabel = (label) => {
  if (typeof label !== "string" || !LABEL_RE.test(label)) throw fail("E_BAD_ARGS", `${JSON.stringify(label)} is not a team label (lowercase letters, digits, and . _ - after the first)`, { label });
};

/** `oats teams add <label> --team <id> [--description <d>]` → { changed, local }. */
export function teamsAdd(ctx, label, { team, description } = {}) {
  assertLabel(label);
  if (typeof team !== "string" || !team.trim()) throw fail("E_BAD_ARGS", "oats teams add needs --team <provider team id>", { label });
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  if (model.labels.has(label)) {
    const from = model.labels.get(label).from;
    throw fail("E_TEAM_EXISTS", `team ${label} is already declared (${from === "shared" ? "shared, in oats-workspace.yaml" : "local, in oats-local.yaml"})${from === "local" ? ": remove it first (`oats teams remove`) to redefine it" : ""}`, { label, from });
  }
  return editLocal(ctx, (s) => {
    s.teams[label] = { team: team.trim(), ...(typeof description === "string" && description ? { description } : {}) };
    // The first team added becomes the deployment's default.
    if (s.defaultTeam === null) s.defaultTeam = label;
  });
}

/** `oats teams remove <label>`: a LOCAL team nothing references (no cascade). */
export function teamsRemove(ctx, label) {
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  if (!model.local.has(label)) {
    if (model.shared.has(label)) throw fail("E_TEAM_SHARED", `team ${label} is shared (declared in oats-workspace.yaml): it is edited by a PR to that file, never removed here`, { label, at: model.shared.get(label).at });
    throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared`, { label });
  }
  // A label also declared in the committed file still resolves after the local copy goes (the
  // collision's fix): its references stay valid, so only a purely local label must be unreferenced.
  const usedBy = model.shared.has(label) ? [] : teamReferences(model, label);
  if (usedBy.length) throw fail("E_TEAM_IN_USE", `team ${label} is still referenced (${usedBy.join(", ")}): remove the references first (\`oats teams default\`, \`oats soul teams … --remove ${label}\`)`, { label, usedBy });
  return editLocal(ctx, (s) => { delete s.teams[label]; });
}

/** `oats teams default <label>`: a label of either file. */
export function teamsDefault(ctx, label) {
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  if (!model.labels.has(label)) throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared: \`oats teams add\` it first`, { label });
  return editLocal(ctx, (s) => { s.defaultTeam = label; });
}

/**
 * `oats soul teams <soul>|'*' [--add a,b] [--remove a,b] [--default <l> | --clear-default]`.
 * `key` is the soul's key ("*" for every soul). → { changed, local }.
 */
export function soulTeamsEdit(ctx, key, { add = [], remove = [], setDefault = null, clearDefault = false } = {}) {
  if (key === "*" && (setDefault !== null || clearDefault)) throw fail("E_BAD_ARGS", "a default is per soul: --default / --clear-default need a soul, not '*' (the deployment's default is `oats teams default`)", { soul: key });
  if (setDefault !== null && clearDefault) throw fail("E_BAD_ARGS", "choose --default <label> or --clear-default, not both");
  const model = teamModel(ctx.workspace, ctx.local, { workspaceKey: ctx.workspaceKey });
  for (const label of [...add, ...remove, ...(setDefault !== null ? [setDefault] : [])]) {
    if (!model.labels.has(label)) throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared: \`oats teams add\` it first`, { label });
  }
  // --default must name one of the soul's teams after the write.
  const check = setDefault === null ? undefined : (local) => {
    try { soulTeams(teamModel(ctx.workspace, local, { workspaceKey: ctx.workspaceKey }), key); }
    catch (e) { if (e.code === "E_TEAM_NOT_ELIGIBLE") throw fail("E_TEAM_NOT_ELIGIBLE", `${e.message}; nothing was written`, { soul: key, label: setDefault }); throw e; }
  };
  return editLocal(ctx, (s) => {
    const list = Array.isArray(s.soulsTeams[key]) ? s.soulsTeams[key] : [];
    const next = [...list.filter((l) => !remove.includes(l)), ...add.filter((l) => !list.includes(l) && !remove.includes(l))].filter((l, i, a) => a.indexOf(l) === i);
    if (next.length) s.soulsTeams[key] = next; else delete s.soulsTeams[key];
    if (clearDefault) delete s.soulsDefault[key];
    if (setDefault !== null) s.soulsDefault[key] = setDefault;
  }, { check });
}
