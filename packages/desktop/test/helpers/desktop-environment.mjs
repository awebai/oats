// The environment a Desktop process has that the user's own shell would not, for the tests of
// what its children receive (cli-environment.mjs): what main sets for the backend, what Electron
// sets on Linux, what the AppImage runtime and its launcher add, and macOS's launch environment.
// The launcher's four exports are written as app-builder-lib 26.15.3 generates them
// (generateAppRunScript), here for a user who had no XDG_DATA_DIRS, LD_LIBRARY_PATH or
// GSETTINGS_SCHEMA_DIR of their own.
import assert from "node:assert/strict";

export const USER_PATH = "/usr/local/bin:/usr/bin";
/** What the launcher leaves in XDG_DATA_DIRS that is not under its mount (a stated limit). */
export const LAUNCHER_DATA_DIRS = "/usr/share/gnome:/usr/local/share/:/usr/share/";
/** The names removed whole when the source has a usable APPDIR, and the two removed always. */
export const DESKTOP_NAMES = ["ELECTRON_RUN_AS_NODE", "CHROME_DESKTOP", "APPIMAGE", "APPDIR", "ARGV0", "OWD"];

/** A Desktop process's environment on an AppImage mounted at `mount`, over `user` (the user's own names). */
export function desktopEnvironment(mount, user = {}) {
  return {
    KEEP: "the user's own value", ...user,
    ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "oats-desktop.desktop", MallocNanoZone: "0",
    APPIMAGE: "/home/fixture/oats-desktop.AppImage", APPDIR: mount, ARGV0: "./oats-desktop.AppImage", OWD: "/home/fixture",
    PATH: `${mount}:${mount}/usr/sbin:${user.PATH ?? USER_PATH}`,
    LD_LIBRARY_PATH: `${mount}/usr/lib`,
    XDG_DATA_DIRS: `${mount}/usr/share/:${LAUNCHER_DATA_DIRS}`,
    GSETTINGS_SCHEMA_DIR: `${mount}/usr/share/glib-2.0/schemas`,
  };
}

/** The entries of every string value of `env` that are the mount or under it, as "NAME=entry". */
export function mountEntries(env, mount) {
  return Object.entries(env).flatMap(([name, value]) => typeof value !== "string" ? []
    : value.split(":").filter(entry => entry === mount || entry.startsWith(`${mount}/`)).map(entry => `${name}=${entry}`));
}

/** `env` is what a program the Desktop starts must receive when the Desktop had desktopEnvironment(mount, { PATH: path }). */
export function assertUserEnvironment(env, mount, what, { path = USER_PATH } = {}) {
  assert.ok(env !== null && typeof env === "object", `${what}: the child is given an environment of its own`);
  for (const name of [...DESKTOP_NAMES, "MallocNanoZone", "LD_LIBRARY_PATH", "GSETTINGS_SCHEMA_DIR"]) {
    assert.equal(Object.hasOwn(env, name), false, `${what}: ${name} does not reach the child`);
  }
  assert.deepEqual(mountEntries(env, mount), [], `${what}: no entry under the mount`);
  assert.equal(env.PATH, path, `${what}: the user's PATH entries, in order`);
  assert.equal(env.XDG_DATA_DIRS, LAUNCHER_DATA_DIRS, `${what}: the launcher's entries outside the mount stay`);
  assert.equal(env.KEEP, "the user's own value", `${what}: an unrelated name is intact`);
}
