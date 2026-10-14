-- Exact SCHEMA from published v0.54.0 commit 201fc63e6eb80f7fd332d0253565b2cf44c5227e
-- Source blob f2e076a408b4660bb27cf45f2a0f07d51248adf3; identical to v0.53.0 e3de1f0c01f25d6fde1f11231c5ef67a9c590ca6.

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_name TEXT,
  thread TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  fidelity TEXT NOT NULL,
  stream TEXT NOT NULL,
  events INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  superseded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS turns_thread ON turns(thread);
CREATE INDEX IF NOT EXISTS turns_ts ON turns(ts);
CREATE TABLE IF NOT EXISTS tombstones (
  ref TEXT NOT NULL,
  from_name TEXT NOT NULL,
  PRIMARY KEY (ref, from_name)
);
CREATE TABLE IF NOT EXISTS index_state (
  stream TEXT PRIMARY KEY,
  indexed_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  tag_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  about TEXT NOT NULL,
  acts TEXT NOT NULL,
  case_slug TEXT,
  note TEXT NOT NULL,
  PRIMARY KEY (tag_id)
);
CREATE INDEX IF NOT EXISTS tags_target ON tags(target_ref);
CREATE INDEX IF NOT EXISTS tags_case ON tags(case_slug);
CREATE TABLE IF NOT EXISTS outfits (
  outfit_id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  members TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
  note_id TEXT PRIMARY KEY,
  thread TEXT NOT NULL,
  start_n INTEGER NOT NULL,
  end_n INTEGER,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  about TEXT NOT NULL,
  established TEXT NOT NULL,
  lesson TEXT,
  ts TEXT NOT NULL,
  ts_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS segments_thread ON segments(thread, start_n);
CREATE TABLE IF NOT EXISTS spawns (
  note_id TEXT PRIMARY KEY,
  agent_thread TEXT NOT NULL,
  outfit_id TEXT NOT NULL,
  task TEXT,
  harness TEXT,
  grant_ref TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spawns_agent ON spawns(agent_thread);
CREATE VIRTUAL TABLE IF NOT EXISTS turn_text USING fts5(
  turn_id UNINDEXED, loc UNINDEXED, role UNINDEXED, text
);

PRAGMA user_version = 1;
