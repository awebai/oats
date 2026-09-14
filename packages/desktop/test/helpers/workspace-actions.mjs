import assert from 'node:assert/strict';

// Use the supported DOM path, including legacy CLIs with no operations API.
// Selection is explicit; the helper never submits the Spawn dialog.
export function launchSoul(doc, card = doc.querySelector('.soul-card')) {
  assert.ok(card, 'a specific soul card is available for selection');
  card.click();
  const control = doc.querySelector('.soul-inspector .spawn-act');
  assert.ok(control, 'selected-soul inspector exposes Launch without waiting for inspection');
  control.click();
  return control;
}
