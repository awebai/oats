// Shared atomic-reset mutations. Caller owns BEGIN/COMMIT/ROLLBACK so a private
// command receipt can join the reset without changing public reset semantics.
// Bump on derived schema shape changes. RecordIndex rebuilds a mismatched
// cache from journals instead of migrating it in place.
export const INDEX_SCHEMA_VERSION = 1;
export const TEXT_SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);`;

export function resetIndexTables(db) {
  db.exec("DELETE FROM turns");
  // Ordinary tables use truncate; FTS recreation avoids visiting every text
  // row. Readers still see either the previous union or the committed empty one.
  db.exec("DROP TABLE turn_text");
  db.exec(TEXT_SCHEMA);
  for (const table of ["tombstones", "tags", "outfits", "segments", "spawns", "index_state", "index_bytes"])
    db.exec(`DELETE FROM ${table}`);
  db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
}
