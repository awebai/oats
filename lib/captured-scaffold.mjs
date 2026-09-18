/** Materialize one already-verified captured composition into a new private home.
 * Home placement is supplied by the lifecycle owner; this module never discovers
 * config, souls, work targets, launch software or instance roots. */
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { capturedDirectoryIdentity, registerCapturedInstance, syncCapturedMetadata } from "./captured-instance-index.mjs";
import { copyTreeSafe } from "./artifact-tree.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { portableScope } from "./portable-state.mjs";
import { oatsError } from "./errors.mjs";

const INSTANCE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

function sameDirectory(path, witness) {
  try {
    const current = lstatSync(path);
    return current.isDirectory() && current.dev === witness.dev && current.ino === witness.ino;
  } catch { return false; }
}

export function validateCapturedDirectoryTarget(home, instance) {
  if (typeof home !== "string" || !isAbsolute(home) || resolve(home) !== home || basename(home) !== instance || !INSTANCE_RE.test(instance)) {
    throw oatsError("invalid-declaration", "captured scaffold needs a normalized absolute home whose basename is its instance name");
  }
}

export function materializeCapturedDirectoryScaffold({ home, instance, loaded }) {
  validateCapturedDirectoryTarget(home, instance);
  if (!loaded?.record || !loaded?.composition || !loaded?.resolution || typeof loaded.deployment !== "string") throw oatsError("invalid-resolution", "captured scaffold requires a verified composition load");
  const { record, composition } = loaded;
  if (record.dispatch.composition?.mode !== "directory") throw oatsError("needs-configuration", "captured scaffold currently requires retained directory work mode");
  if (existsSync(home)) throw oatsError("E_INSTANCE_EXISTS", `instance home already exists: ${home}`);
  const parent = dirname(home), parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || realpathSync(parent) !== parent) throw oatsError("E_NO_CANONICAL_ROOT", "captured scaffold parent must be a physical directory");
  const subject = record.subject, agent = subject.kind === "persistent" ? subject.soul.alias : subject.name;
  const responsibleHuman = record.messagingChoice.enabled ? record.messagingChoice.privateKey.human : null;
  const executionBinding = { schemaVersion: 1, deployment: portableScope(loaded.deployment), resolution: loaded.resolution };
  const bodyFile = loaded.resources.get(record.dispatch.composition.body);
  if (!bodyFile) throw oatsError("invalid-resolution", "captured scaffold body is absent from verified resources");
  const sourceRoot = dirname(bodyFile);
  const metadata = {
    instance, agent, kind: subject.kind, home, work: "directory", launched: false, incarnationId: randomUUID(),
    executionBinding, responsibleHuman,
    captured: { schemaVersion: 1, resolution: loaded.resolution, lifecycle: "scaffolded-hooks-pending" },
    capabilities: [...loaded.capabilities.values()].map(({ id, manifest, settings }) => ({ id, version: manifest.version, settings })),
  };
  let owned, primary, indexAttempted = false;
  try {
    mkdirSync(home, { mode: 0o700 }); owned = lstatSync(home);
    symlinkSync(sourceRoot, join(home, "soul"));
    writeFileSync(join(home, "AGENTS.md"), composition.text, { mode: 0o600 });
    symlinkSync("AGENTS.md", join(home, "CLAUDE.md"));
    mkdirSync(join(home, ".agents", "skills"), { recursive: true, mode: 0o700 });
    mkdirSync(join(home, ".claude"), { mode: 0o700 });
    for (const skill of composition.skills) copyTreeSafe(skill.path, join(home, ".agents", "skills", skill.name));
    symlinkSync(join("..", ".agents", "skills"), join(home, ".claude", "skills"));
    mkdirSync(join(home, "work"), { mode: 0o700 });
    for (const skill of composition.skills) {
      const file = join(home, ".agents", "skills", skill.name, "SKILL.md");
      if (!existsSync(file) || !lstatSync(file).isFile()) throw oatsError("resolution-incomplete", `captured skill ${skill.name} did not materialize`);
    }
    metadata.captured.custody = { home: capturedDirectoryIdentity(home), work: capturedDirectoryIdentity(join(home, "work")) };
    writeFileSync(join(home, "instance.json"), canonicalJson(metadata), { flag: "wx", mode: 0o600 });
    for (const path of [join(home, "instance.json"), join(home, "work"), home, parent]) syncCapturedMetadata(path);
    indexAttempted = true;
    registerCapturedInstance(loaded.deployment, home);
    return { home, instance, agent, work: "directory", incarnationId: metadata.incarnationId, executionBinding, responsibleHuman, launched: false, hooksPending: true };
  } catch (error) {
    primary = error;
    // Publication/guard cleanup may fail AFTER index publication. Retain the
    // home rather than erase evidence just because the call did not return.
    if (indexAttempted) { error.home = home; error.cleanupRequired = true; }
    throw error;
  }
  finally {
    if (primary && owned && !indexAttempted) {
      try {
        if (!sameDirectory(home, owned)) throw oatsError("integrity-drift", "captured scaffold home ownership changed during rollback");
        rmSync(home, { recursive: true });
      } catch (cleanup) {
        const error = new AggregateError([primary, cleanup], "captured scaffold and rollback failed", { cause: primary });
        error.code = primary.code; throw error;
      }
    }
  }
}
