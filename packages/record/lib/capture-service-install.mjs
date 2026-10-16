// Setup's two-phase service migration. Preflight is read-only across every
// target; apply rechecks identities, backs up replacements, then mutates only
// the named label/units. Manager failure is partial apply, not atomic rollback.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { captureServiceDefinition, captureServiceLabel, captureServiceUnit, captureServiceTimer } from "./capture-service-definition.mjs";
import { captureServiceOwnership, captureServiceArgvOwnership } from "./capture-service-ownership.mjs";

export const serviceShellWord = value => /^[A-Za-z0-9_./:@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
const identity = stat => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
function parents(path) {
  const records = [];
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    let stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stat) {
      let target = null;
      if (stat.isSymbolicLink()) {
        try { target = fs.statSync(directory); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      // Even a dangling ancestor link has an identity to retain. Its missing
      // target must not turn a later retargeting into ordinary directory creation.
      records.push([directory, `${stat.dev}:${stat.ino}:${stat.mode}`, stat.isSymbolicLink() ? fs.readlinkSync(directory) : null,
        target ? `${target.dev}:${target.ino}:${target.mode}` : null]);
    }
    if (dirname(directory) === directory) return records;
  }
}

export function captureSetupSnapshot(path) {
  const ancestry = parents(path);
  let stat;
  try { stat = fs.lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return { path, kind: "absent", parents: ancestry }; throw error; }
  const before = identity(stat);
  let bytes, link;
  if (stat.isSymbolicLink()) link = fs.readlinkSync(path);
  else {
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`refusing nonregular or oversized setup target ${path}`);
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (identity(fs.fstatSync(fd)) !== before) throw new Error(`setup target changed while opening ${path}`);
      bytes = fs.readFileSync(fd);
      if (identity(fs.fstatSync(fd)) !== before) throw new Error(`setup target changed while reading ${path}`);
    } finally { fs.closeSync(fd); }
  }
  if (identity(fs.lstatSync(path)) !== before) throw new Error(`setup target changed while reading ${path}`);
  return { path, kind: link === undefined ? "file" : "link", identity: before, bytes, link, parents: ancestry };
}

function recheckParents(snapshot, current) {
  if (snapshot.parents.some(record => !current.parents.some(now => JSON.stringify(now) === JSON.stringify(record))))
    throw new Error(`setup target parent changed since preflight: ${snapshot.path}; re-run setup`);
}
export function recheckCaptureSetup(snapshot) {
  const current = captureSetupSnapshot(snapshot.path);
  recheckParents(snapshot, current);
  if (current.kind !== snapshot.kind || current.identity !== snapshot.identity || current.link !== snapshot.link ||
      (snapshot.bytes && !snapshot.bytes.equals(current.bytes))) throw new Error(`setup target changed since preflight: ${snapshot.path}; re-run setup`);
}

export function writeCaptureSetup(snapshot, contents) {
  recheckCaptureSetup(snapshot);
  fs.mkdirSync(dirname(snapshot.path), { recursive: true });
  const temporary = `${snapshot.path}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    recheckCaptureSetup(snapshot);
    fs.renameSync(temporary, snapshot.path);
  } finally { fs.rmSync(temporary, { force: true }); }
}

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
  const body = /^\s*disabled services = \{([^]*)\}\s*$/.exec(disabledText);
  if (!body) throw new Error("indeterminate launchctl disabled state");
  const disabled = new Map();
  for (const line of body[1].split("\n").map(value => value.trim()).filter(Boolean)) {
    const item = /^("(?:[^"\\]|\\.)*") => (true|false)\s*;?$/.exec(line);
    if (!item) throw new Error("indeterminate launchctl disabled entry");
    const label = JSON.parse(item[1]);
    if (disabled.has(label)) throw new Error("duplicate launchctl disabled entry");
    disabled.set(label, item[2] === "true");
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
function refuse(plan, code, found) {
  const recovery = `${serviceShellWord(plan.node)} ${serviceShellWord(plan.setupPath)} --owner ${serviceShellWord(plan.request.owner)} --root ${serviceShellWord(plan.request.root)}${plan.noHooks ? " --no-hooks" : ""}`;
  throw Object.assign(new Error(`${code}: ${found}; replace only the named capture service with ${recovery} --replace-service, or keep it with ${recovery} --no-service`), { code });
}

export function preflightCaptureService({ platform, node, request, setupPath, dry = false, replace = false,
  noHooks = false, uid = process.getuid?.(), run = manager, log = console.log }) {
  const definition = captureServiceDefinition({ platform, node, request });
  // All targets are read before a refusal or mutation; no existsSync fallback
  // may turn EACCES, a dangling link, or an unreadable target into absence.
  const files = definition.files.map(file => {
    const snapshot = captureSetupSnapshot(file.path), kind = file.path.endsWith(".plist") ? "plist" : file.path.endsWith(".timer") ? "timer" : "service";
    const ownership = snapshot.kind === "absent" ? "absent" : platform === "linux" && snapshot.kind === "link" && snapshot.link === "/dev/null" ? "masked" : snapshot.kind === "file" &&
      Buffer.from(snapshot.bytes.toString("utf8")).equals(snapshot.bytes) ? captureServiceOwnership(snapshot.bytes.toString("utf8"), kind) : "foreign";
    return { ...file, snapshot, ownership, changed: snapshot.kind !== "file" || !snapshot.bytes.equals(Buffer.from(file.contents)) };
  });
  const plan = { platform, node, request: JSON.parse(definition.argv[2]), setupPath, dry, replace, noHooks, run, log, files,
    argv: definition.argv, domain: `gui/${uid}`, target: `gui/${uid}/${captureServiceLabel}` };
  if (platform === "darwin" && !Number.isSafeInteger(uid)) throw new Error("cannot determine launchd user domain");
  plan.state = dry ? null : inspect(plan);
  const foreign = files.filter(file => file.ownership === "foreign");
  if (platform === "darwin" && plan.state?.registered &&
      (plan.state.path !== files[0].path || captureServiceArgvOwnership(plan.state.argv) === "foreign")) foreign.push({ path: plan.target });
  if (platform === "linux" && plan.state) for (const [i, state] of Object.values(plan.state).entries()) {
    if (state.FragmentPath && state.FragmentPath !== files[i].path && state.LoadState !== "masked") foreign.push({ path: state.FragmentPath });
  }
  if (foreign.length && !replace) refuse(plan, "E_CAPTURE_SERVICE_FOREIGN", `unrecognized definition/registration at ${foreign.map(file => JSON.stringify(file.path)).join(", ")}`);
  const disabled = platform === "darwin" ? plan.state?.disabled : files.some(file => file.ownership === "masked") || plan.state && Object.values(plan.state).some((state, i) =>
    state.LoadState === "masked" || state.UnitFileState.startsWith("masked") ||
    (state.UnitFileState === "disabled" && (files[i].snapshot.kind !== "absent" || state.LoadState !== "not-found")));
  if (disabled && !replace) refuse(plan, "E_CAPTURE_SERVICE_DISABLED", "named capture schedule/service is explicitly disabled or masked");
  plan.disabled = Boolean(disabled);
  plan.changed = files.some(file => file.changed) || (platform === "darwin" && plan.state?.registered &&
    (JSON.stringify(plan.state.argv) !== JSON.stringify(plan.argv) || plan.state.interval !== 900)) ||
    (platform === "linux" && plan.state && (Object.values(plan.state).some(state => state.NeedDaemonReload === "yes") ||
      ["enabled", "enabled-runtime"].includes(plan.state.service.UnitFileState)));
  return plan;
}

export function applyCaptureService(plan) {
  const { files, run, log } = plan;
  if (plan.dry) {
    for (const file of files) log(`service: would ${file.snapshot.kind === "absent" ? "install" : file.changed ? "update" : "keep"} ${file.path}`);
    log("service: manager registration/disabled state unexamined (--dry-run); no manager invoked");
    return;
  }
  const recheck = () => files.forEach(file => recheckCaptureSetup(file.snapshot));
  recheck();
  const current = inspect(plan);
  if (stateIdentity(current, plan.platform) !== stateIdentity(plan.state, plan.platform)) throw new Error("capture manager identity/enablement changed since preflight; re-run setup");
  const replaced = files.filter(file => file.changed && file.snapshot.kind !== "absent");
  if (replaced.length) {
    const directory = join(plan.request.root, "service-backups", `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID()}`);
    fs.mkdirSync(dirname(directory), { recursive: true }); fs.mkdirSync(directory);
    log(`service: replacement backups at ${directory}`);
    for (const file of replaced) {
      recheck(); const path = join(directory, basename(file.path));
      if (file.snapshot.kind === "link") fs.symlinkSync(file.snapshot.link, path);
      else fs.writeFileSync(path, file.snapshot.bytes, { flag: "wx", mode: 0o600 });
    }
  }
  recheck();
  const command = (name, args) => requireOk(run, name, args);
  if (plan.platform === "darwin") {
    if (plan.changed && current.registered) command("launchctl", ["bootout", plan.target]);
    for (const file of files) if (file.changed) writeCaptureSetup(file.snapshot, file.contents);
    fs.mkdirSync(join(plan.request.plan.home, "Library", "Logs"), { recursive: true });
    if (plan.disabled) command("launchctl", ["enable", plan.target]);
    if (plan.changed || !current.registered) command("launchctl", ["bootstrap", plan.domain, files[0].path]);
    const after = inspect(plan);
    if (after.disabled || !after.registered || after.path !== files[0].path || after.interval !== 900 || JSON.stringify(after.argv) !== JSON.stringify(plan.argv))
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
        recheckParents(file.snapshot, now);
        if (now.kind === "absent") file.snapshot = now;
      }
      if (file.changed) writeCaptureSetup(file.snapshot, file.contents);
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
    if (final.kind !== "file" || !final.bytes.equals(Buffer.from(file.contents))) throw new Error(`capture definition changed during activation: ${file.path}; re-run setup`);
  }
  log(`service: periodic capture scheduled (every 15 minutes)${plan.changed ? "" : "; definitions already installed"}`);
}
