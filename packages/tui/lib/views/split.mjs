// The split of the panel (docs/tui.md, "Splits"): two groups side by side ("right") or one above
// the other ("down"), always even, with a rule between them. Pure geometry, shared by the store
// (which refuses a split the panel cannot hold) and the frame (which draws one group alone while
// the panel is too small for both).

/** The least a group takes: 40 columns side by side, 8 rows (its strip counted) one above the other. */
export const SPLIT_MIN = Object.freeze({ cols: 40, rows: 8 });

/** Whether a panel of `room` (`{ cols, rows }`, its strip row counted in `rows`) holds two groups
 *  split `dir`. A room not known is taken as holding them. */
export function splitFits(dir, room) {
  if (!room || !Number.isInteger(room.cols) || !Number.isInteger(room.rows)) return true;
  return dir === "right" ? Math.floor((room.cols - 1) / 2) >= SPLIT_MIN.cols : Math.floor((room.rows - 1) / 2) >= SPLIT_MIN.rows;
}

/** The two groups' places in a panel `area` (`{ title, col, cols, rows }`: its strip row, its first
 *  column, its width and the rows under the strip), split `dir`: `[first, second, rule]`. The first
 *  (left or top) takes the extra cell or row; each group is `{ title, top, col, cols, rows }` as
 *  the area is, and `rule` the column (`{ col }`) or the row (`{ row }`) between them. */
export function splitRegions(area, dir) {
  if (dir === "right") {
    const left = Math.ceil((area.cols - 1) / 2), right = area.cols - 1 - left;
    const at = (col, cols) => ({ title: area.title, top: area.title + 1, col, cols, rows: area.rows });
    return [at(area.col, left), at(area.col + left + 1, right), { col: area.col + left }];
  }
  const total = area.rows + 1, upper = Math.ceil((total - 1) / 2), lower = total - 1 - upper;
  const at = (title, height) => ({ title, top: title + 1, col: area.col, cols: area.cols, rows: height - 1 });
  return [at(area.title, upper), at(area.title + upper + 1, lower), { row: area.title + upper }];
}
