// Setup's two-phase service migration. Preflight is read-only across every
// target; apply rechecks identities, backs up replacements, then mutates only
// the named label/units. Manager failure is partial apply, not atomic rollback.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { capturePendingActivationName, captureServiceDefinition, captureServiceLabel, captureServiceUnit, captureServiceTimer } from "./capture-service-definition.mjs";
import { captureServiceOwnership, captureServiceArgvOwnership } from "./capture-service-ownership.mjs";
import { captureSetupSnapshot, recheckCaptureSetup, recheckCaptureSetupParents, writeCaptureSetup } from "./capture-setup-write.mjs";
export { captureSetupSnapshot, recheckCaptureSetup, writeCaptureSetup } from "./capture-setup-write.mjs";

export const serviceShellWord = value => /^[A-Za-z0-9_./:@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
const detail = result => [result.error?.message, result.signal && `signal ${result.signal}`, result.stderr?.trim(),
  result.status !== null && result.status !== undefined && `exit ${result.status}`].filter(Boolean).join("; ") || "no exit status returned";
const manager = (command, argv) => spawnSync(command, argv, { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
function call(run, command, argv) {
  const result = run(command, argv);
  if (result.error || result.signal || result.status === null || result.status === undefined)
    throw new Error(`${command} ${argv.map(serviceShellWord).join(" ")} failed (${detail(result)}); check manager availability/access and re-run setup`);
  return result;
}
function requireOk(run, command, argv) {
  const result = call(run, command, argv);
  if (result.status !== 0) throw new Error(`${command} ${argv.map(serviceShellWord).join(" ")} failed (${detail(result)}); re-run setup to recover the named service`);
  return result.stdout ?? "";
}

function linuxState(run, unit) {
  const output = requireOk(run, "systemctl", ["--user", "show", unit, "--no-pager", "--all",
    "--property=LoadState,UnitFileState,ActiveState,SubState,FragmentPath,DropInPaths,NeedDaemonReload"]);
  const fields = {};
  for (const line of output.trim().split("\n")) {
    const item = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!item || Object.hasOwn(fields, item[1])) throw new Error(`indeterminate systemctl state for ${unit}`);
    fields[item[1]] = item[2];
  }
  const keys = ["LoadState", "UnitFileState", "ActiveState", "SubState", "FragmentPath", "DropInPaths", "NeedDaemonReload"];
  if (Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) ||
      !["loaded", "not-found", "masked"].includes(fields.LoadState) ||
      !["", "enabled", "enabled-runtime", "disabled", "static", "masked", "masked-runtime"].includes(fields.UnitFileState) ||
      !["active", "inactive", "failed", "activating", "deactivating"].includes(fields.ActiveState) || !["yes", "no"].includes(fields.NeedDaemonReload))
    throw new Error(`indeterminate systemctl state for ${unit}`);
  if (fields.DropInPaths) throw new Error(`unsupported manager drop-ins for ${unit}; inspect ${fields.DropInPaths}, or use --no-service`);
  if (fields.LoadState === "not-found" && (fields.FragmentPath || fields.UnitFileState || fields.ActiveState !== "inactive"))
    throw new Error(`inconsistent absent systemctl state for ${unit}`);
  if (fields.LoadState === "loaded" && (!isAbsolute(fields.FragmentPath) || !fields.UnitFileState))
    throw new Error(`indeterminate loaded systemctl identity for ${unit}`);
  return fields;
}

function darwinState(run, domain, target) {
  const disabledText = requireOk(run, "launchctl", ["print-disabled", domain]);
  // Only the one disabled-services block, closed by a brace on its own line, is
  // the override DB. Other blocks (login item associations, for one) carry other
  // syntax and no disable state. launchd has printed both value spellings.
  const blocks = [...disabledText.matchAll(/^[ \t]*disabled services = \{(?:[ \t]*\n([^]*?)^)?[ \t]*\}[ \t]*$/gm)];
  if (blocks.length !== 1) throw new Error("indeterminate launchctl disabled state");
  const disabled = new Map();
  for (const line of (blocks[0][1] ?? "").split("\n").map(value => value.trim()).filter(Boolean)) {
    const item = /^("(?:[^"\\]|\\.)*") => (true|false|disabled|enabled)\s*;?$/.exec(line);
    if (!item) throw new Error("indeterminate launchctl disabled entry");
    const label = JSON.parse(item[1]);
    if (disabled.has(label)) throw new Error("duplicate launchctl disabled entry");
    disabled.set(label, item[2] === "true" || item[2] === "disabled");
  }
  const result = call(run, "launchctl", ["print", target]);
  if (result.status === 113 && /Could not find (?:specified )?service/.test(result.stderr ?? ""))
    return { disabled: disabled.get(captureServiceLabel) === true, registered: false };
  if (result.status !== 0) throw new Error(`launchctl print failed (${detail(result)}); cannot determine registration`);
  const path = /^\s*path = (.+)$/m.exec(result.stdout ?? "")?.[1];
  const block = /^\s*arguments = \{\n([^]*?)^\s*\}/m.exec(result.stdout ?? "");
  if (!path || !block) throw new Error("indeterminate launchctl registered identity");
  const argv = block[1].split("\n").map(line => line.trim()).filter(Boolean);
  const interval = /^\s*run interval = (\d+) seconds\s*$/m.exec(result.stdout ?? "")?.[1];
  return { disabled: disabled.get(captureServiceLabel) === true, registered: true, path, argv, interval: interval ? Number(interval) : null };
}

function inspect(plan) {
  return plan.platform === "darwin" ? darwinState(plan.run, plan.domain, plan.target) :
    { service: linuxState(plan.run, captureServiceUnit), timer: linuxState(plan.run, captureServiceTimer) };
}
function stateIdentity(state, platform) {
  if (platform === "darwin") return JSON.stringify(state);
  // A normal pass may finish during setup. Its activity is not ownership or
  // enablement, so don't mistake that transition for operator replacement.
  return JSON.stringify(Object.values(state).map(({ LoadState, UnitFileState, FragmentPath, DropInPaths, NeedDaemonReload }) =>
    ({ LoadState, UnitFileState, FragmentPath, DropInPaths, NeedDaemonReload })));
}
// The recovery is the command the person runs (setupCommand: `oats setup` or
// `turn-record setup`), so a rerun selects its node the same way this run did.
function refuse(plan, code, found, replaceable = true) {
  const recovery = `${plan.setupCommand} --owner ${serviceShellWord(plan.request.owner)} --root ${serviceShellWord(plan.request.root)}${plan.noHooks ? " --no-hooks" : ""}`;
  const replacement = replaceable ? `replace only the named capture service with ${recovery} --replace-service` :
    `--replace-service replaces only the named capture plist; remove that registration yourself, then re-run ${recovery}`;
  throw Object.assign(new Error(`${code}: ${found}; ${replacement}, or keep it with ${recovery} --no-service`), { code });
}

export function preflightCaptureService({ platform, node, request, setupCommand, dry = false, replace = false,
  noHooks = false, uid = process.getuid?.(), run = manager, log = console.log, intervalSeconds = CAPTURE_POLICY.intervalSeconds }) {
  // intervalSeconds is the definition module's internal seam for guarded
  // real-manager tests; ownership and verification expect what was rendered.
  const definition = captureServiceDefinition({ platform, node, request, intervalSeconds }), schedule = { intervalSeconds };
  // All targets are read before a refusal or mutation; no existsSync fallback
  // may turn EACCES, a dangling link, or an unreadable target into absence.
  const files = definition.files.map(file => {
    const snapshot = captureSetupSnapshot(file.path), kind = file.path.endsWith(".plist") ? "plist" : file.path.endsWith(".timer") ? "timer" : "service";
    const ownership = snapshot.kind === "absent" ? "absent" : platform === "linux" && snapshot.kind === "link" && snapshot.link === "/dev/null" ? "masked" : snapshot.kind === "file" &&
      Buffer.from(snapshot.bytes.toString("utf8")).equals(snapshot.bytes) ? captureServiceOwnership(snapshot.bytes.toString("utf8"), kind, schedule) : "foreign";
    return { ...file, snapshot, ownership, changed: snapshot.kind !== "file" || !snapshot.bytes.equals(Buffer.from(file.contents)) };
  });
  const plan = { platform, node, request: JSON.parse(definition.argv[2]), setupCommand, dry, replace, noHooks, run, log, files, intervalSeconds,
    argv: definition.argv, domain: `gui/${uid}`, target: `gui/${uid}/${captureServiceLabel}` };
  if (platform === "darwin" && !Number.isSafeInteger(uid)) throw new Error("cannot determine launchd user domain");
  plan.state = dry ? null : inspect(plan);
  // The marker counts only beside setup's own marked definitions; with no
  // unit, or one without setup's mark, it is stale and authorizes nothing.
  const markerPath = join(plan.request.root, capturePendingActivationName), marker = captureSetupSnapshot(markerPath);
  if (!["absent", "file"].includes(marker.kind)) throw new Error(`cannot safely read the pending-activation marker ${markerPath}`);
  plan.marker = marker;
  plan.pending = marker.kind === "absent" ? null :
    { path: markerPath, snapshot: marker, stale: !files.every(file => file.ownership === "periodic") };
  // A label registered from any other plist is not a named file: booting it
  // out would not remove that file, which can load it again, and the file is
  // never setup's to unlink. Explicit replacement does not reach it.
  if (platform === "darwin" && plan.state?.registered && plan.state.path !== files[0].path)
    refuse(plan, "E_CAPTURE_SERVICE_FOREIGN", `launchd registration ${captureServiceLabel} is loaded from ${JSON.stringify(plan.state.path)}, not from the named capture plist ${JSON.stringify(files[0].path)}`, false);
  const foreign = files.filter(file => file.ownership === "foreign");
  if (platform === "darwin" && plan.state?.registered && captureServiceArgvOwnership(plan.state.argv) === "foreign") foreign.push({ path: plan.target });
  if (platform === "linux" && plan.state) for (const [i, state] of Object.values(plan.state).entries()) {
    if (state.FragmentPath && state.FragmentPath !== files[i].path && state.LoadState !== "masked") foreign.push({ path: state.FragmentPath });
  }
  if (foreign.length && !replace) refuse(plan, "E_CAPTURE_SERVICE_FOREIGN", `unrecognized definition/registration at ${foreign.map(file => JSON.stringify(file.path)).join(", ")}`);
  // Report what was observed, not a cause: a disabled unit file state alone
  // does not tell an operator's disable from an incomplete earlier activation.
  const disabled = [];
  if (platform === "darwin") {
    if (plan.state?.disabled) disabled.push(`launchctl print-disabled ${plan.domain} lists ${captureServiceLabel} as disabled (named plist ${files[0].snapshot.kind === "absent" ? "absent" : "present"}, label ${plan.state.registered ? "registered" : "not registered"})`);
  } else {
    for (const file of files) if (file.ownership === "masked") disabled.push(`${JSON.stringify(file.path)} links to /dev/null`);
    // A loaded, unmasked disabled unit beside setup's live marker is setup's
    // own unverified activation (a failed enable), not an operator's choice.
    const ownPending = plan.pending && !plan.pending.stale;
    if (plan.state) for (const [i, state] of Object.values(plan.state).entries()) if (state.LoadState === "masked" || state.UnitFileState.startsWith("masked") ||
      (state.UnitFileState === "disabled" && (files[i].snapshot.kind !== "absent" || state.LoadState !== "not-found") && !(ownPending && state.LoadState === "loaded")))
      disabled.push(`${[captureServiceUnit, captureServiceTimer][i]} LoadState=${state.LoadState} UnitFileState=${state.UnitFileState}`);
  }
  if (disabled.length && !replace) refuse(plan, "E_CAPTURE_SERVICE_DISABLED", `named capture service is not enabled: observed ${disabled.join(", ")}; setup enables it only when asked`);
  plan.disabled = disabled.length > 0;
  plan.changed = files.some(file => file.changed) || (platform === "darwin" && plan.state?.registered &&
    (JSON.stringify(plan.state.argv) !== JSON.stringify(plan.argv) || plan.state.interval !== plan.intervalSeconds)) ||
    (platform === "linux" && plan.state && (Object.values(plan.state).some(state => state.NeedDaemonReload === "yes") ||
      ["enabled", "enabled-runtime"].includes(plan.state.service.UnitFileState)));
  return plan;
}

// Apply has no atomic rollback. A failure names, on the thrown error's
// `applied`, every change made before it, as each was logged.
export function applyCaptureService(plan, createdParents = new Map()) {
  const applied = [];
  try { return applyCaptureServiceSteps(plan, createdParents, applied); }
  catch (error) { if (applied.length) error.applied = [...applied, ...(error.applied ?? [])]; throw error; }
}

function applyCaptureServiceSteps(plan, createdParents, applied) {
  const { files, run, log } = plan;
  const changed = text => { applied.push(text); log(`service: ${text}`); };
  if (plan.dry) {
    for (const file of files) log(`service: would ${file.snapshot.kind === "absent" ? "install" : file.changed ? "update" : "keep"} ${file.path}`);
    if (plan.pending) log(`service: pending-activation marker ${plan.pending.path} is ${plan.pending.stale ? "stale; would remove it" : "present; would retry activation"}`);
    log("service: manager registration/disabled state unexamined (--dry-run); no manager invoked");
    return;
  }
  const recheck = () => files.forEach(file => recheckCaptureSetup(file.snapshot, createdParents));
  recheck();
  const current = inspect(plan);
  if (stateIdentity(current, plan.platform) !== stateIdentity(plan.state, plan.platform)) throw new Error("capture manager identity/enablement changed since preflight; re-run setup");
  const markerPath = join(plan.request.root, capturePendingActivationName);
  // The marker is written like every other setup target: against what
  // preflight saw, never through a link or a replaced file.
  let markerSnapshot = plan.marker;
  if (plan.pending?.stale) {
    recheckCaptureSetup(plan.pending.snapshot, createdParents); fs.rmSync(markerPath);
    markerSnapshot = captureSetupSnapshot(markerPath);
    changed(`removed stale pending-activation marker ${markerPath} (no setup-marked capture definition); it authorizes nothing`);
  }
  // Written before the first manager change or definition write, removed only
  // after activation is verified: a failure in between leaves it for a rerun.
  let marked = false;
  const mark = () => {
    if (marked) return;
    writeCaptureSetup(markerSnapshot, JSON.stringify({ platform: plan.platform, startedAt: new Date().toISOString() }) + "\n", createdParents);
    marked = true;
    changed(`pending-activation marker written: ${markerPath}`);
  };
  const replaced = files.filter(file => file.changed && file.snapshot.kind !== "absent");
  if (replaced.length) {
    // Replacing definitions is activation work: the marker comes first, and its
    // write creates a missing root as a recorded parent the backups then use.
    mark();
    const directory = join(plan.request.root, "service-backups", `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID()}`);
    fs.mkdirSync(dirname(directory), { recursive: true }); fs.mkdirSync(directory);
    changed(`replacement backups at ${directory}`);
    for (const file of replaced) {
      recheck(); const path = join(directory, basename(file.path));
      if (file.snapshot.kind === "link") fs.symlinkSync(file.snapshot.link, path);
      else fs.writeFileSync(path, file.snapshot.bytes, { flag: "wx", mode: 0o600 });
    }
  }
  recheck();
  const command = (name, args) => {
    mark(); requireOk(run, name, args);
    changed(`manager action completed: ${name} ${args.map(serviceShellWord).join(" ")}`);
  };
  const writeDefinition = file => {
    mark(); writeCaptureSetup(file.snapshot, file.contents, createdParents);
    changed(`definition written: ${file.path}`);
  };
  if (plan.platform === "darwin") {
    if (plan.changed && current.registered) command("launchctl", ["bootout", plan.target]);
    for (const file of files) if (file.changed) writeDefinition(file);
    recheckCaptureSetupParents(files[0].snapshot, createdParents);
    fs.mkdirSync(join(plan.request.plan.home, "Library", "Logs"), { recursive: true });
    if (plan.disabled) command("launchctl", ["enable", plan.target]);
    if (plan.changed || !current.registered) command("launchctl", ["bootstrap", plan.domain, files[0].path]);
    const after = inspect(plan);
    if (after.disabled || !after.registered || after.path !== files[0].path || after.interval !== plan.intervalSeconds || JSON.stringify(after.argv) !== JSON.stringify(plan.argv))
      throw new Error("capture launchd registration verification failed; inspect the named job and re-run setup");
  } else {
    // Stop the timer first so it cannot launch the old service between writes.
    // An unchanged enabled timer never receives stop/restart, preserving its pass.
    if (plan.changed || plan.disabled) {
      if (current.timer.LoadState !== "not-found") command("systemctl", ["--user", "stop", captureServiceTimer]);
      if (current.service.LoadState !== "not-found") command("systemctl", ["--user", "stop", captureServiceUnit]);
      if (["enabled", "enabled-runtime"].includes(current.service.UnitFileState)) command("systemctl",
        ["--user", ...(current.service.UnitFileState === "enabled-runtime" ? ["--runtime"] : []), "disable", captureServiceUnit]);
      if (plan.disabled) for (const [unit, state] of [[captureServiceUnit, current.service], [captureServiceTimer, current.timer]]) {
        if (state.LoadState === "masked" || state.UnitFileState.startsWith("masked")) command("systemctl",
          ["--user", ...(state.UnitFileState === "masked-runtime" ? ["--runtime"] : []), "unmask", unit]);
      }
    }
    // unmask may remove the exact named /dev/null links. Reconcile only that
    // expected removal; any other replacement still refuses the file write.
    for (const file of files) {
      if (plan.disabled && file.snapshot.kind === "link" && file.snapshot.link === "/dev/null") {
        const now = captureSetupSnapshot(file.path);
        recheckCaptureSetupParents(file.snapshot, createdParents, now);
        if (now.kind === "absent") file.snapshot = now;
      }
      if (file.changed) writeDefinition(file);
    }
    if (plan.changed || plan.disabled || current.service.LoadState !== "loaded" || current.timer.LoadState !== "loaded") command("systemctl", ["--user", "daemon-reload"]);
    if (plan.changed || plan.disabled || current.timer.UnitFileState !== "enabled" || current.timer.ActiveState !== "active")
      command("systemctl", ["--user", "enable", "--now", captureServiceTimer]);
    const after = inspect(plan);
    if (after.service.LoadState !== "loaded" || after.timer.LoadState !== "loaded" ||
        after.service.FragmentPath !== files[0].path || after.timer.FragmentPath !== files[1].path ||
        after.timer.UnitFileState !== "enabled" || after.timer.ActiveState !== "active" ||
        after.service.UnitFileState !== "static" || after.service.NeedDaemonReload !== "no" || after.timer.NeedDaemonReload !== "no")
      throw new Error("capture timer/service verification failed; inspect the named units and re-run setup");
  }
  for (const file of files) {
    const final = captureSetupSnapshot(file.path);
    recheckCaptureSetupParents(file.snapshot, createdParents, final);
    if (final.kind !== "file" || !final.bytes.equals(Buffer.from(file.contents))) throw new Error(`capture definition changed during activation: ${file.path}; re-run setup`);
  }
  if (marked || plan.pending && !plan.pending.stale) {
    fs.rmSync(markerPath, { force: true });
    log(`service: activation verified; pending-activation marker removed: ${markerPath}`);
  }
  log(`service: periodic capture scheduled (every 15 minutes)${plan.changed ? "" : "; definitions already installed"}`);
}
