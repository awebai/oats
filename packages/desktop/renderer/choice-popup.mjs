/** Existing-data single choice popup. Search is local/advisory, never a resolver.
 * Popup-local keys consume selection before any enclosing form launch handler. */
import { revealInScrollport } from './reveal-in-scrollport.mjs';
export function createChoicePopup(doc, host, label, id, options, pick, {
  searchable = false, scope = () => '', nothingReported = 'No choices reported.', noMatch = 'No choices match the filter.',
} = {}) {
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const root = node('div', undefined, 'spawn-choice-popover'), trigger = node('button', label, 'spawn-choice-trigger');
  trigger.type = 'button'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const menu = node('div', undefined, 'spawn-choice-menu'); menu.id = id; menu.hidden = true;
  const list = node('div'); list.id = `${id}-list`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', label);
  trigger.setAttribute('aria-controls', list.id);
  let search = null;
  if (searchable) {
    const wrap = node('div', undefined, 'spawn-popup-search');
    const caption = node('span', `Filter ${label.toLowerCase()}`, 'workspace-sr-only');
    search = node('input', undefined, 'field'); search.type = 'search'; search.autocomplete = 'off'; search.placeholder = 'Filter model suggestions…';
    search.setAttribute('aria-label', 'Filter model suggestions'); search.setAttribute('aria-controls', list.id);
    wrap.append(caption, search); menu.append(wrap);
  }
  const status = node('p', '', 'spawn-popup-status'); status.setAttribute('role', 'status');
  menu.append(status, list); root.append(trigger, menu); host.append(root);
  let alive = true, epoch = 0, openedScope;
  const key = item => JSON.stringify([item.custom ? 'custom' : 'value', item.value ?? item.label]);
  const visible = () => {
    if (!alive || !root.isConnected) return false;
    for (let el = root; el; el = el.parentElement) {
      const css = doc.defaultView?.getComputedStyle(el);
      if (el.hidden || el.inert || css?.display === 'none' || css?.visibility === 'hidden') return false;
    }
    return true;
  };
  const choices = () => [...list.querySelectorAll('button:not(:disabled)')];
  const focus = element => {
    if (!element || !visible()) return;
    if (element === search) menu.scrollTop = 0;
    element.focus({ preventScroll: true });
    if (list.contains(element)) revealInScrollport(menu, element, search?.parentElement);
  };
  const close = (restore = false) => {
    epoch++; menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (restore && visible()) trigger.focus({ preventScroll: true });
  };
  function render() {
    if (!visible() || menu.hidden) return;
    if (openedScope !== scope()) { close(menu.contains(doc.activeElement)); return; }
    const mine = ++epoch, focused = list.contains(doc.activeElement) ? doc.activeElement.dataset.choiceKey : null;
    const rows = options(), query = search?.value.toLocaleLowerCase() || '';
    const reports = rows.filter(item => item.search !== false);
    const matches = reports.filter(item => `${item.label}\n${item.value ?? ''}\n${item.detail ?? ''}`.toLocaleLowerCase().includes(query));
    const shown = rows.filter(item => item.search === false ? !query || item.custom : matches.includes(item));
    status.textContent = !reports.length ? nothingReported : !matches.length ? noMatch : '';
    list.replaceChildren();
    let group = null, groupName;
    for (const item of shown) {
      if (item.group !== groupName || !group) {
        group = node('div'); groupName = item.group;
        if (groupName) { group.setAttribute('role', 'group'); group.setAttribute('aria-label', groupName); group.append(node('div', groupName, 'spawn-popup-group')); }
        list.append(group);
      }
      const button = node('button', item.label); button.type = 'button'; button.disabled = !!item.disabled; button.dataset.choiceKey = key(item);
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(!!item.selected));
      if (item.detail) button.append(node('small', item.detail));
      button.addEventListener('click', () => {
        if (!visible() || menu.hidden || mine !== epoch || openedScope !== scope() || !list.contains(button) || button.disabled) return;
        const current = options().find(candidate => key(candidate) === key(item));
        if (!current || current.disabled) return;
        close(true); pick(current);
      });
      group.append(button);
    }
    if (focused !== null) {
      const replacement = choices().find(button => button.dataset.choiceKey === focused);
      focus(replacement || search || choices()[0] || trigger);
    }
  }
  function open() {
    if (!visible() || trigger.disabled) return;
    openedScope = scope(); if (search) search.value = '';
    menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render();
    focus(search || list.querySelector('[aria-selected=true]:not(:disabled)') || choices()[0] || trigger);
  }
  search?.addEventListener('input', render);
  trigger.addEventListener('click', () => { if (visible()) menu.hidden ? open() : close(); });
  root.addEventListener('keydown', event => {
    if (!visible() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const editing = event.target === search;
    if (event.repeat && (event.key === 'Enter' || event.key === ' ' && !editing)) { event.preventDefault(); event.stopPropagation(); return; }
    if (menu.hidden) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key) || event.key === 'Enter' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); event.stopPropagation(); open(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.key === 'Enter' || event.key === ' ' && !editing) {
      event.preventDefault(); event.stopPropagation();
      if (editing) {
        const rows = options(), query = search.value.toLocaleLowerCase();
        const candidate = query ? rows.find(item => item.search !== false && !item.disabled && `${item.label}\n${item.value ?? ''}\n${item.detail ?? ''}`.toLocaleLowerCase().includes(query))
          : rows.find(item => item.selected && !item.disabled);
        if (candidate) choices().find(button => button.dataset.choiceKey === key(candidate))?.click();
      } else if (list.contains(doc.activeElement)) doc.activeElement.click();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (editing && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || ['Home', 'End'].includes(event.key))) return;
      event.preventDefault(); event.stopPropagation();
      const rows = choices(), at = rows.indexOf(doc.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
        : at < 0 ? event.key === 'ArrowDown' ? 0 : rows.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      focus(rows[next]);
    }
  });
  const outside = event => { if (!root.contains(event.target)) close(); }; doc.addEventListener('mousedown', outside);
  return { trigger, close, refresh: render, dispose() { if (!alive) return; close(); alive = false; doc.removeEventListener('mousedown', outside); } };
}
