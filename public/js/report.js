// מודל הדוח החודשי: סוגי ימים, חישוב שעות (זהה לנוסחאות בקובץ האקסל), מילוי אוטומטי ובדיקות תקינות.

import {
  monthDays, weekday, isWeekend, primaryEvent, formatShort, ATTENTION_KINDS, WEEKDAY_NAMES,
} from './calendar.js';

// hours: 'required' – חובה להזין שעות, 'optional' – אפשר, 'none' – יום היעדרות ללא שעות
export const DAY_TYPES = [
  { id: 'work', label: 'עבודה', hours: 'required', note: '' },
  { id: 'vacation', label: 'חופש', hours: 'none', note: 'חופש' },
  { id: 'halfVacation', label: 'חצי יום חופש', hours: 'required', note: 'חצי יום חופש' },
  { id: 'sick', label: 'מחלה', hours: 'none', note: 'מחלה' },
  { id: 'halfSick', label: 'חצי יום מחלה', hours: 'required', note: 'חצי יום מחלה' },
  { id: 'familySick', label: 'מחלת בן משפחה', hours: 'none', note: 'מחלת בן משפחה' },
  { id: 'reserve', label: 'מילואים', hours: 'none', note: 'מילואים' },
  { id: 'choice', label: 'יום בחירה', hours: 'none', note: 'יום בחירה' },
  { id: 'holiday', label: 'חג / מועד (לא עבדתי)', hours: 'none', note: '' },
  { id: 'other', label: 'אחר (לפרט בהערה)', hours: 'optional', note: '' },
];

export const TYPE_BY_ID = Object.fromEntries(DAY_TYPES.map((t) => [t.id, t]));

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function toMin(s) {
  if (!isTime(s)) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** דקות → "8:15" (כמו פורמט [h]:mm באקסל). ערך שלילי מוצג עם מינוס. */
export function fmtMin(min) {
  if (min == null) return '';
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

export function hasHours(day) {
  const t = TYPE_BY_ID[day?.type];
  return !!t && t.hours !== 'none';
}

/** היום כפי שייכתב לאקסל: שעות רק לסוגים שמאפשרים שעות */
export function effectiveDay(day) {
  if (!day || !day.type) return { in1: '', out1: '', in2: '', out2: '', noBreak: false, note: day?.note || '' };
  const withHours = hasHours(day);
  return {
    in1: withHours ? day.in1 || '' : '',
    out1: withHours ? day.out1 || '' : '',
    in2: withHours ? day.in2 || '' : '',
    out2: withHours ? day.out2 || '' : '',
    noBreak: withHours && !!day.noBreak,
    note: day.note || '',
  };
}

/**
 * חישוב שעות ליום – העתק של הנוסחאות בגיליון:
 *   H (ש"ע ברוטו) = (E-D)+(G-F)
 *   I (ש"ע בפועל) = IF(H>0, IF(OR(B>5, C="x"), H, H-$B$2), 0)   כאשר B = WEEKDAY (ראשון=1 ... שבת=7)
 */
export function calcDay(iso, day, breakMin = 30) {
  const e = effectiveDay(day);
  const pair = (a, b) => {
    const x = toMin(a);
    const y = toMin(b);
    return x != null && y != null ? y - x : 0;
  };
  const gross = pair(e.in1, e.out1) + pair(e.in2, e.out2);
  const excelWeekday = weekday(iso) + 1;
  let net = 0;
  if (gross > 0) net = excelWeekday > 5 || e.noBreak ? gross : gross - breakMin;
  return { gross, net };
}

export function emptyReport(ym) {
  return { ym, days: {}, sentAt: null, updatedAt: null };
}

/** יום עבודה רגיל לפי הפרופיל */
export function workDay(profile, note = '') {
  return { type: 'work', in1: profile.start, out1: profile.end, in2: '', out2: '', noBreak: false, note };
}

export function shortDay(settings, note = '') {
  return { type: 'work', in1: settings.shortDay.start, out1: settings.shortDay.end, in2: '', out2: '', noBreak: true, note };
}

export function offDay(note) {
  return { type: 'holiday', in1: '', out1: '', in2: '', out2: '', noBreak: false, note };
}

/** ההצעה האוטומטית ליום מסוים (או null אם צריך להשאיר לבחירת המשתמש) */
export function suggestDay(iso, settings, profile) {
  const ev = primaryEvent(iso, settings.special);
  const meaningful = ev && ev.kind !== 'info';
  if (isWeekend(iso)) return meaningful ? offDay(ev.name) : null;
  if (!ev || ev.kind === 'info') return workDay(profile);
  if (ev.kind === 'holiday') return offDay(ev.name);
  const policy = settings.policies[ev.kind] || 'ask';
  if (policy === 'short') return shortDay(settings, ev.name);
  if (policy === 'off') return offDay(ev.name);
  if (policy === 'full') return workDay(profile, ev.name);
  return null;
}

/**
 * מילוי אוטומטי: ממלא רק ימים ריקים (אלא אם overwrite).
 * מחזיר { days, filled, pending } – pending הם ימים מיוחדים שנשארו לבחירה.
 */
export function autoFill(ym, days, settings, profile, { overwrite = false } = {}) {
  const out = { ...days };
  let filled = 0;
  const pending = [];
  for (const iso of monthDays(ym)) {
    if (!overwrite && out[iso]?.type) continue;
    const s = suggestDay(iso, settings, profile);
    if (s) {
      out[iso] = s;
      filled++;
    } else if (!isWeekend(iso)) {
      const ev = primaryEvent(iso, settings.special);
      if (ev) pending.push(iso);
    }
  }
  return { days: out, filled, pending };
}

/**
 * בדיקות תקינות לפני שליחה.
 * מחזיר מערך של { date, level: 'error'|'warn', msg }
 * uptoISO – אם ניתן, ימים חסרים אחרי התאריך הזה לא ייחשבו שגיאה (לתצוגה שוטפת בזמן החודש).
 */
export function validate(ym, days, settings, profile, { uptoISO = null } = {}) {
  const issues = [];
  const push = (date, level, msg) => issues.push({ date, level, msg });
  for (const iso of monthDays(ym)) {
    const day = days[iso];
    const ev = primaryEvent(iso, settings.special);
    const label = `${WEEKDAY_NAMES[weekday(iso)]} ${formatShort(iso)}`;
    const future = uptoISO && iso > uptoISO;

    if (!day?.type) {
      if (isWeekend(iso) || future) continue;
      if (ev && ev.kind === 'holiday') continue;
      if (ev && ATTENTION_KINDS.has(ev.kind)) push(iso, 'error', `${label} – ${ev.name}: יש לבחור אם עבדת (יום קצר / לא עבדתי / חופש)`);
      else push(iso, 'error', `${label} – חסר דיווח (שעות או סיבת היעדרות)`);
      continue;
    }

    const t = TYPE_BY_ID[day.type];
    if (!t) {
      push(iso, 'error', `${label} – סוג יום לא מוכר`);
      continue;
    }

    if (t.hours !== 'none') {
      const pairs = [[day.in1, day.out1, 1], [day.in2, day.out2, 2]];
      let complete = 0;
      for (const [a, b, n] of pairs) {
        const hasA = !!a;
        const hasB = !!b;
        if (!hasA && !hasB) continue;
        if (hasA !== hasB || (hasA && !isTime(a)) || (hasB && !isTime(b))) {
          push(iso, 'error', `${label} – ${n === 1 ? 'כניסה/יציאה' : 'כניסה/יציאה שנייה'} לא מלאה`);
        } else if (toMin(b) <= toMin(a)) {
          push(iso, 'error', `${label} – שעת היציאה חייבת להיות אחרי שעת הכניסה`);
        } else complete++;
      }
      if (day.in2 && day.out1 && isTime(day.in2) && isTime(day.out1) && toMin(day.in2) < toMin(day.out1)) {
        push(iso, 'warn', `${label} – הכניסה השנייה לפני היציאה הראשונה`);
      }
      if (t.hours === 'required' && complete === 0 && !issues.some((i) => i.date === iso)) {
        push(iso, 'error', `${label} – חסרות שעות כניסה ויציאה`);
      }
      const { gross, net } = calcDay(iso, day, profile.breakMin);
      if (net < 0) push(iso, 'error', `${label} – משך העבודה קצר מזמן ההפסקה; סמן "אין הפסקה"`);
      if (gross > 14 * 60) push(iso, 'warn', `${label} – יום ארוך במיוחד (${fmtMin(gross)})`);
      if (ev && ev.kind === 'holiday' && gross > 0) push(iso, 'warn', `${label} – דיווחת שעות ב${ev.name}`);
    }

    if (day.type === 'other' && !day.note?.trim()) push(iso, 'error', `${label} – בסוג "אחר" יש לפרט בהערה`);
    if ((day.note || '').length > 60) push(iso, 'warn', `${label} – הערה ארוכה, ייתכן שלא תיראה במלואה באקסל`);
  }
  return issues;
}

/** הערה לחופש בחול המועד – נספר כחצי יום */
export const CHOLHAMOED_VACATION_NOTE = 'חצי יום חופש (חוה״מ)';

/**
 * כמה ימי חופש יום מסוים "עולה" (למעקב בסיכומים).
 * חול המועד הוא חצי יום עבודה – לכן יום בחוה"מ שלא עבדו בו ("לא עבדתי" או "חופש") נספר כחצי יום חופש.
 * חג וערב חג – לא נספרים.
 */
export function vacationValue(iso, day, special = []) {
  const cholhamoed = primaryEvent(iso, special)?.kind === 'cholhamoed';
  if (day?.type === 'vacation') return cholhamoed ? 0.5 : 1;
  if (day?.type === 'halfVacation') return 0.5;
  if (day?.type === 'holiday' && cholhamoed && !isWeekend(iso)) return 0.5;
  return 0;
}

/** סיכום חודשי */
export function summarize(ym, days, profile, special = []) {
  const s = {
    netMin: 0, grossMin: 0, workDays: 0, vacation: 0, sick: 0, familySick: 0, reserve: 0, choice: 0, holiday: 0, other: 0,
  };
  for (const iso of monthDays(ym)) {
    const day = days[iso];
    if (!day?.type) continue;
    const { gross, net } = calcDay(iso, day, profile.breakMin);
    s.grossMin += Math.max(gross, 0);
    s.netMin += net;
    if (net > 0) s.workDays++;
    switch (day.type) {
      case 'vacation':
      case 'halfVacation': s.vacation += vacationValue(iso, day, special); break;
      case 'sick': s.sick += 1; break;
      case 'halfSick': s.sick += 0.5; break;
      case 'familySick': s.familySick += 1; break;
      case 'reserve': s.reserve += 1; break;
      case 'choice': s.choice += 1; break;
      case 'holiday': {
        const v = vacationValue(iso, day, special);
        if (v) s.vacation += v; // "לא עבדתי" בחול המועד
        else if (!isWeekend(iso)) s.holiday += 1;
        break;
      }
      case 'other': s.other += 1; break;
      default: break;
    }
  }
  return s;
}

/** ניקוי וולידציה של מידע שמגיע מהלקוח (משמש גם בשרת) */
export function sanitizeDays(ym, days) {
  const valid = new Set(monthDays(ym));
  const out = {};
  if (!days || typeof days !== 'object') return out;
  for (const [iso, d] of Object.entries(days)) {
    if (!valid.has(iso) || !d || typeof d !== 'object') continue;
    const type = TYPE_BY_ID[d.type] ? d.type : '';
    if (!type && !d.note) continue;
    const time = (v) => (isTime(v) ? v : '');
    out[iso] = {
      type,
      in1: time(d.in1),
      out1: time(d.out1),
      in2: time(d.in2),
      out2: time(d.out2),
      noBreak: !!d.noBreak,
      note: String(d.note || '').slice(0, 120),
    };
  }
  return out;
}
