// Fixed, finite installed-service supervisor entry. It neither schedules the
// next pass nor installs/inspects a manager; the root lock owns child lifetime.
import { captureServiceRequest } from "./capture-service-definition.mjs";
import { captureCommandPass } from "./capture-command-output.mjs";
import { IgnoreError, loadIgnore } from "./ignore.mjs";

try {
  if (process.argv.length !== 3) throw new Error("invalid private capture service arguments");
  const request = captureServiceRequest(JSON.parse(process.argv[2]));
  // Match foreground setup/manual privacy ordering. No source discovery runs
  // here: the registered worker resolves the explicit plan after admission.
  loadIgnore(request.root);
  await captureCommandPass(request.root, { owner: request.owner, plan: request.plan,
    trigger: "service", indexEnabled: true, retrySetAside: false }, { entry: "service-runner" });
} catch (error) {
  console.error(error instanceof IgnoreError ? error.message : `capture service failed: ${error.message}`);
  process.exitCode = 1;
}
