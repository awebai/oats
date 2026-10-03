// The short human summary each command prints without --json.
export function summarize(command, r) {
  switch (command) {
    case "request":
      if (r.preview) return `preview: cloner ${r.preview.instance} (${r.preview.soul}) would clone ${r.request.source}; nothing was created`;
      return `cloner ${r.cloner.instance} spawned for ${r.request.source} (${r.request.relation}${r.request.relativeTo ? ` of ${r.request.relativeTo}` : ""}); transcript ${r.request.transcript === "include" ? "included" : "excluded"}`;
    case "dossier": {
      const s = r.summary;
      return `dossier for ${s.source}: ${s.files.copied} file(s) copied, ${s.files.notCopied} not; work ${s.work.mode}${s.work.branch ? ` on ${s.work.branch}` : ""}; transcript ${s.transcript.included ? `${s.transcript.status}, ${s.transcript.sessions} session(s), ${s.transcript.turns} turn(s)` : "not included"}\n${r.dossier}`;
    }
    case "spawn":
      if (r.preview) return `preview: ${r.preview.instance} (${r.preview.soul}, ${r.preview.relation}${r.preview.relativeTo ? ` of ${r.preview.relativeTo}` : ""}) decision ${r.preview.decision}; brief ${r.brief.bytes} bytes, ${r.redactions.length} redaction(s); nothing was created`;
      return `clone ${r.clone.instance} spawned and verified at ${r.clone.home}; brief ${r.brief.bytes} bytes sha256 ${r.brief.sha256}, ${r.redactions.length} redaction(s)`;
    default:
      return JSON.stringify(r);
  }
}
