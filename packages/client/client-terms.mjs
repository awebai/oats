/** A client's own terms: the words a shared sentence uses where it names the client that shows it.
 * The tables of this home hold one explanation per code for every client, and some of those sentences
 * name the client ("this Desktop"), what to update when the client is the old one, or the machine it
 * runs on. A table takes the terms as an argument and builds the sentence from them, so two clients
 * show the same explanation, each in its own words.
 *
 *   clientTerms({ name, self, selfInitial, update, thisMachine }) -> the same five, frozen
 *
 *   name         the client, as a sentence names it                  "… than Desktop can show."
 *   self         where a sentence says "this client"                 "… a workspace this Desktop can't read."
 *   selfInitial  the same, opening a sentence                        "This Desktop can't read …"
 *   update       what to update when the client is the old one       "Update OATS Desktop."
 *   thisMachine  the label of the machine the client runs on; a label, and it opens sentences, so the
 *                client capitalises it                               "This Mac"
 *
 * Nothing has a default, here or in a table: a client says its five terms once and passes them at every
 * call. This home holds none of its own and imports no client's.
 *
 * No state: no list of the objects made is kept. A table knows terms by what the object itself carries, a
 * private field of a class this module does not export; a copy, a spread or a hand-built object has none.
 * Only `clientTerms` can make one: the class is reachable from nowhere else (its prototype names no
 * constructor), and what it stores is what was checked, each value read from the caller once. */
import { cleanLine } from './display-text.mjs';

const KEYS = Object.freeze(['name', 'self', 'selfInitial', 'update', 'thisMachine']);

class ClientTerms {
  #made = true;
  /** `checked`: the five values `clientTerms` read and checked. Never the caller's own object. */
  constructor(checked) { for (const key of KEYS) this[key] = checked[key]; Object.freeze(this); }
  static made(value) { return typeof value === 'object' && value !== null && #made in value; }
}
// Without this, `terms.constructor` would hand the class to anyone holding terms, and `new` on it would
// give an object that carries the field and none of the checks.
delete ClientTerms.prototype.constructor;
Object.freeze(ClientTerms.prototype); Object.freeze(ClientTerms);

/** The terms of one client. Throws a TypeError that names the key when one is missing, empty, not a
 * string or not one display line (display-text.mjs `cleanLine`), and when a key is not one of the five. */
export function clientTerms(values) {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new TypeError('clientTerms: pass an object with name, self, selfInitial, update and thisMachine');
  for (const key of Reflect.ownKeys(values)) if (!KEYS.includes(key)) throw new TypeError(`clientTerms: ${String(key)} is not a term (the terms are ${KEYS.join(', ')})`);
  // Each value is read once, and that reading is what is checked and kept: a getter that answers
  // differently the second time has no second time.
  const checked = {};
  for (const key of KEYS) {
    if (!Object.hasOwn(values, key)) throw new TypeError(`clientTerms: ${key} is missing`);
    const value = values[key];
    if (!cleanLine(value)) throw new TypeError(`clientTerms: ${key} must be a string of one display line, and not empty`);
    checked[key] = value;
  }
  return new ClientTerms(checked);
}

/** What a table calls first: the terms as given, or a TypeError when they are absent or are not an
 * object `clientTerms` returned. `table` names the function that was called without them. */
export function requireTerms(terms, table) {
  if (!ClientTerms.made(terms)) throw new TypeError(`${table}: terms must be the object clientTerms() returned`);
  return terms;
}
