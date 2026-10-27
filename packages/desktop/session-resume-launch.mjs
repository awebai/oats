/* oats desktop — resume lost sessions (main).

   The shared trigger (packages/client/session-resume-trigger.mjs) decides when the kernel's machine sweep
   `oats session resume --json` runs; the Desktop owns no session: the kernel resumes them. This module is
   that trigger's wiring in main, with main's IO injected: the reading's routing. main.mjs only builds it, arms
   it with `launch()` after the startup's deployments-list step settles (its first run imports the Desktop's
   saved deployments into the machine registry the sweep reads), and hands it each accepted /api/panel reply's
   instance rows with `observed()`.

   - A sweep's child is the runner's default exec's (file-output-exec.mjs: detached, output in files):
     nothing here holds it, so quitting Desktop never cancels it. Never add the trigger to shutdown(), the
     terminal broker or the server's lifetime; `dispose()` is for tests and the TUI.
   - The Desktop shows nothing of a sweep (the product owner, 2026-10-27): a `notice` reading is dropped like
     `quiet`, `busy` and `unsupported`. `failed` logs one line with its code only: no kernel text is logged. */

const CODE = /^E_[A-Z0-9_]{1,64}$/;

/**
 * The trigger, built with main's reading routing; returns what `createTrigger` made.
 * @param {object} io
 * @param {(options: object) => object} io.createTrigger  createResumeTrigger (its run and read are its defaults)
 * @param {() => object|null|Promise<object|null>} io.cli  the settled CLI probe, or null
 * @param {(line: string) => void} io.error                a failed sweep
 */
export function createResumeWiring({ createTrigger, cli, error }) {
  return createTrigger({
    cli,
    onReading(reading) {
      if (reading?.kind === "failed") error(`oats-desktop: the session resume sweep failed: ${typeof reading.code === "string" && CODE.test(reading.code) ? reading.code : "E_CLI_PROTOCOL"}`);
    },
  });
}
