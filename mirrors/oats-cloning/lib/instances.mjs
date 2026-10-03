import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fail } from "./errors.mjs";
import { isSlug } from "./args.mjs";
import { kernelJson } from "./kernel.mjs";

// The source (and any anchor) is found through the kernel's `oats status
// --json` on this host, never by path. v1 clones only local instances.

export function readStatus(ctx) {
  const { value } = kernelJson(["status", "--json"], { cwd: ctx.cwd, env: ctx.env, timeout: 180000 });
  if (!value || !Array.isArray(value.agents)) fail("E_CLONE_KERNEL", "oats status --json answered without agents");
  return value;
}

/** name → { row, agent } for every local instance the status lists. */
export function instanceIndex(status) {
  const index = new Map();
  for (const agent of status.agents || []) {
    for (const row of agent?.instances || []) {
      if (row && typeof row.instance === "string") index.set(row.instance, { row, agent });
    }
  }
  return index;
}

/** Read <home>/instance.json without following a symlinked file. */
export function readInstanceJson(home) {
  const path = join(home, "instance.json");
  const st = lstatSync(path);
  if (!st.isFile()) throw new Error(`${path} is not a regular file`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Resolve `name` to a local instance whose home records that name. */
export function resolveInstance(status, name, code = "E_CLONE_SOURCE", what = "source") {
  if (!isSlug(name)) fail(code, `${what} ${JSON.stringify(name)} is not an instance name (give a name, never a path)`);
  const hit = instanceIndex(status).get(name);
  if (!hit) fail(code, `no instance ${JSON.stringify(name)} on this host (v1 clones only instances on this host)`, { instance: name });
  const home = hit.row.home;
  if (typeof home !== "string" || !isAbsolute(home)) fail(code, `${what} ${name} has no home on this host`, { instance: name });
  let real, meta;
  try { real = realpathSync(home); meta = readInstanceJson(real); }
  catch { fail(code, `${what} ${name}: its home has no readable instance.json`, { instance: name }); }
  if (meta?.instance !== name) fail(code, `${what} ${name}: its home records another instance name`, { instance: name });
  return { name, home: real, meta, running: hit.row.running === true };
}

/** The soul a spawn names: a package soul by its qualified name, a member soul by its own. */
export function soulOf(meta) {
  const soul = meta?.workspace?.soul;
  if (soul && typeof soul.qualifiedName === "string" && soul.qualifiedName) return soul.qualifiedName;
  return typeof meta?.agent === "string" ? meta.agent : null;
}

/** The merged oats.okf harvest value the source was spawned with, or null. */
export const harvestOf = (meta) => {
  const value = meta?.providers?.["oats.okf"]?.harvest;
  return typeof value === "string" ? value : null;
};

export const launchConfigOf = (meta) => ({
  name: typeof meta?.launch?.launchConfig === "string" ? meta.launch.launchConfig : null,
  default: meta?.launch?.launchConfigDefault === true,
});

export const childSpawnsOf = (meta) => {
  const allowed = meta?.policy?.childSpawns?.allowed;
  return typeof allowed === "boolean" ? allowed : null;
};

/** The aweb identity home the messaging hook gave this instance, or null. */
export const identityHomeOf = (meta) => {
  const value = meta?.launch?.hooks?.env?.AWEB_IDENTITY_HOME;
  return typeof value === "string" ? value : null;
};

const str = (v) => (typeof v === "string" ? v : null);

/** What the dossier records of the source's instance.json. A whitelist: never
 *  `command`, `launch.env`, `launch.hooks`, `capabilityMeta`, `tmux`,
 *  `capabilityRuntime`, settings payloads or any other environment or
 *  credential locator. */
export function filterInstance(meta, { running } = {}) {
  const ws = meta?.workspace?.soul || {};
  const modules = {};
  for (const [name, mod] of Object.entries(meta?.modules || {})) {
    const from = mod?.from || {};
    modules[name] = {
      kind: str(from.kind),
      ...(from.kind === "package" ? { package: str(from.package), version: str(from.version) } : {}),
      repoKey: str(from.repoKey),
      commit: str(mod?.commit) ?? str(from.commit),
    };
  }
  const base = meta?.decision?.base;
  return {
    name: str(meta?.instance),
    agent: str(meta?.agent),
    soul: {
      name: soulOf(meta),
      id: str(ws.id),
      qualifiedName: str(ws.qualifiedName),
      repoKey: str(ws.repoKey),
      commit: str(ws.commit),
    },
    kind: str(meta?.kind),
    work: str(meta?.work),
    repo: str(meta?.repo),
    branch: str(meta?.branch),
    base: base && typeof base === "object" ? { ref: str(base.ref), oid: str(base.oid) } : null,
    harness: str(meta?.harness),
    model: str(meta?.model),
    launchConfig: launchConfigOf(meta),
    yolo: typeof meta?.yolo === "boolean" ? meta.yolo : null,
    childSpawns: childSpawnsOf(meta),
    parentInstance: str(meta?.parentInstance),
    siblingInstance: str(meta?.siblingInstance),
    relation: str(meta?.relation),
    relativeTo: str(meta?.relativeTo),
    createdAt: str(meta?.createdAt),
    teams: Array.isArray(meta?.teams) ? meta.teams.map((t) => ({ label: str(t?.label), team: str(t?.team), default: t?.default === true })) : [],
    defaultTeam: meta?.defaultTeam && typeof meta.defaultTeam === "object" ? { label: str(meta.defaultTeam.label), team: str(meta.defaultTeam.team) } : null,
    modules,
    harvest: harvestOf(meta),
    running: running === true,
  };
}
