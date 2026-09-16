/** Durable captured-home references independent of a live source definition.
 * This is lifecycle custody/indexing only, not discovery policy or a registry
 * service. */
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readPortableBytes } from "./portable-files.mjs";
import { compareUtf8, canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { portableStateDirectory, withPortableStateWrite, writeGuardedPortableDocument } from "./portable-state.mjs";
import { validateExecutionBinding } from "./schedule-capsule.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

const FILE = "instance-references.json";
const STATUSES = new Set(["spawn-hooks-running", "spawned-launch-pending", "spawn-failed-cleanup-required", "retire-running", "retire-failed-cleanup-required"]);
const LIMITS = Object.freeze({ maxBytes: 4 * 1024 * 1024, maxDepth: 24, maxEntries: 20_000 });

function human(value, pointer) {
  if (value === null) return;
  objectAt(value, ["provider", "id"], ["provider", "id"], pointer);
  stringAt(value.provider, `${pointer}/provider`); stringAt(value.id, `${pointer}/id`);
}

export function validateCapturedInstanceReference(row, pointer = "/instances") {
  objectAt(row, ["home", "instance", "agent", "kind", "status", "executionBinding", "responsibleHuman"],
    ["home", "instance", "agent", "kind", "status", "executionBinding", "responsibleHuman"], pointer);
  stringAt(row.home, `${pointer}/home`); stringAt(row.instance, `${pointer}/instance`); stringAt(row.agent, `${pointer}/agent`);
  if (!isAbsolute(row.home) || resolve(row.home) !== row.home || !row.instance || !row.agent) throw oatsError("invalid-declaration", "captured instance reference has invalid identity/path");
  if (!['persistent','helper'].includes(row.kind) || !STATUSES.has(row.status)) throw oatsError("invalid-declaration", "captured instance reference has invalid kind/status");
  validateExecutionBinding(row.executionBinding); human(row.responsibleHuman, `${pointer}/responsibleHuman`);
  return row;
}

function validateIndex(value) {
  canonicalJson(value, LIMITS); objectAt(value, ["schemaVersion", "instances"], ["schemaVersion", "instances"]);
  if (value.schemaVersion !== 1 || !Array.isArray(value.instances)) throw oatsError("invalid-declaration", "captured instance index must be schemaVersion 1 with instances");
  const homes = new Set(); let prior;
  for (let index = 0; index < value.instances.length; index++) {
    const row = validateCapturedInstanceReference(value.instances[index], `/instances/${index}`);
    if (homes.has(row.home) || (prior !== undefined && compareUtf8(prior, row.home) >= 0)) throw oatsError("invalid-declaration", "captured instance references must have unique UTF-8 ordered homes");
    homes.add(row.home); prior = row.home;
  }
  return value;
}

export function readCapturedInstanceIndex(deployment) {
  const root = portableStateDirectory(deployment, false);
  if (!root) return { schemaVersion: 1, instances: [] };
  const file = join(root, FILE);
  if (!existsSync(file)) return { schemaVersion: 1, instances: [] };
  return validateIndex(parseStrictJson(readPortableBytes(file, LIMITS), LIMITS));
}

export function updateCapturedInstanceReference(deployment, row, { expectedStatus = null } = {}) {
  validateCapturedInstanceReference(row); if (expectedStatus !== null && !STATUSES.has(expectedStatus)) throw oatsError("invalid-declaration", "invalid expected captured instance status");
  return withPortableStateWrite(deployment, context => {
    const current = readCapturedInstanceIndex(context.deployment), index = current.instances.findIndex(entry => entry.home === row.home), prior = index < 0 ? null : current.instances[index];
    if ((expectedStatus === null && prior !== null) || (expectedStatus !== null && prior?.status !== expectedStatus)) throw oatsError("selection-changed", "captured instance lifecycle status changed");
    if (prior && canonicalJson({ ...prior, status: row.status }) !== canonicalJson(row)) throw oatsError("invalid-resolution", "captured instance reference authority changed");
    const instances = [...current.instances]; if (index < 0) instances.push(row); else instances[index] = row;
    instances.sort((a, b) => compareUtf8(a.home, b.home)); const next = validateIndex({ schemaVersion: 1, instances });
    writeGuardedPortableDocument(context, join(context.root, FILE), next, { absent: !existsSync(join(context.root, FILE)) });
    return { previous: prior, current: row };
  });
}
