// Shared pi/Codex session fixtures, mirroring the real on-disk record
// shapes (verified against ~/.pi/agent/sessions and ~/.codex/sessions).
// Used by the core formats tests here and by the experimental package's
// dress-over-formats test (experimental importing core is the allowed
// direction).

export const PI_UUID = "019fc67c-9c46-73f3-b44a-cbb6c7b02457";
export const PI_LINES = [
  { type: "session", version: "3", id: PI_UUID, timestamp: "2026-08-03T07:18:03.078Z", cwd: "/w" },
  { type: "model_change", id: "8ebfd618", timestamp: "2026-08-03T07:18:03.126Z", provider: "openai-codex" },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:05.000Z",
    message: { role: "user", content: [{ type: "text", text: "migrate the identity registry" }] },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:09.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "planning the migration quietly", thinkingSignature: "{}" },
        { type: "text", text: "starting with the schema split" },
      ],
    },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:09.500Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_x|fc_y",
          name: "read",
          arguments: "{'path': '/w/file.txt'}",
        },
      ],
    },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:10.000Z",
    message: { role: "toolResult", content: [{ type: "text", text: "tool noise not indexed" }] },
  },
];

export const CODEX_UUID = "019ac984-519d-75c2-b2f0-a6611c4f063e";
export const CODEX_LINES = [
  {
    timestamp: "2025-11-28T08:11:23.460Z",
    type: "session_meta",
    payload: { id: CODEX_UUID, timestamp: "2025-11-28T08:11:23.422Z", cwd: "/w" },
  },
  {
    timestamp: "2025-11-28T08:11:23.460Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "study the aweb access model" }],
    },
  },
  {
    timestamp: "2025-11-28T08:12:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "the access model has three verbs" }],
    },
  },
];

export const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
