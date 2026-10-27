// Scripts the service runs in the agent's browser tabs (Runtime.evaluate).
// They read the page and draw on it; they never act on it for the agent
// (clicks and keys go through the browser's own input).

/** A numbered mark: something to click, type into or scroll, in viewport pixels. */
export interface Mark {
    kind: string;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export const MAX_MARKS = 120;

/**
 * What can be used on the page: its controls (by tag, role and editability), and elements that only look
 * clickable (cursor: pointer, outermost). Open shadow roots and same-origin frames are walked; other frames
 * are counted, since their insides can't be read from here. Visible and not covered, or it isn't a mark.
 */
export const MARKS_JS = String.raw`(() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  let budget = 8000, crossFrames = 0;
  const ROLE_KINDS = { button: 'push button', link: 'link', checkbox: 'check box', switch: 'check box', radio: 'radio button',
    tab: 'page tab', menuitem: 'menu item', menuitemcheckbox: 'menu item', menuitemradio: 'menu item', option: 'list item',
    combobox: 'combo box', textbox: 'entry', searchbox: 'entry', slider: 'slider', spinbutton: 'spin button', treeitem: 'tree item' };
  const INPUT_KINDS = { password: 'password text', checkbox: 'check box', radio: 'radio button', submit: 'push button', button: 'push button',
    reset: 'push button', image: 'push button', range: 'slider', file: 'push button', color: 'push button' };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  function kindOf(el, style) {
    const role = (el.getAttribute('role') || '').split(' ')[0];
    if (ROLE_KINDS[role]) return ROLE_KINDS[role];
    const tag = el.tagName;
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'push button';
    if (tag === 'SELECT') return 'combo box';
    if (tag === 'TEXTAREA') return 'entry';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden') return null;
      return INPUT_KINDS[t] || 'entry';
    }
    if (el.isContentEditable && (el.parentElement === null || !el.parentElement.isContentEditable)) return 'entry';
    // a label is its control's name, not a mark of its own, unless the control is hidden behind it
    if (tag === 'LABEL' && el.control && el.control.getBoundingClientRect().width >= 3 && getComputedStyle(el.control).visibility !== 'hidden') return null;
    if (el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex'))) return 'clickable';
    if (style.cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) return 'clickable';
    return null;
  }
  function nameOf(el, doc) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ');
      if (clean(t)) return clean(t);
    }
    const direct = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') ||
      el.getAttribute('alt') || (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) ? el.value : '') || el.getAttribute('title');
    if (clean(direct)) return clean(direct);
    if (el.tagName === 'SELECT') return clean(el.selectedOptions[0] && el.selectedOptions[0].text);
    if (el.tagName === 'INPUT' && el.type === 'file') return el.files && el.files.length ? 'choose file (' + clean([...el.files].map((f) => f.name).join(', ')) + ' chosen)' : 'choose file';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return '';
    const img = el.querySelector && el.querySelector('img[alt]');
    return clean(el.innerText || (img && img.alt));
  }
  function state(el) {
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return el.checked ? ' (checked)' : '';
    const c = el.getAttribute('aria-checked') || el.getAttribute('aria-pressed') || el.getAttribute('aria-selected');
    if (c === 'true') return ' (checked)';
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return ' (disabled)';
    return '';
  }
  // the part of it on screen, when it can be clicked there; a mark is that part, so its middle is always on screen
  function visible(el, r, root, ox, oy) {
    const x0 = Math.max(0, r.left + ox), y0 = Math.max(0, r.top + oy), x1 = Math.min(vw, r.right + ox), y1 = Math.min(vh, r.bottom + oy);
    if (x1 - x0 < 3 || y1 - y0 < 3) return null;
    const cx = (x0 + x1) / 2 - ox, cy = (y0 + y1) / 2 - oy;
    let hit = root.elementFromPoint(cx, cy);
    while (hit && hit.shadowRoot && hit !== el) {
      const inner = hit.shadowRoot.elementFromPoint(cx, cy);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    const box = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    if (!hit) return null;
    if (hit === el || el.contains(hit) || hit.contains(el) && hit.tagName === 'LABEL') return box;
    // a styled control whose own box is covered by its label (custom checkboxes)
    return el.labels && [...el.labels].some((l) => l === hit || l.contains(hit)) ? box : null;
  }
  function walk(root, ox, oy, doc, inside) {
    const els = root.querySelectorAll('*');
    for (const el of els) {
      if (--budget < 0) return;
      if (el.shadowRoot) walk(el.shadowRoot, ox, oy, doc, inside);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let d = null;
        try { d = el.contentDocument; } catch (e) { d = null; }
        const r = el.getBoundingClientRect();
        if (d && d.documentElement) walk(d, ox + r.left + el.clientLeft, oy + r.top + el.clientTop, d, null);
        else if (r.width > 20 && r.height > 20 && r.bottom > 0 && r.top < vh) crossFrames++;
        continue;
      }
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const kind = kindOf(el, style);
      if (!kind) continue;
      const box = visible(el, el.getBoundingClientRect(), root.elementFromPoint ? root : doc, ox, oy);
      if (!box) continue;
      out.push({ kind, name: nameOf(el, doc) + state(el), ...box, el });
    }
  }
  walk(document, 0, 0, document, null);
  // a control inside another one that covers the same place is one mark: the inner one, with a name
  const kept = [];
  for (const m of out) {
    const i = kept.findIndex((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, m.x + m.w) - Math.max(k.x, m.x)), iy = Math.max(0, Math.min(k.y + k.h, m.y + m.h) - Math.max(k.y, m.y));
      return ix * iy >= 0.8 * Math.max(k.w * k.h, m.w * m.h) && (k.el.contains(m.el) || m.el.contains(k.el));
    });
    if (i < 0) kept.push(m);
    else if (kept[i].el.contains(m.el)) kept[i] = { ...m, name: m.name || kept[i].name, kind: m.kind === 'clickable' ? kept[i].kind : m.kind };
  }
  const marks = kept.map(({ el, ...m }) => m).sort((a, b) => Math.floor(a.y / 12) - Math.floor(b.y / 12) || a.x - b.x).slice(0, ${120});
  return { marks, crossFrames, width: vw, height: vh, url: location.href, title: document.title };
})()`;

const OVERLAY_HOST = "paperboard-agent-overlay";

/**
 * Draw boxes (and their labels) and optionally a coordinate grid over the page, for one screenshot; REMOVE_OVERLAY_JS
 * takes it away. It sits in a closed shadow root at the top of the stacking order, and never takes the pointer.
 */
export function overlayJs(o: {
    boxes: { x: number; y: number; w: number; h: number; label: string }[];
    color?: "palette" | "blue";
    grid?: { x: number; y: number; w: number; h: number; step: number; scale: number };
}): string {
    return `(() => {
  const o = ${JSON.stringify(o)};
  document.getElementById(${JSON.stringify(OVERLAY_HOST)})?.remove();
  const host = document.createElement('div');
  host.id = ${JSON.stringify(OVERLAY_HOST)};
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const palette = ['#e63946', '#1d78dc', '#229650', '#c86e00', '#8c3cc8'];
  const s = o.grid ? o.grid.scale : 1;
  const font = (px) => 'font:bold ' + (px / s) + 'px/1 sans-serif;';
  let html = '';
  if (o.grid) {
    const g = o.grid;
    for (let gx = Math.ceil(g.x / g.step) * g.step; gx < g.x + g.w; gx += g.step) {
      html += '<div style="position:absolute;left:' + gx + 'px;top:' + g.y + 'px;width:' + (1 / s) + 'px;height:' + g.h + 'px;background:rgba(255,0,140,.45)"></div>';
      if ((gx - g.x) * s >= 30) html += '<div style="position:absolute;left:' + (gx + 1 / s) + 'px;top:' + g.y + 'px;padding:0 ' + (2 / s) + 'px;background:rgba(255,255,255,.85);color:#c8006e;' + font(12) + '">' + gx + '</div>';
    }
    for (let gy = Math.ceil(g.y / g.step) * g.step; gy < g.y + g.h; gy += g.step) {
      html += '<div style="position:absolute;left:' + g.x + 'px;top:' + gy + 'px;width:' + g.w + 'px;height:' + (1 / s) + 'px;background:rgba(255,0,140,.45)"></div>';
      html += '<div style="position:absolute;left:' + g.x + 'px;top:' + (gy + 1 / s) + 'px;padding:0 ' + (2 / s) + 'px;background:rgba(255,255,255,.85);color:#c8006e;' + font(12) + '">' + gy + '</div>';
    }
  }
  o.boxes.forEach((b, i) => {
    const c = o.color === 'blue' ? '#1d78dc' : palette[i % palette.length];
    const label = String(b.label).replace(/[<&]/g, '');
    const above = b.y >= 16 / s;
    html += '<div style="position:absolute;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;box-sizing:border-box;border:' + (2 / s) + 'px solid ' + c + '"></div>';
    html += '<div style="position:absolute;left:' + Math.max(0, b.x - 1) + 'px;top:' + (above ? b.y - 16 / s : b.y) + 'px;height:' + (16 / s) + 'px;padding:' + (2 / s) + 'px ' + (3 / s) + 'px;box-sizing:border-box;background:' + c + ';color:#fff;' + font(12) + '">' + label + '</div>';
  });
  root.innerHTML = html;
  (document.body || document.documentElement).appendChild(host);
  return true;
})()`;
}

export const REMOVE_OVERLAY_JS = `(() => { document.getElementById(${JSON.stringify(OVERLAY_HOST)})?.remove(); return true; })()`;

// --- sign-in: the focused field, checked and selected (typing replaces what's there), on which site

export const EDITABLE_JS = String.raw`(() => {
  let e = document.activeElement;
  while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement;
  const editable = !!e && !e.disabled && !e.readOnly && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable);
  if (editable && e.select) e.select();
  return [location.protocol + '//' + location.hostname, editable, editable && e.maxLength > 0 ? e.maxLength : -1];
})()`;

// A one-time code split into a box per character: FOCUS remembers the box with the cursor, MOVED says whether
// the cursor still has to be moved on after a key (a site that doesn't move it itself).
export const SIGN_IN_FOCUS_JS = `(() => { window[Symbol.for('paperboard.signIn')] = document.activeElement; return true; })()`;
export const SIGN_IN_MOVED_JS = String.raw`(() => {
  const was = window[Symbol.for('paperboard.signIn')];
  return !!was && document.activeElement === was && was.maxLength > 0 && (was.value || '').length >= was.maxLength;
})()`;

/** How many ways this page could send UDP around the proxy (WebRTC candidates); the profile's policy makes it 0. */
export const WEBRTC_CANDIDATES_JS = String.raw`(async () => {
  const pc = new RTCPeerConnection({ iceServers: [] });
  let n = 0;
  pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate) n++; };
  pc.createDataChannel('x');
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((ok) => { const t = setTimeout(ok, 3000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }; });
  pc.close();
  return n;
})()`;
