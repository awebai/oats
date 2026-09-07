/** Optional recurring message configured by the spawner. */
export function wakeScheduleFields(doc) {
  const el = doc.createElement("fieldset"); el.className = "frelgroup fwakegroup";
  el.innerHTML = `<legend>Recurring wake-up</legend>
    <label><span><input type="checkbox" class="fwake-enabled"> Wake this agent on a schedule</span></label>
    <div class="fwake-options" hidden>
      <label>Repeat<select class="field fwake-repeat"><option value="*/5 * * * *">Every 5 minutes</option><option value="*/15 * * * *" selected>Every 15 minutes</option><option value="*/30 * * * *">Every 30 minutes</option><option value="0 * * * *">Every hour</option><option value="custom">Custom cron</option></select></label>
      <label>Cron expression<input class="field fwake-cron" value="*/15 * * * *"></label>
      <label>Time zone<input class="field fwake-tz"></label>
      <label>Message on wake-up<textarea class="field fwake-message" rows="3" placeholder="Check your pending work and report anything that needs attention."></textarea></label>
      <p class="freldesc">Uses this same agent home and sends the message through its terminal, without an interrupt. The host scheduler must be enabled for wake-ups to run.</p>
    </div>`;
  const q = selector => el.querySelector(selector);
  q(".fwake-tz").value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  q(".fwake-enabled").addEventListener("change", () => { q(".fwake-options").hidden = !q(".fwake-enabled").checked; });
  q(".fwake-repeat").addEventListener("change", () => {
    if (q(".fwake-repeat").value !== "custom") q(".fwake-cron").value = q(".fwake-repeat").value;
  });
  q(".fwake-cron").addEventListener("input", () => { q(".fwake-repeat").value = "custom"; });
  return {
    el,
    read() {
      if (!q(".fwake-enabled").checked) return undefined;
      const message = q(".fwake-message").value;
      const cron = q(".fwake-cron").value.trim(), tz = q(".fwake-tz").value.trim();
      if (!message.trim() || !cron || !tz) throw new Error("Specify the wake schedule, time zone, and message");
      return { cron, tz, message, enabled: true };
    },
  };
}
