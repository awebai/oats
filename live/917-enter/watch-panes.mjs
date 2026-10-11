// Read-only witness for the live runs: every 50 ms, capture each pane of the scratch
// tmux server with the transport's own command (`tmux -u -S <socket> capture-pane -p`),
// and keep each distinct frame as frames/<sha256>.txt, with frames.jsonl listing
// {at, paneId, sha256}. The kernel's launch-prompt rows carry the sha256 of the frame
// they compared (signatureDigest), so a run can show the exact bytes the kernel judged.
// It never sends a key, never starts a server (list-panes on a missing socket fails),
// and exits when its stdin closes. Usage: node watch-panes.mjs <socket> <out-dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [socket, out] = process.argv.slice(2);
const frames = join(out, "frames");
mkdirSync(frames, { recursive: true });
const seen = new Set();
const tmux = (args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
let stop = false;
process.stdin.on("end", () => { stop = true; });
process.stdin.on("close", () => { stop = true; });
process.stdin.resume();
const tick = () => {
  if (stop) process.exit(0);
  if (existsSync(socket)) {
    let panes = [];
    try { panes = tmux(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").filter(Boolean); } catch { /* no server yet, or between windows */ }
    for (const paneId of panes) {
      let text;
      try { text = tmux(["capture-pane", "-p", "-t", paneId]); } catch { continue; }
      const sha256 = createHash("sha256").update(text).digest("hex");
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      writeFileSync(join(frames, `${sha256}.txt`), text);
      appendFileSync(join(out, "frames.jsonl"), JSON.stringify({ at: new Date().toISOString(), paneId, sha256 }) + "\n");
    }
  }
  setTimeout(tick, 50);
};
tick();
