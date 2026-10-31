import test from "node:test";
import assert from "node:assert/strict";
import { waitingLine } from "../lib/status-words.mjs";

const row = (since, extra = {}) => ({ running: true, waitingOnYou: { since, reason: "question", message: "Which branch?", ...extra } });
const now = Date.parse("2026-10-30T14:02:00Z");
const utc = { now, timeZone: "UTC" };

test("plain status claim start: today's clock, another day's month and date, another year's ISO date", () => {
  assert.equal(waitingLine(row("2026-10-30T14:00:00Z"), utc), "! needs input (question) since 14:00, 2 min: Which branch?");
  assert.equal(waitingLine(row("2026-10-29T09:15:00Z"), utc), "! needs input (question) since Oct 29 09:15, 1 d: Which branch?");
  assert.equal(waitingLine(row("2026-10-02T09:05:00Z", { reason: "permission", message: null }), utc), "! needs input (permission) since Oct 2 09:05, 28 d");
  assert.equal(waitingLine(row("2025-12-31T09:05:00Z"), { ...utc, now: Date.parse("2026-01-01T09:05:00Z") }), "! needs input (question) since 2025-12-31 09:05, 1 d: Which branch?");
});

test("elapsed words floor at the minute, hour and day boundaries", () => {
  for (const [ms, elapsed] of [
    [0, "under a minute"], [59999, "under a minute"], [60000, "1 min"],
    [3599999, "59 min"], [3600000, "1 h"], [86399999, "23 h"],
    [86400000, "1 d"], [172799999, "1 d"], [172800000, "2 d"],
  ]) {
    const line = waitingLine(row(new Date(now - ms).toISOString(), { message: null }), utc);
    assert.ok(line.endsWith(`, ${elapsed}`), `${ms}: ${line}`);
  }
});

test("calendar day and year are determined in the supplied timezone, including midnight", () => {
  const since = "2026-10-30T00:05:00Z", at = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(waitingLine(row(since), { now: at, timeZone: "UTC" }), "! needs input (question) since 00:05, 11 h: Which branch?");
  assert.equal(waitingLine(row(since), { now: at, timeZone: "America/Los_Angeles" }), "! needs input (question) since Oct 29 17:05, 11 h: Which branch?");
  assert.equal(waitingLine(row("2026-01-01T00:05:00Z"), { now: Date.parse("2026-01-01T12:00:00Z"), timeZone: "America/Los_Angeles" }), "! needs input (question) since 2025-12-31 16:05, 11 h: Which branch?");
});

test("elapsed time measures real time across a daylight saving clock change", () => {
  assert.equal(waitingLine(row("2026-11-01T08:30:00Z"), { now: Date.parse("2026-11-01T10:30:00Z"), timeZone: "America/Los_Angeles" }), "! needs input (question) since 01:30, 2 h: Which branch?");
});

test("a future start keeps its clock without elapsed; invalid or missing starts retain the old line", () => {
  assert.equal(waitingLine(row("2026-10-30T14:02:01Z"), utc), "! needs input (question) since 14:02: Which branch?");
  assert.equal(waitingLine(row("2027-01-01T00:00:00Z", { message: null }), utc), "! needs input (question) since 2027-01-01 00:00");
  for (const since of ["not a time", "", undefined, null]) {
    assert.equal(waitingLine(row(since), utc), "! needs input (question): Which branch?");
    assert.equal(waitingLine(row(since, { reason: null, message: null }), utc), "! needs input (unknown)");
  }
  assert.equal(waitingLine(row("2026-10-30T14:01:00Z", { reason: undefined, message: "" }), utc), "! needs input (unknown) since 14:01, 1 min");
});

test("only running rows holding a claim print the line", () => {
  for (const running of [false, null, undefined]) assert.equal(waitingLine({ ...row("2026-10-30T14:01:00Z"), running }, utc), null);
  for (const waitingOnYou of [null, undefined]) assert.equal(waitingLine({ running: true, waitingOnYou }, utc), null);
});
