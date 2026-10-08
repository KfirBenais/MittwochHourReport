// עזרי ממשק: יצירת אלמנטים, הודעות, חלונות, הורדות.

/** h('div', { class: 'x', onclick: fn }, 'text', child) – יוצר אלמנט בלי innerHTML */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// אייקונים קטנים (SVG) – בלי תלות בגופני אייקונים
const ICONS = {
  prev: 'M9 6l6 6-6 6',
  next: 'M15 6l-6 6 6 6',
  magic: 'M5 19L19 5M15 4v3M13.5 5.5h3M19 9v2M18 10h2M8 3v2M7 4h2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v5M15 3v5',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 100-6M22 21c0-3-2-5-5-5.5',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.5 7.5 0 000-2l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L15 3h-4l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1L11 21h4l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  refresh: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4M12 7v5l3 2',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
};

export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

// ---------- הודעות קופצות ----------

export function toast(message, type = 'info', ms = 4000) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${type}` }, message);
  host.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ---------- חלון ----------

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'סגירה', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => dialog.querySelector('input, textarea, select, button.primary')?.focus(), 30);
  return { close, dialog };
}

export function confirmDialog(title, message, okLabel = 'אישור', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      body: h('p', {}, message),
      actions: [
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, okLabel),
        h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'ביטול'),
      ],
      onClose: () => finish(false),
    });
  });
}

// ---------- הורדות ----------

export function download(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = h('script', { src, onload: resolve, onerror: () => reject(new Error(`טעינת ${src} נכשלה`)) });
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

// ---------- שעות ----------

/**
 * מנרמל קלט שעה חופשי: "8" → 08:00, "845" → 08:45, "1645" → 16:45, "16.45" / "16,45" → 16:45.
 * מחזיר '' לקלט ריק ו-null לקלט לא תקין.
 */
export function normalizeTime(raw) {
  const s = String(raw || '').trim().replace(/[.,;׳']/g, ':');
  if (!s) return '';
  let h;
  let m;
  const parts = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (parts) {
    h = +parts[1];
    m = +parts[2];
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = +s;
      m = 0;
    } else {
      h = +s.slice(0, s.length - 2);
      m = +s.slice(-2);
    }
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = () => {
    clearTimeout(t);
    fn();
  };
  return wrapped;
}

export function formatDays(n) {
  if (!n) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------- שדות טופס ----------

let fieldSeq = 0;

/** שדה עם תווית. control יכול להיות input או אלמנט עוטף */
export function field(label, control, hint) {
  const input = control.matches?.('input, select, textarea') ? control : control.querySelector('input, select, textarea');
  if (input && !input.id) input.id = `f${++fieldSeq}`;
  return h('div', { class: 'field' },
    h('label', { for: input?.id }, label),
    control,
    hint ? h('small', {}, hint) : null);
}

/**
 * שדה מייל של החברה: מקלידים רק את החלק שלפני ה-@ (הדומיין מוצג קבוע).
 * אם מדביקים כתובת מלאה של הדומיין – הדומיין מוסר אוטומטית.
 */
export function emailInput({ domain = '', value = '', autocomplete = 'username' } = {}) {
  const input = h('input', {
    type: 'text', name: 'email', dir: 'ltr', inputmode: 'email', autocomplete, autocapitalize: 'none', spellcheck: 'false', required: true,
    placeholder: domain ? 'first.last' : 'name@company.com',
  });
  const strip = () => {
    const v = input.value.trim();
    if (domain && v.toLowerCase().endsWith(`@${domain}`)) input.value = v.slice(0, -(domain.length + 1));
  };
  input.value = value;
  strip();
  input.addEventListener('input', strip);
  input.addEventListener('change', strip);
  const el = h('div', { class: `email-field${domain ? ' has-suffix' : ''}`, dir: 'ltr' }, input, domain ? h('span', { class: 'suffix' }, `@${domain}`) : null);
  return {
    el,
    input,
    value() {
      const v = input.value.trim().toLowerCase();
      return !domain || !v || v.includes('@') ? v : `${v}@${domain}`;
    },
  };
}

/** שדה סיסמה עם כפתור הצגה/הסתרה */
export function passwordInput({ name = 'password', autocomplete = 'current-password', minlength } = {}) {
  const input = h('input', { type: 'password', name, dir: 'ltr', autocomplete, required: true, minlength });
  const btn = h('button', {
    type: 'button', class: 'pw-toggle', 'aria-label': 'הצגת הסיסמה', title: 'הצגת הסיסמה',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה');
      btn.title = btn.getAttribute('aria-label');
      clear(btn, icon(show ? 'eyeOff' : 'eye', 18));
    },
  }, icon('eye', 18));
  return { el: h('div', { class: 'pw-field', dir: 'ltr' }, input, btn), input };
}
