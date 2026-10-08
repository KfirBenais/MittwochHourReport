// שרת דיווח שעות – Node.js בלבד, ללא תלויות חיצוניות.
// מגיש את האתר (public/) ומספק API לשמירת הדוחות, משתמשים והגדרות בקובץ JSON בתיקיית data/.
//
// הרצה:  node server.js        (ההגדרות בקובץ config.json – ראו config.example.json)
// משתני סביבה (גוברים על config.json): PORT, HOST, DATA_DIR, CONFIG

import http from 'node:http';
import https from 'node:https';
import { promises as fs, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeSettings, mergeProfile, profileForReport } from './public/js/defaults.js';
import { sanitizeDays, summarize, validate, isTime } from './public/js/report.js';
import { todayISO } from './public/js/calendar.js';
import { createMailer } from './mailer.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const SESSION_DAYS = 30;
const COOKIE = 'hr_sid';
const MAX_BODY = 256 * 1024;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const MIN_PASSWORD = 8;
const RESET_MINUTES = 60;
const ADMIN_RESET_HOURS = 24;
const VERIFY_DAYS = 7;

// ---------- הגדרות שרת (config.json) ----------

/** מסיר הערות // מקובץ JSON (כדי שאפשר יהיה להשאיר הסברים בקובץ ההגדרות) */
export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else out += ch;
  }
  return out;
}

export function loadConfig(file = process.env.CONFIG || path.join(ROOT, 'config.json')) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(stripJsonComments(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  } catch (err) {
    throw new Error(`שגיאה בקובץ ההגדרות ${file}: ${err.message}`);
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function makeLogger(dataDir) {
  const dir = path.join(dataDir, 'logs');
  return (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}`;
    console.log(line);
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path.join(dir, `server-${todayISO().slice(0, 7)}.log`), `${line}\n`);
    } catch {
      // אין גישה לכתיבת לוג – ממשיכים בלי
    }
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- אחסון ----------

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.data = null;
    this.queue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.join(this.dir, 'backups'), { recursive: true });
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`לא ניתן לקרוא את ${this.file} – הקובץ פגום? יש גיבויים בתיקיית backups. (${err.message})`);
      this.data = {};
    }
    this.data.users ||= [];
    this.data.sessions ||= {};
    this.data.tokens ||= {};
    this.data.settings ||= {};
    this.data.reports ||= {};
  }

  save() {
    const snapshot = JSON.stringify(this.data, null, 1);
    this.queue = this.queue.then(() => this.#write(snapshot)).catch((err) => console.error('שגיאה בשמירה:', err));
    return this.queue;
  }

  async #write(json) {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, json);
    await fs.rename(tmp, this.file);
    // גיבוי יומי – נשמרים 30 האחרונים
    const backup = path.join(this.dir, 'backups', `db-${todayISO()}.json`);
    try {
      await fs.access(backup);
    } catch {
      await fs.writeFile(backup, json);
      const files = (await fs.readdir(path.join(this.dir, 'backups'))).filter((f) => f.startsWith('db-')).sort();
      for (const f of files.slice(0, -30)) await fs.rm(path.join(this.dir, 'backups', f));
    }
  }
}

// ---------- עזרי אבטחה ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone || '',
  isAdmin: !!u.isAdmin,
  verified: u.verified !== false,
  approved: u.approved !== false,
  createdAt: u.createdAt,
  profile: mergeProfile(u.profile),
});

/** טלפון: ספרות בלבד (ו-+ בהתחלה), 9–15 ספרות. מחזיר '' לריק ו-null ללא תקין */
function cleanPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  const count = digits.replace(/\D/g, '').length;
  return count >= 9 && count <= 15 && /^\+?\d+$/.test(digits) ? digits : null;
}

function cleanProfile(input, base) {
  const p = mergeProfile(base);
  if (typeof input.fullName === 'string') p.fullName = input.fullName.trim().slice(0, 60);
  if (isTime(input.start)) p.start = input.start;
  if (isTime(input.end)) p.end = input.end;
  if (isTime(input.halfDayEnd)) p.halfDayEnd = input.halfDayEnd;
  const b = Number(input.breakMin);
  if (Number.isFinite(b) && b >= 0 && b <= 120) p.breakMin = Math.round(b);
  return p;
}

function cleanSettings(input, base) {
  const s = mergeSettings(base);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  for (const [k, max] of [['recipientEmail', 200], ['recipientName', 40], ['ccEmail', 300], ['companyName', 80], ['subjectTemplate', 150], ['fileTemplate', 150], ['teamCode', 40]]) {
    const v = str(input[k], max);
    if (v !== undefined) s[k] = v;
  }
  if (typeof input.requireApproval === 'boolean') s.requireApproval = input.requireApproval;
  if (input.shortDay && isTime(input.shortDay.start) && isTime(input.shortDay.end)) s.shortDay = { start: input.shortDay.start, end: input.shortDay.end };
  if (input.policies) {
    for (const k of ['erev', 'cholhamoed', 'fast']) {
      if (['ask', 'short', 'off', 'full'].includes(input.policies[k])) s.policies[k] = input.policies[k];
    }
  }
  if (Array.isArray(input.special)) {
    s.special = input.special
      .filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.name === 'string' && x.name.trim())
      .map((x) => ({ date: x.date, name: x.name.trim().slice(0, 60), kind: ['holiday', 'erev', 'cholhamoed', 'fast', 'info'].includes(x.kind) ? x.kind : 'holiday' }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 200);
  }
  return s;
}

// ---------- האפליקציה ----------

export async function createApp({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  config = {},
  log = makeLogger(dataDir),
} = {}) {
  const store = new Store(dataDir);
  await store.load();
  const db = store.data;
  const failures = new Map(); // ip → { count, until }
  const mailThrottle = new Map(); // `${type}:${userId}` → זמן שליחה אחרון
  const mailer = createMailer(config.mail, log);
  const emailDomain = String(config.emailDomain ?? 'ncr.co.il').trim().toLowerCase().replace(/^@/, '');
  const publicUrl = String(config.publicUrl || 'http://localhost:8080').replace(/\/+$/, '');

  const settings = () => mergeSettings(db.settings);
  const findUser = (id) => db.users.find((u) => u.id === id);

  function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const key = sha256(token);
    const s = db.sessions[key];
    if (!s || s.expires < Date.now()) return null;
    const user = findUser(s.userId);
    return user ? { key, user } : null;
  }

  function startSession(req, res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = Date.now() + SESSION_DAYS * 86400000;
    // ניקוי סשנים שפג תוקפם
    for (const [k, s] of Object.entries(db.sessions)) if (s.expires < Date.now()) delete db.sessions[k];
    db.sessions[sha256(token)] = { userId: user.id, expires };
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  function rateLimit(req) {
    const ip = req.socket.remoteAddress;
    const f = failures.get(ip);
    if (f && f.count >= 10 && f.until > Date.now()) throw new HttpError(429, 'יותר מדי ניסיונות כושלים. נסה שוב בעוד כמה דקות.');
  }

  function recordFailure(req) {
    const ip = req.socket.remoteAddress;
    const f = failures.get(ip);
    const fresh = !f || f.until < Date.now();
    failures.set(ip, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60000 });
  }

  const reportOf = (userId, ym) => db.reports[userId]?.[ym] || { ym, days: {}, sentAt: null, updatedAt: null };

  // ---------- מייל, טוקנים ואימות ----------

  const normEmail = (v) => String(v || '').trim().toLowerCase();

  function checkCompanyEmail(email) {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'כתובת המייל לא תקינה');
    if (emailDomain && !email.endsWith(`@${emailDomain}`)) throw new HttpError(400, `אפשר להירשם רק עם מייל של החברה (@${emailDomain})`);
  }

  /** חיפוש משתמש לפי מייל (או שם משתמש ישן) */
  function findByLogin(value) {
    const v = normEmail(value);
    if (!v) return null;
    const local = emailDomain && v.endsWith(`@${emailDomain}`) ? v.slice(0, -(emailDomain.length + 1)) : null;
    return db.users.find((u) => u.email?.toLowerCase() === v || u.username === v)
      || (local ? db.users.find((u) => u.username === local) : null)
      || null;
  }

  function createToken(userId, type, ms) {
    for (const [k, t] of Object.entries(db.tokens)) {
      if (t.expires < Date.now() || (t.userId === userId && t.type === type)) delete db.tokens[k];
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.tokens[sha256(token)] = { userId, type, expires: Date.now() + ms };
    return token;
  }

  function consumeToken(token, type) {
    const key = sha256(String(token || ''));
    const t = db.tokens[key];
    if (!t || t.type !== type || t.expires < Date.now()) return null;
    delete db.tokens[key];
    return findUser(t.userId);
  }

  const throttled = (key) => {
    const last = mailThrottle.get(key) || 0;
    if (Date.now() - last < 60000) return true;
    mailThrottle.set(key, Date.now());
    return false;
  };

  function mailHtml(title, paragraphs, button) {
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head>'
      + '<body dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#1d2619;text-align:right;direction:rtl">'
      + `<h2 style="color:#3f7d22;margin:0 0 12px">${esc(title)}</h2>`
      + paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('')
      + (button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#3f7d22;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>`
        + `<p style="font-size:12px;color:#5d6958">אם הכפתור לא עובד, אפשר להעתיק את הקישור לדפדפן:<br><span dir="ltr">${esc(button.url)}</span></p>` : '')
      + '<p style="font-size:12px;color:#5d6958;margin-top:24px">אתר דיווח השעות · I.E. Mittwoch &amp; Sons · NCR</p>'
      + '</body></html>';
  }

  async function sendVerification(user) {
    const token = createToken(user.id, 'verify', VERIFY_DAYS * 86400000);
    await store.save();
    const url = `${publicUrl}/#/verify/${token}`;
    if (!mailer.enabled) {
      log(`(mail disabled) verification link for ${user.email}: ${url}`);
      return;
    }
    await mailer.send({
      to: user.email,
      subject: 'אימות המייל – אתר דיווח השעות',
      text: `שלום ${user.fullName},\n\nכדי להשלים את ההרשמה לאתר דיווח השעות יש לפתוח את הקישור:\n${url}\n\nהקישור בתוקף ${VERIFY_DAYS} ימים.`,
      html: mailHtml(`שלום ${user.fullName},`, ['כדי להשלים את ההרשמה לאתר דיווח השעות – לוחצים על הכפתור:', `הקישור בתוקף ${VERIFY_DAYS} ימים.`], { url, label: 'אימות המייל וכניסה' }),
    });
  }

  async function sendReset(user) {
    const token = createToken(user.id, 'reset', RESET_MINUTES * 60000);
    await store.save();
    const url = `${publicUrl}/#/reset/${token}`;
    await mailer.send({
      to: user.email,
      subject: 'איפוס סיסמה – אתר דיווח השעות',
      text: `שלום ${user.fullName},\n\nהתקבלה בקשה לאיפוס הסיסמה שלך באתר דיווח השעות. לבחירת סיסמה חדשה:\n${url}\n\nהקישור בתוקף שעה. אם לא ביקשת איפוס – אפשר להתעלם מהמייל.`,
      html: mailHtml(`שלום ${user.fullName},`, ['התקבלה בקשה לאיפוס הסיסמה שלך באתר דיווח השעות.', 'הקישור בתוקף שעה. אם לא ביקשת איפוס – אפשר להתעלם מהמייל הזה.'], { url, label: 'בחירת סיסמה חדשה' }),
    });
  }

  // ---------- נתבים ----------

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

  route('GET', /^\/api\/health$/, () => ({
    ok: true,
    mode: 'server',
    version: VERSION,
    needsSetup: db.users.length === 0,
    teamCodeRequired: db.users.length > 0 && !!settings().teamCode,
    emailDomain,
    mailEnabled: mailer.enabled,
  }), { public: true });

  route('POST', /^\/api\/register$/, async ({ req, res, body }) => {
    rateLimit(req);
    const email = normEmail(body.email);
    const password = String(body.password || '');
    const fullName = String(body.fullName || '').trim().slice(0, 60);
    const phone = cleanPhone(body.phone);
    if (!fullName) throw new HttpError(400, 'יש להזין שם מלא (כפי שיופיע בדוח)');
    checkCompanyEmail(email);
    if (phone === null) throw new HttpError(400, 'מספר הטלפון לא תקין');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים`);
    const first = db.users.length === 0;
    const code = settings().teamCode;
    if (!first && code && String(body.teamCode || '').trim() !== code) {
      recordFailure(req);
      throw new HttpError(403, 'קוד הצוות שגוי – אפשר לבקש אותו ממנהל הצוות');
    }
    if (findByLogin(email)) throw new HttpError(409, 'המייל הזה כבר רשום. אפשר להתחבר, או ללחוץ "שכחתי סיסמה".');
    const { salt, hash } = hashPassword(password);
    // המשתמש הראשון (מנהל) מאושר מיד. אחרים: אימות מייל (אם השרת שולח מיילים) ו/או אישור מנהל
    const needsVerify = mailer.enabled && !first;
    const needsApproval = !first && settings().requireApproval;
    const user = {
      id: crypto.randomUUID(),
      username: email,
      email,
      fullName,
      phone,
      salt,
      hash,
      isAdmin: first,
      verified: !needsVerify,
      approved: !needsApproval,
      createdAt: new Date().toISOString(),
    };
    user.profile = cleanProfile({ ...(body.profile || {}), fullName }, {});
    user.profile.email = email;
    db.users.push(user);
    log(`registered ${email}${first ? ' (admin)' : ''}`);
    if (needsVerify) {
      await store.save();
      try {
        await sendVerification(user);
        return { pendingVerification: true, pendingApproval: needsApproval, email };
      } catch (err) {
        log('verification mail failed:', err);
        return { pendingVerification: true, pendingApproval: needsApproval, email, mailError: true };
      }
    }
    if (needsApproval) {
      await store.save();
      return { pendingApproval: true, email };
    }
    startSession(req, res, user);
    await store.save();
    return { user: publicUser(user) };
  }, { public: true });

  route('POST', /^\/api\/login$/, async ({ req, res, body }) => {
    rateLimit(req);
    const user = findByLogin(body.email ?? body.username);
    if (!user || !checkPassword(String(body.password || ''), user)) {
      recordFailure(req);
      throw new HttpError(401, 'המייל או הסיסמה שגויים');
    }
    if (user.verified === false) throw new HttpError(403, `צריך לאשר את המייל קודם – שלחנו קישור אימות ל-${user.email}`, 'unverified');
    if (user.approved === false) throw new HttpError(403, 'החשבון ממתין לאישור של מנהל הצוות. אחרי האישור אפשר להתחבר.', 'pending');
    startSession(req, res, user);
    await store.save();
    return { user: publicUser(user) };
  }, { public: true });

  route('POST', /^\/api\/verify$/, async ({ req, res, body }) => {
    rateLimit(req);
    const user = consumeToken(body.token, 'verify');
    if (!user) {
      recordFailure(req);
      throw new HttpError(400, 'הקישור לא תקין או שפג תוקפו. אפשר להתחבר ולבקש קישור חדש.');
    }
    user.verified = true;
    log(`verified ${user.email}`);
    if (user.approved === false) {
      await store.save();
      return { pendingApproval: true, email: user.email };
    }
    startSession(req, res, user);
    await store.save();
    return { user: publicUser(user) };
  }, { public: true });

  route('POST', /^\/api\/verify\/resend$/, async ({ req, body }) => {
    rateLimit(req);
    const user = findByLogin(body.email);
    if (user && user.verified === false && mailer.enabled && !throttled(`verify:${user.id}`)) {
      await sendVerification(user).catch((err) => log('verification mail failed:', err));
    }
    return { ok: true };
  }, { public: true });

  route('POST', /^\/api\/password\/forgot$/, async ({ req, body }) => {
    rateLimit(req);
    const user = findByLogin(body.email);
    if (!mailer.enabled) {
      // בלי מיילים מהשרת: הבקשה מופיעה אצל מנהל הצוות, והוא שולח קישור איפוס מהאאוטלוק שלו
      if (user && !throttled(`reset:${user.id}`)) {
        user.resetRequestedAt = new Date().toISOString();
        await store.save();
        log(`password reset requested by ${user.email}`);
      }
      return { ok: true, viaAdmin: true };
    }
    // תמיד אותה תשובה – כדי לא לחשוף אילו מיילים רשומים
    if (user?.email && !throttled(`reset:${user.id}`)) {
      await sendReset(user).catch((err) => log('reset mail failed:', err));
    }
    return { ok: true };
  }, { public: true });

  route('POST', /^\/api\/password\/reset$/, async ({ req, res, body }) => {
    rateLimit(req);
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים`);
    const user = consumeToken(body.token, 'reset');
    if (!user) {
      recordFailure(req);
      throw new HttpError(400, 'הקישור לא תקין או שפג תוקפו (תקף שעה). אפשר לבקש קישור חדש.');
    }
    Object.assign(user, hashPassword(password));
    user.verified = true;
    delete user.resetRequestedAt;
    for (const [k, s2] of Object.entries(db.sessions)) if (s2.userId === user.id) delete db.sessions[k];
    if (user.approved === false) {
      await store.save();
      return { pendingApproval: true, email: user.email };
    }
    startSession(req, res, user);
    await store.save();
    log(`password reset ${user.email}`);
    return { user: publicUser(user) };
  }, { public: true });

  route('POST', /^\/api\/logout$/, async ({ res, session }) => {
    delete db.sessions[session.key];
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    await store.save();
    return { ok: true };
  });

  route('GET', /^\/api\/me$/, ({ session }) => {
    if (!session) return { user: null };
    const s = settings();
    if (!session.user.isAdmin) delete s.teamCode;
    const pending = session.user.isAdmin ? db.users.filter((u) => u.approved === false || u.verified === false || u.resetRequestedAt).length : 0;
    return { user: publicUser(session.user), settings: s, pending };
  }, { public: true });

  route('PUT', /^\/api\/me$/, async ({ session, body }) => {
    const u = session.user;
    const profile = cleanProfile(body, u.profile);
    if (!profile.fullName) throw new HttpError(400, 'יש להזין שם מלא');
    if (body.phone !== undefined) {
      const phone = cleanPhone(body.phone);
      if (phone === null) throw new HttpError(400, 'מספר הטלפון לא תקין');
      u.phone = phone;
    }
    profile.email = u.email || '';
    u.profile = profile;
    u.fullName = profile.fullName;
    await store.save();
    return { user: publicUser(u) };
  });

  route('POST', /^\/api\/me\/password$/, async ({ session, body }) => {
    const u = session.user;
    if (!checkPassword(String(body.current || ''), u)) throw new HttpError(400, 'הסיסמה הנוכחית שגויה');
    const next = String(body.next || '');
    if (next.length < MIN_PASSWORD) throw new HttpError(400, `הסיסמה החדשה צריכה להכיל לפחות ${MIN_PASSWORD} תווים`);
    Object.assign(u, hashPassword(next));
    // ניתוק כל שאר החיבורים
    for (const [k, s] of Object.entries(db.sessions)) if (s.userId === u.id && k !== session.key) delete db.sessions[k];
    await store.save();
    return { ok: true };
  });

  // כל הדוחות של המשתמש (או של שנה מסוימת עם ?year=)
  route('GET', /^\/api\/reports$/, ({ session, url }) => {
    const year = url.searchParams.get('year');
    if (year && !/^\d{4}$/.test(year)) throw new HttpError(400, 'שנה לא תקינה');
    const all = db.reports[session.user.id] || {};
    const months = {};
    for (const [ym, r] of Object.entries(all)) if (!year || ym.startsWith(`${year}-`)) months[ym] = r;
    return { months };
  });

  route('GET', /^\/api\/reports\/(\d{4}-\d{2})$/, ({ session, params }) => {
    if (!YM_RE.test(params[0])) throw new HttpError(400, 'חודש לא תקין');
    return reportOf(session.user.id, params[0]);
  });

  route('PUT', /^\/api\/reports\/(\d{4}-\d{2})$/, async ({ session, params, body }) => {
    const ym = params[0];
    if (!YM_RE.test(ym)) throw new HttpError(400, 'חודש לא תקין');
    const prev = reportOf(session.user.id, ym);
    const report = { ...prev, ym, days: sanitizeDays(ym, body.days), updatedAt: new Date().toISOString() };
    (db.reports[session.user.id] ||= {})[ym] = report;
    await store.save();
    return report;
  });

  // סימון חודש כנשלח: אחרי יצירת המייל באתר, או ידנית ("כבר שלחתי") עם { manual: true }.
  // { sent: false } מבטל את הסימון.
  route('POST', /^\/api\/reports\/(\d{4}-\d{2})\/sent$/, async ({ session, params, body }) => {
    const ym = params[0];
    if (!YM_RE.test(ym)) throw new HttpError(400, 'חודש לא תקין');
    if (body.sent === false) {
      const report = { ...reportOf(session.user.id, ym), ym, sentAt: null };
      delete report.sentManually;
      delete report.snapshot;
      (db.reports[session.user.id] ||= {})[ym] = report;
      await store.save();
      return report;
    }
    const report = { ...reportOf(session.user.id, ym), ym, sentAt: new Date().toISOString(), sentManually: body.manual === true };
    report.updatedAt ||= report.sentAt;
    // הפרטים כפי שהיו בשליחה הראשונה – כדי שקובץ של חודש ישן ייווצר בדיוק כמו שנשלח
    const p = mergeProfile(session.user.profile);
    report.snapshot ||= { fullName: p.fullName, breakMin: p.breakMin, companyName: settings().companyName, at: report.sentAt };
    (db.reports[session.user.id] ||= {})[ym] = report;
    await store.save();
    return report;
  });

  // ---------- ניהול (מנהל צוות) ----------

  route('PUT', /^\/api\/settings$/, async ({ body }) => {
    db.settings = cleanSettings(body, db.settings);
    await store.save();
    return { settings: settings() };
  }, { admin: true });

  route('GET', /^\/api\/team$/, ({ url }) => {
    const ym = url.searchParams.get('ym');
    if (!YM_RE.test(ym || '')) throw new HttpError(400, 'חודש לא תקין');
    const s = settings();
    const today = todayISO();
    return {
      members: db.users
        .map((u) => {
          const r = reportOf(u.id, ym);
          const profile = profileForReport(mergeProfile(u.profile), r);
          const issues = validate(ym, r.days, s, profile, { uptoISO: today });
          return {
            id: u.id,
            username: u.username,
            fullName: u.fullName,
            email: u.email,
            phone: u.phone || '',
            isAdmin: !!u.isAdmin,
            verified: u.verified !== false,
            approved: u.approved !== false,
            resetRequestedAt: u.resetRequestedAt || null,
            summary: summarize(ym, r.days, profile),
            errors: issues.filter((i) => i.level === 'error').length,
            filledDays: Object.values(r.days).filter((d) => d.type).length,
            sentAt: r.sentAt,
            updatedAt: r.updatedAt,
          };
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')),
    };
  }, { admin: true });

  route('GET', /^\/api\/team\/([\w-]+)\/reports\/(\d{4}-\d{2})$/, ({ params }) => {
    const u = findUser(params[0]);
    if (!u) throw new HttpError(404, 'משתמש לא נמצא');
    if (!YM_RE.test(params[1])) throw new HttpError(400, 'חודש לא תקין');
    return { user: publicUser(u), report: reportOf(u.id, params[1]) };
  }, { admin: true });

  // קישור איפוס חד-פעמי שהמנהל שולח לעובד בעצמו (מהאאוטלוק שלו / Teams). המנהל לא רואה את הסיסמה.
  route('POST', /^\/api\/admin\/users\/([\w-]+)\/reset-link$/, async ({ params }) => {
    const u = findUser(params[0]);
    if (!u) throw new HttpError(404, 'משתמש לא נמצא');
    const token = createToken(u.id, 'reset', ADMIN_RESET_HOURS * 3600000);
    delete u.resetRequestedAt;
    await store.save();
    log(`admin created reset link for ${u.email}`);
    return { token, url: `${publicUrl}/#/reset/${token}`, hours: ADMIN_RESET_HOURS, email: u.email, fullName: u.fullName };
  }, { admin: true });

  route('PUT', /^\/api\/admin\/users\/([\w-]+)$/, async ({ params, body, session }) => {
    const u = findUser(params[0]);
    if (!u) throw new HttpError(404, 'משתמש לא נמצא');
    if (typeof body.isAdmin === 'boolean') {
      if (!body.isAdmin && u.id === session.user.id && db.users.filter((x) => x.isAdmin).length === 1) {
        throw new HttpError(400, 'אי אפשר להסיר את המנהל האחרון');
      }
      u.isAdmin = body.isAdmin;
    }
    if (body.verified === true) u.verified = true;
    if (body.approved === true) {
      u.approved = true;
      u.verified = true;
      log(`approved ${u.email}`);
    }
    await store.save();
    return { user: publicUser(u) };
  }, { admin: true });

  route('POST', /^\/api\/admin\/test-mail$/, async ({ body, session }) => {
    const to = normEmail(body.to || session.user.email);
    if (!EMAIL_RE.test(to)) throw new HttpError(400, 'כתובת לא תקינה');
    if (!mailer.enabled) throw new HttpError(400, 'שליחת מיילים לא מוגדרת – יש למלא את החלק mail בקובץ config.json בשרת ולהפעיל מחדש');
    try {
      await mailer.send({
        to,
        subject: 'בדיקת מייל – אתר דיווח השעות',
        text: 'אם קיבלת את המייל הזה – השרת יודע לשלוח מיילים (איפוס סיסמה ואימות הרשמה). 👍',
        html: mailHtml('בדיקת מייל ✓', ['אם קיבלת את המייל הזה – השרת יודע לשלוח מיילים (איפוס סיסמה ואימות הרשמה).'], { url: publicUrl, label: 'כניסה לאתר' }),
      });
    } catch (err) {
      log('test mail failed:', err);
      throw new HttpError(502, `השליחה נכשלה: ${err.message}`);
    }
    return { ok: true, to };
  }, { admin: true });

  route('GET', /^\/api\/admin\/mail$/, () => ({ enabled: mailer.enabled, info: mailer.info, publicUrl, emailDomain }), { admin: true });

  route('DELETE', /^\/api\/admin\/users\/([\w-]+)$/, async ({ params, session }) => {
    const u = findUser(params[0]);
    if (!u) throw new HttpError(404, 'משתמש לא נמצא');
    if (u.id === session.user.id) throw new HttpError(400, 'אי אפשר למחוק את עצמך');
    db.users = db.users.filter((x) => x.id !== u.id);
    delete db.reports[u.id];
    for (const [k, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[k];
    await store.save();
    return { ok: true };
  }, { admin: true });

  // ---------- טיפול בבקשות ----------

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'הבקשה גדולה מדי');
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'JSON לא תקין');
    }
  }

  function send(res, status, obj) {
    const json = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(json);
  }

  async function handleApi(req, res, url) {
    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
    if (!r) throw new HttpError(404, 'לא נמצא');
    // הגנת CSRF: בקשות משנות מצב חייבות להיות JSON (דפדפן לא שולח JSON בין-אתרי בלי preflight)
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'נדרש Content-Type: application/json');
    }
    const session = getSession(req);
    if (!r.public && !session) throw new HttpError(401, 'יש להתחבר');
    if (r.admin && !session.user.isAdmin) throw new HttpError(403, 'למנהלים בלבד');
    const body = req.method === 'GET' ? {} : await readBody(req);
    const params = url.pathname.match(r.pattern).slice(1);
    const result = await r.handler({ req, res, url, body, session, params });
    send(res, 200, result);
  }

  async function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Bad request');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, `.${rel}`);
    if (!file.startsWith(path.resolve(publicDir) + path.sep)) throw new HttpError(403, 'Forbidden');
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      throw new HttpError(404, 'לא נמצא');
    }
    if (!st.isFile()) throw new HttpError(404, 'לא נמצא');
    const mtime = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === mtime) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': mtime,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(await fs.readFile(file));
  }

  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'");
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await handleStatic(req, res, url);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) log(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'שגיאת שרת' : err.message, ...(err.code ? { code: err.code } : {}) });
      else res.end();
    }
  };

  // HTTPS אופציונלי: תעודה בפורמט pfx (מקבלים מה-IT)
  const pfxFile = config.https?.pfxFile;
  const server = pfxFile
    ? https.createServer({ pfx: readFileSync(path.resolve(ROOT, pfxFile)), passphrase: config.https.passphrase || undefined }, handler)
    : http.createServer(handler);

  server.store = store;
  server.mailer = mailer;
  server.log = log;
  return server;
}

// ---------- הפעלה ישירה ----------

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = loadConfig();
  const port = Number(process.env.PORT) || Number(config.port) || 8080;
  const host = process.env.HOST || config.host || '0.0.0.0';
  const dataDir = path.resolve(ROOT, process.env.DATA_DIR || config.dataDir || 'data');
  const scheme = config.https?.pfxFile ? 'https' : 'http';
  config.publicUrl ||= `${scheme}://${os.hostname().toLowerCase()}:${port}`;
  const log = makeLogger(dataDir);
  const server = await createApp({ dataDir, config, log });
  server.on('error', (err) => {
    log(err.code === 'EADDRINUSE' ? `הפורט ${port} תפוס – אולי השרת כבר רץ? (${err.message})` : err);
    process.exit(1);
  });
  server.listen(port, host, () => {
    log(`version ${VERSION} started on port ${port} (data: ${dataDir})`);
    console.log(`\n  דיווח שעות ${VERSION} פועל:`);
    console.log(`    ${config.publicUrl}   ← הכתובת לצוות`);
    console.log(`    ${scheme}://localhost:${port}`);
    for (const ip of lanAddresses()) console.log(`    ${scheme}://${ip}:${port}`);
    console.log(`\n  שכחתי סיסמה: ${server.mailer.enabled ? `מייל אוטומטי דרך ${server.mailer.info.host}:${server.mailer.info.port}` : 'הבקשה מגיעה למנהל הצוות (מסך הצוות), והוא שולח קישור איפוס'}`);
    console.log('  המשתמש הראשון שנרשם הופך למנהל הצוות.\n');
  });
  const stop = async () => {
    await server.store.queue;
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
