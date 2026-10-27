// Whether this computer runs Omarchy (the product owner, 2026-10-26: Omarchy's font, and a 13px terminal, are the
// defaults on Omarchy only): main's one read-only check (host-theme.mjs omarchyHost, on the "This computer" theme's
// own marker), the window argument main adds, and the constant preload exposes. Shipped main.mjs and preload.cjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { omarchyHost, omarchyCurrentDir, OMARCHY_ARG } from "../host-theme.mjs";

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** An fs whose statSync answers `answer(path)` and records each path asked. */
function fakeFs(answer) {
  const asked = [];
  return { asked, fs: { statSync: path => { asked.push(path); return answer(path); } } };
}
const dir = { isDirectory: () => true }, file = { isDirectory: () => false };

test("omarchyHost: on Linux, true only when Omarchy's current/ is a directory, the host theme's marker", () => {
  const yes = fakeFs(() => dir);
  assert.equal(omarchyHost({ fs: yes.fs, home: "/home/someone", platform: "linux" }), true);
  assert.deepEqual(yes.asked, [omarchyCurrentDir("/home/someone")], "one stat, of the one marker");
  assert.equal(omarchyHost({ fs: fakeFs(() => file).fs, home: "/h", platform: "linux" }), false, "a file is not Omarchy");
  assert.equal(omarchyHost({ fs: fakeFs(() => ({ isDirectory: () => "yes" })).fs, home: "/h", platform: "linux" }), false, "only true counts");
});

test("omarchyHost: any stat error is false (missing, denied, a loop), and so is a missing fs or home", () => {
  for (const code of ["ENOENT", "EACCES", "ELOOP", "ENOTDIR"]) {
    const thrown = fakeFs(() => { throw Object.assign(new Error(code), { code }); });
    assert.equal(omarchyHost({ fs: thrown.fs, home: "/h", platform: "linux" }), false, code);
  }
  assert.equal(omarchyHost({ fs: {}, home: "/h", platform: "linux" }), false, "no statSync");
  assert.equal(omarchyHost({ fs: fakeFs(() => dir).fs, home: undefined, platform: "linux" }), false, "no home");
});

test("omarchyHost: off Linux it is false without looking", () => {
  for (const platform of ["darwin", "win32", "freebsd", undefined]) {
    const probe = fakeFs(() => dir);
    assert.equal(omarchyHost({ fs: probe.fs, home: "/h", platform }), false, String(platform));
    assert.deepEqual(probe.asked, [], `nothing read on ${platform}`);
  }
});

test("main: one marker (the host theme's helper, no copy of its path), read once at start, passed to each window as an argument", () => {
  const main = read("main.mjs");
  assert.match(main, /import \{[^}]*\bomarchyHost\b[^}]*\bOMARCHY_ARG\b[^}]*\} from "\.\/host-theme\.mjs";/);
  assert.doesNotMatch(main, /omarchy[/"', ]+current|\.local[/"', ]+state/, "no second copy of the marker's path");
  assert.match(main, /const omarchyArguments = Object\.freeze\(omarchyHost\(\{ fs: \{ statSync \}, home: homedir\(\), platform: process\.platform \}\) \? \[OMARCHY_ARG\] : \[\]\);/);
  // Read at start, beside the host theme's source: outside the window and startup code the main harnesses run.
  assert.ok(main.indexOf("const omarchyArguments =") > main.indexOf("installHostThemeHandlers({ ipc: ipcMain, guard, source: hostTheme });"));
  assert.ok(main.indexOf("const omarchyArguments =") < main.indexOf("// ---- windows: one per workspace (#481)"));
  const window = main.slice(main.indexOf("function createWindow("));
  assert.match(window.slice(0, window.indexOf("});")), /webPreferences: \{[^}]*additionalArguments: \[\.\.\.omarchyArguments\],[^}]*\}/);
  assert.doesNotMatch(main, /ipcMain\.(handle|on)\([^)]*omarchy/i, "no IPC channel carries it");
});

/** The shipped preload over a fake electron, with `argv` as its process's. */
function preload(argv) {
  const require = createRequire(import.meta.url);
  let api = null;
  const sent = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { invoke: (...args) => { sent.push(args); return Promise.resolve(null); }, send: (...args) => sent.push(args), on() {}, removeListener() {} },
    webUtils: {},
  };
  runInNewContext(read("preload.cjs"), { process: { argv },
    require: name => (name === "electron" ? electron : require(name === "./terminal-bridge.cjs" ? "../terminal-bridge.cjs" : name)) });
  return { api, sent };
}

test("preload: isOmarchy is a constant boolean read from main's argument; nothing is sent for it", () => {
  assert.match(read("preload.cjs"), new RegExp(`process\\.argv\\.includes\\("${OMARCHY_ARG}"\\)`), "spelled as host-theme.mjs's OMARCHY_ARG");
  const on = preload(["electron", "--type=renderer", OMARCHY_ARG]), off = preload(["electron", "--type=renderer"]);
  assert.equal(on.api.isOmarchy, true); assert.equal(off.api.isOmarchy, false);
  assert.equal(preload(["electron", `${OMARCHY_ARG}=1`, "--oats-host-omarchy-not"]).api.isOmarchy, false, "the exact flag only");
  const property = Object.getOwnPropertyDescriptor(on.api, "isOmarchy");
  assert.equal(typeof property.value, "boolean", "a value, not a function or a getter"); assert.equal(property.get, undefined);
  assert.deepEqual(on.sent, [], "reading it sends nothing");
});
