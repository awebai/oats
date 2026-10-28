/** The CLI's hot reads (awebai/oats#1630): the reads the Desktop, the TUI and agents' hooks run over and
 *  over load only the modules they use, never core.mjs. `bin/oats.mjs` asks hotRead for its argv before
 *  its imports; for a hot read, each of its import lines (`lib/<name>.mjs`) takes the leaves listed here
 *  for that name, the modules its names are defined in and re-exported from. Every other command, and a
 *  hot read given anything but the words and flags listed here (help, an unknown flag, a missing value),
 *  imports every module as before.
 *
 *  A list must hold every module the read's code can reach, its error paths included. A line a read
 *  does not list, or a name its leaves do not export, is a tripwire (standIn): taking it is free, and
 *  any use of it throws a HotReadUnlisted defect that names the read, the line and the name.
 *  test/cli-hot-reads.test.mjs runs each read and pins the modules it must not load. Kernel-private,
 *  not exported from `./core`. Dependency-free. */

/** The dispatch's own modules: the deprecated-name warning, the typed failures, the resume feature. */
const DISPATCH = { deprecation: ["deprecation"], errors: ["errors"], "session-resume-contract": ["session-resume-contract"] };
/** A read that lists its deployment (LISTS_ITS_DEPLOYMENT in bin/oats.mjs): the observer and the list. */
const LISTS = { "resolved-deployment": ["resolved-deployment"], deployments: ["deployments"] };
/** `--max-age` (status and workspace status): the observation window and the local-input revision. */
const OBSERVES = { remote: ["remote"], "local-inputs": ["local-inputs"] };

const READS = {
  version: { ...DISPATCH, core: ["version"], schedule: ["automation-api"], automations: ["automation-api"], "session-viewer": ["session-viewer"] },
  "session inspect": { ...DISPATCH, ...LISTS, "refused-text": ["refused-text"], core: ["session-inspect"] },
  status: { ...DISPATCH, ...LISTS, ...OBSERVES, core: ["agents-root", "instance-listing"], "session-viewer": ["session-viewer"], "status-words": ["status-words"], teams: ["teams"], workspace: ["workspace"], packages: ["packages"] },
  "status --server": { ...DISPATCH, "status-words": ["status-words"], servers: ["servers"] },
  "workspace status": { ...DISPATCH, ...LISTS, ...OBSERVES, core: ["package-catalog"], packages: ["packages"], schedule: ["automation-scope"], automations: ["automations"], workspace: ["workspace"] },
  "instance events": { ...DISPATCH, ...LISTS, core: ["agents-root"], "instance-events": ["instance-events"], "instance-lifecycle": ["instance-address"] },
  "instance waiting clear": { ...DISPATCH, ...LISTS, core: ["soul-listing", "agents-root"], "instance-events": ["instance-events"], "instance-lifecycle": ["instance-address"] },
};

/** Each hot read's form: its words (`<name>`: an instance name), the switches and the value flags it
 *  takes, and the value flags it requires. */
const FORMS = [
  { read: "version", words: ["version"], switches: ["--json"] },
  { read: "version", words: ["--version"], switches: ["--json"] },
  { read: "version", words: ["-v"], switches: ["--json"] },
  { read: "session inspect", words: ["session", "inspect"], switches: ["--json"], values: ["--home"] },
  { read: "status", words: ["status"], switches: ["--json", "--team", "--verbose"], values: ["--dir", "--max-age"] },
  { read: "status --server", words: ["status"], switches: ["--json"], values: ["--server"], requires: ["--server"] },
  { read: "workspace status", words: ["workspace", "status"], switches: ["--json"], values: ["--dir", "--max-age"] },
  { read: "instance events", words: ["instance", "events", "<name>"], switches: ["--json"], values: ["--home", "--dir", "--limit", "--since"] },
  { read: "instance waiting clear", words: ["instance", "waiting", "clear"], switches: ["--json"], values: ["--producer", "--reason", "--message", "--home", "--dir"] },
];

function matches(form, argv) {
  if (argv.length < form.words.length) return false;
  if (form.words.some((w, i) => (w === "<name>" ? !argv[i] || argv[i].startsWith("-") : argv[i] !== w))) return false;
  const given = new Set();
  for (let i = form.words.length; i < argv.length; i++) {
    const a = argv[i], eq = a.indexOf("=");
    if (form.switches.includes(a)) continue;
    const name = a.startsWith("--") && eq > 2 ? a.slice(0, eq) : a;
    if (!form.values?.includes(name)) return false;
    if (name === a) { if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) return false; i++; }
    given.add(name);
  }
  return (form.requires ?? []).every((f) => given.has(f));
}

/** argv's hot read, { form, lines: { <name>: [leaf names] } }, or null for any other command. Help is
 *  never one: the dispatch answers usage for `-h` or `--help` anywhere in argv as it expands it, a flag's
 *  value included (`--dir -h`, `--dir=-h`), and usage reads beyond any hot read's names. */
export function hotRead(argv) {
  if (argv.some((a) => /(^|=)(-h|--help)$/.test(a))) return null;
  const form = FORMS.find((f) => matches(f, argv));
  return form ? { form: form.read, lines: READS[form.read] } : null;
}

/** The leaves a hot read loads in place of an import line of bin/oats.mjs (`../lib/<name>.mjs`, `yaml`). */
export function hotLeaves(read, specifier) {
  return read.lines[/^\.\.\/lib\/(.+)\.mjs$/.exec(specifier)?.[1] ?? specifier] ?? [];
}

/** A hot read's use of a name it does not list: a mistake in this table, never an answer. Its name is on
 *  the prototype, so the kernel reports it as the defect it is (errors.mjs isDefect). */
export class HotReadUnlisted extends Error {}
HotReadUnlisted.prototype.name = "HotReadUnlisted";

/** What an import line answers in a hot read: the one leaf's namespace (read live), or the names of its
 *  leaves together, behind a proxy that answers any other name with a tripwire. `then` is never one: an
 *  `await` asks for it, and its absence is what makes the answer no promise. */
export function standIn(read, specifier, modules) {
  const target = modules.length === 1 ? modules[0] : Object.assign(Object.create(null), ...modules);
  return new Proxy(target, { get: (t, name) => (name in t ? t[name] : name === "then" ? undefined : tripwire(read, specifier, name)) });
}

function tripwire(read, specifier, name) {
  const fail = () => {
    throw new HotReadUnlisted(`oats ${read.form} is a hot read, and it used ${String(name)} of ${specifier}, which lib/hot-reads.mjs does not list for it: list the module that defines ${String(name)} under that line in the read's entry in lib/hot-reads.mjs`);
  };
  // A function target, so that a call and `new` reach their traps too.
  return new Proxy(function unlisted() {}, { get: fail, set: fail, has: fail, ownKeys: fail, apply: fail, construct: fail, getOwnPropertyDescriptor: fail, defineProperty: fail, deleteProperty: fail, getPrototypeOf: fail });
}
