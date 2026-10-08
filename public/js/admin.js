// מסכי ניהול: לוח צוות והגדרות.

import { monthLabel, shiftMonth, todayISO, ymOf, KIND_LABELS } from './calendar.js';
import { fmtMin } from './report.js';
import { POLICY_LABELS, profileForReport, settingsForReport } from './defaults.js';
import {
  h, clear, icon, toast, modal, confirmDialog, formatDays, normalizeTime, formatDateTime, autosaver,
} from './ui.js';
import { downloadExcel } from './send.js';
import { buildSubject, buildFileName } from './email.js';
import { reportStatus } from './month.js';

// ---------- לוח צוות ----------

export async function showTeam(ctx, ym) {
  const { store, main } = ctx;
  // גם רענון מתוך המסך (אחרי אישור / קישור איפוס) – רק אם עדיין נמצאים במסך הצוות
  const stillHere = () => /^#\/team(\/|$)/.test(location.hash);
  if (!stillHere()) return;
  const nav = ctx.nav;
  clear(main, h('div', { class: 'loading' }, 'טוען…'));
  const members = await store.team(ym);
  if (ctx.nav !== nav || !stillHere()) return;
  const curYm = ymOf(todayISO());
  const sent = members.filter((m) => m.sentAt).length;

  const table = h('table', { class: 'team' },
    h('thead', {}, h('tr', {},
      ['שם', 'שעות בפועל', 'ימי עבודה', 'חופש', 'מחלה', 'לטיפול', 'סטטוס', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, members.map((m) => {
      const st = m.filledDays || m.sentAt ? reportStatus(m) : { cls: 'empty', text: 'לא התחיל' };
      return h('tr', {},
        h('td', {}, h('div', { class: 'strong' }, m.fullName), h('div', { class: 'muted small', dir: 'ltr' }, m.email || m.username)),
        h('td', { class: 'num strong' }, fmtMin(m.summary.netMin)),
        h('td', { class: 'num' }, String(m.summary.workDays)),
        h('td', { class: 'num' }, formatDays(m.summary.vacation)),
        h('td', { class: 'num' }, formatDays(m.summary.sick + m.summary.familySick)),
        h('td', { class: 'num' }, !m.filledDays ? '—' : m.errors ? h('span', { class: 'pill changed' }, String(m.errors)) : h('span', { class: 'ok' }, '✓')),
        h('td', {}, h('span', { class: `pill ${st.cls}` }, st.text)),
        h('td', {}, h('button', {
          class: 'btn ghost small',
          title: 'הורדת קובץ האקסל של העובד',
          onclick: async () => {
            const { user, report } = await store.memberReport(m.id, ym);
            await downloadExcel({ ...ctx, settings: settingsForReport(ctx.settings, report) }, { ym, days: report.days || {}, profile: profileForReport(user.profile, report) });
          },
        }, icon('download', 14), ' אקסל')));
    })));

  const inviteUrl = `${location.origin}${location.pathname}`;
  const code = ctx.settings.teamCode;
  const inviteText = `היי! נכנסים לאתר דיווח השעות כאן: ${inviteUrl}${code ? `\nקוד צוות להרשמה: ${code}` : ''}`;

  const approve = async (m) => {
    await store.approveUser(m.id);
    toast(`${m.fullName} אושר/ה ויכול/ה להתחבר`, 'success');
    refreshPending(ctx);
    showTeam(ctx, ym);
  };

  // בקשות שמחכות למנהל: "שכחתי סיסמה" ומשתמשים שממתינים לאישור
  const requests = members.filter((m) => m.resetRequestedAt || !m.approved || !m.verified);
  const requestsCard = requests.length ? h('section', { class: 'card requests' },
    h('h2', {}, icon('bell'), ` בקשות שמחכות לך (${requests.length})`),
    h('ul', { class: 'members' }, requests.map((m) => h('li', {},
      h('div', {},
        h('div', { class: 'strong' }, m.fullName),
        h('div', { class: 'muted small' }, m.resetRequestedAt
          ? `ביקש/ה איפוס סיסמה · ${formatDateTime(m.resetRequestedAt)}`
          : 'נרשם/ה וממתין/ה לאישור')),
      h('div', { class: 'member-actions' },
        m.resetRequestedAt ? h('button', { class: 'btn primary small', onclick: () => sendResetLink(ctx, m, () => showTeam(ctx, ym)) }, icon('mail', 14), ' שליחת קישור איפוס') : null,
        !m.approved || !m.verified ? h('button', { class: 'btn primary small', onclick: () => approve(m) }, 'אישור') : null))))) : null;

  const manage = h('section', { class: 'card' },
    h('h2', {}, icon('users'), ' חברי הצוות'),
    h('div', { class: 'invite' },
      h('div', {},
        h('div', { class: 'strong' }, 'הזמנת חברי צוות'),
        h('div', { class: 'muted small' }, code ? `קוד הצוות: ${code}` : `כל מי שיש לו מייל @${ctx.store.health?.emailDomain || 'ncr.co.il'} יכול להירשם בעצמו.`)),
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(inviteText);
            toast('ההזמנה הועתקה – אפשר להדביק בוואטסאפ / מייל', 'success');
          } catch {
            modal({ title: 'הזמנה', body: h('textarea', { rows: 3, readonly: true }, inviteText) });
          }
        },
      }, 'העתקת הזמנה')),
    h('ul', { class: 'members' }, members.map((m) => h('li', {},
      h('div', {},
        h('div', {}, h('span', { class: 'strong' }, m.fullName),
          m.isAdmin ? h('span', { class: 'pill sent' }, 'מנהל') : null,
          m.approved && m.verified ? null : h('span', { class: 'pill changed' }, 'ממתין לאישור')),
        h('div', { class: 'muted small contact' },
          h('a', { href: `mailto:${m.email}`, dir: 'ltr' }, m.email || m.username),
          m.phone ? h('a', { href: `tel:${m.phone}`, dir: 'ltr' }, m.phone) : null)),
      h('div', { class: 'member-actions' },
        m.approved && m.verified ? null : h('button', { class: 'btn small', onclick: () => approve(m) }, 'אישור'),
        h('button', { class: 'btn ghost small', onclick: () => sendResetLink(ctx, m, () => showTeam(ctx, ym)) }, 'קישור איפוס סיסמה'),
        m.id !== ctx.user.id ? h('button', {
          class: 'btn ghost small',
          onclick: async () => {
            try {
              await store.setAdmin(m.id, !m.isAdmin);
              showTeam(ctx, ym);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }, m.isAdmin ? 'הסרת ניהול' : 'הגדרה כמנהל') : null,
        m.id !== ctx.user.id ? h('button', {
          class: 'btn ghost small danger-text',
          onclick: async () => {
            if (!await confirmDialog('מחיקת משתמש', `למחוק את ${m.fullName} וכל הדוחות שלו? אי אפשר לבטל.`, 'מחיקה', true)) return;
            await store.deleteUser(m.id);
            showTeam(ctx, ym);
          },
        }, 'מחיקה') : null)))));

  clear(main,
    h('section', { class: 'month-head' },
      h('div', { class: 'month-nav' },
        h('a', { class: 'icon-btn', href: `#/team/${shiftMonth(ym, -1)}`, 'aria-label': 'החודש הקודם' }, icon('prev')),
        h('div', { class: 'month-title' }, h('h1', {}, `הצוות – ${monthLabel(ym)}`), h('div', { class: 'muted small' }, `${sent} מתוך ${members.length} שלחו`)),
        h('a', { class: 'icon-btn', href: `#/team/${shiftMonth(ym, 1)}`, 'aria-label': 'החודש הבא' }, icon('next')),
        ym !== curYm ? h('a', { class: 'btn ghost small', href: `#/team/${curYm}` }, 'לחודש הנוכחי') : null)),
    requestsCard,
    h('section', { class: 'card table-wrap' }, table),
    manage);
}

/** מעדכן את מספר הבקשות שמוצג ליד "הצוות" בתפריט */
async function refreshPending(ctx) {
  try {
    const me = await ctx.store.me();
    ctx.pending = me?.pending || 0;
    const link = document.querySelector('[data-route="team"]');
    link?.querySelector('.badge')?.remove();
    if (ctx.pending && link) link.append(h('span', { class: 'badge' }, String(ctx.pending)));
  } catch {
    // לא קריטי
  }
}

/**
 * קישור איפוס סיסמה חד-פעמי (24 שעות). המנהל שולח אותו מהאאוטלוק שלו (או מעתיק ל-Teams/וואטסאפ) –
 * בלי שרת מייל ובלי שהמנהל יודע את הסיסמה.
 */
async function sendResetLink(ctx, m, onDone) {
  let r;
  try {
    r = await ctx.store.adminResetLink(m.id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  refreshPending(ctx);
  const url = `${location.origin}${location.pathname}#/reset/${r.token}`;
  const subject = 'קישור לבחירת סיסמה חדשה – אתר דיווח השעות';
  const text = `היי ${m.fullName},\n\nזה הקישור לבחירת סיסמה חדשה באתר דיווח השעות.\nהקישור חד-פעמי ובתוקף ${r.hours} שעות:\n${url}\n\n${ctx.user.fullName}`;
  const mailto = `mailto:${m.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const input = h('input', { type: 'text', dir: 'ltr', readonly: true, value: url, onfocus: (e) => e.target.select() });
  modal({
    title: `איפוס סיסמה – ${m.fullName}`,
    body: h('div', {},
      h('p', {}, `נוצר קישור חד-פעמי לבחירת סיסמה חדשה (בתוקף ${r.hours} שעות). שולחים אותו אל ${m.fullName} – הכי פשוט במייל מהאאוטלוק שלך:`),
      input,
      h('p', { class: 'muted small' }, 'רק מי שמקבל את הקישור יכול לבחור סיסמה – הסיסמה החדשה לא מוצגת לאף אחד אחר.')),
    actions: [
      h('a', { class: 'btn primary', href: mailto }, icon('mail'), ' פתיחת מייל באאוטלוק'),
      h('button', {
        class: 'btn ghost',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast('הקישור הועתק – אפשר להדביק ב-Teams / וואטסאפ', 'success');
          } catch {
            input.focus();
          }
        },
      }, 'העתקת הקישור'),
    ],
    onClose: onDone,
  });
}

// ---------- הגדרות ----------

export function showSettings(ctx) {
  const { main, store } = ctx;
  const s = structuredClone(ctx.settings);

  // כל שינוי נשמר אוטומטית (מועדים מיוחדים בלי שם/תאריך לא נשמרים עד שממלאים אותם)
  const saver = autosaver(async () => {
    ctx.settings = await store.saveSettings({ ...s, special: s.special.filter((x) => x.date && x.name.trim()) });
  });
  const changed = () => saver.change();
  const changedNow = () => saver.change({ now: true });
  window.onpagehide = () => saver.flush();

  const text = (key, label, hint, attrs = {}, preview = null) => {
    const prev = preview ? h('span', { class: 'preview' }) : null;
    const update = () => { if (prev) prev.textContent = `לדוגמה: ${preview()}`; };
    const el = h('label', { class: 'field' },
      h('span', {}, label),
      h('input', { type: 'text', value: s[key] || '', ...attrs, oninput: (e) => { s[key] = e.target.value; update(); changed(); } }),
      hint ? h('small', {}, hint, prev) : null);
    update();
    return el;
  };
  const sampleYm = shiftMonth(ymOf(todayISO()), -1);

  const time = (obj, key, label) => {
    const input = h('input', {
      type: 'text', class: 'time', inputmode: 'numeric', value: obj[key],
      onchange: () => {
        const v = normalizeTime(input.value);
        if (!v) {
          input.classList.add('invalid');
          return;
        }
        input.classList.remove('invalid');
        input.value = v;
        obj[key] = v;
        changedNow();
      },
    });
    return h('label', { class: 'field inline' }, h('span', {}, label), input);
  };

  const policy = (key, label) => h('label', { class: 'field' },
    h('span', {}, label),
    h('select', { onchange: (e) => { s.policies[key] = e.target.value; changedNow(); } },
      Object.entries(POLICY_LABELS).map(([v, l]) => h('option', { value: v, selected: s.policies[key] === v }, l))));

  const specialList = h('div', { class: 'special-list' });
  const renderSpecial = () => clear(specialList,
    s.special.length ? null : h('p', { class: 'muted small' }, 'אין מועדים מיוחדים.'),
    s.special.map((sp, i) => h('div', { class: 'special-row' },
      h('input', { type: 'text', class: 'sp-name', value: sp.name, placeholder: 'שם המועד (למשל: יום חברה)', 'aria-label': 'שם המועד', oninput: (e) => { sp.name = e.target.value; changed(); } }),
      h('input', { type: 'date', value: sp.date, 'aria-label': 'תאריך', onchange: (e) => { sp.date = e.target.value; changedNow(); } }),
      h('select', { 'aria-label': 'סוג', onchange: (e) => { sp.kind = e.target.value; changedNow(); } },
        Object.entries(KIND_LABELS).map(([v, l]) => h('option', { value: v, selected: sp.kind === v }, v === 'holiday' ? 'חג / יום חופש' : l))),
      h('button', { class: 'icon-btn', 'aria-label': 'הסרה', onclick: () => { s.special.splice(i, 1); renderSpecial(); changedNow(); } }, icon('trash', 16)))),
    h('button', { class: 'btn ghost small', onclick: () => { s.special.push({ date: todayISO(), name: '', kind: 'holiday' }); renderSpecial(); } }, icon('plus', 14), ' הוספת מועד'));
  renderSpecial();

  clear(main,
    h('section', { class: 'page-head row' }, h('h1', {}, 'הגדרות'), saver.indicator),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h2', {}, icon('mail'), ' המייל'),
        text('recipientEmail', 'נמען', 'לשם נשלח הדיווח', { dir: 'ltr' }),
        text('recipientName', 'שם הנמען בברכה', 'יופיע ב"היי ___"'),
        text('ccEmail', 'עותק (CC)', 'אופציונלי, כמה כתובות מופרדות בפסיק', { dir: 'ltr' }),
        text('subjectTemplate', 'נושא המייל', 'משתנים: {month} {year} {name}', {}, () => buildSubject(s, ctx.user.profile, sampleYm)),
        text('fileTemplate', 'שם קובץ האקסל', 'משתנים: {month} {year} {name}', {}, () => buildFileName(s, ctx.user.profile, sampleYm))),
      h('section', { class: 'card' },
        h('h2', {}, icon('calendar'), ' ימים מיוחדים'),
        h('p', { class: 'muted small' }, 'מה "מילוי אוטומטי" עושה בימים האלה (תמיד אפשר לשנות ידנית בכל יום):'),
        policy('erev', 'ערב חג'),
        policy('cholhamoed', 'חול המועד'),
        policy('fast', 'תשעה באב'),
        h('div', { class: 'inline-fields' }, h('span', {}, 'יום קצר:'), time(s.shortDay, 'start', 'מ-'), time(s.shortDay, 'end', 'עד'))),
      h('section', { class: 'card' },
        h('h2', {}, icon('bell'), ' מועדים מיוחדים'),
        h('p', { class: 'muted small' }, 'ימים שאינם בלוח העברי: בחירות, יום חברה, חופשה מרוכזת... הם יופיעו כהתראה במסך החודש.'),
        specialList),
      store.mode === 'server' && store.health?.mailEnabled ? mailCard(ctx) : null,
      h('section', { class: 'card' },
        h('h2', {}, icon('gear'), ' כללי'),
        text('companyName', 'שם החברה (בראש האקסל)'),
        store.mode === 'server' ? [
          h('h3', {}, 'הרשמה'),
          h('p', { class: 'muted small' }, `נרשמים רק עם מייל @${store.health?.emailDomain || 'ncr.co.il'}, ונכנסים מיד.`),
          text('teamCode', 'קוד צוות (לא חובה)', 'אם ממלאים – מי שנרשם צריך להזין את הקוד. ריק = לא נדרש.'),
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: !!s.requireApproval, onchange: (e) => { s.requireApproval = e.target.checked; changedNow(); } }),
            h('span', {}, 'משתמש חדש נכנס רק אחרי אישור שלי')),
        ] : null)));
}

// כרטיס בדיקת שליחת מיילים מהשרת (איפוס סיסמה / אימות הרשמה)
function mailCard(ctx) {
  const { store } = ctx;
  const status = h('div', { class: 'muted small' }, 'בודק…');
  const to = h('input', { type: 'email', dir: 'ltr', value: ctx.user.email || '', 'aria-label': 'כתובת לבדיקה' });
  const result = h('div', { class: 'small' });
  const btn = h('button', {
    class: 'btn',
    onclick: async () => {
      btn.disabled = true;
      clear(result, 'שולח…');
      try {
        const r = await store.testMail(to.value.trim());
        clear(result, h('span', { class: 'ok' }, `✓ נשלח ל-${r.to}. אם המייל הגיע – הכול מוכן.`));
      } catch (err) {
        clear(result, h('span', { class: 'danger-text' }, err.message));
      } finally {
        btn.disabled = false;
      }
    },
  }, icon('mail', 16), ' שליחת מייל בדיקה');
  store.mailStatus().then((m) => {
    clear(status, m.enabled
      ? [h('span', { class: 'ok' }, '✓ פעיל'), ` – דרך ${m.info.host}:${m.info.port}, מאת ${m.info.from}`]
      : [h('span', { class: 'danger-text' }, 'כבוי'), ' – כדי להפעיל: למלא את החלק mail בקובץ config.json בשרת ולהפעיל את השרת מחדש. עד אז "שכחתי סיסמה" עובר דרך מנהל הצוות.']);
    status.append(h('div', {}, `כתובת האתר בקישורים: ${m.publicUrl} · הרשמה רק עם @${m.emailDomain}`));
  }).catch(() => clear(status, ''));
  return h('section', { class: 'card' },
    h('h2', {}, icon('inbox'), ' מיילים מהשרת'),
    h('p', { class: 'muted small' }, 'לאיפוס סיסמה ולאימות הרשמה.'),
    status,
    h('div', { class: 'inline-fields test-mail' }, to, btn),
    result);
}
