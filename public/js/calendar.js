// לוח עברי וחגי ישראל – פונקציות טהורות, רצות גם בדפדפן וגם ב-Node.
// כל התאריכים הם מחרוזות ISO בפורמט YYYY-MM-DD ומחושבים ב-UTC כדי להימנע מבעיות אזור זמן.

const DAY_MS = 86400000;

export const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// סוגי מועדים:
//   holiday    – חג / שבתון: לא יום עבודה
//   erev       – ערב חג: דורש החלטה (יום קצר / לא עובדים)
//   cholhamoed – חול המועד: דורש החלטה
//   fast       – תשעה באב: דורש החלטה (בדרך כלל יום קצר)
//   info       – מועד לידיעה בלבד (חנוכה, פורים, צומות...) – יום עבודה רגיל
export const KIND_LABELS = {
  holiday: 'חג',
  erev: 'ערב חג',
  cholhamoed: 'חול המועד',
  fast: 'תענית',
  info: 'מועד',
};

export const ATTENTION_KINDS = new Set(['erev', 'cholhamoed', 'fast']);

const pad = (n) => String(n).padStart(2, '0');

export function toISO(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function isoToMs(iso) {
  const { y, m, d } = parseISO(iso);
  return Date.UTC(y, m - 1, d);
}

function msToISO(ms) {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso, n) {
  return msToISO(isoToMs(iso) + n * DAY_MS);
}

/** 0 = ראשון ... 6 = שבת */
export function weekday(iso) {
  return new Date(isoToMs(iso)).getUTCDay();
}

/** ימי עבודה בישראל: ראשון–חמישי */
export function isWeekend(iso) {
  return weekday(iso) >= 5;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = daysInMonth(y, m);
  const out = [];
  for (let d = 1; d <= n; d++) out.push(toISO(y, m, d));
  return out;
}

export function ymOf(iso) {
  return iso.slice(0, 7);
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function formatShort(iso) {
  const { m, d } = parseISO(iso);
  return `${pad(d)}/${pad(m)}`;
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---------- תאריך עברי ----------

const HEB_FMT = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const HEB_MONTHS = {
  Tishri: 'תשרי', Heshvan: 'חשוון', Kislev: 'כסלו', Tevet: 'טבת', Shevat: 'שבט',
  'Adar I': 'אדר א׳', 'Adar II': 'אדר ב׳', Adar: 'אדר', Nisan: 'ניסן', Iyar: 'אייר',
  Sivan: 'סיוון', Tamuz: 'תמוז', Av: 'אב', Elul: 'אלול',
};

const hebCache = new Map();

/** מחזיר { day, month, year } כאשר month הוא שם החודש באנגלית כפי ש-ICU מחזיר ('Tishri', 'Adar II' ...) */
export function hebrewDate(iso) {
  let v = hebCache.get(iso);
  if (!v) {
    const parts = HEB_FMT.formatToParts(new Date(isoToMs(iso)));
    const get = (t) => parts.find((p) => p.type === t)?.value;
    v = { day: Number(get('day')), month: get('month'), year: Number(get('year')) };
    hebCache.set(iso, v);
  }
  return v;
}

const GEM_UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const GEM_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const GEM_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

/** מספר בגימטריה (1–999), כולל גרש/גרשיים: 15 → ט״ו, 787 → תשפ״ז */
export function gematria(n) {
  let s = GEM_HUNDREDS[Math.floor(n / 100)];
  const rest = n % 100;
  if (rest === 15) s += 'טו';
  else if (rest === 16) s += 'טז';
  else s += GEM_TENS[Math.floor(rest / 10)] + GEM_UNITS[rest % 10];
  return s.length === 1 ? `${s}׳` : `${s.slice(0, -1)}״${s.slice(-1)}`;
}

/** "ט״ו בתשרי" */
export function hebrewDateLabel(iso, withYear = false) {
  const h = hebrewDate(iso);
  const base = `${gematria(h.day)} ב${HEB_MONTHS[h.month] || h.month}`;
  return withYear ? `${base} ${gematria(h.year % 1000)}` : base;
}

// ---------- חגים ----------

const yearCache = new Map();

/**
 * מחזיר Map של ISO → [{ name, kind }] לכל המועדים בשנה הלועזית gy.
 */
export function holidaysForYear(gy) {
  if (yearCache.has(gy)) return yearCache.get(gy);

  // אינדקס: שנה עברית → "חודש|יום" → ISO. סורקים טווח רחב כדי לכסות את כל השנים העבריות הרלוונטיות.
  const index = new Map();
  let ms = Date.UTC(gy - 1, 7, 1);
  const end = Date.UTC(gy + 1, 1, 1);
  for (; ms <= end; ms += DAY_MS) {
    const iso = msToISO(ms);
    const h = hebrewDate(iso);
    if (!index.has(h.year)) index.set(h.year, new Map());
    index.get(h.year).set(`${h.month}|${h.day}`, iso);
  }

  const events = new Map();
  const add = (iso, name, kind) => {
    if (!iso || !iso.startsWith(`${gy}-`)) return;
    if (!events.has(iso)) events.set(iso, []);
    events.get(iso).push({ name, kind });
  };

  for (const map of index.values()) {
    const D = (month, day) => map.get(`${month}|${day}`);
    const wd = (iso) => (iso ? weekday(iso) : -1);
    const isLeap = map.has('Adar I|1');
    const ADAR = isLeap ? 'Adar II' : 'Adar';

    // תשרי
    add(D('Tishri', 1), 'ראש השנה', 'holiday');
    add(D('Tishri', 2), 'ראש השנה', 'holiday');
    const gedaliah = D('Tishri', 3);
    add(wd(gedaliah) === 6 ? D('Tishri', 4) : gedaliah, 'צום גדליה', 'info');
    add(D('Tishri', 9), 'ערב יום כיפור', 'erev');
    add(D('Tishri', 10), 'יום כיפור', 'holiday');
    add(D('Tishri', 14), 'ערב סוכות', 'erev');
    add(D('Tishri', 15), 'סוכות', 'holiday');
    for (let d = 16; d <= 20; d++) add(D('Tishri', d), 'חול המועד סוכות', 'cholhamoed');
    add(D('Tishri', 21), 'הושענא רבה', 'cholhamoed');
    add(D('Tishri', 22), 'שמחת תורה', 'holiday');

    // חנוכה – 8 ימים החל מכ״ה בכסלו
    const chanukah = D('Kislev', 25);
    if (chanukah) for (let i = 0; i < 8; i++) add(addDays(chanukah, i), 'חנוכה', 'info');
    add(D('Tevet', 10), 'צום עשרה בטבת', 'info');
    add(D('Shevat', 15), 'ט״ו בשבט', 'info');

    // אדר (אדר ב׳ בשנה מעוברת)
    const esther = D(ADAR, 13);
    add(wd(esther) === 6 ? D(ADAR, 11) : esther, 'תענית אסתר', 'info');
    add(D(ADAR, 14), 'פורים', 'info');
    add(D(ADAR, 15), 'שושן פורים (ירושלים)', 'info');

    // ניסן
    add(D('Nisan', 14), 'ערב פסח', 'erev');
    add(D('Nisan', 15), 'פסח', 'holiday');
    for (let d = 16; d <= 19; d++) add(D('Nisan', d), 'חול המועד פסח', 'cholhamoed');
    add(D('Nisan', 20), 'ערב שביעי של פסח', 'cholhamoed');
    add(D('Nisan', 21), 'שביעי של פסח', 'holiday');

    let shoah = D('Nisan', 27);
    if (wd(shoah) === 5) shoah = D('Nisan', 26);
    else if (wd(shoah) === 0) shoah = D('Nisan', 28);
    add(shoah, 'יום השואה', 'info');

    // אייר – יום הזיכרון ויום העצמאות לפי כללי ההקדמה/דחייה
    const iyar5 = D('Iyar', 5);
    let atzmaut = iyar5;
    if (wd(iyar5) === 5) atzmaut = D('Iyar', 4);
    else if (wd(iyar5) === 6) atzmaut = D('Iyar', 3);
    else if (wd(iyar5) === 1) atzmaut = D('Iyar', 6);
    if (atzmaut) {
      add(addDays(atzmaut, -1), 'יום הזיכרון (ערב יום העצמאות)', 'erev');
      add(atzmaut, 'יום העצמאות', 'holiday');
    }
    add(D('Iyar', 18), 'ל״ג בעומר', 'info');
    add(D('Iyar', 28), 'יום ירושלים', 'info');

    // סיוון
    add(D('Sivan', 5), 'ערב שבועות', 'erev');
    add(D('Sivan', 6), 'שבועות', 'holiday');

    // תמוז ואב
    const tamuz17 = D('Tamuz', 17);
    add(wd(tamuz17) === 6 ? D('Tamuz', 18) : tamuz17, 'צום י״ז בתמוז', 'info');
    const av9 = D('Av', 9);
    add(wd(av9) === 6 ? D('Av', 10) : av9, 'תשעה באב', 'fast');

    // אלול
    add(D('Elul', 29), 'ערב ראש השנה', 'erev');
  }

  yearCache.set(gy, events);
  return events;
}

const KIND_RANK = { holiday: 0, erev: 1, cholhamoed: 2, fast: 3, info: 4 };

/**
 * כל המועדים בתאריך מסוים, כולל מועדים מיוחדים שהוגדרו בהגדרות (בחירות, ימי חברה וכו').
 * special: [{ date, name, kind }]
 */
export function eventsOn(iso, special = []) {
  const { y } = parseISO(iso);
  const list = [...(holidaysForYear(y).get(iso) || [])];
  for (const s of special) if (s && s.date === iso) list.push({ name: s.name, kind: s.kind || 'holiday', special: true });
  return list.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** המועד החשוב ביותר ביום (או null) */
export function primaryEvent(iso, special = []) {
  return eventsOn(iso, special)[0] || null;
}

/** כל המועדים בחודש (YYYY-MM) */
export function monthEvents(ym, special = []) {
  const out = [];
  for (const iso of monthDays(ym)) {
    for (const ev of eventsOn(iso, special)) out.push({ date: iso, ...ev });
  }
  return out;
}

/**
 * מקבץ מועדים רצופים בעלי אותו שם לטווחים: "חול המועד סוכות 27/09–30/09".
 */
export function groupEvents(events) {
  const groups = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (last && last.name === ev.name && last.kind === ev.kind && addDays(last.to, 1) === ev.date) {
      last.to = ev.date;
    } else {
      groups.push({ name: ev.name, kind: ev.kind, from: ev.date, to: ev.date });
    }
  }
  return groups;
}

/** יום העבודה הראשון בחודש (ראשון–חמישי שאינו חג) */
export function firstWorkday(ym, special = []) {
  for (const iso of monthDays(ym)) {
    if (isWeekend(iso)) continue;
    const ev = primaryEvent(iso, special);
    if (ev && ev.kind === 'holiday') continue;
    return iso;
  }
  return `${ym}-01`;
}
