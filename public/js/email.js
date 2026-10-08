// בניית המייל לכוכי: נושא, ברכה מתחלפת, גוף ההודעה וקובץ ‎.eml‏ שנפתח באאוטלוק כטיוטה מוכנה לשליחה.

import { MONTH_NAMES, addDays, eventsOn, parseISO } from './calendar.js';

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function vars(ym, profile) {
  const [y, m] = ym.split('-').map(Number);
  return { month: MONTH_NAMES[m - 1], year: String(y), name: profile.fullName || '' };
}

export function buildSubject(settings, profile, ym) {
  return fill(settings.subjectTemplate, vars(ym, profile)).replace(/\s+/g, ' ').trim();
}

export function buildFileName(settings, profile, ym) {
  const base = fill(settings.fileTemplate, vars(ym, profile)).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${base}.xlsx`;
}

// ---------- ברכות ----------

export const GENERIC_GREETINGS = [
  'שיהיה חודש טוב',
  'שיהיה חודש טוב ומוצלח',
  'חודש טוב ומלא בבשורות טובות',
  'שיהיה חודש רגוע ונעים',
  'חודש טוב ובהצלחה',
  'שיהיה חודש מצוין',
  'חודש טוב ושמח',
  'שיהיה חודש פורה ומוצלח',
  'חודש טוב, ושיהיו רק חדשות טובות',
  'שיהיה לכולנו חודש טוב',
];

// לפי מועדים קרובים לתאריך השליחה
const SEASONAL = [
  { names: ['ערב ראש השנה', 'ראש השנה'], text: 'שנה טובה ומתוקה! ושיהיה חודש טוב' },
  { names: ['ערב יום כיפור', 'יום כיפור'], text: 'גמר חתימה טובה, ושיהיה חודש טוב' },
  { names: ['חול המועד סוכות', 'הושענא רבה', 'חול המועד פסח', 'ערב שביעי של פסח'], text: 'מועדים לשמחה! ושיהיה חודש טוב', now: true },
  { names: ['ערב סוכות', 'סוכות', 'שמחת תורה'], text: 'חג סוכות שמח! ושיהיה חודש טוב' },
  { names: ['חנוכה'], text: 'חנוכה שמח! ושיהיה חודש טוב' },
  { names: ['פורים', 'תענית אסתר'], text: 'פורים שמח! ושיהיה חודש טוב' },
  { names: ['ערב פסח', 'פסח', 'שביעי של פסח'], text: 'חג פסח כשר ושמח! ושיהיה חודש טוב' },
  { names: ['יום העצמאות'], text: 'חג עצמאות שמח! ושיהיה חודש טוב' },
  { names: ['ערב שבועות', 'שבועות'], text: 'חג שבועות שמח! ושיהיה חודש טוב' },
];

/** ברכה עונתית לפי מועדים שחלים מהיום ועד 12 יום קדימה (או null) */
export function seasonalGreeting(todayIso, special = []) {
  const { m, d } = parseISO(todayIso);
  if (m === 1 && d <= 7) return 'שנה אזרחית טובה, ושיהיה חודש טוב';
  for (let i = 0; i <= 12; i++) {
    const iso = addDays(todayIso, i);
    const names = eventsOn(iso, special).map((e) => e.name);
    for (const s of SEASONAL) {
      if (s.now && i > 0) continue;
      if (names.some((n) => s.names.includes(n))) return s.text;
    }
  }
  return null;
}

/** רשימת ברכות אפשריות. הראשונה היא ברירת המחדל ומשתנה מחודש לחודש. */
export function greetingOptions(ym, todayIso, special = []) {
  const [y, m] = ym.split('-').map(Number);
  const start = (y * 12 + m) % GENERIC_GREETINGS.length;
  const rotated = [...GENERIC_GREETINGS.slice(start), ...GENERIC_GREETINGS.slice(0, start)];
  const seasonal = seasonalGreeting(todayIso, special);
  return seasonal ? [seasonal, ...rotated] : rotated;
}

export function buildBody({ recipientName, greeting, ym, fullName }) {
  const [y, m] = ym.split('-').map(Number);
  return [
    `היי ${recipientName}`.trim(),
    '',
    greeting,
    '',
    `מצורף דיווח השעות שלי לחודש ${MONTH_NAMES[m - 1]} ${y}.`,
    '',
    'תודה,',
    fullName,
    '',
  ].join('\n');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function bodyToHtml(text) {
  const lines = text.split('\n').map((l) => (l ? escapeHtml(l) : '&nbsp;'));
  return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head>'
    + '<body dir="rtl" style="font-family:Arial,sans-serif;font-size:11pt;text-align:right;direction:rtl">'
    + lines.map((l) => `<p dir="rtl" style="margin:0">${l}</p>`).join('')
    + '</body></html>';
}

// ---------- MIME / EML ----------

const utf8 = (s) => new TextEncoder().encode(s);

export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

/** RFC 2047 encoded-words, מפוצל כך שכל מילה ≤ 75 תווים ואין חיתוך באמצע תו */
export function encodeHeader(str) {
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const words = [];
  let cur = '';
  for (const ch of str) {
    if (utf8(cur + ch).length > 45) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${bytesToBase64(utf8(w))}?=`).join('\r\n ');
}

function encodeRfc2231(str) {
  return Array.from(utf8(str)).map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9.\-_~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

/**
 * קובץ eml עם X-Unsent: 1 – אאוטלוק פותח אותו כהודעה חדשה (טיוטה) עם הנמען, הנושא, הגוף והקובץ המצורף.
 * @param {{to:string, cc?:string, subject:string, text:string, attachment?:{filename:string, contentType:string, bytes:Uint8Array}}} msg
 */
export function buildEml({ to, cc, subject, text, attachment }) {
  const rnd = () => Math.random().toString(36).slice(2, 12);
  const mixed = `----=_Mixed_${rnd()}`;
  const alt = `----=_Alt_${rnd()}`;
  const lines = [
    'X-Unsent: 1',
    `To: ${to}`,
  ];
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    'This is a multi-part message in MIME format.',
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(utf8(text.replace(/\r?\n/g, '\r\n')))),
    '',
    `--${alt}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(bytesToBase64(utf8(bodyToHtml(text)))),
    '',
    `--${alt}--`,
    '',
  );
  if (attachment) {
    const encName = encodeHeader(attachment.filename).replace(/\r\n /g, '');
    lines.push(
      `--${mixed}`,
      `Content-Type: ${attachment.contentType}; name="${encName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encName}"; filename*=UTF-8''${encodeRfc2231(attachment.filename)}`,
      '',
      wrap76(bytesToBase64(attachment.bytes)),
      '',
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

/** קישור mailto כגיבוי (ללא קובץ מצורף – mailto לא תומך בצירוף קבצים) */
export function mailtoLink({ to, cc, subject, text }) {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(text)}`];
  if (cc) params.unshift(`cc=${encodeURIComponent(cc)}`);
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${params.join('&')}`;
}

/** תזכורת חודשית ליומן: ביום העבודה הראשון בכל חודש (א׳–ה׳) ב-09:00 */
export function buildReminderIcs({ url, recipientName }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 2; // מתחילים מהחודש הבא
  // DTSTART חייב להיות המופע הראשון של החוק: יום א׳–ה׳ הראשון בחודש הבא
  const start = new Date(y, m - 1, 1);
  while (start.getDay() > 4) start.setDate(start.getDate() + 1);
  const dt = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}${String(start.getDate()).padStart(2, '0')}T090000`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  // קיפול שורות ל-75 בתים לפי RFC 5545, בלי לחתוך תו באמצע
  const fold = (line) => {
    const parts = [];
    let cur = '';
    for (const ch of line) {
      if (utf8(cur + ch).length > (parts.length ? 74 : 75)) {
        parts.push(cur);
        cur = '';
      }
      cur += ch;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NCR Hours Report//HE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:hours-report-${stamp}@ncr-hours`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dt}`,
    'DURATION:PT15M',
    'RRULE:FREQ=MONTHLY;BYDAY=SU,MO,TU,WE,TH;BYSETPOS=1',
    `SUMMARY:${esc(`שליחת דיווח שעות ל${recipientName}`)}`,
    `DESCRIPTION:${esc(`להיכנס לאתר דיווח השעות ולשלוח את הדוח של החודש הקודם:\n${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:דיווח שעות',
    'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].map(fold).join('\r\n');
}
