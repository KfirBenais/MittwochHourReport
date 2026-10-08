// ברירות מחדל משותפות לשרת ולדפדפן.

export const DEFAULT_SETTINGS = {
  recipientEmail: 'kohava@ncr.co.il',
  recipientName: 'כוכי',
  ccEmail: '',
  companyName: 'י.א. מיטווך ובניו בע"מ',
  subjectTemplate: 'דווח שעות {month} {year} - {name}',
  fileTemplate: 'דיווח שעות {name} {month} {year}',
  // יום קצר (ערב חג / תשעה באב) – ללא קיזוז הפסקה, כמו בדוח יולי (תשעה באב 08:00–13:00 עם x)
  shortDay: { start: '08:00', end: '13:00' },
  // מה המילוי האוטומטי עושה בימים מיוחדים: ask = משאיר לבחירה ומתריע, short = יום קצר, off = לא עובדים, full = יום מלא
  policies: { erev: 'ask', cholhamoed: 'ask', fast: 'ask' },
  // מועדים מיוחדים שאינם בלוח העברי (בחירות, ימי חברה, חופשה מרוכזת...)
  special: [
    { date: '2026-10-27', name: 'בחירות לכנסת', kind: 'holiday' },
  ],
  // קוד צוות להרשמה (ריק = לא נדרש)
  teamCode: '',
  // אם true – משתמש חדש נכנס רק אחרי אישור של מנהל הצוות (ברירת מחדל: נכנסים מיד)
  requireApproval: false,
};

export const DEFAULT_PROFILE = {
  fullName: '',
  email: '',
  start: '08:00',
  end: '16:45',
  breakMin: 30,
  halfDayEnd: '12:30',
};

export const POLICY_LABELS = {
  ask: 'להשאיר לבחירה (עם התראה)',
  short: 'יום קצר ללא הפסקה',
  off: 'לא עובדים (רישום שם החג)',
  full: 'יום עבודה מלא',
};

export function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.shortDay = { ...DEFAULT_SETTINGS.shortDay, ...(saved?.shortDay || {}) };
  s.policies = { ...DEFAULT_SETTINGS.policies, ...(saved?.policies || {}) };
  s.special = Array.isArray(saved?.special) ? saved.special : DEFAULT_SETTINGS.special;
  return s;
}

export function mergeProfile(saved) {
  return { ...DEFAULT_PROFILE, ...(saved || {}) };
}

/**
 * הפרטים שבהם יש להשתמש לחודש מסוים: אם הדוח כבר נשלח – השם וזמן ההפסקה כפי שהיו בשליחה,
 * כדי שקובץ של חודש ישן ייווצר בדיוק כמו שנשלח.
 */
export function profileForReport(profile, report) {
  const s = report?.snapshot;
  if (!s) return profile;
  return {
    ...profile,
    fullName: s.fullName || profile.fullName,
    breakMin: Number.isFinite(s.breakMin) ? s.breakMin : profile.breakMin,
  };
}

export function settingsForReport(settings, report) {
  const s = report?.snapshot;
  return s?.companyName ? { ...settings, companyName: s.companyName } : settings;
}
