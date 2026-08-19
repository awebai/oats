// Tag and outfit conventions — the record's selection map.
//
// Tags and outfits are ordinary note turns (conventions over the record,
// never kernel objects): a tag annotates one turn with what it is about
// and what it does; an outfit records a selection of turns that served a
// task, with its validation status. Both are written by the intelligence
// layer (the librarian-dresser now, the capture-following mind later)
// into the tagger's own stream, and become queryable through the derived
// index like everything else.
//
// Fidelity is "summary": tag content is model judgment, not source truth.
// The link to the target turn is the truth; the annotation is an opinion
// with provenance.

export const TAG_ACTS = new Set([
  "decides",
  "commits",
  "closes",
  "asks",
  "answers",
  "reports",
  "explores",
  "concludes",
  "corrects",
]);

const slugish = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

// Build a tag turn core annotating `targetRef` (turn id, or id@loc for a
// session event). ts mirrors the target's ts so tag ordering follows the
// content it describes, not tagging time.
export function tagTurnCore({ owner, targetRef, targetTs, about = [], acts = [], caseSlug, note, model }) {
  const tag = {};
  const cleanAbout = [...new Set(about.map(slugish).filter(Boolean))].sort();
  const cleanActs = [...new Set(acts.filter((a) => TAG_ACTS.has(a)))].sort();
  if (cleanAbout.length > 0) tag.about = cleanAbout;
  if (cleanActs.length > 0) tag.acts = cleanActs;
  const cs = caseSlug ? slugish(caseSlug) : "";
  if (cs) tag.case = cs;
  if (note) tag.note = String(note).slice(0, 200);
  return {
    v: 1,
    ts: targetTs,
    from: owner,
    kind: "note",
    links: [{ rel: "tags", ref: targetRef }],
    body: { text: tag.note ?? "", tag },
    provenance: {
      source: "mind",
      fidelity: "summary",
      origin: { target: targetRef, ...(model ? { model } : {}) },
    },
  };
}

// Build an outfit turn core recording a selection that served a task.
export function outfitTurnCore({ owner, task, members, status = "proposed", evidence, ts, model }) {
  return {
    v: 1,
    ts,
    from: owner,
    kind: "note",
    links: members.map((ref) => ({ rel: "member", ref })),
    body: {
      text: `outfit for: ${String(task).slice(0, 120)}`,
      outfit: {
        task: String(task),
        status,
        ...(evidence ? { evidence } : {}),
      },
    },
    provenance: {
      source: "mind",
      fidelity: "summary",
      origin: { ...(model ? { model } : {}) },
    },
  };
}

// Parse helpers: return the structured payload or null.
export function parseTag(turn) {
  const tag = turn?.body?.tag;
  if (!tag || typeof tag !== "object") return null;
  const links = Array.isArray(turn.links) ? turn.links : [];
  const target = links.find((l) => l?.rel === "tags")?.ref;
  if (!target) return null;
  return {
    target,
    about: Array.isArray(tag.about) ? tag.about : [],
    acts: Array.isArray(tag.acts) ? tag.acts : [],
    caseSlug: typeof tag.case === "string" ? tag.case : null,
    note: typeof tag.note === "string" ? tag.note : "",
  };
}

export function parseOutfit(turn) {
  const outfit = turn?.body?.outfit;
  if (!outfit || typeof outfit !== "object") return null;
  return {
    task: String(outfit.task ?? ""),
    status: String(outfit.status ?? "proposed"),
    evidence: outfit.evidence ?? null,
    members: (Array.isArray(turn.links) ? turn.links : [])
      .filter((l) => l?.rel === "member")
      .map((l) => l.ref),
  };
}

export { slugish };
