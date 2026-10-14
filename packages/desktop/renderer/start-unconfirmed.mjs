/** What the Desktop says of a start whose wait ended (packages/client/cli-adapter.mjs cliStart answers the code
 * `E_START_UNCONFIRMED`, with no words): the Desktop's own sentence, so it is shown under no speaker, never as
 * the kernel's. Nothing is known of the start; the next step names the Desktop's roster. The route answers it
 * (server/oats-web.mjs, the start route) and the Start dialog shows it as its status. */
export const START_UNCONFIRMED = Object.freeze({ code: 'E_START_UNCONFIRMED',
  message: "OATS didn't confirm the start. It may still be running: check the roster before you start it again." });
