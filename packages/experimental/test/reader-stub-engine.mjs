#!/usr/bin/env node
// Deterministic reader stub: segments a window by marker lines.
// "PHASE:<type>:<gist>" opens a segment at that line (closing any open
// one at the previous line); "WRONG!" inside a segment's gist marks it
// dead-end wrong-track. Open segments passed in are closed when a new
// PHASE appears, else returned still open.

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const lines = input.split("\n");
  const openIn = [];
  for (const m of input.matchAll(/^- start=(line:\d+) type=(\S+) about=(\S*) established="([^"]*)"/gm)) {
    openIn.push({ start: m[1], type: m[2], established: m[4] });
  }
  const events = [];
  for (const line of lines) {
    const m = /^\[(line:\d+)\] .*?PHASE:([\w-]+):(.*)$/.exec(line);
    if (m) events.push({ loc: m[1], type: m[2], gist: m[3].trim() });
  }
  const windowLocs = [...input.matchAll(/^\[(line:(\d+))\]/gm)].map((m) => ({
    ref: m[1],
    n: Number(m[2]),
  }));
  const lastLoc = windowLocs.length ? windowLocs[windowLocs.length - 1].ref : null;
  const segments = [];
  // Half-open spans: a carried-open segment closes AT the first new
  // phase's line (its end === the next segment's start).
  for (const o of openIn) {
    if (events.length > 0) {
      segments.push({
        start: o.start,
        end: events[0].loc,
        type: o.type,
        about: ["stub"],
        established: o.established,
        outcome: o.established.includes("WRONG!") ? "dead-end" : "fruitful",
      });
    } else {
      segments.push({
        start: o.start,
        end: null,
        type: o.type,
        about: ["stub"],
        established: o.established,
        outcome: "ongoing",
      });
    }
  }
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const isLast = i === events.length - 1;
    const wrong = e.gist.includes("WRONG!");
    segments.push({
      start: e.loc,
      end: isLast ? null : events[i + 1].loc,
      type: e.type,
      about: ["stub"],
      established: e.gist,
      outcome: isLast ? "ongoing" : wrong ? "dead-end" : "fruitful",
      ...(wrong ? { lesson: "the stub lesson" } : {}),
    });
  }
  // A window with no phases and no carried segments: cover it as admin.
  if (segments.length === 0 && lastLoc) {
    segments.push({
      start: windowLocs[0].ref,
      end: null,
      type: "admin",
      about: ["stub"],
      established: "window without phase markers",
      outcome: "ongoing",
    });
  }
  process.stdout.write(JSON.stringify({ segments }) + "\n");
});
