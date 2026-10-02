/**
 * A pi session host for driving the bridge without pi installed. It models
 * only what decides whether a prompt reaches the transcript: when pi's
 * prompt() refuses, queues or runs a message. Each rule cites the
 * @earendil-works/pi-coding-agent 0.85.1 source it copies (paths under the
 * package's dist/), so a later pi can be checked against it. Model replies,
 * tools, compaction and retries are not modelled: a run answers each message
 * with one assistant message, a macrotask later.
 */
const tick = () => new Promise((resolve) => setImmediate(resolve));

export class PiHost {
  handlers = new Map();
  transcript = [];
  /** Errors pi reports for fire-and-forget extension sends (core/agent-session.js:2020-2028). */
  extensionErrors = [];
  /** Awaited inside prompt()'s preflight, where pi awaits auth and compaction checks (core/agent-session.js:880-896). */
  preflight = async () => {};
  /** AgentSession._isAgentRunActive, which isStreaming reads (core/agent-session.js:616-618). */
  sessionRunActive = false;
  /** pi-agent-core Agent.activeRun. */
  agentRunActive = false;
  followUps = [];

  /** The ExtensionAPI subset the bridge and the race fixtures use. */
  api() {
    return {
      on: (event, handler) => { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(handler); },
      // core/extensions/loader.js:299-301 → core/agent-session.js:2020-2028: fire and forget, errors reported.
      sendUserMessage: (content, options) => { this.sendUserMessage(content, options).catch((e) => this.extensionErrors.push(e.message)); },
      sendMessage: (message, options) => { this.sendCustomMessage(message, options); },
    };
  }

  context() { return { isIdle: () => !this.sessionRunActive }; }

  async emit(event) {
    for (const handler of this.handlers.get(event.type) || []) await handler(event, this.context());
  }

  /** core/agent-session.js:821-950 (prompt). */
  async prompt(text, options = {}) {
    const source = options.source ?? "interactive";
    // core/agent-session.js:842-852: input handlers see streamingBehavior only while streaming; the first "handled" wins.
    for (const handler of this.handlers.get("input") || []) {
      const result = await handler({ type: "input", text, images: options.images, source, streamingBehavior: this.sessionRunActive ? options.streamingBehavior : undefined }, this.context());
      if (result?.action === "handled") return;
      if (result?.action === "transform") text = result.text;
    }
    // core/agent-session.js:860-870: while streaming, queue by streamingBehavior or refuse.
    if (this.sessionRunActive) {
      if (!options.streamingBehavior) throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
      this.followUps.push({ role: "user", text });
      return;
    }
    await this.preflight();
    // core/agent-session.js:915: before_agent_start, then _runAgentPrompt (core/agent-session.js:949).
    await this.emit({ type: "before_agent_start", prompt: text });
    await this.runAgentPrompt({ role: "user", text });
  }

  /** core/agent-session.js:1161-1185: an extension's user message is a prompt with source "extension". */
  sendUserMessage(content, options = {}) {
    const text = typeof content === "string" ? content : content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    return this.prompt(text, { expandPromptTemplates: options.expandPromptTemplates ?? false, streamingBehavior: options.deliverAs, source: "extension" });
  }

  /** core/agent-session.js:1099-1133: a triggerTurn custom message queues while streaming, else starts a run at once. */
  sendCustomMessage(message, options = {}) {
    const entry = { role: "custom", text: message.content };
    if (this.sessionRunActive && options.triggerTurn !== false) { this.followUps.push(entry); return; }
    if (options.triggerTurn) { this.runAgentPrompt(entry); return; }
    this.transcript.push(entry);
  }

  /** core/agent-session.js:772-786 and :347-356: the run flag is set first and cleared, with agent_settled, in finally. */
  async runAgentPrompt(message) {
    this.sessionRunActive = true;
    try {
      await this.agentPrompt(message);
    } finally {
      this.sessionRunActive = false;
      await this.emit({ type: "agent_settled" });
    }
  }

  /** pi-agent-core dist/agent.js:226-229: a prompt during an active run is refused; the loop drains follow-ups before agent_end. */
  async agentPrompt(message) {
    if (this.agentRunActive) throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.");
    this.agentRunActive = true;
    await this.emit({ type: "agent_start" });
    let next = message;
    while (next) {
      this.transcript.push(next);
      await this.emit({ type: "message_start", message: { role: next.role } });
      await tick();
      this.transcript.push({ role: "assistant", text: `reply to ${next.text}` });
      next = this.followUps.shift();
    }
    this.agentRunActive = false;
    await this.emit({ type: "agent_end" });
  }

  /** Let every pending run, queue and send finish. */
  async drain() { for (let i = 0; i < 200; i++) await tick(); }
}
