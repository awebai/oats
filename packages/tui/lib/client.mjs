// The ONE module of packages/tui/ that imports the shared client home (packages/client/): the rest
// of the TUI names no reader path, so what the TUI takes from the shared readers is this list
// (test/tui-boundary.test.mjs pins it). The filter is the Desktop's own, never a copy.
export { displayLine, DETAIL_WITHHELD } from "../../client/display-text.mjs";
