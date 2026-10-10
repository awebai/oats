// The one reader of a Markdown table in a docs page, for the tests that hold a docs table to the
// kernel's own data (the pair table, the codes answered only before any effect, details.holder).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** The one Markdown table between `<a id="<anchor>"></a>` and the next anchor of the page `doc`
 *  (a path) → { header: [cell], body: [[cell]] }, every cell trimmed. Fails when the anchor is
 *  missing or there twice, when its section has no table or more than one, and when a row has not
 *  the header's number of cells (a `|` inside a cell would split it). */
export function tableAfter(doc, anchor) {
  const text = readFileSync(doc, "utf8"), page = `docs/${basename(doc)}`;
  const marker = `<a id="${anchor}"></a>`;
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, `${page} has the anchor ${marker}`);
  assert.equal(text.indexOf(marker, at + 1), -1, `${page} has the anchor ${marker} once`);
  const rest = text.slice(at + marker.length);
  const next = rest.indexOf('<a id="');
  const lines = (next === -1 ? rest : rest.slice(0, next)).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  assert.notEqual(start, -1, `the section of ${marker} has a table`);
  let end = start;
  while (end < lines.length && lines[end].startsWith("|")) end++;
  assert.equal(lines.slice(end).some((line) => line.startsWith("|")), false, `the section of ${marker} has one table, not several: this reads the first`);
  const cells = (line) => {
    assert.ok(line.trimEnd().endsWith("|"), `a table row of ${marker} ends with |: ${line}`);
    return line.trimEnd().slice(1, -1).split("|").map((cell) => cell.trim());
  };
  const [header, rule, ...body] = lines.slice(start, end).map(cells);
  assert.ok(rule && rule.every((cell) => /^:?-+:?$/.test(cell)), `the second line of the table of ${marker} is its rule`);
  assert.ok(body.length > 0, `the table of ${marker} has rows`);
  for (const row of body) assert.equal(row.length, header.length, `a row of the table of ${marker} has ${header.length} cells: ${row.join(" | ")}`);
  return { header, body };
}
