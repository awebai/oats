// The help view: the action table as rows of safe text. Pure: no IO, no clock, no escape byte.
// It is generated from the table the reducer acts on, so it names every key that does something
// and no key that does not.
import { keyLabel } from "../actions.mjs";
import { lit } from "../term/text.mjs";
import { style } from "../term/style.mjs";

const TITLE = style({ bold: true });
const KEYS = style({ bold: true });
const HINT = style({ dim: true });
const INDENT = 2;
const GAP = 3;

/** The keys of an action as a person reads them: `q, Ctrl+C`. */
export const keysLabel = (action) => action.keys.map(keyLabel).join(", ");

/** `size.rows` rows for an area `size.cols` wide: a title, one row per action (its keys, then
 *  what it does), and how to close. */
export function help(actions, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  const column = INDENT + Math.max(...actions.map((action) => keysLabel(action).length)) + GAP;
  const put = (r, ...spans) => { if (r < size.rows) rows[r] = spans; };
  put(1, { col: INDENT, text: lit("Keys"), style: TITLE });
  actions.forEach((action, i) => put(3 + i, { col: INDENT, text: lit(keysLabel(action)), style: KEYS }, { col: column, text: lit(action.label) }));
  const closing = ["close", "help"].map((id) => actions.find((action) => action.id === id)).filter(Boolean).map((action) => keyLabel(action.keys[0]));
  if (closing.length) put(4 + actions.length, { col: INDENT, text: lit(`${closing.join(" or ")} closes this help`), style: HINT });
  return rows;
}
