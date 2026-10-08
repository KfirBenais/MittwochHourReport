// מסך היסטוריה: כל החודשים, סטטוס שליחה, סיכומים והורדת אקסל לכל חודש.

import {
  monthLabel, shiftMonth, todayISO, ymOf, MONTH_NAMES,
} from './calendar.js';
import { validate, summarize, fmtMin } from './report.js';
import { profileForReport, settingsForReport } from './defaults.js';
import {
  h, clear, icon, formatDays, toast,
} from './ui.js';
import { downloadExcel } from './send.js';
import { reportStatus } from './month.js';

export async function showHistory(ctx) {
  const { store, main } = ctx;
  const nav = ctx.nav;
  clear(main, h('div', { class: 'loading' }, 'טוען…'));
  const all = await store.allReports();
  if (ctx.nav !== nav) return;
  const today = todayISO();
  const curYm = ymOf(today);

  // טווח: מהחודש הראשון שיש בו נתונים (או חודש ההרשמה) ועד החודש הנוכחי / האחרון שמולא
  const keys = Object.keys(all).filter((k) => Object.keys(all[k]?.days || {}).length || all[k]?.sentAt).sort();
  let first = keys[0] || curYm;
  if (ctx.user.createdAt) first = [first, ymOf(ctx.user.createdAt.slice(0, 10))].sort()[0];
  const last = [curYm, keys.at(-1) || curYm].sort().at(-1);
  const months = [];
  for (let ym = last; ym >= first; ym = shiftMonth(ym, -1)) months.push(ym);

  const rowsByYear = new Map();
  for (const ym of months) {
    const report = all[ym] || { ym, days: {}, sentAt: null };
    const profile = profileForReport(ctx.user.profile, report);
    const days = report.days || {};
    const filled = Object.values(days).filter((d) => d.type).length;
    const s = summarize(ym, days, profile, ctx.settings.special);
    const errors = filled ? validate(ym, days, ctx.settings, profile, { uptoISO: ym === curYm ? today : null }).filter((i) => i.level === 'error').length : 0;
    const st = filled || report.sentAt ? reportStatus(report) : { cls: 'empty', text: 'לא מולא' };
    const notSent = !report.sentAt && ym < curYm;
    const y = ym.slice(0, 4);
    if (!rowsByYear.has(y)) rowsByYear.set(y, []);
    rowsByYear.get(y).push({ ym, report, profile, s, filled, errors, st, notSent });
  }

  const sections = [...rowsByYear].map(([year, rows]) => {
    const tot = rows.reduce((a, r) => ({
      net: a.net + r.s.netMin, vac: a.vac + r.s.vacation, sick: a.sick + r.s.sick + r.s.familySick, sent: a.sent + (r.report.sentAt ? 1 : 0),
    }), { net: 0, vac: 0, sick: 0, sent: 0 });
    return h('section', { class: 'card table-wrap history' },
      h('div', { class: 'history-head' },
        h('h2', {}, year),
        h('div', { class: 'muted small' }, `${fmtMin(tot.net)} שעות · ${formatDays(tot.vac)} ימי חופש · ${formatDays(tot.sick)} ימי מחלה · נשלחו ${tot.sent} חודשים`)),
      h('table', { class: 'team' },
        h('thead', {}, h('tr', {}, ['חודש', 'שעות בפועל', 'ימי עבודה', 'חופש', 'מחלה', 'לטיפול', 'סטטוס', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.notSent ? 'not-sent' : '' },
          h('td', {}, h('a', { class: 'strong', href: `#/month/${r.ym}` }, MONTH_NAMES[Number(r.ym.slice(5)) - 1]), r.ym === curYm ? h('span', { class: 'today-tag' }, 'החודש') : null),
          h('td', { class: 'num strong' }, r.filled ? fmtMin(r.s.netMin) : '—'),
          h('td', { class: 'num' }, r.filled ? String(r.s.workDays) : '—'),
          h('td', { class: 'num' }, r.filled ? formatDays(r.s.vacation) : '—'),
          h('td', { class: 'num' }, r.filled ? formatDays(r.s.sick + r.s.familySick) : '—'),
          h('td', { class: 'num' }, r.errors ? h('span', { class: 'pill changed' }, String(r.errors)) : r.filled ? h('span', { class: 'ok' }, '✓') : ''),
          h('td', {}, h('span', { class: `pill ${r.notSent && r.filled ? 'changed' : r.st.cls}` }, r.notSent && r.filled ? 'לא נשלח' : r.st.text)),
          h('td', { class: 'actions' },
            r.notSent ? h('button', {
              class: 'btn ghost small',
              title: 'אם הדוח כבר נשלח בלי האתר',
              onclick: async () => {
                await ctx.store.markSent(r.ym, { manual: true });
                toast(`${monthLabel(r.ym)} סומן כנשלח`, 'success');
                showHistory(ctx);
              },
            }, icon('check', 14), ' סמן כנשלח') : null,
            h('a', { class: 'btn ghost small', href: `#/month/${r.ym}` }, 'פתיחה'),
            r.filled ? h('button', {
              class: 'btn ghost small',
              title: r.report.snapshot ? 'הקובץ ייווצר בדיוק כמו שנשלח' : 'הורדת קובץ האקסל',
              onclick: () => downloadExcel({ ...ctx, settings: settingsForReport(ctx.settings, r.report) }, { ym: r.ym, days: r.report.days, profile: r.profile }),
            }, icon('download', 14), ' אקסל') : null))))));
  });

  const unsent = [...rowsByYear.values()].flat().filter((r) => r.notSent && r.filled);
  clear(main,
    h('section', { class: 'page-head' },
      h('h1', {}, 'היסטוריה'),
      h('p', { class: 'muted' }, 'כל החודשים שלך. אפשר לפתוח כל חודש, לתקן, להוריד אקסל או לשלוח שוב. חודש שכבר נשלח ייווצר עם הפרטים שהיו בזמן השליחה.')),
    unsent.length ? h('div', { class: 'banner' }, icon('bell', 22),
      h('div', { class: 'banner-text' }, h('strong', {}, 'שימו לב: '), `${unsent.length === 1 ? 'חודש אחד לא נשלח' : `${unsent.length} חודשים לא נשלחו`} – ${unsent.map((r) => monthLabel(r.ym)).join(', ')}.`)) : null,
    sections);
}
