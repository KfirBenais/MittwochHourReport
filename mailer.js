// שליחת מיילים מהשרת (איפוס סיסמה, אימות מייל) – לקוח SMTP קטן ללא תלויות.
// תומך ב-STARTTLS, ב-TLS מלא (פורט 465) ובהזדהות AUTH PLAIN / LOGIN.

import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';
import { encodeHeader, bytesToBase64 } from './public/js/email.js';

const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (s) => bytesToBase64(utf8(s));
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();

/** "דיווח שעות <hours@ncr.co.il>" → { name, address } */
export function parseAddress(value) {
  const m = String(value || '').trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim(), address: m[2] };
  return { name: '', address: String(value || '').trim() };
}

const formatAddress = ({ name, address }) => (name ? `${encodeHeader(name).replace(/\r\n /g, ' ')} <${address}>` : `<${address}>`);

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;
  const fromAddr = parseAddress(from);
  const lines = [
    `From: ${formatAddress(fromAddr)}`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${fromAddr.address.split('@')[1] || os.hostname()}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text.replace(/\r?\n/g, '\r\n'))),
    '',
  ];
  if (html) {
    lines.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(html)),
      '',
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

/** שיחת SMTP אחת: מחזיר פונקציות לשליחת פקודה וקריאת תשובה */
function smtpConnection(socket, timeoutMs) {
  let buffer = '';
  let lines = [];
  const replies = [];
  const waiters = [];
  let failure = null;

  const deliver = (item) => {
    const w = waiters.shift();
    if (w) w(item);
    else replies.push(item);
  };

  const onData = (chunk) => {
    buffer += chunk.toString('latin1');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        deliver({ code: Number(line.slice(0, 3)), lines, text: lines.map((l) => l.slice(4)).join(' ') });
        lines = [];
      }
    }
  };
  const onError = (err) => {
    failure = err;
    while (waiters.length) waiters.shift()({ error: err });
  };

  let current = socket;
  const attach = (s) => {
    current = s;
    s.on('data', onData);
    s.on('error', onError);
    s.on('close', () => onError(new Error('החיבור לשרת המייל נסגר')));
    s.setTimeout(timeoutMs, () => s.destroy(new Error('שרת המייל לא הגיב בזמן')));
  };
  attach(socket);

  const read = () => new Promise((resolve, reject) => {
    const done = (item) => (item.error ? reject(item.error) : resolve(item));
    if (replies.length) done(replies.shift());
    else if (failure) reject(failure);
    else waiters.push(done);
  });

  return {
    read,
    async cmd(line, expect, label = line.split(' ')[0]) {
      current.write(`${line}\r\n`);
      const r = await read();
      if (!expect.includes(r.code)) throw new Error(`שרת המייל דחה את ${label}: ${r.code} ${r.text}`);
      return r;
    },
    upgrade(options) {
      current.removeListener('data', onData);
      current.removeAllListeners('error');
      current.removeAllListeners('close');
      current.setTimeout(0);
      return new Promise((resolve, reject) => {
        const secure = tls.connect({ socket: current, ...options }, () => resolve());
        secure.once('error', reject);
        attach(secure);
      });
    },
    get socket() {
      return current;
    },
  };
}

/**
 * יוצר שולח מיילים לפי הגדרות "mail" בקובץ config.json.
 * אם host או from חסרים – המיילים מושבתים (enabled = false).
 */
export function createMailer(cfg = {}, log = () => {}) {
  const enabled = !!(cfg && cfg.host && cfg.from);
  const port = Number(cfg.port) || (cfg.secure ? 465 : 25);
  const timeoutMs = Number(cfg.timeoutMs) || 20000;
  const tlsOptions = { servername: cfg.host, rejectUnauthorized: !cfg.allowSelfSignedCert };

  async function send({ to, subject, text, html }) {
    if (!enabled) throw new Error('שליחת מיילים לא מוגדרת בשרת (config.json → mail)');
    const fromAddr = parseAddress(cfg.from);
    const socket = await new Promise((resolve, reject) => {
      const s = cfg.secure
        ? tls.connect({ host: cfg.host, port, ...tlsOptions }, () => resolve(s))
        : net.connect({ host: cfg.host, port }, () => resolve(s));
      s.once('error', reject);
      s.setTimeout(timeoutMs, () => s.destroy(new Error(`אין חיבור לשרת המייל ${cfg.host}:${port}`)));
    });
    const c = smtpConnection(socket, timeoutMs);
    try {
      const greet = await c.read();
      if (greet.code !== 220) throw new Error(`שרת המייל לא מוכן: ${greet.code} ${greet.text}`);
      const helo = cfg.heloName || os.hostname();
      let ehlo = await c.cmd(`EHLO ${helo}`, [250]);
      const has = (cap) => ehlo.lines.some((l) => l.slice(4).toUpperCase().startsWith(cap));
      if (!cfg.secure && cfg.starttls !== false && has('STARTTLS')) {
        await c.cmd('STARTTLS', [220]);
        await c.upgrade(tlsOptions);
        ehlo = await c.cmd(`EHLO ${helo}`, [250]);
      }
      if (cfg.user) {
        const auth = ehlo.lines.find((l) => l.slice(4).toUpperCase().startsWith('AUTH')) || '';
        if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
          await c.cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.password || ''}`)}`, [235], 'AUTH');
        } else {
          await c.cmd('AUTH LOGIN', [334], 'AUTH');
          await c.cmd(b64(cfg.user), [334], 'AUTH (user)');
          await c.cmd(b64(cfg.password || ''), [235], 'AUTH (password)');
        }
      }
      await c.cmd(`MAIL FROM:<${fromAddr.address}>`, [250], 'MAIL FROM');
      await c.cmd(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
      await c.cmd('DATA', [354]);
      const msg = buildMessage({ from: cfg.from, to, subject, text, html })
        .split('\r\n').map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n');
      await c.cmd(`${msg}\r\n.`, [250], 'DATA (תוכן ההודעה)');
      await c.cmd('QUIT', [221]).catch(() => {});
      log(`mail sent to ${to}: ${subject}`);
    } finally {
      c.socket.destroy();
    }
  }

  return {
    enabled,
    info: enabled ? { host: cfg.host, port, from: cfg.from } : null,
    send,
  };
}
