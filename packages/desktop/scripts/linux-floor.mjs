// The Linux installers' glibc floor (#1050) — dist-smoke's Linux phase.
//
// docs/desktop.md states what Linux the installers need: the glibc version
// (and libstdc++'s GLIBCXX and CXXABI) their files ask for. That number is a
// fact about the files, and it follows the system that built them: a native
// module built on a newer runner, or a newer node-pty or Electron, can raise
// it silently. This phase holds it. It unpacks the two shipped Linux
// artifacts, reads the version needs of every ELF file in them, and fails
// when one needs more than scripts/linux-floor.json, the one value the page
// states (test/linux-floor.test.mjs holds the page to it).
//
// What is read, and why it is all of it:
//   * the DEB, unpacked with `ar x` and `tar -xf` (binutils and tar, beside
//     readelf);
//   * the AppImage, which is more than the app directory both are made from:
//     electron-builder writes the AppImage runtime (an ELF) at the head of the
//     file and adds its own libraries under usr/lib. The file itself is read
//     as an ELF, and its squashfs is extracted by the AppImage's own
//     `--appimage-extract` (the runner image has no squashfs-tools). That runs
//     the AppImage runtime to unpack it, never the app;
//   * in each, every regular file whose first bytes are the ELF magic, and
//     every ELF entry inside app.asar (Electron loads a native module from the
//     asar by copying it out; app.asar.unpacked is on disk and read as files).
//
// The tool: `readelf -V -W`, the version-needs table (.gnu.version_r). It is
// what the dynamic loader checks at load time ("version `GLIBC_2.34' not
// found"); `objdump -T` would mix in the versions a file defines. GLIBC_*
// needs count against the glibc floor whichever glibc library names them
// (libc, libm, libdl, libpthread, ld-linux), GLIBCXX_* and CXXABI_* against
// libstdc++'s; other libraries' versions (NSS, ALSA, GCC_) are not glibc's
// and are not held. A need this cannot place under a number (GLIBC_PRIVATE,
// GLIBC_ABI_DT_RELR) fails: the floor cannot say what glibc it requires.
//
// Fails loudly, never passes by default: a missing tool, a failed or timed-out
// extraction or read, an unreadable asar, or a tree without the app's
// executable (an empty scan would hold nothing).
//
// Execution discipline: as smoke-probes.mjs, every child runs through the
// injected reaper's runTracked (async, detached, group-tracked; a timeout
// kills the group). No synchronous child execution. Filesystem reads are
// synchronous and local.
import {
  closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

/** Where the value lives, relative to packages/desktop: what failures name. */
export const FLOOR_FILE = "scripts/linux-floor.json";
const FLOOR_URL = new URL("./linux-floor.json", import.meta.url);

/** Version namespaces held, and the floor key that holds each. */
export const NAMESPACES = { GLIBC: "glibc", GLIBCXX: "glibcxx", CXXABI: "cxxabi" };
const NUMERIC = /^\d+(\.\d+)*$/;

/** The floor: { glibc, glibcxx?, cxxabi? }, each a dotted number. Throws on
 * anything else, so a mistyped value never passes a build. */
export function parseFloor(text) {
  const floor = JSON.parse(text);
  if (!floor || typeof floor !== "object" || Array.isArray(floor)) throw new Error(`${FLOOR_FILE} must hold an object`);
  if (floor.glibc === undefined) throw new Error(`${FLOOR_FILE} must name the glibc floor`);
  const keys = new Set(Object.values(NAMESPACES));
  for (const [key, value] of Object.entries(floor)) {
    if (!keys.has(key)) throw new Error(`${FLOOR_FILE}: unknown key ${key}`);
    if (typeof value !== "string" || !NUMERIC.test(value)) throw new Error(`${FLOOR_FILE}: ${key} must be a dotted version number, got ${JSON.stringify(value)}`);
  }
  return floor;
}

export function readFloor() {
  return parseFloor(readFileSync(FLOOR_URL, "utf8"));
}

/** Compare dotted numbers part by part: -1, 0 or 1. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The version needs in `readelf -V -W` output: [{ library, name }], read from
 * the "Version needs section" only (the definitions section also prints
 * `Name:` fields, and they are what the file provides, not what it needs).
 */
export function parseVersionNeeds(text) {
  const needs = [];
  let inNeeds = false, library = null;
  for (const line of String(text).split("\n")) {
    if (/^Version needs section/.test(line)) { inNeeds = true; library = null; continue; }
    if (/^\S/.test(line)) { inNeeds = false; continue; }
    if (!inNeeds) continue;
    const file = /\bFile: (\S+)/.exec(line);
    if (file) { library = file[1]; continue; }
    const name = /\bName: (\S+)/.exec(line);
    if (name) needs.push({ library, name: name[1] });
  }
  return needs;
}

/**
 * Hold one file's needs against the floor. Returns
 * { held: [{ ns, version, name }], problems: [string] }: a problem is a need
 * above the floor, a held namespace without a floor, or a version that is not
 * a number. `where` names the file in the messages.
 */
export function holdNeeds(where, needs, floor) {
  const held = [], problems = [], unheld = {};
  for (const { name } of needs) {
    const m = /^(GLIBCXX|GLIBC|CXXABI)_(.*)$/.exec(name);
    if (!m) continue;                                  // another library's versions (NSS_, ALSA_, GCC_ …)
    const [, ns, version] = m;
    const key = NAMESPACES[ns];
    if (!NUMERIC.test(version)) { problems.push(`${where} needs ${name}, which names no version: the floor cannot hold it`); continue; }
    if (floor[key] === undefined) {                    // reported once per namespace, at its highest need
      if (!unheld[ns] || compareVersions(version, unheld[ns].version) > 0) unheld[ns] = { version, name };
      continue;
    }
    if (compareVersions(version, floor[key]) > 0) problems.push(`${where} needs ${name}, newer than the floor ${key} ${floor[key]} (${FLOOR_FILE})`);
    held.push({ ns, version, name });
  }
  for (const [ns, { name }] of Object.entries(unheld)) problems.push(`${where} needs ${name}, and ${FLOOR_FILE} has no ${NAMESPACES[ns]} floor`);
  return { held, problems };
}

/** Whether the first bytes are the ELF magic. */
export function isElfHeader(buf) {
  return buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
}

function headOf(path, n = 4) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally { closeSync(fd); }
}

/** Every regular file under `root` (symlinks are not followed: what they
 * point at inside the package is read where it is). */
export function regularFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) out.push(path);
    }
  };
  walk(root);
  return out;
}

/** The ELF files under `root`. */
export function elfFiles(root) {
  return regularFiles(root).filter((path) => isElfHeader(headOf(path)));
}

/**
 * The ELF entries packed inside an asar archive: [{ name, offset, size }],
 * offsets absolute in the file. The header is a Chromium pickle: a uint32
 * size of the size pickle (4), the header pickle's size, then that pickle's
 * payload size and the JSON's length, then the JSON; file data starts after
 * the header pickle. Entries marked `unpacked` live in app.asar.unpacked and
 * are read there; links are not files. Throws when the header cannot be read.
 */
export function asarElfEntries(asarPath) {
  const fd = openSync(asarPath, "r");
  try {
    const sizes = Buffer.alloc(16);
    if (readSync(fd, sizes, 0, 16, 0) !== 16) throw new Error("truncated asar header");
    const headerSize = sizes.readUInt32LE(4), jsonLength = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    if (readSync(fd, json, 0, jsonLength, 16) !== jsonLength) throw new Error("truncated asar header");
    const header = JSON.parse(json.toString("utf8"));
    const base = 8 + headerSize;
    const out = [];
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files || {})) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.files) { walk(entry, path); continue; }
        if (entry.link || entry.unpacked || !(entry.size >= 4)) continue;
        const offset = base + Number(entry.offset);
        const head = Buffer.alloc(4);
        readSync(fd, head, 0, 4, offset);
        if (isElfHeader(head)) out.push({ name: path, offset, size: entry.size });
      }
    };
    walk(header, "");
    return out;
  } finally { closeSync(fd); }
}

function copyRange(src, offset, size, dest) {
  const fd = openSync(src, "r");
  try {
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, offset);
    writeFileSync(dest, buf);
  } finally { closeSync(fd); }
}

/** Tools the phase runs, each asked for its version first so a missing one
 * fails by name before anything is unpacked. */
export const TOOLS = ["readelf", "ar", "tar"];

/**
 * The phase. `artifacts` = { deb, appImage } (paths to the built files);
 * `executable` = the app's executable name each unpacked tree must hold.
 * Returns { ok, detail, lines } and never throws.
 */
export async function checkLinuxFloor(reaper, artifacts, {
  floor, executable = "oats-desktop", timeout = 120_000, now = () => Date.now(), tmp = tmpdir(),
} = {}) {
  if (typeof reaper?.runTracked !== "function") {
    return { ok: false, detail: "the glibc floor check requires a reaper with runTracked (async group-tracked execution is the contract)" };
  }
  try { floor = floor ?? readFloor(); } catch (e) { return { ok: false, detail: `cannot read the floor: ${e.message}` }; }
  const deadline = now() + timeout;
  const env = { ...process.env, LC_ALL: "C" };
  const run = async (exe, args, cwd) => {
    const left = deadline - now();
    if (left <= 0) return { failed: `${exe} not started: the phase's ${timeout / 1000}s budget is spent` };
    const r = await reaper.runTracked(exe, args, { timeout: left, env, cwd });
    if (r.timedOut) return { failed: `${exe} ${args.join(" ")} timed out (group killed)` };
    if (r.code !== 0) return { failed: `${exe} ${args.join(" ")} failed (exit ${r.code}): ${`${r.stdout}\n${r.stderr || ""}`.trim().slice(-400)}` };
    return { stdout: String(r.stdout) };
  };

  for (const tool of TOOLS) {
    const r = await run(tool, ["--version"]);
    if (r.failed) return { ok: false, detail: `required tool missing or broken: ${tool} (${r.failed})` };
  }
  for (const kind of ["deb", "appImage"]) {
    const path = artifacts?.[kind];
    if (!path || !existsSync(path)) return { ok: false, detail: `no ${kind} to read: ${path}` };
  }

  const work = mkdtempSync(join(tmp, "oats-linux-floor-"));
  const problems = [], lines = [];
  try {
    // One file's needs. `where` names it for the messages.
    const readFile = async (path, where, held) => {
      const r = await run("readelf", ["-V", "-W", path]);
      if (r.failed) { problems.push(`${where}: ${r.failed}`); return; }
      const one = holdNeeds(where, parseVersionNeeds(r.stdout), floor);
      problems.push(...one.problems);
      held.push(...one.held.map((h) => ({ ...h, where })));
    };
    // A whole unpacked tree, asar entries included.
    const readTree = async (label, root, held) => {
      const elves = elfFiles(root);
      if (!elves.some((p) => basename(p) === executable)) {
        problems.push(`${label}: no ELF named ${executable} in what was unpacked (${elves.length} ELF files): nothing proves the scan read the app`);
      }
      for (const path of elves) await readFile(path, `${label}:${relative(root, path)}`, held);
      let count = elves.length;
      for (const asar of regularFiles(root).filter((p) => basename(p) === "app.asar")) {
        let entries;
        try { entries = asarElfEntries(asar); } catch (e) { problems.push(`${label}:${relative(root, asar)} cannot be read as an asar: ${e.message}`); continue; }
        for (const entry of entries) {
          const copy = join(work, `asar-entry-${count++}`);
          copyRange(asar, entry.offset, entry.size, copy);
          await readFile(copy, `${label}:${relative(root, asar)}/${entry.name}`, held);
        }
      }
      return count;
    };
    const summary = (label, count, held) => {
      const top = {};
      for (const h of held) if (!top[h.ns] || compareVersions(h.version, top[h.ns].version) > 0) top[h.ns] = h;
      const parts = Object.keys(NAMESPACES).filter((ns) => top[ns]).map((ns) => `${top[ns].name} (${top[ns].where.slice(label.length + 1)})`);
      return `${label}: ${count} ELF files read; highest needs ${parts.join(", ") || "none"}`;
    };

    // The DEB: ar x, then its data archive.
    {
      const label = basename(artifacts.deb);
      const dir = join(work, "deb"), root = join(dir, "root");
      mkdirSync(root, { recursive: true });
      const ar = await run("ar", ["x", artifacts.deb], dir);
      const data = ar.failed ? null : readdirSync(dir).find((n) => n.startsWith("data.tar"));
      if (ar.failed) problems.push(`${label}: ${ar.failed}`);
      else if (!data) problems.push(`${label}: no data.tar.* member (ar x gave ${readdirSync(dir).join(", ")})`);
      else {
        const tar = await run("tar", ["-xf", join(dir, data), "-C", root]);
        if (tar.failed) problems.push(`${label}: ${tar.failed}`);
        else { const held = []; const n = await readTree(label, root, held); lines.push(summary(label, n, held)); }
      }
    }

    // The AppImage: its runtime (the file itself), then what it carries.
    {
      const label = basename(artifacts.appImage);
      const held = [];
      await readFile(artifacts.appImage, `${label}:<runtime>`, held);
      const dir = join(work, "appimage");
      mkdirSync(dir);
      const x = await run(artifacts.appImage, ["--appimage-extract"], dir);
      if (x.failed) problems.push(`${label}: ${x.failed}`);
      else if (!existsSync(join(dir, "squashfs-root"))) problems.push(`${label}: --appimage-extract left no squashfs-root`);
      else { const n = await readTree(label, join(dir, "squashfs-root"), held); lines.push(summary(label, n + 1, held)); }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const stated = Object.entries(floor).map(([k, v]) => `${k} ${v}`).join(", ");
  if (problems.length) return { ok: false, detail: `the Linux package is not held within its stated floor (${stated}, ${FLOOR_FILE}):\n  ${problems.join("\n  ")}`, lines };
  return { ok: true, detail: `every ELF file of the Linux package is within the stated floor (${stated}, ${FLOOR_FILE})`, lines };
}
