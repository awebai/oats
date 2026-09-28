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
import { LOCAL_FILE, TEAM_ID_RE, pointerKey, soulTeams, teamModel, teamProblems, teamReferences } from "./teams.mjs";
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
const modelOf = (ctx, local) => teamModel(ctx.workspace, local, { workspaceKey: ctx.workspaceKey });
/** The refusals a state carries (unknown / ineligible references), keyed so a write can tell new ones. */
const refusals = (ctx, local) => new Map(teamProblems(modelOf(ctx, local))
  .filter((p) => p.code === "E_TEAM_UNKNOWN" || p.code === "E_TEAM_NOT_ELIGIBLE").map((p) => [`${p.code} ${p.at}`, p]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readLocal = (ctx) => {
  const text = readFileSync(ctx.localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw fail("E_WORKSPACE_SCHEMA", `${ctx.localPath}: ${doc.errors[0].message}`, { path: ctx.localPath });
  return { text, doc, local: parseConfigData(text, { origin: { kind: "local", path: ctx.localPath } }).value };
};

/**
 * Edit `doc` from `before` to `next` SURGICALLY: only the entries that change are touched, so comments and
 * styles on everything else (inline comments on sibling entries, flow sequences) are kept. A map or list
 * left empty is removed, and so is an empty `souls`.
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
  // A soul's list, item by item (its style — flow or block — and the other items' comments stay).
  map(["souls", "teams"], before.soulsTeams, next.soulsTeams, (path, was, now) => {
    const seq = doc.getIn(path, true);
    if (!Array.isArray(was) || !YAML.isSeq(seq)) { doc.setIn(path, now); return; }
    seq.items = seq.items.filter((item) => now.includes(YAML.isScalar(item) ? item.value : item));
    for (const label of now) if (!was.includes(label)) seq.items.push(doc.createNode(label));
  });
  map(["souls", "default"], before.soulsDefault, next.soulsDefault, (path, _was, now) => doc.setIn(path, now));
  const souls = doc.get("souls");
  if (YAML.isMap(souls) && souls.items.length === 0) doc.delete("souls");
}

/**
 * Rewrite oats-local.yaml. `mutate(state, model)` edits the plain `state` (teamState) and may throw a
 * refusal; both come from the file AS IT IS NOW (re-read here, never the command's startup snapshot), so
 * two verbs running together cannot drop each other's change: the write is compare-and-swap — when the
 * file changed after this read, the edit is redone on the new content (a few times, then E_LOCAL_CHANGED).
 * `check(local)` may refuse the result before anything is written. → { changed, local } (the value now).
 */
function editLocal(ctx, mutate, { check } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { text, doc, local: current } = readLocal(ctx);
    const before = teamState(current);
    const next = teamState(current);
    mutate(next, modelOf(ctx, current));
    if (same(next, before)) return { changed: false, local: current };
    applyState(doc, before, next);
    const out = doc.toString();
    const local = parseConfigData(out, { origin: { kind: "local", path: ctx.localPath } }).value;
    const problems = validateLocal(local);
    if (problems.length) throw fail("E_WORKSPACE_SCHEMA", `the rewritten oats-local.yaml would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`, { problems });
    const had = refusals(ctx, current);
    for (const [k, p] of refusals(ctx, local)) if (!had.has(k)) throw fail(p.code, `${p.message}; nothing was written`, Object.fromEntries(Object.entries(p).filter(([key]) => !["code", "severity", "message", "fix"].includes(key))));
    if (check) check(local);
    if (readFileSync(ctx.localPath, "utf8") !== text) continue; // changed under us: redo on the new content
    writeFileAtomic(ctx.localPath, out);
    return { changed: true, local };
  }
  throw fail("E_LOCAL_CHANGED", `${ctx.localPath} kept changing while this edit ran; nothing was written — run it again`, { path: ctx.localPath });
}

const assertLabel = (label) => {
  if (typeof label !== "string" || !LABEL_RE.test(label)) throw fail("E_BAD_ARGS", `${JSON.stringify(label)} is not a team label (lowercase letters, digits, and . _ - after the first)`, { label });
};

/** `oats teams add <label> --team <id> [--description <d>]` → { changed, local }. */
export function teamsAdd(ctx, label, { team, description } = {}) {
  assertLabel(label);
  if (typeof team !== "string" || !team.trim()) throw fail("E_BAD_ARGS", "oats teams add needs --team <provider team id>", { label });
  if (!TEAM_ID_RE.test(team.trim())) throw fail("E_BAD_ARGS", `${JSON.stringify(team)} is not a team id: it must match ${TEAM_ID_RE.source} (a letter or digit first; no whitespace or control characters; at most 256 characters)`, { label, team });
  return editLocal(ctx, (s, model) => {
    if (model.labels.has(label)) {
      const from = model.labels.get(label).from;
      throw fail("E_TEAM_EXISTS", `team ${label} is already declared (${from === "shared" ? "shared, in oats-workspace.yaml" : "local, in oats-local.yaml"})${from === "local" ? ": remove it first (`oats teams remove`) to redefine it" : ""}`, { label, from });
    }
    s.teams[label] = { team: team.trim(), ...(typeof description === "string" && description ? { description } : {}) };
    // The first team added becomes the deployment's default.
    if (s.defaultTeam === null) s.defaultTeam = label;
  });
}

/** `oats teams remove <label>`: a LOCAL team nothing references (no cascade). */
export function teamsRemove(ctx, label) {
  return editLocal(ctx, (s, model) => {
    if (!model.local.has(label)) {
      if (model.shared.has(label)) throw fail("E_TEAM_SHARED", `team ${label} is shared (declared in oats-workspace.yaml): it is edited by a PR to that file, never removed here`, { label, at: model.shared.get(label).at });
      throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared`, { label });
    }
    // A label also declared in the committed file still resolves after the local copy goes (the
    // collision's fix): its references stay valid, so only a purely local label must be unreferenced.
    const usedBy = model.shared.has(label) ? [] : teamReferences(model, label);
    if (usedBy.length) throw fail("E_TEAM_IN_USE", `team ${label} is still referenced (${usedBy.join(", ")}): remove the references first (\`oats teams default\`, \`oats soul teams … --remove ${label}\`)`, { label, usedBy });
    delete s.teams[label];
  });
}

/** `oats teams default <label>`: a label of either file. */
export function teamsDefault(ctx, label) {
  return editLocal(ctx, (s, model) => {
    if (!model.labels.has(label)) throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared: \`oats teams add\` it first`, { label });
    s.defaultTeam = label;
  });
}

/**
 * `oats soul teams <soul>|'*' [--add a,b] [--remove a,b] [--default <l> | --clear-default]`.
 * `key` is the soul's key ("*" for every soul). → { changed, local }.
 */
export function soulTeamsEdit(ctx, key, { add = [], remove = [], setDefault = null, clearDefault = false } = {}) {
  if (key === "*" && (setDefault !== null || clearDefault)) throw fail("E_BAD_ARGS", "a default is per soul: --default / --clear-default need a soul, not '*' (the deployment's default is `oats teams default`)", { soul: key });
  if (setDefault !== null && clearDefault) throw fail("E_BAD_ARGS", "choose --default <label> or --clear-default, not both");
  // --default must name one of the soul's teams after the write.
  const check = setDefault === null ? undefined : (local) => {
    try { soulTeams(modelOf(ctx, local), key); }
    catch (e) { if (e.code === "E_TEAM_NOT_ELIGIBLE") throw fail("E_TEAM_NOT_ELIGIBLE", `${e.message}; nothing was written`, { soul: key, label: setDefault, at: `${LOCAL_FILE}#/souls/default/${pointerKey(key)}` }); throw e; }
  };
  return editLocal(ctx, (s, model) => {
    for (const label of [...add, ...remove, ...(setDefault !== null ? [setDefault] : [])]) {
      if (!model.labels.has(label)) throw fail("E_TEAM_UNKNOWN", `team ${JSON.stringify(label)} is not declared: \`oats teams add\` it first`, { label });
    }
    const list = Array.isArray(s.soulsTeams[key]) ? s.soulsTeams[key] : [];
    const next = [...list.filter((l) => !remove.includes(l)), ...add.filter((l) => !list.includes(l) && !remove.includes(l))].filter((l, i, a) => a.indexOf(l) === i);
    if (next.length) s.soulsTeams[key] = next; else delete s.soulsTeams[key];
    if (clearDefault) delete s.soulsDefault[key];
    if (setDefault !== null) s.soulsDefault[key] = setDefault;
  }, { check });
}
