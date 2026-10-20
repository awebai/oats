/** The suggested name's rules on the Desktop's side (feature spawn-suggest-name, awebai/oats#1421 §3 "The Desktop's use
 * of it"). The kernel chooses the name (`spawn --preview --suggest-name`); these say when the dialog asks, how it
 * remembers an answer, and how it says a numbered one. */
import { HARNESS_NAMES } from './harness-names.mjs';

/** How long the task text must rest before the dialog asks (about 1.5 s): never on each keystroke. */
export const SUGGEST_PAUSE_MS = 1500;
/** The words a task needs before the dialog asks while it is typed. Spawn asks whatever the length. */
export const SUGGEST_MIN_WORDS = 3;

/** The words of `text`: whitespace-separated runs that hold a letter or a digit. */
export const taskWords = text => (String(text ?? '').match(/\S+/g) || []).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

/** What an answer is remembered by: the exact task text and the soul (its root and name). */
export const namingKey = (selector, text) => JSON.stringify([selector?.agentsRoot ?? null, selector?.soul ?? null, String(text ?? '')]);

const harnessName = harness => HARNESS_NAMES[harness] ?? (typeof harness === 'string' && harness ? harness : 'the harness');
/** Why a spawn was numbered, in the Desktop's words. The kernel's `message` is never shown: it can carry an exit
 * code or a signal. */
export function numberedWords(reason, harness) {
  switch (reason) {
    case 'no-task': return 'there is no task to name it from';
    case 'unsupported-harness': return `${harnessName(harness)} doesn't suggest names`;
    case 'timeout': return 'naming took longer than 20 seconds';
    case 'harness-failed': return `${harnessName(harness)} couldn't be asked for a name`;
    case 'invalid-reply': return `${harnessName(harness)} gave no usable name`;
    default: return 'it could not be named from its task';
  }
}
/** "Named <instance>: <why>." for a spawn that was numbered. */
export const numberedLine = (instance, reason, harness) => `Named ${instance}: ${numberedWords(reason, harness)}.`;
