#!/usr/bin/env node
/**
 * oats-aweb — OATS messaging-provider hooks for aweb.
 *
 * Invoked by the OATS kernel at instance lifecycle events (hook contract):
 *   oats-aweb spawn    mint a team-scoped aweb identity for the instance
 *   oats-aweb retire   gracefully self-delete it (BEFORE the home dir is removed)
 *   oats-aweb roster   list the aweb team's members — the cross-machine directory
 *                     of live instances (alias = instance name) and humans
 *   oats-aweb setup    guided onboarding: check the aw CLI, initialize the team
 *                     scope's aweb workspace, create/join the team
 *
 * Env contract (set by the kernel):
 *   OATS_EVENT     spawn|retire
 *   OATS_INSTANCE  instance name (used as the aweb alias)
 *   OATS_HOME      instance home dir (cwd is also set to it)
 *   OATS_CONTEXT   resolution context dir (the soul's repo / agents root parent)
 *   OATS_WORKSPACE the agents root's parent — the team boundary
 *   OATS_SETTINGS  JSON of the provider's `settings:` block
 *   OATS_TEAM_NAME/OATS_TEAM_ID/OATS_TEAM_SCOPE  resolved config `team:` block (may be empty)
 *   OATS_META      JSON persisted from this hook's previous spawn output (retire only)
 *
 * Output (spawn, stdout JSON):
 *   { "meta": {...persisted to instance.json + OATS_META at retire},
 *     "brief": "one-line TASK.md briefing line", "warning": "non-fatal problem" }
 *
 * EXIT CODE IS THE CONTRACT for the spawn hook. This capability declares
 * `spawn` as required (oats.json), so a nonzero exit fails the spawn and rolls it
 * back. Messaging is the whole point of the capability: an instance whose
 * identity was never minted believes it can be woken by mail and cannot, which
 * is worse than not starting. So identity failures exit nonzero, while genuinely
 * advisory problems (the Claude channel plugin, a team-name mismatch) stay
 * warnings on exit 0.
 *
 * On a fatal path, ALWAYS emit any metadata gathered so far before exiting: the
 * kernel feeds it to the retire hook to compensate partial state, and an
 * identity joined moments before the failure must still be deletable.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, dirname, resolve, delimiter } from "node:path";

/** Run a command as ARGV — never a shell string. Team ids, aliases, instance
 * names and invite tokens all flow through here; quoting them correctly is a
 * property of one helper staying correct forever, while argv removes the class.
 * This hook is a REQUIRED spawn hook, so it gates every spawn, which is reason
 * enough not to rely on quoting. */
const run = (argv, cwd, timeout = 45000, { secrets = [], secretSafe = false } = {}) => {
  try {
    return execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim();
  } catch (e) {
    // execFileSync puts the WHOLE ARGV in e.message ("Command failed: aw team
    // join <token> …"). This hook's failures are reported by the kernel and land
    // in CLI/Desktop logs, so a failed join disclosed a still-valid team invite
    // token to anyone reading them (reviewer-aggregate2). Rebuild the error from
    // the command name and the status — never the argv.
    //
    // secretSafe drops the child's OUTPUT as well. Scrubbing known strings is not
    // enough for a command that MINTS a secret: `aw team invite` can print a
    // freshly-created token to stderr while failing, and at that point the caller
    // has no value to scrub because the token is exactly what it never received
    // (reviewer-1a6e82e). For those commands, status plus fixed context is all
    // the diagnosis anyone gets.
    const scrub = (t) => secrets.filter(Boolean).reduce((acc, sec) => acc.split(sec).join("<redacted>"), String(t ?? ""));
    const where = [argv[0], argv[1], argv[2]].filter((a) => a && !secrets.includes(a) && !a.startsWith("-")).join(" ");
    const why = secretSafe ? "" : (scrub(e.stderr).trim() || (e.status === undefined ? String(e.code || "failed") : ""));
    const err = new Error(`${where} failed${e.status === undefined ? "" : ` (exit ${e.status})`}${why ? `: ${why}` : ""}${secretSafe ? " (output withheld: this command handles credentials)" : ""}`);
    err.status = e.status;
    // A classification, never the text: the caller may name a KNOWN failure
    // class (an alias that still holds a certificate) without any output of a
    // credential-handling command reaching a log.
    err.aliasConflict = /already|exists|conflict|422|active certificate/i.test(String(e.stderr ?? "") + String(e.stdout ?? ""));
    throw err;
  }
};
/** JSON.parse whose failure never quotes the input. Node includes an excerpt of
 * the malformed text in a SyntaxError, which for these commands IS the credential
 * (reviewer-1a6e82e). */
const parseSecretJson = (text, what) => {
  try { return JSON.parse(text); }
  catch { throw new Error(`${what} returned output that is not valid JSON (withheld: this command handles credentials)`); }
};
/** Is a command on PATH? Resolved in-process rather than by running
 * `command -v`, which is a SHELL BUILTIN — spawning it as a program depends on
 * a /usr/bin/command binary that many systems do not ship, and its absence
 * would read as "aw is missing" on every such host. */
/** The installed aw's version from `aw version` ("aw 1.36.1 ..."), or
 *  undefined when it cannot be read; compared as numeric triples. */
function awAtLeast(floor) {
  let v;
  try { v = /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(run(["aw", "version"], undefined, 10000)); } catch { return false; }
  if (!v) return false;
  const a = v.slice(1, 4).map(Number), b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}

function onPath(cmd) {
  for (const dir of String(process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    try { const st = statSync(join(dir, cmd)); if (st.isFile() && (st.mode & 0o111)) return true; } catch { /* keep looking */ }
  }
  return false;
}
const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(code); };
const warn = (m) => out({ warning: `oats-aweb: ${String(m).slice(0, 300)}` });
/** Fatal for a REQUIRED spawn hook: emit metadata for compensation, then exit
 * nonzero so the kernel rolls the spawn back. `meta` carries whatever external
 * state already exists (e.g. a joined identity) so retire can undo it. */
const fatal = (m, meta) => out({ ...(meta ? { meta } : {}), warning: `oats-aweb: ${String(m).slice(0, 300)}` }, 1);

const event = process.env.OATS_EVENT || process.argv[2];
const instance = process.env.OATS_INSTANCE;
const home = process.env.OATS_HOME || process.cwd();
// Effective capability settings, injected by kernel dispatch (OATS_SETTINGS).
// delivery: "channel" (default) keeps the native channel packages waking the
// instance; "session" hands delivery to the host wake broker (aweb-abil):
// AWEB_DELIVERY=session goes into the launch environment, the Claude channel
// flag is omitted, and nothing wakes the instance until the broker exists.
let settings = {};
try { settings = JSON.parse(process.env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
const deliveryMode = (() => {
  const v = settings.delivery === undefined || settings.delivery === null || settings.delivery === "" ? "channel" : String(settings.delivery);
  return v === "session" ? "session" : "channel";
})();

/**
 * The aweb root (minting authority). BOUNDED candidates — the deployment's team
 * scope (from config `team:`) is the natural home; we never walk past the
 * workspace to the laptop root (a `.aw` there would be a different team;
 * minting into it would be a silent cross-team leak):
 *   1. the declared team scope (OATS_TEAM_SCOPE)
 *   2. the instance home itself
 *   3. the git repo root containing the home (if any)
 *   4. the resolution context (the soul's target repo) and its git repo root
 *   5. the workspace root (OATS_WORKSPACE — e.g. ~/lfx)
 * First candidate with a `.aw` wins; none → no minting.
 */
function gitRootOf(startDir) {
  let d = resolve(startDir);
  while (true) {
    if (existsSync(join(d, ".git"))) return d;
    const parent = dirname(d);
    if (parent === d) return undefined;
    d = parent;
  }
}
function awebRoot() {
  const candidates = [];
  const push = (p) => { if (p && !candidates.includes(resolve(p))) candidates.push(resolve(p)); };
  push(process.env.OATS_TEAM_SCOPE);
  push(home);
  push(gitRootOf(home));
  push(process.env.OATS_CONTEXT);
  if (process.env.OATS_CONTEXT) push(gitRootOf(process.env.OATS_CONTEXT));
  push(process.env.OATS_WORKSPACE);
  for (const c of candidates) if (existsSync(join(c, ".aw"))) return c;
  return undefined;
}

/** Team memberships from `aw team list --json`. The current CLI returns
 * `memberships`; older output used `teams`. Spawn resolution and `oats aweb
 * setup` MUST read this the same way — they drifted once, and because spawn
 * treats "no matching membership" as fatal, the stale reader turned every
 * name-only team config into a blocked spawn (reviewer-602627c). */
const teamMemberships = (listed) => listed?.memberships || listed?.teams || [];
const teamIdsOf = (listed) => teamMemberships(listed).map((m) => m.team_id || m.id || m);

const AW_INSTALL = "install the aw CLI first — see https://aweb.ai/docs (or `oats aweb setup` for guided onboarding)";
const isCommand = ["roster", "setup"].includes(event);
if (!onPath("aw")) {
  if (isCommand) { console.error(`oats aweb ${event}: aw CLI not on PATH — ${AW_INSTALL}`); process.exit(1); }
  if (event === "spawn") fatal(`aw CLI not on PATH, so no identity could be minted and this instance would have no messaging — ${AW_INSTALL}`);
  warn(`aw CLI not on PATH — no identity minted; ${AW_INSTALL}`);
}

// ---------------------------------------------------------------------------
// Retained identity (explicit per-soul opt-in): a standing seat keeps its
// did:aw and address when re-seated as an OATS instance. Per aweb's contract
// (2026-09-05): copy exactly the identity-authority files from the source
// .aw into the home's .aw, reconnect the coordination binding with
// `aw workspace connect`, verify online, heartbeat and status show the new
// path, and hold a lock BESIDE the source so no second seat can take it.
// Never copy workspace.yaml, caches or locks; never delete the source; never
// team-join (that is the mint path, which would try to create the alias
// again). Retire releases the lock and leaves the identity alone.
const IDENTITY_AUTHORITY = ["signing.key", "identity.yaml", "teams.yaml", "team-certs", "encryption.yaml", "encryption-keys"];
// Session delivery registers the home with the host wake broker (aweb-abil:
// `aw wake register --home <abs> --identity-home <abs> --delivery session
// [--backend tmux|herdr]`, durable even when the daemon is down). An aw
// without `aw wake` cannot deliver in session mode: refuse, never silently
// turn a working channel into a poll-only instance.
// Throws, never exits: both callers run it inside a try whose catch performs
// the rollback (the seat path restores the binding; the mint path hands the
// minted identity to compensation).
function wakeRegister(instanceHome, identityHome) {
  const backend = process.env.OATS_BACKEND;
  try {
    run(["aw", "wake", "register", "--home", instanceHome, "--identity-home", identityHome, "--delivery", "session", ...(backend ? ["--backend", backend] : [])], instanceHome, 60000);
  } catch (e) {
    throw new Error(`delivery: session needs an aw with the wake broker CLI (aw wake register), which this aw does not provide (${e.message || e}); install the aweb release that ships aw wake, or use delivery: channel`);
  }
}
function wakeDeregister(instanceHome) {
  try { run(["aw", "wake", "deregister", "--home", instanceHome], instanceHome, 60000); return true; } catch { return false; }
}
const seatLockPath = (source) => join(dirname(source), ".aw-retained-seat.json");
/** The alias a home's .aw/workspace.yaml records under memberships (indented),
 *  or undefined. Read only when the hook has no alias of its own. */
const workspaceAliasOf = (homeDir) => {
  try { const m = readFileSync(join(homeDir, ".aw", "workspace.yaml"), "utf8").match(/^\s*alias:\s*["']?([a-z0-9][a-z0-9._-]{0,127})["']?\s*$/mi); return m ? m[1] : undefined; }
  catch { return undefined; }
};
/** A join that the CLI reported as failed (or that this hook killed on
 *  timeout) may still have completed server-side: the home then holds a
 *  signing key, a team certificate and a workspace binding. */
const joinedLate = (homeDir) => existsSync(join(homeDir, ".aw", "signing.key")) && existsSync(join(homeDir, ".aw", "team-certs")) && !!workspaceAliasOf(homeDir);
const JOIN_TIMEOUT_MS = Number(process.env.OATS_AWEB_JOIN_TIMEOUT_MS) > 0 ? Number(process.env.OATS_AWEB_JOIN_TIMEOUT_MS) : 120000;
const yamlScalar = (text, key) => {
  const m = String(text).match(new RegExp(`^${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`, "m"));
  return m ? m[1].trim() : undefined;
};
function retainedSeatSpawn(source, takeOver) {
  if (typeof source !== "string" || !source.startsWith("/")) fatal("identity.source must be the absolute path of the legacy .aw directory to retain");
  if (!existsSync(join(source, "signing.key"))) fatal(`identity.source ${source} holds no signing.key, so there is no identity to retain`);
  const lockPath = seatLockPath(source);
  let takenOver;
  if (existsSync(lockPath)) {
    let held; try { held = JSON.parse(readFileSync(lockPath, "utf8")); } catch { held = {}; }
    const holderHome = held.home;
    // Held means the holder's home still exists: retire removes both the lock
    // and the home, so a home that is there is a seat that was never retired.
    // No process liveness is inferred (the spawner's pid says nothing about the
    // runtime). The only escape is the explicit, warned take-over for a seat
    // whose runtime is known to be dead.
    if (holderHome && existsSync(holderHome)) {
      if (takeOver !== true) fatal(`identity at ${source} is already held by ${holderHome} (${lockPath}); a seat is never taken from a holder whose home exists — retire that instance first, or set identity.takeOver: true only if you know its runtime is dead`);
      takenOver = holderHome;
    }
  }
  const srcWorkspace = existsSync(join(source, "workspace.yaml")) ? readFileSync(join(source, "workspace.yaml"), "utf8") : "";
  const service = process.env.OATS_AWEB_URL || yamlScalar(srcWorkspace, "aweb_url");
  if (!service) fatal(`cannot determine the aweb service for ${source} (no aweb_url in its workspace.yaml)`);
  const role = yamlScalar(srcWorkspace, "role_name");
  let team = process.env.OATS_TEAM_ID;
  if (!team && existsSync(join(source, "teams.yaml"))) team = yamlScalar(readFileSync(join(source, "teams.yaml"), "utf8"), "active_team") || yamlScalar(readFileSync(join(source, "teams.yaml"), "utf8"), "active");
  if (!team || !team.includes(":")) fatal(`cannot determine the team for the retained identity (set team.id in oats-config.yaml, or an active team in ${join(source, "teams.yaml")})`);
  const dest = join(home, ".aw");
  const legacyHome = dirname(source);
  // The lock is taken FIRST: a concurrent second spawn must see it before any
  // byte of the identity is copied.
  // Exclusive creation (wx): two concurrent spawns cannot both pass the
  // existence check and overwrite each other; the loser fails here having
  // copied nothing. A take-over replaces the stale lock first, deliberately.
  if (takenOver) { try { rmSync(lockPath, { force: true }); } catch { /* replaced below */ } }
  try {
    writeFileSync(lockPath, JSON.stringify({ home, instance, team, takenAt: new Date().toISOString(), host: hostname(), ...(takenOver ? { tookOverFrom: takenOver } : {}) }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } catch (e) {
    fatal(`identity at ${source} was taken by another spawn a moment ago (${lockPath} exists); nothing copied`);
  }
  let connected = false;
  const rollback = () => {
    // After `aw workspace connect` the server binding points at the new home;
    // deleting the copy alone would leave the identity bound to nothing. Put
    // the binding back where it was, from the legacy home, then remove the
    // copy; if the restore fails, KEEP the copy so the seat stays recoverable.
    let restored = !connected;
    if (connected) {
      try { run(["aw", "workspace", "connect", "--service", service, "--team", team, ...(role ? ["--role", role] : [])], legacyHome, 60000); restored = true; }
      catch { restored = false; }
    }
    if (restored) { try { rmSync(dest, { recursive: true, force: true }); } catch { /* best effort */ } try { rmSync(lockPath, { force: true }); } catch { /* best effort */ } }
    return restored;
  };
  try {
    mkdirSync(dest, { recursive: true, mode: 0o700 });
    chmodSync(dest, 0o700);
    for (const name of IDENTITY_AUTHORITY) {
      const from = join(source, name);
      if (!existsSync(from)) continue; // encryption material may be absent on an identity that never had it
      const to = join(dest, name);
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true }); chmodSync(to, 0o700);
        for (const f of readdirSync(to)) { const p = join(to, f); if (statSync(p).isFile()) chmodSync(p, 0o600); } // private keys inside, whatever the source modes were
      } else { copyFileSync(from, to); chmodSync(to, 0o600); }
    }
    for (const forbidden of ["workspace.yaml", "context", "interaction-log.jsonl", "channel-delivered-ids.json", "chat-delivered-ids.json"]) {
      if (existsSync(join(dest, forbidden))) rmSync(join(dest, forbidden), { recursive: true, force: true });
    }
    run(["aw", "workspace", "connect", "--service", service, "--team", team, ...(role ? ["--role", role] : [])], home, 60000);
    connected = true;
    run(["aw", "check", "--online"], home, 60000);
    run(["aw", "heartbeat"], home, 60000);
    const status = run(["aw", "workspace", "status", "--json"], home, 60000);
    // Thrown, not fatal: the catch below rolls the copy and the lock back first.
    // Verified by parsing: the workspace row's path must be this home. The
    // hostname the row records is whatever the binding stored (on hosted
    // teams it need not equal this OS hostname), so it is reported, not judged.
    let st; try { st = JSON.parse(String(status)); } catch { throw new Error(`aw workspace status from ${home} answered no JSON, so the seat is not connected; nothing is briefed`); }
    const ws = st.workspace && typeof st.workspace === "object" ? st.workspace : st;
    const shownPath = String(ws.workspace_path || ws.path || "");
    const same = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); } };
    if (!shownPath || !same(shownPath, home)) throw new Error(`aw workspace status from ${home} shows workspace_path ${JSON.stringify(shownPath)} not this home, so the seat is not connected; nothing is briefed`);
    const hostNote = ws.hostname && ws.hostname !== hostname() && ws.hostname.split(".")[0] !== hostname().split(".")[0] ? ` (workspace row hostname ${ws.hostname}, this host ${hostname()})` : "";
    const identityText = readFileSync(join(dest, "identity.yaml"), "utf8");
    const expectedDid = yamlScalar(identityText, "did");
    const expectedAddress = yamlScalar(identityText, "address");
    // The same-identity check the contract is for: `aw whoami --json` from the
    // new home reports the did and address the CLI now acts as (workspace
    // status carries no did); both must equal the copied identity.yaml.
    let who; try { who = JSON.parse(String(run(["aw", "whoami", "--json"], home, 60000))); } catch (e) { throw new Error(`aw whoami from ${home} answered no JSON (${e.message || e}); the seat is not verified`); }
    const shownDid = who.did || who.identity?.did;
    const shownAddress = who.address || who.identity?.address;
    if (expectedDid && shownDid !== expectedDid) throw new Error(`aw whoami shows did ${shownDid || "(none)"}, not the retained identity's ${expectedDid}; the seat is not the same identity`);
    if (expectedAddress && shownAddress !== expectedAddress) throw new Error(`aw whoami shows address ${shownAddress || "(none)"}, not the retained identity's ${expectedAddress}; the seat is not the same identity`);
    const aliasRaw = String(ws.alias || st.alias || (expectedAddress || "").split("/").pop() || instance);
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(aliasRaw)) throw new Error(`aw workspace status reports an alias that is not a plausible alias; the seat is not briefed`);
    const alias = aliasRaw;
    if (expectedAddress && !expectedAddress.endsWith(`/${alias}`)) throw new Error(`aw workspace status shows alias ${alias}, not the retained identity's address ${expectedAddress}; the seat is not the same identity`);
    writeFileSync(lockPath, JSON.stringify({ home, instance, alias, team, takenAt: new Date().toISOString(), host: hostname(), ...(takenOver ? { tookOverFrom: takenOver } : {}) }, null, 2) + "\n", { mode: 0o600 });
    const launch = (process.env.OATS_RUNTIME || "") === "claude" && deliveryMode === "channel"
      ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }
      : undefined;
    const env = deliveryMode === "session" ? { AWEB_DELIVERY: "session" } : undefined;
    const deliveryBrief = deliveryMode === "session"
      ? ` Notification delivery: external (AWEB_DELIVERY=session); until the host wake broker registers this instance NOTHING wakes you: check \`aw mail inbox\` and \`aw chat pending\` at every task boundary.`
      : "";
    if (deliveryMode === "session") wakeRegister(home, dest);
    const warnings = [];
    if (takenOver) warnings.push(`oats-aweb: took over the retained identity from ${takenOver} on identity.takeOver: true; if that runtime was still alive there are now two seats with one key — stop the old one`);
    if (hostNote) warnings.push(`oats-aweb: seated${hostNote}`);
    out({
      meta: { team, alias, retained: true, source, lock: lockPath, delivery: deliveryMode, ...(takenOver ? { tookOverFrom: takenOver } : {}) },
      ...(env ? { env } : {}),
      brief: `Comms: you are the retained seat of the existing aweb identity "${alias}" on team ${team} (same did and address as the seat you replace; its contacts, routes and conversations are yours).${deliveryBrief} Use \`aw mail\`/\`aw chat\` for messaging (see the aweb-messaging skill).`,
      ...(launch ? { launch } : {}),
      ...(warnings.length ? { warning: warnings.join(" | ") } : {}),
    });
  } catch (e) {
    const restored = rollback();
    fatal(`retained identity could not be seated from ${source}: ${e.message || e}${connected ? (restored ? " (the server binding was restored to the legacy home and the copy removed)" : ` (the server binding still points at ${home} and the copy was KEPT there so the seat is recoverable: run aw workspace connect from ${legacyHome} to restore it, or retry the spawn)`) : ""}`);
  }
}

if (event === "spawn") {
  if (settings.identity && typeof settings.identity === "object" && settings.identity.source) retainedSeatSpawn(String(settings.identity.source), settings.identity.takeOver === true);
  let minted;                 // external identity, once `aw team join` succeeds
  const root = awebRoot();
  if (!root) fatal(`no initialized aweb root (.aw) among the bounded candidates (home, its git repo, context repo, workspace ${process.env.OATS_WORKSPACE || "?"}), so no identity could be minted and this instance would have no messaging — run \`oats aweb setup\` for guided onboarding`);
  try {
    // Team correctness: the config's `team:` block wins (id, then name), else the
    // root's active team. ALWAYS pass --team-id explicitly — never inherit whatever
    // team happens to be active at mint time — and verify the joined cert matches.
    // The instance name IS the discoverable alias (the team roster doubles as the
    // cross-machine instance directory).
    let team = process.env.OATS_TEAM_ID || process.env.OATS_TEAM_NAME;
    if (!team) team = JSON.parse(run(["aw", "team", "list", "--json"], root)).active_team;
    if (!team) fatal("cannot determine target team (no config team block, no active team at root), so no identity could be minted — set a team: block in oats-config.yaml, or activate a team at the aweb root");
    // A bare team name (no namespace) resolves against the root's memberships.
    if (!team.includes(":")) {
      const teams = JSON.parse(run(["aw", "team", "list", "--json"], root));
      const match = teamIdsOf(teams).filter((tid) => String(tid).startsWith(`${team}:`));
      if (match.length === 1) team = match[0];
      else if (match.length > 1) fatal(`team name "${team}" is ambiguous at ${root}: ${match.join(", ")}, so no identity could be minted — set team.id in oats-config.yaml`);
      else fatal(`no membership matching team "${team}" at ${root}, so no identity could be minted — join or create it first (aweb-team-membership skill), or set team.id`);
    }
    // Both of these carry the invite token — one mints it, the other spends it —
    // so neither their output nor their diagnostics may reach a log.
    const inv = parseSecretJson(run(["aw", "team", "invite", "--team-id", team, "--json"], root, 45000, { secretSafe: true }), "aw team invite");
    if (!inv?.token || typeof inv.token !== "string") fatal("aw team invite returned no usable token, so no identity could be minted");
    let raw;
    try {
      // 120 s: a join on a slow or flapping link is slow, not broken; a killed
      // join that completed server-side is caught below.
      raw = parseSecretJson(run(["aw", "team", "join", inv.token, "--name", instance, "--json"], home, JOIN_TIMEOUT_MS, { secrets: [inv.token], secretSafe: true }), "aw team join");
    } catch (e) {
      // The join may have completed after the CLI was killed or reported a
      // failure: if the home now holds a bound identity, that identity EXISTS
      // and must be reported so compensation retires it instead of orphaning it.
      if (joinedLate(home)) {
        const late = workspaceAliasOf(home);
        minted = { team, alias: late };
        fatal(`aw team join was reported failed (${e.message || e}) but the home now holds a bound identity "${late}" on ${team}; reported for compensation so it is retired, not orphaned`, minted);
      }
      // A retired alias keeps its certificate until aweb-abim ships, so a
      // re-spawn under the same name is refused by AWID. Say that, and the
      // remedy, instead of relaying a bare join error.
      if (e.aliasConflict) {
        fatal(`alias "${instance}" already holds a certificate on ${team} (a retired instance of that name is not reusable until aweb-abim ships), so no identity could be minted — spawn with a fresh --purpose instead`);
      }
      throw e;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fatal("aw team join returned no usable result, so no identity could be minted", minted);
    // The RESPONSE is not a safe place to take strings from. Suppressing the
    // failure paths does nothing if a successful reply is copied into meta and
    // the briefing verbatim: a response echoing the invite token back as the
    // alias would print it twice, on exit 0 (reviewer-a6aa1c5). Accept a field
    // only if it is a plausible value of its own kind and is not carrying the
    // token; otherwise fall back to what WE asked for, which is always known.
    const clean = (v) => (typeof v === "string" && v.trim() && !v.includes(inv.token) ? v.trim() : undefined);
    const joined = {
      alias: (() => { const a = clean(raw.alias); return a && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(a) ? a : instance; })(),
      // Team ids are "<name>:<domain>"; anything else is not one, and the
      // requested team is the honest fallback.
      team_id: (() => { const t = clean(raw.team_id); return t && /^[^\s:]+:[^\s:]+$/.test(t) ? t : team; })(),
    };
    // External state now exists. Record it immediately so any later failure can
    // still report it for compensation.
    minted = { team: joined.team_id, alias: joined.alias };
    run(["aw", "init", "--do-not-touch-agents-md"], home);
    const alias = joined.alias;
    const mismatch = joined.team_id !== team
      ? ` [WARNING: joined ${joined.team_id}, expected ${team}]` : "";
    // Runtime integration: for Claude Code sessions the aweb-channel plugin
    // carries real-time push events. This hook does NOT install it. The plugin
    // is a DECLARED runtime requirement (oats.json), consented once at
    // `oats install` and verified by the kernel before spawn — installing it here
    // would mutate the operator's Claude configuration without asking, inside a
    // spawn, which is exactly the silent host mutation the consent gate exists
    // to prevent. By the time this runs the kernel has already proven the plugin
    // is present and enabled, so contributing the flag is safe.
    // Session delivery: no channel flag, AWEB_DELIVERY=session in the launch
    // environment (declared in the manifest), and the truth about waking.
    const launch = (process.env.OATS_RUNTIME || "") === "claude" && deliveryMode === "channel"
      ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }
      : undefined;
    const env = deliveryMode === "session" ? { AWEB_DELIVERY: "session" } : undefined;
    const channelWarning = undefined;
    if (deliveryMode === "session") wakeRegister(home, join(home, ".aw"));
    const deliveryBrief = deliveryMode === "session"
      ? ` Notification delivery: external (AWEB_DELIVERY=session): the host wake broker (aw wake) is registered for this home and nudges you when mail or chat arrives; the native aweb channel is not running. If you have waited long with nothing arriving, check \`aw mail inbox\` and \`aw chat pending\` yourself at task boundaries.`
      : "";
    out({
      meta: { team: joined.team_id, alias, delivery: deliveryMode },
      ...(env ? { env } : {}),
      brief: `Comms: you have an aweb identity — alias "${alias}" on team ${joined.team_id}.${mismatch}${deliveryBrief} Use \`aw mail\`/\`aw chat\` for messaging (see the aweb-messaging skill); coordination stays in your deployment's task layer.`,
      ...(launch ? { launch } : {}),
      ...(mismatch ? { warning: `oats-aweb: team mismatch — joined ${joined.team_id}, expected ${team}` } : channelWarning ? { warning: channelWarning } : {}),
    });
  } catch (e) {
    // A join may already have created a REMOTE identity before the failure.
    // Hand it back as meta so the kernel's compensation can delete it — losing
    // it here would strand a roster entry no one owns.
    fatal(`identity minting failed: ${e.message || e}`, minted);
  }
} else if (event === "retire") {
  let meta = JSON.parse(process.env.OATS_META || "{}");
  // A retained seat: release the lock and leave the identity alone. Never
  // aw workspace delete (it would soft-delete the standing identity's row)
  // and never team retire; the source .aw stays until a human removes it.
  if (meta.delivery === "session") { if (!wakeDeregister(home)) process.stderr.write("oats-aweb: aw wake deregister failed; the broker treats a retired home as inactive on its own\n"); }
  if (meta.retained) {
    if (meta.lock) { try { rmSync(meta.lock, { force: true }); } catch { /* the lock may already be gone */ } }
    out({ meta: { retired: true, retained: true, identityReleased: true, ...(meta.tookOverFrom ? { tookOverFrom: meta.tookOverFrom } : {}) }, warning: `oats-aweb: released the retained identity "${meta.alias}" (lock ${meta.lock || "?"} removed); the identity itself and ${meta.source || "its source"} are untouched${meta.tookOverFrom ? `; this seat had taken over from ${meta.tookOverFrom}` : ""}` });
  }
  // No alias means the spawn hook never reported an identity: nothing exists to
  // undo, which is completion. An alias WITH no local `.aw` is the opposite —
  // the remote record exists and its key is gone, so the self-delete cannot be
  // authenticated and the cleanup is incomplete, not vacuous (reviewer-602627c).
  // A home whose spawn hook could not report its alias (a join killed on
  // timeout that completed anyway) still carries the alias in its workspace
  // binding: use it rather than leaving the workspace orphaned.
  if (!meta.alias) { const late = workspaceAliasOf(home); if (late) meta = { ...meta, alias: late, aliasFromHome: true }; }
  if (!meta.alias) out({ meta: { retired: false, reason: "nothing-to-delete" } });
  if (!existsSync(join(home, ".aw"))) {
    out({ meta: { retired: false, reason: "no-local-identity-key" }, warning: `oats-aweb: alias "${meta.alias}" was minted but ${join(home, ".aw")} is gone, so the remote record cannot be self-deleted and will linger until stale` }, 1);
  }
  try {
    // Self-delete from inside the home, authenticated by its own key — a remote
    // delete would 409 until the server marks the workspace stale.
    // aw 1.36.1 (aweb-abim) revokes the member's certificate on delete and
    // says so: `--json` prints alias_released true|false with a reason, and
    // a released alias may be reused by a later spawn. An older aw cannot
    // revoke, so the alias stays unusable and the report says that instead.
    if (awAtLeast("1.36.1")) {
      const raw = run(["aw", "workspace", "delete", meta.alias, "--json"], home);
      let doc; try { doc = JSON.parse(raw); } catch { doc = undefined; }
      const released = doc?.alias_released === true;
      // aw 1.36.1 prints the cause as alias_released_reason (workspace.go,
      // workspace_self_retire.go); `reason` is tolerated for a later rename.
      const reason = typeof doc?.alias_released_reason === "string" ? doc.alias_released_reason : typeof doc?.reason === "string" ? doc.reason : (doc ? "unstated" : "no JSON answer");
      out({ meta: { retired: true, aliasReusable: released, aliasReason: reason }, ...(released ? {} : { warning: `oats-aweb: workspace "${meta.alias}" deleted but its alias was not released (${reason}); spawn successors with a fresh --purpose until it is` }) });
    }
    run(["aw", "workspace", "delete", meta.alias], home);
    // Honest: the workspace row is deleted, but a hosted local member cannot
    // revoke its own AWID certificate (aweb-abim), so the alias is NOT
    // reusable. retired stays true because the cleanup is as complete as the
    // platform allows; the field and the line carry the truth.
    out({ meta: { retired: true, aliasReusable: false }, warning: `oats-aweb: workspace "${meta.alias}" deleted; its certificate is not revoked (aweb-abim), so the alias is not reusable — spawn successors with a fresh --purpose` });
  } catch (e) {
    // Exit nonzero: during a required-hook rollback this is the signal that
    // compensation did NOT complete, so the spawn is not reported as cleanly
    // rolled back while a remote identity still exists.
    out({ meta: { retired: false, reason: "self-delete-failed" }, warning: `oats-aweb: self-delete failed (the remote record will linger until stale): ${e.message || e}` }, 1);
  }
} else if (event === "roster") {
  // Cross-machine directory: every OATS-spawned instance joins the team with
  // alias = instance name, so the team's member roster lists live instances
  // wherever they run (plus human members). Local liveness comes from
  // `oats status --team`; this is the network view.
  const root = awebRoot();
  if (!root) { console.error("oats aweb roster: no initialized aweb root (.aw) found"); process.exit(1); }
  const team = process.env.OATS_TEAM_ID || process.env.OATS_TEAM_NAME || JSON.parse(run(["aw", "team", "list", "--json"], root)).active_team;
  if (!team) { console.error("oats aweb roster: cannot determine team (no config team block, no active team)"); process.exit(1); }
  const teamFlag = team.includes(":") ? ["--team-id", team] : ["--team", team];
  const r = JSON.parse(run(["aw", "id", "team", "members", ...teamFlag, "--json"], root, 60000));
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`aweb team ${r.team_id || team} — member roster (cross-machine):`);
  const members = r.members || [];
  if (!members.length) console.log("  (no member certificates visible from this workspace)");
  for (const m of members) console.log(`  ${m.alias || m.name || m.did || JSON.stringify(m)}`);
  console.log("\nAliases minted by OATS are instance names; message one with `aw mail send --to <alias> --subject \"...\" --body \"...\"`.");
  process.exit(0);
} else if (event === "setup") {
  // Guided onboarding — idempotent, prints what it finds and the one next step.
  const scope = process.env.OATS_TEAM_SCOPE || process.cwd();
  const teamName = process.env.OATS_TEAM_NAME;
  const teamId = process.env.OATS_TEAM_ID;
  console.log(`aweb onboarding — team scope: ${scope}${teamName ? `, config team: ${teamName}${teamId ? ` (${teamId})` : ""}` : ""}\n`);
  if (!teamName) {
    console.log("1. Declare your team in the deployment scope's oats-config.yaml first:");
    console.log("     team:\n       name: <your-team>\n   then re-run `oats aweb setup` from there.");
    process.exit(0);
  }
  if (!existsSync(join(scope, ".aw"))) {
    console.log(`No aweb workspace at the team scope yet. Initialize it (interactive — creates or connects an aweb account):`);
    console.log(`     cd ${scope} && aw init`);
    console.log("   First time on aweb? `aw init` walks you through creating a hosted aweb.ai account.");
    console.log("   Own your domain? Use `aw init --byod` (see the aweb-team-membership skill).");
    process.exit(0);
  }
  let teams = { memberships: [] };
  try { teams = JSON.parse(run(["aw", "team", "list", "--json"], scope)); } catch { /* fall through */ }
  const want = teamId || teamName;
  const match = teamIdsOf(teams).find((tid) => String(tid) === want || String(tid).startsWith(`${want}:`));
  if (match) {
    console.log(`✓ aweb workspace initialized and member of ${match}.`);
    if (teams.active_team && teams.active_team !== match) console.log(`  Note: active team is ${teams.active_team}; instances join ${match} explicitly, but consider \`aw team switch ${match}\`.`);
    console.log("  Done — spawned instances will join this team automatically (alias = instance name).");
    console.log("  Roster: `oats aweb roster`  ·  local: `oats status --team`");
  } else {
    console.log(`Workspace initialized, but no membership matching "${want}".`);
    console.log(`  Create the team:   cd ${scope} && aw team create ${teamName}`);
    console.log("  Or join an existing one: get an invite token from a member, then `aw team join <token>`");
    console.log("  (details: aweb-team-membership skill)");
  }
  process.exit(0);
} else {
  warn(`unknown event "${event}" (expected spawn|retire)`);
}
