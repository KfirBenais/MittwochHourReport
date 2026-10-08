import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildXlsx, excelDateSerial } from '../public/js/excel.js';
import { autoFill } from '../public/js/report.js';
import { mergeSettings, mergeProfile } from '../public/js/defaults.js';
import {
  buildSubject, buildFileName, buildBody, buildEml, greetingOptions, seasonalGreeting, encodeHeader, mailtoLink, buildReminderIcs,
} from '../public/js/email.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('../public/vendor/exceljs.min.js');

// ExcelJS קורא בחזרה ערכים בפורמט תאריך/שעה כ-Date – ממירים חזרה למספר סידורי של אקסל
const num = (v) => (v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v);
const close = (a, b) => assert.ok(Math.abs(num(a) - b) < 1e-9, `${num(a)} != ${b}`);

const profile = mergeProfile({ fullName: 'כפיר בנאיס' });
const settings = mergeSettings({ policies: { erev: 'off', cholhamoed: 'off' } });

function september() {
  const pre = { '2026-09-14': { type: 'sick', note: 'מחלה' }, '2026-09-17': { type: 'vacation', note: 'חופש' } };
  return autoFill('2026-09', pre, settings, profile).days;
}

test('excel serial dates', () => {
  assert.equal(excelDateSerial('2026-10-01'), 46296);
  assert.equal(excelDateSerial('1900-03-01'), 61);
});

test('xlsx reproduces the "נוסח 1" template with formulas and cached results', async () => {
  const bytes = await buildXlsx(ExcelJS, { ym: '2026-09', days: september(), profile, settings });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.getWorksheet('נוסח 1');
  assert.ok(ws.views[0].rightToLeft);
  assert.equal(ws.getCell('B1').value, 'כפיר בנאיס');
  assert.equal(ws.getCell('J1').value, 'י.א. מיטווך ובניו בע"מ');
  assert.equal(ws.getCell('G4').value, '09/26');
  close(ws.getCell('B2').value, 30 / 1440);
  // 01/09 Tuesday
  close(ws.getCell('A12').value, excelDateSerial('2026-09-01'));
  assert.equal(ws.getCell('B12').value.formula, 'IF(A12>0,WEEKDAY(A12),"")');
  assert.equal(ws.getCell('B12').value.result, 3);
  close(ws.getCell('D12').value, 8 / 24);
  close(ws.getCell('E12').value, (16 * 60 + 45) / 1440);
  assert.equal(ws.getCell('I12').value.formula, 'IF(H12>0,IF(OR($B12>5,$C12="x",$C12="X"),H12,H12-$B$2),0)');
  close(ws.getCell('I12').value.result, 495 / 1440);
  // 14/09 sick
  assert.equal(ws.getCell('J25').value, 'מחלה');
  assert.equal(ws.getCell('D25').value, null);
  // 30 days → total on row 42, like the original 30-day sheets
  assert.equal(ws.getCell('D42').value, 'ס"ה ש"ע בפועל:');
  assert.equal(ws.getCell('I42').value.formula, 'SUM(I12:I41)');
  close(ws.getCell('I42').value.result, (107 * 60 + 15) / 1440);
  assert.equal(ws.getCell('A47').value, 'חתימת העובד');
});

test('31-day month puts the total on row 43', async () => {
  const days = autoFill('2026-10', {}, settings, profile).days;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildXlsx(ExcelJS, { ym: '2026-10', days, profile, settings }));
  const ws = wb.getWorksheet('נוסח 1');
  assert.equal(ws.getCell('I43').value.formula, 'SUM(I12:I42)');
  assert.equal(ws.getCell('A48').value, 'חתימת העובד');
  assert.equal(ws.getCell('J38').value, 'בחירות לכנסת');
});

test('subject, file name and body', () => {
  assert.equal(buildSubject(settings, profile, '2026-09'), 'דווח שעות ספטמבר 2026 - כפיר בנאיס');
  assert.equal(buildFileName(settings, profile, '2026-09'), 'דיווח שעות כפיר בנאיס ספטמבר 2026.xlsx');
  const body = buildBody({ recipientName: 'כוכי', greeting: 'שיהיה חודש טוב', ym: '2026-09', fullName: 'כפיר בנאיס' });
  assert.ok(body.startsWith('היי כוכי\n\nשיהיה חודש טוב\n'));
  assert.match(body, /ספטמבר 2026/);
});

test('greetings change by month and season', () => {
  const a = greetingOptions('2026-05', '2026-06-01')[0];
  const b = greetingOptions('2026-06', '2026-07-01')[0];
  assert.notEqual(a, b);
  assert.equal(seasonalGreeting('2026-10-01'), 'מועדים לשמחה! ושיהיה חודש טוב');
  assert.equal(seasonalGreeting('2026-09-01'), 'שנה טובה ומתוקה! ושיהיה חודש טוב');
  assert.equal(seasonalGreeting('2026-12-01'), 'חנוכה שמח! ושיהיה חודש טוב');
  assert.equal(seasonalGreeting('2026-07-01'), null);
});

test('eml opens as an unsent draft with the attachment', () => {
  const eml = buildEml({
    to: 'kohava@ncr.co.il', cc: '', subject: 'דווח שעות ספטמבר 2026 - כפיר בנאיס', text: 'היי כוכי\n\nשיהיה חודש טוב\n',
    attachment: { filename: 'דיווח שעות כפיר בנאיס ספטמבר 2026.xlsx', contentType: 'application/x-test', bytes: new Uint8Array([1, 2, 3]) },
  });
  assert.ok(eml.startsWith('X-Unsent: 1\r\nTo: kohava@ncr.co.il\r\n'));
  assert.ok(!/\r\nCc:/.test(eml));
  assert.match(eml, /Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
  assert.match(eml, /filename\*=UTF-8''%D7%93/);
  assert.match(eml, /\r\nAQID\r\n/); // base64 of [1,2,3]
  for (const line of eml.split('\r\n')) if (!line.startsWith('Content-')) assert.ok(line.length <= 998);
  // subject decodes back
  const subj = eml.split('\r\n').reduce((acc, l, i, arr) => acc ?? (l.startsWith('Subject: ') ? [l.slice(9), ...arr.slice(i + 1).filter((x, j, a) => a.slice(0, j + 1).every((y) => y.startsWith(' ')))].join('') : null), null);
  const decoded = subj.trim().split(/\s+/).map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.equal(decoded, 'דווח שעות ספטמבר 2026 - כפיר בנאיס');
});

test('header encoding keeps every encoded word ≤ 75 chars', () => {
  for (const w of encodeHeader('א'.repeat(200)).split('\r\n ')) assert.ok(w.length <= 75, w.length);
  assert.equal(encodeHeader('plain ascii'), 'plain ascii');
});

test('mailto fallback and calendar reminder', () => {
  const link = mailtoLink({ to: 'kohava@ncr.co.il', subject: 'א', text: 'ב' });
  assert.ok(link.startsWith('mailto:kohava@ncr.co.il?subject=%D7%90&body=%D7%91'));
  const ics = buildReminderIcs({ url: 'http://hours', recipientName: 'כוכי' });
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYDAY=SU,MO,TU,WE,TH;BYSETPOS=1/);
});
