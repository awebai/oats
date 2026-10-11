// Inert DTOs from the writer contract; no harness, CLI or tmux process runs.
export function launchPrompts(status = 'blocked') {
  return { status, answers: status === 'blocked' ? [{ class: 'awebDevelopmentChannel', signatureId: 'claude-fixture', status: 'submitted' }] : [],
    reason: status === 'blocked' ? 'blocked: unexpected prompt' : 'launch prompt audit failed after possible input',
    receipt: [{ ok: true, row: { data: { private: 'PRIVATE RAW EVENT' } }, results: [
      { path: '/example/events.jsonl', ok: true }, { path: '/example/home-events.jsonl', ok: false, reason: 'PRIVATE OS ERROR' }] }] };
}
export function retained(d, status = 'blocked') {
  return { instance: d.instance, home: d.home, launched: 'unknown', retained: true, unconfirmed: true,
    parentLineageCommitted: true, target: { socket: '/tmp/fixture.sock', session: 'agents', window: d.instance, windowId: '@2', paneId: '%2', pid: 1234 },
    launchPrompts: launchPrompts(status) };
}

// OATS 0.52.0 (awebai/oats#917). Hand-written from the documented shapes at kernel head 881ecc1f:
// lib/launch-prompt-fixtures.mjs `devChannelDifference` (a tolerance entry's id, and at most 40 UTF-16
// units of each normalized text from the first differing position), docs/desktop-cli-api.md "Launch
// prompt results". Here the screen was a folder-trust prompt, so the texts differ from the start.
export const EXPECTED = 'WARNING: Loading development channels --', FOUND = 'Do you trust the files in this folder?';
export const differed = (firstDifference = {}, nearest = 'aweb-dev-channel-confirmation-1') => ({ nearest,
  firstDifference: { index: 0, expected: EXPECTED, found: FOUND, ...firstDifference } });
/** What the outcome reader answers for `differed()`. */
export const DIFFERED = Object.freeze({ nearest: 'aweb-dev-channel-confirmation-1', index: 0, expected: EXPECTED, found: FOUND });

// Hand-written from the kernel at head 7dc5a20c of awebai/oats#917 (lib/launch-prompts.mjs, the end of
// `observe`; lib/core.mjs `retainedPromptError`): the Enter was sent and the screen then showed no clean
// session within the bound. Blocked, the Enter in `answers`; kernels 0.44 to 0.51 answer the same reason.
export const observationTimeout = (extra = {}) => ({ status: 'blocked', reason: 'blocked: observation timeout',
  answers: [{ class: 'awebDevelopmentChannel', signatureId: 'aweb-dev-channel-confirmation-1', status: 'submitted' }], receipt: [], ...extra });
export const observationTimeoutMessage = home => `blocked: observation timeout; home and pane retained: inspect ${home}, then use oats session start --home '${home}'. OATS sent one Enter to Claude's development-channel confirmation, and the screen then never settled into a session within the 30 s bound; no other key is sent: look at the pane, and if Claude's session is running, it started.`;
