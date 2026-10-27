// What assistive tech reads of an element's content: its text without the subtrees hidden from it
// (aria-hidden="true", or the hidden attribute). Text only: no aria-label, aria-labelledby or role rules, so it
// stands in for the accessible name only of content whose name is its text (a roster row's button).

/** `el`'s text, leaving out every subtree with aria-hidden="true" or hidden. */
export function spokenText(el) {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) text += node.nodeValue;
    else if (node.nodeType === 1 && node.getAttribute("aria-hidden") !== "true" && !node.hasAttribute("hidden")) text += spokenText(node);
  }
  return text;
}
