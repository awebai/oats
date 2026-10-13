// Recovery proof for positional transcript journals. The temporary lookup is
// disk-backed: comparing a long prefix retains one native record at a time.
import { digest } from "./session-snapshot.mjs";

export function compareTranscriptPrefix(store, stream, state, lines) {
  const db = state.db;
  db.exec("DROP TABLE IF EXISTS temp.transcript_prefix; CREATE TEMP TABLE transcript_prefix (line INTEGER PRIMARY KEY, hash TEXT NOT NULL)");
  const put = db.prepare("INSERT OR IGNORE INTO transcript_prefix VALUES (?, ?)");
  const get = db.prepare("SELECT hash FROM transcript_prefix WHERE line = ?");
  let lastLine = 0, lastTs = "", batch = [];
  const flush = () => state.transaction(() => {
    for (const turn of batch) {
      const line = turn.provenance?.origin?.line;
      if (!Number.isSafeInteger(line) || line < 1 || typeof turn.body?.line !== "string") throw new Error(`invalid positional transcript journal: ${stream}`);
      const hash = digest(Buffer.from(turn.body.line));
      const old = get.get(line);
      if (old && old.hash !== hash) throw new Error(`conflicting positional transcript journal: ${stream}, line ${line}`);
      put.run(line, hash);
      if (line >= lastLine) { lastLine = line; lastTs = turn.ts; }
    }
    batch = [];
  });
  let bytes = 0;
  for (const turn of store.iterateStream(stream)) {
    if (turn.kind !== "session") continue;
    batch.push(turn); bytes += Buffer.byteLength(turn.body?.line ?? "");
    if (batch.length >= 2000 || bytes >= 8 * 1024 * 1024) { flush(); bytes = 0; }
  }
  flush();
  let line = 0, offset = 0;
  if (lastLine) for (const record of lines) {
    line++;
    const expected = get.get(line);
    if (expected && expected.hash !== digest(Buffer.from(record.text))) return { conflict: { line, offset, reason: "captured-prefix-changed" } };
    offset += record.bytes;
    if (line === lastLine) break;
  }
  if (line < lastLine) return { conflict: { line: line + 1, offset, reason: "captured-prefix-missing" } };
  return { bytes: offset, line, lastTs };
}
