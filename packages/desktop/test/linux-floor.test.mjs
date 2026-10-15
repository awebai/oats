// linux-floor — the Linux installers' glibc floor (#1050).
//
// Pins:
//   * the one value (scripts/linux-floor.json) and what the page states
//     (docs/desktop.md): the same glibc number;
//   * the reading of `readelf -V -W`: needs only, never definitions;
//   * holding needs: under, at and above the floor; GLIBCXX and CXXABI;
//     a namespace without a floor and a version that is no number fail;
//     other libraries' versions are not glibc's;
//   * the phase end to end, with synthetic artifacts and a fake reaper: what
//     is read (the DEB, the AppImage's runtime and its contents, ELF entries
//     of app.asar), what is not (a non-ELF file), and every way it fails
//     loudly (a tool missing, an extraction failing, a read timing out, no
//     executable in what was unpacked);
//   * the wiring: dist-smoke runs it on linux, guarded by the platform only,
//     before the launch skip, through the reaper.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FLOOR_FILE, TOOLS, asarElfEntries, checkLinuxFloor, compareVersions, holdNeeds, isElfHeader, parseFloor, parseVersionNeeds, readFloor,
} from "../scripts/linux-floor.mjs";
import { PHASE_BUDGET_MS } from "../scripts/launch-probe.mjs";

const FLOOR = { glibc: "2.34", glibcxx: "3.4.22", cxxabi: "1.3.9" };

// ---- the value and the page ----------------------------------------------------

test("the floor file holds glibc, GLIBCXX and CXXABI as dotted numbers", () => {
  const floor = readFloor();
  assert.deepEqual(Object.keys(floor).sort(), ["cxxabi", "glibc", "glibcxx"]);
  assert.equal(FLOOR_FILE, "scripts/linux-floor.json");
});

test("docs/desktop.md states the floor's glibc, and no other glibc number", () => {
  const floor = readFloor();
  const page = readFileSync(new URL("../../../docs/desktop.md", import.meta.url), "utf8");
  const install = page.slice(page.indexOf("## Install"), page.indexOf("\n## ", page.indexOf("## Install") + 1));
  assert.ok(install.includes("| Linux x64 |"), "the Install section holds the platform table");
  const prose = install.replace(/\s+/g, " ");
  assert.ok(prose.includes(`On Linux the installers need glibc ${floor.glibc} or later (for example Ubuntu 22.04, Debian 12, RHEL 9 or later).`),
    `the Install section states glibc ${floor.glibc} with its examples`);
  assert.match(prose, /not a list of systems the app was tested on/, "stated as a fact about the files, not a tested promise");
  const numbers = [...page.matchAll(/glibc (\d+(?:\.\d+)+)/g)].map((m) => m[1]);
  assert.ok(numbers.length >= 1);
  for (const n of numbers) assert.equal(n, floor.glibc, `docs/desktop.md names glibc ${n}; the floor (${FLOOR_FILE}) is ${floor.glibc}`);
});

test("parseFloor refuses what would let a build pass by accident", () => {
  assert.deepEqual(parseFloor('{"glibc":"2.34"}'), { glibc: "2.34" });
  assert.throws(() => parseFloor('{"glibcxx":"3.4.22"}'), /must name the glibc floor/);
  assert.throws(() => parseFloor('{"glibc":2.34}'), /dotted version number/);
  assert.throws(() => parseFloor('{"glibc":"2.34-1"}'), /dotted version number/);
  assert.throws(() => parseFloor('{"glibc":"2.34","musl":"1.2"}'), /unknown key musl/);
  assert.throws(() => parseFloor("[]"), /must hold an object/);
  assert.throws(() => parseFloor("not json"));
});

test("compareVersions compares dotted numbers part by part", () => {
  assert.equal(compareVersions("2.34", "2.34"), 0);
  assert.equal(compareVersions("2.35", "2.34"), 1);
  assert.equal(compareVersions("2.4", "2.34"), -1, "numeric, not lexical");
  assert.equal(compareVersions("2.2.5", "2.2"), 1);
  assert.equal(compareVersions("3.4", "3.4.0"), 0);
});

// ---- reading readelf -----------------------------------------------------------

const readelfText = (needs, defs = []) => [
  "",
  "Version symbols section '.gnu.version' contains 3 entries:",
  "  000:   0 (*local*)       2 (GLIBC_2.99)    3 (GLIBC_2.2.5)",
  "",
  ...(defs.length ? [
    `Version definition section '.gnu.version_d' contains ${defs.length} entries:`,
    ...defs.map((d, i) => `  0x00${i}0: Rev: 1  Flags: none  Index: ${i + 2}  Cnt: 1  Name: ${d}`),
    "",
  ] : []),
  `Version needs section '.gnu.version_r' contains ${needs.length} entries:`,
  " Addr: 0x0000000000002440  Offset: 0x00002440  Link: 5 (.dynstr)",
  ...needs.flatMap(([file, names]) => [
    `  000000: Version: 1  File: ${file}  Cnt: ${names.length}`,
    ...names.map((n, i) => `  0x00${i}0:   Name: ${n}  Flags: none  Version: ${i + 2}`),
  ]),
  "",
].join("\n");

test("parseVersionNeeds reads the needs section only, with the library of each need", () => {
  const text = readelfText(
    [["libc.so.6", ["GLIBC_2.34", "GLIBC_2.2.5"]], ["libstdc++.so.6", ["GLIBCXX_3.4.22", "CXXABI_1.3.9"]]],
    ["GLIBC_9.99"],
  );
  assert.deepEqual(parseVersionNeeds(text), [
    { library: "libc.so.6", name: "GLIBC_2.34" }, { library: "libc.so.6", name: "GLIBC_2.2.5" },
    { library: "libstdc++.so.6", name: "GLIBCXX_3.4.22" }, { library: "libstdc++.so.6", name: "CXXABI_1.3.9" },
  ], "a defined version (GLIBC_9.99) and the symbols table (GLIBC_2.99) are not needs");
  assert.deepEqual(parseVersionNeeds("\nNo version information found in this file.\n"), []);
});

test("holdNeeds: a need under or at the floor passes, above it fails naming the file and the version", () => {
  const needs = (...names) => names.map((name) => ({ library: "libc.so.6", name }));
  assert.deepEqual(holdNeeds("f", needs("GLIBC_2.17", "GLIBC_2.2.5"), FLOOR).problems, [], "under");
  assert.deepEqual(holdNeeds("f", needs("GLIBC_2.34", "GLIBCXX_3.4.22", "CXXABI_1.3.9"), FLOOR).problems, [], "at");
  const above = holdNeeds("pkg:lib/pty.node", needs("GLIBC_2.35"), FLOOR).problems;
  assert.equal(above.length, 1);
  assert.match(above[0], /^pkg:lib\/pty\.node needs GLIBC_2\.35, newer than the floor glibc 2\.34 \(scripts\/linux-floor\.json\)$/);
  assert.match(holdNeeds("f", needs("GLIBCXX_3.4.30"), FLOOR).problems[0], /needs GLIBCXX_3\.4\.30, newer than the floor glibcxx 3\.4\.22/);
  assert.match(holdNeeds("f", needs("CXXABI_1.3.13"), FLOOR).problems[0], /needs CXXABI_1\.3\.13, newer than the floor cxxabi 1\.3\.9/);
});

test("holdNeeds: other libraries' versions are not held; one it cannot place fails", () => {
  const needs = (...names) => names.map((name) => ({ library: "x.so", name }));
  assert.deepEqual(holdNeeds("f", needs("NSS_3.30", "ALSA_0.9.0rc4", "GCC_3.0", "LIBUDEV_183"), FLOOR), { held: [], problems: [] });
  for (const name of ["GLIBC_PRIVATE", "GLIBC_ABI_DT_RELR", "CXXABI_TM_1"]) {
    assert.match(holdNeeds("f", needs(name), FLOOR).problems[0], new RegExp(`needs ${name}, which names no version`), name);
  }
  const unheld = holdNeeds("f", needs("CXXABI_1.3", "CXXABI_1.3.9", "GLIBC_2.17"), { glibc: "2.34" }).problems;
  assert.deepEqual(unheld, ["f needs CXXABI_1.3.9, and scripts/linux-floor.json has no cxxabi floor"], "once per namespace, at its highest need");
});

test("isElfHeader reads the magic only", () => {
  assert.ok(isElfHeader(Buffer.from("\x7fELF\x02", "latin1")));
  assert.ok(!isElfHeader(Buffer.from("#!/bin/sh", "latin1")));
  assert.ok(!isElfHeader(Buffer.from("MZ\x90\x00", "latin1")), "a Windows PE");
  assert.ok(!isElfHeader(Buffer.from("\xcf\xfa\xed\xfe", "latin1")), "a Mach-O");
  assert.ok(!isElfHeader(Buffer.from("\x7fEL", "latin1")));
});

// ---- the phase, end to end -----------------------------------------------------
// A synthetic ELF is the magic followed by the JSON of its needs; the fake
// readelf answers from it. The fake ar, tar and AppImage extract lay out the
// trees the test names, in the directory each is run in.

const elf = (needs) => Buffer.concat([Buffer.from("\x7fELF", "latin1"), Buffer.from(JSON.stringify(needs))]);
const APP = { glibc: ["GLIBC_2.25"] };
const PTY = { glibc: ["GLIBC_2.34", "GLIBC_2.2.5"], cxx: ["GLIBCXX_3.4.22", "CXXABI_1.3.9"] };
const toText = (needs) => readelfText([
  ...(needs.glibc ? [["libc.so.6", needs.glibc]] : []),
  ...(needs.cxx ? [["libstdc++.so.6", needs.cxx]] : []),
]);

/** A minimal asar: Chromium pickles of the header size and the JSON, then the data. */
function asar(entries) {
  const files = {}, chunks = [];
  let offset = 0;
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.split("/");
    let node = files;
    for (const dir of parts.slice(0, -1)) node = (node[dir] ??= { files: {} }).files;
    node[parts.at(-1)] = data === "unpacked" ? { size: 10, unpacked: true } : { size: data.length, offset: String(offset) };
    if (data !== "unpacked") { chunks.push(data); offset += data.length; }
  }
  const json = Buffer.from(JSON.stringify({ files }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4);
  json.copy(padded);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(4 + padded.length, 0);
  header.writeUInt32LE(json.length, 4);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(header.length + padded.length, 4);
  return Buffer.concat([sizes, header, padded, ...chunks]);
}

function layout(root, tree) {
  for (const [path, data] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  }
}

const DEB_TREE = {
  "opt/OATS Desktop/oats-desktop": elf(APP),
  "opt/OATS Desktop/libffmpeg.so": elf({ glibc: ["GLIBC_2.17"] }),
  "opt/OATS Desktop/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node": elf(PTY),
  "opt/OATS Desktop/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node": Buffer.from("\xcf\xfa\xed\xfe macho", "latin1"),
  "opt/OATS Desktop/resources/app.asar": asar({ "main.mjs": Buffer.from("export {}"), "node_modules/node-pty/lib/index.js": Buffer.from("x"), "node_modules/node-pty/build/Release/pty.node": "unpacked" }),
  "usr/share/doc/README": Buffer.from("text"),
};
const APPIMAGE_TREE = {
  "oats-desktop": elf(APP),
  "AppRun": Buffer.from("#!/bin/bash\n"),
  "usr/lib/libnotify.so.4": elf({ glibc: ["GLIBC_2.7"] }),
  "resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node": elf(PTY),
};
const RUNTIME = elf({ glibc: ["GLIBC_2.3.3"] });

function fixture(t, { deb = DEB_TREE, appImage = APPIMAGE_TREE, runtime = RUNTIME } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oats-linux-floor-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = { deb: join(dir, "oats-desktop-1.0.0-linux-amd64.deb"), appImage: join(dir, "oats-desktop-1.0.0-linux-x86_64.AppImage") };
  writeFileSync(paths.deb, "!<arch>\n");
  writeFileSync(paths.appImage, runtime);
  const tmp = join(dir, "tmp");
  mkdirSync(tmp);
  return { paths, tmp, trees: { deb, appImage } };
}

/** The fake reaper: `override(exe, args, opts)` may answer first. */
function fakeReaper(fx, override = () => undefined) {
  const calls = [];
  return {
    calls,
    runTracked: async (exe, args, opts) => {
      calls.push({ exe, args, opts });
      const o = override(exe, args, opts);
      if (o) return { stdout: "", stderr: "", code: 0, timedOut: false, ...o };
      if (args[0] === "--version") return { stdout: `${exe} 1.0`, code: 0 };
      if (exe === "ar") { writeFileSync(join(opts.cwd, "debian-binary"), "2.0\n"); writeFileSync(join(opts.cwd, "data.tar.xz"), "x"); return { stdout: "", code: 0 }; }
      if (exe === "tar") { layout(args[3], fx.trees.deb); return { stdout: "", code: 0 }; }
      if (exe === fx.paths.appImage && args[0] === "--appimage-extract") { layout(join(opts.cwd, "squashfs-root"), fx.trees.appImage); return { stdout: "", code: 0 }; }
      if (exe === "readelf") {
        const buf = readFileSync(args[2]);
        assert.ok(isElfHeader(buf), `readelf is only asked about ELF files (${args[2]})`);
        return { stdout: toText(JSON.parse(buf.subarray(4).toString())), code: 0 };
      }
      throw new Error(`unexpected run: ${exe} ${args.join(" ")}`);
    },
  };
}

test("a package within the floor passes, and every ELF it carries is read", async (t) => {
  const fx = fixture(t);
  const reaper = fakeReaper(fx);
  const r = await checkLinuxFloor(reaper, fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, true, r.detail);
  assert.match(r.detail, /within the stated floor \(glibc 2\.34, glibcxx 3\.4\.22, cxxabi 1\.3\.9, scripts\/linux-floor\.json\)/);
  assert.match(r.lines[0], /^oats-desktop-1\.0\.0-linux-amd64\.deb: 3 ELF files read; highest needs GLIBC_2\.34 \(opt\/OATS Desktop\/resources\/app\.asar\.unpacked\/node_modules\/node-pty\/build\/Release\/pty\.node\), GLIBCXX_3\.4\.22 /);
  assert.match(r.lines[1], /^oats-desktop-1\.0\.0-linux-x86_64\.AppImage: 4 ELF files read;/, "the runtime, the app's two and the library the AppImage adds");
  const read = reaper.calls.filter((c) => c.exe === "readelf" && c.args[0] === "-V").map((c) => c.args);
  assert.ok(read.every((a) => a[1] === "-W"), "readelf -V -W");
  assert.equal(read.length, 7, "3 in the DEB, the AppImage file itself, 3 in its contents; the Mach-O, the text and the script are not read");
  assert.ok(read.some((a) => a[2] === fx.paths.appImage), "the AppImage runtime is read from the file itself");
  for (const c of reaper.calls) assert.equal(c.opts.env.LC_ALL, "C", "readelf's text is read in the C locale");
  assert.deepEqual(reaper.calls.slice(0, 3).map((c) => [c.exe, c.args]), TOOLS.map((tool) => [tool, ["--version"]]), "the tools are asked for first");
});

test("a need above the floor fails, naming the artifact, the file and the version", async (t) => {
  const fx = fixture(t, { appImage: { ...APPIMAGE_TREE, "usr/lib/libnotify.so.4": elf({ glibc: ["GLIBC_2.38"] }) } });
  const r = await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /oats-desktop-1\.0\.0-linux-x86_64\.AppImage:usr\/lib\/libnotify\.so\.4 needs GLIBC_2\.38, newer than the floor glibc 2\.34 \(scripts\/linux-floor\.json\)/);
  assert.doesNotMatch(r.detail, /\.deb:/, "the DEB is within it");
});

test("the AppImage runtime above the floor fails", async (t) => {
  const fx = fixture(t, { runtime: elf({ glibc: ["GLIBC_2.39"] }) });
  const r = await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /AppImage:<runtime> needs GLIBC_2\.39/);
});

test("an ELF entry packed inside app.asar is read, and fails above the floor", async (t) => {
  const tree = { ...DEB_TREE, "opt/OATS Desktop/resources/app.asar": asar({ "main.mjs": Buffer.from("x"), "native/addon.node": elf({ glibc: ["GLIBC_2.36"] }) }) };
  const fx = fixture(t, { deb: tree });
  const r = await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /\.deb:opt\/OATS Desktop\/resources\/app\.asar\/native\/addon\.node needs GLIBC_2\.36/);
});

test("asarElfEntries skips unpacked entries, links and non-ELF files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oats-linux-floor-asar-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "app.asar");
  writeFileSync(path, asar({ "a.js": Buffer.from("console.log(1)"), "b/c.node": elf(APP), "d.node": "unpacked", "e": Buffer.from("\x7fE", "latin1") }));
  assert.deepEqual(asarElfEntries(path).map((e) => e.name), ["b/c.node"]);
  writeFileSync(path, Buffer.from([4, 0, 0, 0, 9]));
  assert.throws(() => asarElfEntries(path), /truncated asar header/);
});

test("an unreadable app.asar fails", async (t) => {
  const fx = fixture(t, { deb: { ...DEB_TREE, "opt/OATS Desktop/resources/app.asar": Buffer.from("garbage") } });
  const r = await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /app\.asar cannot be read as an asar/);
});

for (const tool of TOOLS) {
  test(`${tool} missing on the runner fails loudly, before anything is unpacked`, async (t) => {
    const fx = fixture(t);
    // runTracked resolves a spawn error (ENOENT) as code -1.
    const reaper = fakeReaper(fx, (exe, args) => (exe === tool && args[0] === "--version" ? { code: -1 } : undefined));
    const r = await checkLinuxFloor(reaper, fx.paths, { floor: FLOOR, tmp: fx.tmp });
    assert.equal(r.ok, false);
    assert.match(r.detail, new RegExp(`^required tool missing or broken: ${tool} `));
    assert.ok(!reaper.calls.some((c) => c.args[0] === "x" || c.args[0] === "--appimage-extract"), "nothing unpacked");
  });
}

test("a failed or empty extraction fails, never passes on what was not read", async (t) => {
  let fx = fixture(t);
  let r = await checkLinuxFloor(fakeReaper(fx, (exe, args) => (args[0] === "--appimage-extract" ? { code: 1, stderr: "cannot extract" } : undefined)), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /AppImage: .*--appimage-extract failed \(exit 1\): cannot extract/);

  fx = fixture(t);
  r = await checkLinuxFloor(fakeReaper(fx, (exe, args) => (exe === "tar" && args[0] === "-xf" ? { code: 2, stderr: "xz: corrupt" } : undefined)), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /\.deb: tar -xf .* failed \(exit 2\): xz: corrupt/);

  fx = fixture(t);
  r = await checkLinuxFloor(fakeReaper(fx, (exe, args) => (exe === "ar" && args[0] === "x" ? { code: 0 } : undefined)), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /\.deb: no data\.tar\.\* member/);

  fx = fixture(t, { appImage: { "AppRun": Buffer.from("#!/bin/sh") } });
  r = await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /AppImage: no ELF named oats-desktop in what was unpacked \(0 ELF files\)/);
});

test("a read that times out or fails, fails the phase", async (t) => {
  let fx = fixture(t);
  let r = await checkLinuxFloor(fakeReaper(fx, (exe, args) => (exe === "readelf" && String(args[2]).endsWith("pty.node") ? { timedOut: true, code: null } : undefined)), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /pty\.node: readelf -V -W .* timed out/);

  fx = fixture(t);
  r = await checkLinuxFloor(fakeReaper(fx, (exe, args) => (exe === "readelf" && args[0] === "-V" ? { code: 1, stderr: "readelf: Error: not an ELF file" } : undefined)), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  assert.equal(r.ok, false);
  assert.match(r.detail, /readelf -V -W .* failed \(exit 1\)/);
});

test("the phase's budget bounds every run; a spent budget fails", async (t) => {
  const fx = fixture(t);
  let clock = 0;
  const reaper = fakeReaper(fx, (exe, args, opts) => {
    assert.ok(opts.timeout > 0 && opts.timeout <= 1000, "each run gets what is left of the budget");
    if (exe === "ar") clock += 2000;                  // the DEB takes the whole budget
    return undefined;
  });
  const r = await checkLinuxFloor(reaper, fx.paths, { floor: FLOOR, tmp: fx.tmp, timeout: 1000, now: () => clock });
  assert.equal(r.ok, false);
  assert.match(r.detail, /budget is spent/);
});

test("refusals: no reaper, a missing artifact, an unreadable floor", async (t) => {
  const fx = fixture(t);
  assert.match((await checkLinuxFloor({}, fx.paths, { floor: FLOOR })).detail, /requires a reaper with runTracked/);
  assert.match((await checkLinuxFloor(fakeReaper(fx), { deb: fx.paths.deb }, { floor: FLOOR, tmp: fx.tmp })).detail, /no appImage to read/);
  assert.match((await checkLinuxFloor(fakeReaper(fx), { ...fx.paths, deb: join(fx.tmp, "none.deb") }, { floor: FLOOR, tmp: fx.tmp })).detail, /no deb to read/);
});

test("the phase leaves nothing behind in its temporary directory", async (t) => {
  const fx = fixture(t);
  await checkLinuxFloor(fakeReaper(fx), fx.paths, { floor: FLOOR, tmp: fx.tmp });
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(fx.tmp), []);
});

// ---- the wiring ----------------------------------------------------------------

test("dist-smoke runs the floor on linux, guarded by the platform only, before the launch skip", () => {
  const src = readFileSync(new URL("../scripts/dist-smoke.mjs", import.meta.url), "utf8");
  const m = src.match(/if \(([^)]*)\) \{\n\s*const r = await checkLinuxFloor\(reaper, \{ deb: artifacts\.deb, appImage: artifacts\.AppImage \}/);
  assert.ok(m, "the phase reads both Linux artifacts the inventory found, through the reaper");
  assert.equal(m[1], `process.platform === "linux"`, "guarded by the platform ONLY: no OATS_SMOKE_* flag skips it");
  assert.match(src, /checkLinuxFloor\([^\n]*timeout: PHASE_BUDGET_MS\.linuxFloor/);
  const phase = src.indexOf("await checkLinuxFloor(reaper"), skip = src.indexOf("process.env.OATS_SMOKE_SKIP_LAUNCH");
  assert.ok(phase > 0 && skip > phase, "the phase precedes the launch-skip logic");
  assert.ok(PHASE_BUDGET_MS.linuxFloor > 0, "the phase has a budget the watchdog counts");
});

test("linux-floor has no synchronous child execution", () => {
  const src = readFileSync(new URL("../scripts/linux-floor.mjs", import.meta.url), "utf8");
  assert.ok(!/execFileSync|execSync|spawnSync|child_process/.test(src), "children only through the reaper");
  assert.match(src, /runTracked/);
});
