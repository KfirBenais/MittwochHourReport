// מסך הדוח החודשי – מילוי שעות, התראות על חגים, סיכום ושליחה.

import {
  monthDays, weekday, isWeekend, eventsOn, primaryEvent, monthLabel, shiftMonth, formatShort, hebrewDateLabel,
  WEEKDAY_LETTERS, WEEKDAY_NAMES, ATTENTION_KINDS, KIND_LABELS, todayISO, ymOf, firstWorkday, monthEvents, groupEvents, parseISO,
} from './calendar.js';
import {
  DAY_TYPES, TYPE_BY_ID, calcDay, fmtMin, validate, summarize, autoFill, workDay, shortDay, offDay,
} from './report.js';
import {
  h, clear, icon, toast, confirmDialog, debounce, normalizeTime, formatDateTime, formatDays,
} from './ui.js';
import { openSendDialog, downloadExcel } from './send.js';
import { profileForReport, settingsForReport } from './defaults.js';

export function reportStatus(report) {
  if (!report?.sentAt) return { cls: 'draft', text: 'טיוטה – טרם נשלח' };
  const changed = report.updatedAt && new Date(report.updatedAt) - new Date(report.sentAt) > 60000;
  if (changed) return { cls: 'changed', text: `עודכן אחרי השליחה (${formatDateTime(report.sentAt)}) – כדאי לשלוח שוב` };
  return { cls: 'sent', text: `נשלח ${formatDateTime(report.sentAt)}` };
}

export async function showMonth(ctx, ym) {
  const { store, main } = ctx;
  const settings = () => ctx.settings;
  // חודש שכבר נשלח משתמש בפרטים (שם, הפסקה, שם החברה) כפי שהיו בזמן השליחה
  const profile = () => profileForReport(ctx.user.profile, current);
  const excelCtx = () => ({ ...ctx, settings: settingsForReport(ctx.settings, current) });
  const today = todayISO();
  const curYm = ymOf(today);

  const nav = ctx.nav;
  clear(main, h('div', { class: 'loading' }, 'טוען…'));
  const prevYm = shiftMonth(curYm, -1);
  const [report, yearMonths] = await Promise.all([
    store.getReport(ym),
    store.yearReports(ym.slice(0, 4)).catch(() => ({})),
  ]);
  const prevReport = ym === prevYm ? report : await store.getReport(prevYm).catch(() => null);
  if (ctx.nav !== nav) return null;

  let days = { ...(report.days || {}) };
  let current = report;
  const rows = new Map();
  let saveState = 'saved';

  // ---------- שמירה ----------

  const saveIndicator = h('span', { class: 'save-state' });
  const setSaveState = (s) => {
    saveState = s;
    saveIndicator.className = `save-state ${s}`;
    clear(saveIndicator,
      s === 'saving' ? 'שומר…' : s === 'error' ? [icon('alert', 14), ' לא נשמר – בודק שוב…'] : [icon('check', 14), ' נשמר']);
  };
  setSaveState('saved');

  const doSave = async () => {
    setSaveState('saving');
    try {
      current = await store.saveReport(ym, days);
      setSaveState('saved');
      refreshStatus();
    } catch (err) {
      setSaveState('error');
      if (err.status === 401) {
        toast('החיבור פג – יש להתחבר מחדש', 'error');
        return;
      }
      setTimeout(() => save(), 5000);
    }
  };
  const save = debounce(doSave, 600);
  window.onbeforeunload = () => (saveState !== 'saved' ? true : undefined);

  // ---------- כותרת ----------

  const statusPill = h('span', { class: 'pill' });
  const refreshStatus = () => {
    const st = reportStatus(current);
    statusPill.className = `pill ${st.cls}`;
    clear(statusPill, st.text);
  };
  refreshStatus();

  const dates = monthDays(ym);
  const hebRange = `${hebrewDateLabel(dates[0], true)} – ${hebrewDateLabel(dates[dates.length - 1], true)}`;

  const head = h('section', { class: 'month-head' },
    h('div', { class: 'month-nav' },
      h('a', { class: 'icon-btn', href: `#/month/${shiftMonth(ym, -1)}`, title: 'החודש הקודם', 'aria-label': 'החודש הקודם' }, icon('prev')),
      h('div', { class: 'month-title' },
        h('h1', {}, monthLabel(ym)),
        h('div', { class: 'muted small' }, hebRange)),
      h('a', { class: 'icon-btn', href: `#/month/${shiftMonth(ym, 1)}`, title: 'החודש הבא', 'aria-label': 'החודש הבא' }, icon('next')),
      ym !== curYm ? h('a', { class: 'btn ghost small', href: `#/month/${curYm}` }, 'לחודש הנוכחי') : null),
    h('div', { class: 'month-meta' }, statusPill, saveIndicator));

  // ---------- באנר תזכורת ----------

  const banner = h('div');
  const renderBanner = () => {
    clear(banner);
    const fw = firstWorkday(curYm, settings().special);
    const dayOfMonth = parseISO(today).d;
    const prev = ym === prevYm ? current : prevReport;
    if (today < fw || dayOfMonth > 20 || prev?.sentAt) return;
    const isToday = today === fw;
    banner.append(h('div', { class: 'banner' },
      icon('bell', 22),
      h('div', { class: 'banner-text' },
        h('strong', {}, isToday ? 'היום יום העבודה הראשון בחודש!' : 'תזכורת:'),
        ` הגיע הזמן לשלוח ל${settings().recipientName} את דיווח השעות של ${monthLabel(prevYm)}.`),
      ym === prevYm
        ? h('button', { class: 'btn primary', onclick: () => send() }, icon('mail'), ` שליחה ל${settings().recipientName}`)
        : h('a', { class: 'btn primary', href: `#/month/${prevYm}` }, `לדוח ${monthLabel(prevYm)}`)));
  };

  // ---------- סטטיסטיקה ----------

  const stats = h('section', { class: 'stats' });
  const yearTotals = (key, extra) => {
    let total = 0;
    for (const [k, r] of Object.entries(yearMonths)) {
      if (k === ym) continue;
      total += summarize(k, r.days || {}, profile())[key];
    }
    return total + extra;
  };
  const renderStats = (issues) => {
    const s = summarize(ym, days, profile());
    const errors = issues.filter((i) => i.level === 'error').length;
    const card = (value, label, sub, cls = '') => h('div', { class: `stat ${cls}` },
      h('div', { class: 'stat-value' }, value),
      h('div', { class: 'stat-label' }, label),
      sub ? h('div', { class: 'stat-sub' }, sub) : null);
    clear(stats,
      card(fmtMin(s.netMin), 'שעות בפועל', `ברוטו ${fmtMin(s.grossMin)}`, 'total'),
      card(String(s.workDays), 'ימי עבודה'),
      card(formatDays(s.vacation), 'ימי חופש', `סה״כ השנה: ${formatDays(yearTotals('vacation', s.vacation))}`),
      card(formatDays(s.sick + s.familySick), 'ימי מחלה', `סה״כ השנה: ${formatDays(yearTotals('sick', s.sick) + yearTotals('familySick', s.familySick))}`),
      card(errors ? String(errors) : '✓', errors ? 'ימים לטיפול' : 'הכול תקין', null, errors ? 'bad' : 'good'));
  };

  // ---------- מועדים בחודש ----------

  const groups = groupEvents(monthEvents(ym, settings().special));
  const eventsBar = groups.length ? h('section', { class: 'events' },
    h('span', { class: 'events-title' }, icon('calendar', 16), ' מועדים החודש:'),
    groups.map((g) => h('button', {
      class: `tag tag-${g.kind}`,
      title: KIND_LABELS[g.kind],
      onclick: () => rows.get(g.from)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    }, `${g.name} · ${formatShort(g.from)}${g.to !== g.from ? `–${formatShort(g.to)}` : ''}`))) : null;

  // ---------- סרגל פעולות ----------

  const toolbar = h('section', { class: 'toolbar' },
    h('button', { class: 'btn', onclick: () => fillMonth(), title: 'ממלא ימי עבודה רגילים, חגים וערבי חג לפי ההגדרות. לא דורס ימים שכבר מולאו.' },
      icon('magic'), ' מילוי אוטומטי'),
    h('button', { class: 'btn ghost', onclick: () => resetMonth() }, icon('trash'), ' ניקוי'),
    h('button', { class: 'btn ghost', onclick: () => downloadExcel(excelCtx(), { ym, days, profile: profile() }) }, icon('download'), ' אקסל'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary big', onclick: () => send() }, icon('mail'), ` שליחה ל${settings().recipientName}`));

  // ---------- רשימת הימים ----------

  const list = h('section', { class: 'days', role: 'table', 'aria-label': `דיווח שעות ${monthLabel(ym)}` },
    h('div', { class: 'day-row header', role: 'row' },
      h('div', { role: 'columnheader' }, 'תאריך'),
      h('div', { role: 'columnheader' }, 'סוג יום'),
      h('div', { role: 'columnheader' }, 'כניסה – יציאה'),
      h('div', { role: 'columnheader' }, 'אין הפסקה'),
      h('div', { role: 'columnheader' }, 'הערה (תופיע באקסל)'),
      h('div', { role: 'columnheader', class: 'num' }, 'ש״ע בפועל')));

  const uptoISO = () => (ym < curYm ? null : ym > curYm ? `${ym}-00` : today);
  let issues = [];

  function refreshComputed() {
    issues = validate(ym, days, settings(), profile(), { uptoISO: uptoISO() });
    renderStats(issues);
    for (const [iso, row] of rows) updateRowComputed(iso, row);
  }

  function mutate(iso, next, { rerender = false } = {}) {
    if (next == null) delete days[iso];
    else days[iso] = next;
    if (rerender) replaceRow(iso);
    refreshComputed();
    save();
  }

  function patch(iso, fields) {
    const d = { type: '', in1: '', out1: '', in2: '', out2: '', noBreak: false, note: '', ...(days[iso] || {}), ...fields };
    if (!d.type && !d.note) mutate(iso, null);
    else mutate(iso, d);
  }

  function setType(iso, type) {
    const prev = days[iso] || {};
    if (!type) {
      mutate(iso, prev.note && !Object.values(TYPE_BY_ID).some((t) => t.note && t.note === prev.note) ? { type: '', note: prev.note } : null, { rerender: true });
      return;
    }
    const t = TYPE_BY_ID[type];
    const ev = primaryEvent(iso, settings().special);
    const evName = ev && ev.kind !== 'info' ? ev.name : '';
    const autoNotes = new Set(['', evName, ...DAY_TYPES.map((x) => x.note)]);
    const note = autoNotes.has(prev.note || '') ? (type === 'work' || type === 'holiday' ? evName : t.note) : prev.note;
    const next = { in1: '', out1: '', in2: '', out2: '', noBreak: false, ...prev, type, note };
    if (t.hours === 'none') Object.assign(next, { in1: '', out1: '', in2: '', out2: '', noBreak: false });
    else if (!next.in1 && !next.out1) {
      if (type === 'work') Object.assign(next, { in1: profile().start, out1: profile().end });
      if (type === 'halfVacation' || type === 'halfSick') Object.assign(next, { in1: profile().start, out1: profile().halfDayEnd });
    }
    mutate(iso, next, { rerender: true });
  }

  function timeInput(iso, field, label) {
    const day = days[iso] || {};
    const input = h('input', {
      class: 'time', type: 'text', inputmode: 'numeric', maxlength: 5, placeholder: '--:--', value: day[field] || '',
      'aria-label': `${label} ${formatShort(iso)}`, dataset: { field },
      onchange: () => {
        const v = normalizeTime(input.value);
        if (v === null) {
          input.classList.add('invalid');
          toast('שעה לא תקינה. אפשר להקליד למשל 8, 0800, 8:00 או 16.45', 'error');
          return;
        }
        input.classList.remove('invalid');
        input.value = v;
        patch(iso, { [field]: v });
      },
      onfocus: () => input.select(),
    });
    return input;
  }

  function buildRow(iso) {
    const day = days[iso] || null;
    const type = day?.type || '';
    const t = TYPE_BY_ID[type];
    const evs = eventsOn(iso, settings().special);
    const ev = evs[0] || null;
    const weekend = isWeekend(iso);
    const showHours = t && t.hours !== 'none';
    const second = showHours && (day.in2 || day.out2 || rows.get(iso)?.dataset.second === '1');

    const select = h('select', {
      class: 'type', 'aria-label': `סוג יום ${formatShort(iso)}`, dataset: { field: 'type' },
      onchange: () => setType(iso, select.value),
    },
    h('option', { value: '' }, weekend ? 'סוף שבוע' : '— בחירה —'),
    DAY_TYPES.map((x) => h('option', { value: x.id, selected: x.id === type }, x.label)));
    select.value = type;

    const hours = showHours ? h('div', { class: 'hours' },
      h('div', { class: 'pair' },
        timeInput(iso, 'in1', 'כניסה'), h('span', { class: 'dash' }, '–'), timeInput(iso, 'out1', 'יציאה'),
        !second ? h('button', {
          class: 'icon-btn tiny', title: 'הוספת כניסה/יציאה נוספת (יום מפוצל)', 'aria-label': 'הוספת כניסה ויציאה נוספת',
          onclick: () => {
            row.dataset.second = '1';
            replaceRow(iso);
            rows.get(iso).querySelector('[data-field="in2"]')?.focus();
          },
        }, icon('plus', 14)) : null),
      second ? h('div', { class: 'pair' },
        timeInput(iso, 'in2', 'כניסה שנייה'), h('span', { class: 'dash' }, '–'), timeInput(iso, 'out2', 'יציאה שנייה'),
        h('button', {
          class: 'icon-btn tiny', title: 'הסרת הכניסה/יציאה הנוספת', 'aria-label': 'הסרת כניסה ויציאה נוספת',
          onclick: () => {
            row.dataset.second = '';
            patch(iso, { in2: '', out2: '' });
            replaceRow(iso);
          },
        }, icon('x', 14))) : null) : h('div', { class: 'hours empty' }, t ? 'ללא שעות' : '');

    const noBreak = showHours ? h('label', { class: 'check', title: 'בימים א-ה בהם אין צורך בקיזוז הפסקה (ערב חג / חוה״מ)' },
      h('input', { type: 'checkbox', checked: !!day.noBreak, dataset: { field: 'noBreak' }, onchange: (e) => patch(iso, { noBreak: e.target.checked }) }),
      h('span', {}, 'x')) : h('span');

    const note = h('input', {
      class: 'note', type: 'text', maxlength: 60, value: day?.note || '', placeholder: weekend ? '' : 'הערה',
      'aria-label': `הערה ${formatShort(iso)}`, dataset: { field: 'note' },
      oninput: () => patch(iso, { note: note.value }),
    });

    const dateCell = h('div', { class: 'date-cell' },
      h('div', { class: 'date-line' },
        h('span', { class: 'wd', title: WEEKDAY_NAMES[weekday(iso)] }, WEEKDAY_LETTERS[weekday(iso)]),
        h('span', { class: 'dnum' }, formatShort(iso)),
        iso === today ? h('span', { class: 'today-tag' }, 'היום') : null),
      h('div', { class: 'heb' }, hebrewDateLabel(iso)),
      evs.length ? h('div', { class: 'tags' }, evs.map((e) => h('span', { class: `tag tag-${e.kind}`, title: KIND_LABELS[e.kind] }, e.name))) : null);

    const row = h('div', {
      class: 'day-row', role: 'row', dataset: { iso },
    },
    dateCell,
    h('div', { class: 'cell-type' }, select),
    h('div', { class: 'cell-hours' }, hours),
    h('div', { class: 'cell-break' }, noBreak),
    h('div', { class: 'cell-note' }, note),
    h('div', { class: 'cell-net num' }, h('span', { class: 'net' })),
    h('div', { class: 'row-extra' }));
    row.classList.toggle('weekend', weekend);
    row.classList.toggle('holiday', ev?.kind === 'holiday');
    row.classList.toggle('is-today', iso === today);

    // פעולות מהירות לימים מיוחדים שלא מולאו
    if (ev && ATTENTION_KINDS.has(ev.kind) && !weekend) {
      const s = settings().shortDay;
      row.querySelector('.row-extra').append(h('div', { class: 'quick' },
        h('span', { class: 'quick-q' }, icon('alert', 16), ` ${ev.name} – מה היה ביום הזה?`),
        h('button', { class: 'chip', onclick: () => mutate(iso, shortDay(settings(), ev.name), { rerender: true }) }, `יום קצר ${s.start}–${s.end} (ללא הפסקה)`),
        h('button', { class: 'chip', onclick: () => mutate(iso, offDay(ev.name), { rerender: true }) }, `לא עבדתי – ${ev.name}`),
        h('button', { class: 'chip', onclick: () => mutate(iso, workDay(profile(), ev.name), { rerender: true }) }, 'יום מלא'),
        h('button', { class: 'chip', onclick: () => mutate(iso, { type: 'vacation', in1: '', out1: '', in2: '', out2: '', noBreak: false, note: 'חופש' }, { rerender: true }) }, 'חופש')));
    }
    row.querySelector('.row-extra').append(h('div', { class: 'row-issues' }));
    return row;
  }

  function updateRowComputed(iso, row) {
    const day = days[iso];
    const { net } = calcDay(iso, day, profile().breakMin);
    const netEl = row.querySelector('.net');
    netEl.textContent = day?.type && TYPE_BY_ID[day.type]?.hours !== 'none' ? fmtMin(net) : (day?.type ? '—' : '');
    const mine = issues.filter((i) => i.date === iso);
    const ev = primaryEvent(iso, settings().special);
    const pending = !day?.type && ev && ATTENTION_KINDS.has(ev.kind) && !isWeekend(iso);
    row.classList.toggle('attention', !!pending);
    row.classList.toggle('has-error', mine.some((i) => i.level === 'error') && !pending);
    row.classList.toggle('has-warn', mine.some((i) => i.level === 'warn'));
    row.classList.toggle('filled', !!day?.type);
    const quick = row.querySelector('.quick');
    if (quick) quick.hidden = !pending;
    const box = row.querySelector('.row-issues');
    clear(box, pending ? [] : mine.map((i) => h('div', { class: `issue ${i.level}` }, icon(i.level === 'error' ? 'alert' : 'clock', 14), ' ', i.msg.replace(/^[^–]+– /, ''))));
  }

  function replaceRow(iso) {
    const old = rows.get(iso);
    const focusField = old && old.contains(document.activeElement) ? document.activeElement.dataset.field : null;
    const second = old?.dataset.second;
    const row = buildRow(iso);
    if (second) row.dataset.second = second;
    rows.set(iso, row);
    if (old) old.replaceWith(row);
    updateRowComputed(iso, row);
    if (focusField) row.querySelector(`[data-field="${focusField}"]`)?.focus();
    return row;
  }

  for (const iso of dates) {
    const row = buildRow(iso);
    rows.set(iso, row);
    list.append(row);
  }

  // ---------- פעולות ----------

  async function fillMonth() {
    const res = autoFill(ym, days, settings(), profile());
    if (!res.filled && !res.pending.length) {
      toast('כל הימים כבר מולאו. אפשר לשנות כל יום ידנית.', 'info');
      return;
    }
    days = res.days;
    for (const iso of dates) replaceRow(iso);
    refreshComputed();
    save();
    const pend = res.pending.length;
    toast(pend
      ? `מולאו ${res.filled} ימים. ${pend} ימים מיוחדים (ערב חג / חוה״מ) מסומנים בכתום ומחכים לבחירה.`
      : `מולאו ${res.filled} ימים. נשאר רק לעדכן חופש / מחלה אם היו.`, pend ? 'warn' : 'success', 6000);
    if (pend) rows.get(res.pending[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function resetMonth() {
    if (!Object.keys(days).length) return;
    if (!await confirmDialog('ניקוי החודש', `למחוק את כל הנתונים של ${monthLabel(ym)}? אי אפשר לבטל.`, 'מחיקה', true)) return;
    days = {};
    for (const iso of dates) replaceRow(iso);
    refreshComputed();
    save();
  }

  async function send() {
    if (saveState !== 'saved') save.flush();
    await openSendDialog(excelCtx(), {
      ym,
      days,
      profile: profile(),
      onSent: (r) => {
        current = r;
        refreshStatus();
        renderBanner();
      },
      onJump: (iso) => {
        const row = rows.get(iso);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row?.classList.add('flash');
        setTimeout(() => row?.classList.remove('flash'), 1600);
      },
    });
  }

  // הערה כשהדוח נשלח עם פרטים שונים מהפרופיל הנוכחי
  const snap = current.snapshot;
  const cur = ctx.user.profile;
  const snapNote = snap && (snap.fullName !== cur.fullName || snap.breakMin !== cur.breakMin || (snap.companyName && snap.companyName !== ctx.settings.companyName))
    ? h('div', { class: 'snap-note' }, icon('file', 16),
      ` החודש נשלח עם הפרטים: שם "${snap.fullName}", הפסקה ${fmtMin(snap.breakMin)}. האקסל ייווצר בדיוק כמו שנשלח.`)
    : null;

  renderBanner();
  refreshComputed();
  clear(main, banner, head, snapNote, stats, eventsBar, toolbar, list);
  return { ym };
}
