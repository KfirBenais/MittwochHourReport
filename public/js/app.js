// נקודת הכניסה: ניווט, פרופיל ולוח חגים.

import { connect } from './store.js';
import {
  todayISO, ymOf, monthLabel, eventsOn, groupEvents, addDays, formatShort, weekday, WEEKDAY_NAMES, hebrewDateLabel, KIND_LABELS,
} from './calendar.js';
import { POLICY_LABELS } from './defaults.js';
import { buildReminderIcs } from './email.js';
import {
  h, clear, icon, toast, download, normalizeTime, autosaver,
} from './ui.js';
import { showMonth } from './month.js';
import { showTeam, showSettings } from './admin.js';
import { showHistory } from './history.js';
import { renderAuth } from './auth.js';

const app = document.getElementById('app');
const ctx = { store: null, user: null, settings: null, main: null };

// ---------- התחברות ----------

function showAuth(initial = {}) {
  ctx.user = null;
  renderAuth(ctx, app, initial, start, footer);
}

// ---------- מעטפת ----------

function footer() {
  return h('footer', { class: 'footer' },
    ctx.store?.mode === 'local'
      ? h('span', {}, icon('alert', 14), ' מצב מקומי – הנתונים נשמרים רק בדפדפן הזה. לעבודת צוות יש להריץ את השרת (ראו README). מומלץ לגבות מדי פעם מהפרופיל.')
      : h('span', {}, `I.E. Mittwoch & Sons · NCR · דיווח שעות${ctx.store?.health?.version ? ` · גרסה ${ctx.store.health.version}` : ''}`));
}

function renderShell() {
  const { user } = ctx;
  const nav = h('nav', { class: 'nav' },
    h('a', { href: '#/', dataset: { route: 'month' } }, icon('clock', 16), h('span', {}, 'הדוח שלי')),
    h('a', { href: '#/history', dataset: { route: 'history' } }, icon('history', 16), h('span', {}, 'היסטוריה')),
    h('a', { href: '#/holidays', dataset: { route: 'holidays' } }, icon('calendar', 16), h('span', {}, 'לוח חגים')),
    user.isAdmin && ctx.store.mode === 'server' ? h('a', { href: '#/team', dataset: { route: 'team' }, title: ctx.pending ? 'יש בקשות שמחכות לך' : null }, icon('users', 16), h('span', {}, 'הצוות'),
      ctx.pending ? h('span', { class: 'badge' }, String(ctx.pending)) : null) : null,
    user.isAdmin ? h('a', { href: '#/settings', dataset: { route: 'settings' } }, icon('gear', 16), h('span', {}, 'הגדרות')) : null);

  const userBtn = h('a', { class: 'user-btn', href: '#/profile', dataset: { route: 'profile' }, title: 'פרופיל' },
    h('span', { class: 'avatar' }, (user.fullName || '?').trim().charAt(0)),
    h('span', { class: 'user-name' }, user.fullName));

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/' },
        h('img', { src: 'img/logo.png', alt: 'NCR · Teradata · I.E. Mittwoch & Sons' }),
        h('span', { class: 'brand-title' }, 'דיווח שעות')),
      nav,
      userBtn));
  ctx.main = h('main', { class: 'main' });
  clear(app, header, ctx.main, footer());
  // גובה הסרגל העליון – כדי שסרגל הפעולות הדביק יישב בדיוק מתחתיו
  const syncHeight = () => document.documentElement.style.setProperty('--topbar-h', `${header.offsetHeight}px`);
  syncHeight();
  if (window.ResizeObserver) new ResizeObserver(syncHeight).observe(header);
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  const curYm = ymOf(todayISO());
  const ymArg = /^\d{4}-(0[1-9]|1[0-2])$/.test(arg || '') ? arg : curYm;
  const active = name || 'month';
  // מונה ניווט: מסך שנטען לאט לא יצייר את עצמו מעל מסך שעברו אליו בינתיים
  ctx.nav = (ctx.nav || 0) + 1;
  for (const a of document.querySelectorAll('[data-route]')) a.classList.toggle('active', a.dataset.route === active);
  window.onbeforeunload = null;
  window.onpagehide = null;
  try {
    if (!name || name === 'month') await showMonth(ctx, ymArg);
    else if (name === 'holidays') showHolidays();
    else if (name === 'history') await showHistory(ctx);
    else if (name === 'team' && ctx.user.isAdmin) await showTeam(ctx, ymArg);
    else if (name === 'settings' && ctx.user.isAdmin) showSettings(ctx);
    else if (name === 'profile') showProfile();
    else location.hash = '#/';
  } catch (err) {
    if (err.status === 401) {
      showAuth();
      return;
    }
    clear(ctx.main, h('div', { class: 'card error-card' }, h('h2', {}, 'משהו השתבש'), h('p', {}, err.message), h('button', { class: 'btn', onclick: route }, 'לנסות שוב')));
  }
  window.scrollTo(0, 0);
}

// ---------- לוח חגים ----------

function showHolidays() {
  const { settings } = ctx;
  const today = todayISO();
  const events = [];
  for (let i = 0; i < 400; i++) {
    const iso = addDays(today, i);
    for (const ev of eventsOn(iso, settings.special)) events.push({ date: iso, ...ev });
  }
  const groups = groupEvents(events);
  const whatToDo = (g) => {
    if (g.kind === 'holiday') return 'חג – לא עובדים. המילוי האוטומטי רושם את שם החג.';
    if (g.kind === 'info') return 'יום עבודה רגיל.';
    return `ברירת המחדל במילוי אוטומטי: ${POLICY_LABELS[settings.policies[g.kind]] || POLICY_LABELS.ask}.`;
  };
  const byMonth = new Map();
  for (const g of groups) {
    const key = ymOf(g.from);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(g);
  }
  const showInfo = h('input', { type: 'checkbox', checked: false, onchange: () => list.classList.toggle('hide-info', !showInfo.checked) });
  const list = h('div', { class: 'holiday-list hide-info' },
    [...byMonth].map(([ym, gs]) => h('section', { class: `card${gs.every((g) => g.kind === 'info') ? ' only-info' : ''}` },
      h('h2', {}, monthLabel(ym)),
      h('ul', {}, gs.map((g) => h('li', { class: `kind-${g.kind}` },
        h('div', { class: 'h-date' },
          h('b', {}, g.from === g.to ? `${WEEKDAY_NAMES[weekday(g.from)]} ${formatShort(g.from)}` : `${formatShort(g.from)}–${formatShort(g.to)}`),
          h('span', { class: 'muted small' }, hebrewDateLabel(g.from))),
        h('div', { class: 'h-name' }, h('span', { class: `tag tag-${g.kind}` }, KIND_LABELS[g.kind]), ' ', h('b', {}, g.name), g.from <= today && today <= g.to ? h('span', { class: 'today-tag' }, 'היום') : null),
        h('div', { class: 'muted small' }, whatToDo(g))))))));
  clear(ctx.main,
    h('section', { class: 'page-head' },
      h('h1', {}, 'לוח חגים ומועדים'),
      h('p', { class: 'muted' }, 'השנה הקרובה – כדי לתכנן חופשות ולא להתבלבל בדיווח. מחושב אוטומטית לפי הלוח העברי (ישראל).'),
      h('label', { class: 'check' }, showInfo, h('span', {}, 'להציג גם מועדים שהם יום עבודה רגיל (חנוכה, פורים, צומות...)'))),
    list);
}

// ---------- פרופיל ----------

function showProfile() {
  const { store, user } = ctx;
  const p = { ...user.profile, phone: user.phone || '' };
  const timeField = (key, label) => {
    const input = h('input', {
      type: 'text', class: 'time', inputmode: 'numeric', value: p[key],
      onchange: () => {
        const v = normalizeTime(input.value);
        if (!v) {
          input.classList.add('invalid');
          return;
        }
        input.classList.remove('invalid');
        input.value = v;
        p[key] = v;
        changedNow();
      },
    });
    return h('label', { class: 'field inline' }, h('span', {}, label), input);
  };

  // כל שינוי בפרופיל נשמר אוטומטית
  const saver = autosaver(async () => {
    if (!p.fullName.trim()) throw new Error('יש להזין שם מלא');
    ctx.user = await store.saveProfile(p);
    // עדכון השם בסרגל העליון בלי לצייר מחדש את המסך (כדי לא לאבד את מיקום ההקלדה)
    const name = document.querySelector('.user-name');
    if (name) name.textContent = ctx.user.fullName;
    const avatar = document.querySelector('.avatar');
    if (avatar) avatar.textContent = (ctx.user.fullName || '?').trim().charAt(0);
  });
  const changed = () => saver.change();
  const changedNow = () => saver.change({ now: true });
  window.onpagehide = () => saver.flush();

  const cards = [
    h('section', { class: 'card' },
      h('h2', {}, icon('user'), ' הפרטים שלי'),
      h('label', { class: 'field' }, h('span', {}, 'שם מלא (מופיע באקסל ובנושא המייל)'), h('input', { type: 'text', value: p.fullName, oninput: (e) => { p.fullName = e.target.value; changed(); } })),
      store.mode === 'server'
        ? h('div', { class: 'field' }, h('span', {}, 'מייל (משמש לכניסה)'), h('div', { class: 'readonly', dir: 'ltr' }, user.email || user.username))
        : h('label', { class: 'field' }, h('span', {}, 'אימייל'), h('input', { type: 'email', dir: 'ltr', value: p.email, oninput: (e) => { p.email = e.target.value; changed(); } })),
      h('label', { class: 'field' }, h('span', {}, 'טלפון נייד'), h('input', { type: 'tel', dir: 'ltr', value: p.phone, placeholder: '050-0000000', oninput: (e) => { p.phone = e.target.value; changed(); } })),
      h('h3', {}, 'שעות ברירת מחדל'),
      h('div', { class: 'inline-fields' }, timeField('start', 'כניסה'), timeField('end', 'יציאה'), timeField('halfDayEnd', 'סוף חצי יום')),
      h('label', { class: 'field inline' }, h('span', {}, 'זמן הפסקה (דקות)'),
        h('input', { type: 'number', min: 0, max: 120, step: 5, value: p.breakMin, class: 'time', oninput: (e) => { p.breakMin = Number(e.target.value); changed(); } }))),
    h('section', { class: 'card' },
      h('h2', {}, icon('bell'), ' תזכורת חודשית ביומן'),
      h('p', {}, 'קובץ ליומן (Outlook) עם תזכורת קבועה ביום העבודה הראשון של כל חודש ב-09:00: "שליחת דיווח שעות ל', ctx.settings.recipientName, '".'),
      h('button', {
        class: 'btn',
        onclick: () => download(buildReminderIcs({ url: `${location.origin}${location.pathname}`, recipientName: ctx.settings.recipientName }), 'תזכורת דיווח שעות.ics', 'text/calendar'),
      }, icon('calendar'), ' הוספה ליומן')),
  ];

  if (store.mode === 'server') {
    const cur = h('input', { type: 'password', dir: 'ltr', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', dir: 'ltr', minlength: 8, autocomplete: 'new-password' });
    cards.push(h('section', { class: 'card' },
      h('h2', {}, icon('gear'), ' סיסמה'),
      h('label', { class: 'field' }, h('span', {}, 'סיסמה נוכחית'), cur),
      h('label', { class: 'field' }, h('span', {}, 'סיסמה חדשה'), next),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            await store.changePassword(cur.value, next.value);
            cur.value = '';
            next.value = '';
            toast('הסיסמה עודכנה', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      }, 'עדכון סיסמה'),
      h('hr'),
      h('button', {
        class: 'btn ghost',
        onclick: async () => {
          await store.logout();
          showAuth();
        },
      }, icon('logout'), ' יציאה')));
  } else {
    const fileInput = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: async () => {
        try {
          const data = JSON.parse(await fileInput.files[0].text());
          store.importAll(data);
          toast('הגיבוי שוחזר', 'success');
          start();
        } catch (err) {
          toast(`שחזור נכשל: ${err.message}`, 'error');
        }
      },
    });
    cards.push(h('section', { class: 'card' },
      h('h2', {}, icon('download'), ' גיבוי (מצב מקומי)'),
      h('p', { class: 'muted small' }, 'במצב מקומי הנתונים שמורים רק בדפדפן הזה. כדאי לשמור גיבוי מדי פעם.'),
      h('div', { class: 'inline-fields' },
        h('button', { class: 'btn', onclick: () => download(JSON.stringify(store.exportAll(), null, 1), `גיבוי דיווח שעות ${todayISO()}.json`, 'application/json') }, icon('download'), ' שמירת גיבוי'),
        h('button', { class: 'btn ghost', onclick: () => fileInput.click() }, 'שחזור מגיבוי'),
        fileInput)));
  }

  clear(ctx.main, h('section', { class: 'page-head row' }, h('h1', {}, 'פרופיל'), saver.indicator), h('div', { class: 'grid-2' }, cards));
}

// ---------- הפעלה ----------

async function start() {
  // קישורים מהמייל: #/verify/<token> או #/reset/<token>
  const link = location.hash.match(/^#\/(verify|reset)\/([\w-]+)/);
  if (link && ctx.store.mode === 'server') {
    window.history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    showAuth({ mode: link[1], token: link[2] });
    return;
  }
  const me = await ctx.store.me();
  if (!me) {
    showAuth();
    return;
  }
  ctx.user = me.user;
  ctx.settings = me.settings;
  ctx.pending = me.pending || 0;
  renderShell();
  route();
}

async function boot() {
  try {
    ctx.store = await connect();
    window.addEventListener('hashchange', () => ctx.user && route());
    await start();
  } catch (err) {
    clear(app, h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'שגיאה בטעינה'), h('p', {}, err.message))));
  }
}

boot();
