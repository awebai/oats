/** An instance's colour on its state dot (feature instance-color, awebai/oats#1421 §2): the roster row's, the
 * terminal tab's, the palette row's and the overview card's. The colour is the row's by the one rule
 * (packages/client instance-presentation.mjs `instanceColor`), and the dot keeps saying the state by its
 * shape: filled while running, a ring while stopped. An unknown state keeps today's warning dot whatever the
 * colour, and a row with no colour keeps today's look. The dot carries the palette name only, as
 * `data-instance-color`; shell.css turns it into `--instance-color` (the soul palette's `--soul-<name>-fg`)
 * and each dot's own rule paints with it (theme-contrast.test.mjs proves it on every surface it sits on). */
import { instanceColor } from '../../client/instance-presentation.mjs';

/** The palette name a dot in `state` ('running' | 'stopped' | 'unknown') shows for `row`, or null. */
export const dotColor = (row, state) => (state === 'running' || state === 'stopped' ? instanceColor(row) : null);

/** Put `row`'s colour on `dot` for `state`, or take it off. */
export function paintDotColor(dot, row, state) {
  if (!dot) return;
  const color = dotColor(row, state);
  if (color) { if (dot.dataset.instanceColor !== color) dot.dataset.instanceColor = color; }
  else if (dot.dataset.instanceColor !== undefined) delete dot.dataset.instanceColor;
}
