// Fixed detached supervisor entry. The short-lived hook launcher owns no lock
// or worker; this process retains both until the ordinary pass transport ends.
import { captureCommandOptions, runCaptureCommand } from "./capture-command.mjs";

try {
  if (process.argv.length !== 3) throw new Error("invalid capture hook request");
  const request = JSON.parse(process.argv[2]);
  if (!request || Object.keys(request).some(key => !["root", "options"].includes(key))) throw new Error("invalid capture hook request");
  const options = captureCommandOptions(request.options);
  if (options.trigger !== "hook" || options.retrySetAside) throw new Error("invalid capture hook intent");
  const result = await runCaptureCommand(request.root, options);
  process.exitCode = result.exitCode;
} catch {
  // stdout/stderr are deliberately detached from the harness. Only admitted
  // workers write status; startup failure must not invent a receipt here.
  process.exitCode = 1;
}
