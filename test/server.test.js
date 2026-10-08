import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, stripJsonComments } from '../server.js';

// ---------- שרת SMTP מדומה ----------

const inbox = [];
let smtp;

function startFakeSmtp() {
  return new Promise((resolve) => {
    smtp = net.createServer((sock) => {
      let buf = '';
      let data = null;
      const msg = { auth: null, from: null, to: [] };
      sock.write('220 fake.smtp ready\r\n');
      sock.on('data', (chunk) => {
        buf += chunk.toString('latin1');
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (data !== null) {
            if (line === '.') {
              inbox.push({ ...msg, raw: Buffer.from(data.join('\r\n'), 'latin1').toString('utf8') });
              data = null;
              sock.write('250 queued\r\n');
            } else data.push(line.startsWith('..') ? line.slice(1) : line);
            continue;
          }
          const cmd = line.toUpperCase();
          if (cmd.startsWith('EHLO')) sock.write('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          else if (cmd.startsWith('AUTH PLAIN')) {
            msg.auth = Buffer.from(line.slice(11), 'base64').toString().split('\0');
            sock.write('235 ok\r\n');
          } else if (cmd.startsWith('MAIL FROM')) {
            msg.from = line.slice(10);
            sock.write('250 ok\r\n');
          } else if (cmd.startsWith('RCPT TO')) {
            msg.to.push(line.slice(8));
            sock.write('250 ok\r\n');
          } else if (cmd === 'DATA') {
            data = [];
            sock.write('354 go\r\n');
          } else if (cmd === 'QUIT') {
            sock.end('221 bye\r\n');
          } else sock.write('500 what\r\n');
        }
      });
    });
    smtp.listen(0, '127.0.0.1', () => resolve(smtp.address().port));
  });
}

/** מחלץ את גוף הטקסט מהמייל (base64) */
function mailText(m) {
  const part = m.raw.split('Content-Type: text/plain; charset="utf-8"')[1];
  const b64 = part.split('\r\n\r\n')[1].split('\r\n\r\n')[0].replace(/\r\n/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}
const linkToken = (m, kind) => mailText(m).match(new RegExp(`#/${kind}/([\\w-]+)`))[1];

// ---------- שרת האפליקציה ----------

let server;
let base;
let dir;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'hours-test-'));
  const smtpPort = await startFakeSmtp();
  server = await createApp({
    dataDir: dir,
    log: () => {},
    config: {
      publicUrl: 'http://hours.test:8080',
      emailDomain: 'ncr.co.il',
      mail: { host: '127.0.0.1', port: smtpPort, from: 'דיווח שעות <hours@ncr.co.il>', user: 'svc', password: 'pw' },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await server.store.queue;
  server.close();
  smtp.close();
  await rm(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}

const admin = client();
const dana = client();

test('first user becomes a verified admin; only company emails can register', async () => {
  let r = await admin('GET', '/api/health');
  assert.equal(r.data.needsSetup, true);
  assert.equal(r.data.emailDomain, 'ncr.co.il');
  assert.equal(r.data.mailEnabled, true);

  r = await admin('POST', '/api/register', { email: 'kfir@gmail.com', password: 'secret123', fullName: 'כפיר בנאיס' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /ncr\.co\.il/);

  r = await admin('POST', '/api/register', { email: 'Kfir@NCR.co.il', password: 'short', fullName: 'כפיר בנאיס' });
  assert.equal(r.status, 400, 'password too short');

  r = await admin('POST', '/api/register', { email: 'Kfir@NCR.co.il', password: 'secret123', fullName: 'כפיר בנאיס', phone: '050-123-4567' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isAdmin, true);
  assert.equal(r.data.user.verified, true);
  assert.equal(r.data.user.email, 'kfir@ncr.co.il');
  assert.equal(r.data.user.phone, '0501234567');
  assert.equal(inbox.length, 0, 'no verification mail for the first admin');

  r = await admin('PUT', '/api/settings', { teamCode: 'ncr2026', requireApproval: false });
  assert.equal(r.data.settings.teamCode, 'ncr2026');
  assert.equal(r.data.settings.requireApproval, false);
});

test('registration with email verification', async () => {
  let r = await dana('POST', '/api/register', { email: 'dana@ncr.co.il', password: 'danapass1', fullName: 'דנה כהן', teamCode: 'wrong' });
  assert.equal(r.status, 403);
  r = await dana('POST', '/api/register', { email: 'dana@ncr.co.il', password: 'danapass1', fullName: 'דנה כהן', teamCode: 'ncr2026', phone: 'abc' });
  assert.equal(r.status, 400, 'bad phone');
  r = await dana('POST', '/api/register', { email: 'dana@ncr.co.il', password: 'danapass1', fullName: 'דנה כהן', teamCode: 'ncr2026' });
  assert.deepEqual(r.data, { pendingVerification: true, pendingApproval: false, email: 'dana@ncr.co.il' });

  const mail = inbox.at(-1);
  assert.deepEqual(mail.to, ['<dana@ncr.co.il>']);
  assert.equal(mail.from, '<hours@ncr.co.il>');
  assert.deepEqual(mail.auth, ['', 'svc', 'pw']);
  assert.match(mail.raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(mailText(mail), /http:\/\/hours\.test:8080\/#\/verify\//);

  r = await dana('POST', '/api/login', { email: 'dana@ncr.co.il', password: 'danapass1' });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'unverified');

  r = await dana('POST', '/api/verify', { token: 'nope' });
  assert.equal(r.status, 400);
  r = await dana('POST', '/api/verify', { token: linkToken(mail, 'verify') });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.verified, true);
  assert.equal((await dana('GET', '/api/me')).data.user.email, 'dana@ncr.co.il');
  // the link works only once
  assert.equal((await client()('POST', '/api/verify', { token: linkToken(mail, 'verify') })).status, 400);

  r = await dana('POST', '/api/register', { email: 'dana@ncr.co.il', password: 'danapass1', fullName: 'דנה', teamCode: 'ncr2026' });
  assert.equal(r.status, 409);
});

test('forgot password sends a one-time reset link', async () => {
  const anon = client();
  const before = inbox.length;
  let r = await anon('POST', '/api/password/forgot', { email: 'nobody@ncr.co.il' });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(inbox.length, before, 'no mail for unknown addresses (same answer though)');

  r = await anon('POST', '/api/password/forgot', { email: 'dana@ncr.co.il' });
  assert.deepEqual(r.data, { ok: true });
  const mail = inbox.at(-1);
  assert.deepEqual(mail.to, ['<dana@ncr.co.il>']);
  const token = linkToken(mail, 'reset');

  // a second request within a minute is throttled
  await anon('POST', '/api/password/forgot', { email: 'dana@ncr.co.il' });
  assert.equal(inbox.at(-1), mail);

  assert.equal((await anon('POST', '/api/password/reset', { token, password: 'short' })).status, 400);
  r = await anon('POST', '/api/password/reset', { token, password: 'newpass99' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'dana@ncr.co.il');
  assert.equal((await anon('POST', '/api/password/reset', { token, password: 'again999' })).status, 400, 'single use');

  assert.equal((await dana('GET', '/api/me')).data.user, null, 'old sessions are revoked');
  assert.equal((await dana('POST', '/api/login', { email: 'dana@ncr.co.il', password: 'danapass1' })).status, 401);
  assert.equal((await dana('POST', '/api/login', { email: 'DANA@ncr.co.il', password: 'newpass99' })).status, 200);
});

test('reports, history and the send-time snapshot', async () => {
  let r = await dana('PUT', '/api/reports/2026-09', { days: { '2026-09-01': { type: 'work', in1: '08:00', out1: '16:45' }, '2026-10-01': { type: 'work' } } });
  assert.deepEqual(Object.keys(r.data.days), ['2026-09-01']);
  await dana('PUT', '/api/reports/2025-12', { days: { '2025-12-01': { type: 'vacation', note: 'חופש' } } });

  r = await dana('POST', '/api/reports/2026-09/sent', {});
  assert.deepEqual({ ...r.data.snapshot, at: undefined }, { fullName: 'דנה כהן', breakMin: 30, companyName: 'י.א. מיטווך ובניו בע"מ', at: undefined });

  // profile changes later – the September snapshot stays as it was sent
  r = await dana('PUT', '/api/me', { fullName: 'דנה לוי', breakMin: 45, phone: '+972501234567' });
  assert.equal(r.data.user.fullName, 'דנה לוי');
  assert.equal(r.data.user.phone, '+972501234567');
  assert.equal(r.data.user.email, 'dana@ncr.co.il', 'email cannot be changed');
  r = await dana('POST', '/api/reports/2026-09/sent', {});
  assert.equal(r.data.snapshot.fullName, 'דנה כהן');
  assert.equal(r.data.snapshot.breakMin, 30);

  r = await dana('GET', '/api/reports');
  assert.deepEqual(Object.keys(r.data.months).sort(), ['2025-12', '2026-09']);
  r = await dana('GET', '/api/reports?year=2026');
  assert.deepEqual(Object.keys(r.data.months), ['2026-09']);

  // the team view uses the snapshot (break 30 → 8:15 = 495 minutes)
  r = await admin('GET', '/api/team?ym=2026-09');
  const d = r.data.members.find((m) => m.email === 'dana@ncr.co.il');
  assert.equal(d.summary.netMin, 495);
  assert.equal(d.phone, '+972501234567');
  assert.equal(d.verified, true);
});

test('admin tools: permissions, test mail, manual verification, legacy usernames', async () => {
  assert.equal((await dana('GET', '/api/team?ym=2026-09')).status, 403);
  assert.equal((await dana('POST', '/api/admin/test-mail', { to: 'dana@ncr.co.il' })).status, 403);
  assert.equal((await client()('GET', '/api/reports/2026-09')).status, 401);

  let r = await admin('POST', '/api/admin/test-mail', {});
  assert.deepEqual(r.data, { ok: true, to: 'kfir@ncr.co.il' });
  assert.deepEqual(inbox.at(-1).to, ['<kfir@ncr.co.il>']);
  r = await admin('GET', '/api/admin/mail');
  assert.equal(r.data.enabled, true);

  // someone whose verification mail got lost – the manager approves manually
  const yossi = client();
  r = await yossi('POST', '/api/register', { email: 'yossi@ncr.co.il', password: 'yossipass', fullName: 'יוסי', teamCode: 'ncr2026' });
  assert.equal(r.data.pendingVerification, true);
  const team = (await admin('GET', '/api/team?ym=2026-09')).data.members;
  const y = team.find((m) => m.email === 'yossi@ncr.co.il');
  assert.equal(y.verified, false);
  await admin('PUT', `/api/admin/users/${y.id}`, { verified: true });
  assert.equal((await yossi('POST', '/api/login', { email: 'yossi@ncr.co.il', password: 'yossipass' })).status, 200);

  // users created before the email change log in with their old username
  server.store.data.users.push({ ...server.store.data.users.find((u) => u.email === 'yossi@ncr.co.il'), id: 'legacy', username: 'old', email: '' });
  assert.equal((await client()('POST', '/api/login', { email: 'old@ncr.co.il', password: 'yossipass' })).status, 200);

  await server.store.queue;
  const saved = JSON.parse(await readFile(path.join(dir, 'db.json'), 'utf8'));
  assert.ok(!JSON.stringify(saved).includes('newpass99'), 'passwords are hashed');
  assert.ok(!JSON.stringify(saved.tokens).includes(linkToken(inbox.find((m) => mailText(m).includes('#/reset/')), 'reset')), 'tokens are stored hashed');
});

test('CSRF guard and static file safety', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 403);
  assert.equal((await fetch(`${base}/../config.json`)).status, 404);
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
});

test('config.json may contain // comments', () => {
  const cfg = JSON.parse(stripJsonComments('// hi\n{\n  "publicUrl": "http://x:8080", // the url\n  "mail": { "from": "a // b" }\n}'));
  assert.equal(cfg.publicUrl, 'http://x:8080');
  assert.equal(cfg.mail.from, 'a // b');
});

// ---------- בלי מיילים מהשרת (ברירת המחדל): אישור מנהל וקישורי איפוס שהמנהל שולח ----------

test('no mail server: admin approval and admin-sent reset links', async () => {
  const dir2 = await mkdtemp(path.join(os.tmpdir(), 'hours-test2-'));
  const app = await createApp({ dataDir: dir2, log: () => {}, config: { publicUrl: 'http://srv:8080' } });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base2 = `http://127.0.0.1:${app.address().port}`;
  const c = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base2 + url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
  };
  try {
    const boss = c();
    const emp = c();
    assert.equal((await boss('GET', '/api/health')).data.mailEnabled, false);
    assert.equal((await boss('POST', '/api/register', { email: 'boss@ncr.co.il', password: 'bosspass1', fullName: 'מנהל' })).status, 200);

    // by default a valid company email gets in right away – no code, no approval
    let r = await emp('POST', '/api/register', { email: 'emp@ncr.co.il', password: 'emppass12', fullName: 'עובד' });
    assert.equal(r.data.user.email, 'emp@ncr.co.il');
    assert.equal((await boss('GET', '/api/me')).data.pending, 0);
    const id = (await boss('GET', '/api/team?ym=2026-10')).data.members.find((m) => m.email === 'emp@ncr.co.il').id;

    // forgot password → request shows up for the manager
    r = await c()('POST', '/api/password/forgot', { email: 'emp@ncr.co.il' });
    assert.deepEqual(r.data, { ok: true, viaAdmin: true });
    let m = (await boss('GET', '/api/team?ym=2026-10')).data.members.find((x) => x.id === id);
    assert.ok(m.resetRequestedAt);
    assert.equal((await boss('GET', '/api/me')).data.pending, 1);

    // the manager creates a one-time link and sends it himself
    r = await boss('POST', `/api/admin/users/${id}/reset-link`, {});
    assert.equal(r.data.email, 'emp@ncr.co.il');
    assert.match(r.data.url, /^http:\/\/srv:8080\/#\/reset\//);
    assert.equal((await emp('POST', '/api/admin/users/x/reset-link', {})).status, 403);
    m = (await boss('GET', '/api/team?ym=2026-10')).data.members.find((x) => x.id === id);
    assert.equal(m.resetRequestedAt, null);
    r = await c()('POST', '/api/password/reset', { token: r.data.token, password: 'brandnew1' });
    assert.equal(r.data.user.email, 'emp@ncr.co.il');
    assert.equal((await emp('GET', '/api/me')).data.user, null, 'old sessions revoked');
    assert.equal((await emp('POST', '/api/login', { email: 'emp@ncr.co.il', password: 'brandnew1' })).status, 200);

    // optional: the manager can require approval for new accounts
    await boss('PUT', '/api/settings', { requireApproval: true });
    const late = c();
    r = await late('POST', '/api/register', { email: 'new@ncr.co.il', password: 'newpass12', fullName: 'חדש' });
    assert.deepEqual(r.data, { pendingApproval: true, email: 'new@ncr.co.il' });
    r = await late('POST', '/api/login', { email: 'new@ncr.co.il', password: 'newpass12' });
    assert.equal(r.data.code, 'pending');
    const newId = (await boss('GET', '/api/team?ym=2026-10')).data.members.find((x) => x.email === 'new@ncr.co.il').id;
    await boss('PUT', `/api/admin/users/${newId}`, { approved: true });
    assert.equal((await late('POST', '/api/login', { email: 'new@ncr.co.il', password: 'newpass12' })).status, 200);
  } finally {
    await app.store.queue;
    app.close();
    await rm(dir2, { recursive: true, force: true });
  }
});
