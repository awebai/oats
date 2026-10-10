// A Desktop process that runs as Node (the backend, the liveness collector) is started with the
// environment its parent was started with, so the packaged executable starts exactly as before,
// and then drops what the Desktop and its packaging added: everything it starts inherits the
// user's environment, with no change at the places that start a program.
//
// This must happen before anything else is loaded, because modules take their environment when
// they are loaded. So it is not a statement in a body: it is the FIRST import of the program's
// entry module (server/oats-web.mjs, server/liveness-main.mjs). A module's imports are evaluated
// in source order, each one completely before the next. This module and the leaf it imports must
// have no other imports, so that nothing can load ahead of the step. A library must never import
// this: it changes the environment of whoever does.
import { cliEnvironment } from "./cli-environment.mjs";

/** The environment this process was started with. Its one use: the backend starts the collector with it. */
export const launchEnvironment = Object.freeze({ ...process.env });

// In place: process.env is never reassigned.
const user = cliEnvironment(launchEnvironment);
for (const name of Object.keys(launchEnvironment)) {
  if (!Object.hasOwn(user, name)) delete process.env[name];
  else if (user[name] !== launchEnvironment[name]) process.env[name] = user[name];
}
