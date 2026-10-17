// Installation evidence for health fixtures. A record root alone is not an
// installation: health reports an installed host only for owned or legacy
// service definitions or capture hooks. A test whose intent needs an installed
// host writes this release's capture hook into its home. Recognition reads the
// command's words, so no path in it has to exist.
import fs from "node:fs";
import { join } from "node:path";

/** Writes `<home>/<dir>/settings.json` holding one current-form capture hook. */
export function writeCurrentHook(home, dir = ".claude") {
  const command = "'/fixture/node' '/fixture/package/bin/capture-hook.mjs' --owner fixture --quiet --root '/fixture/record'";
  fs.mkdirSync(join(home, dir), { recursive: true });
  fs.writeFileSync(join(home, dir, "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }));
}
