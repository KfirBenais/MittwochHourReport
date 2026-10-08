import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFill, summarize, validate, calcDay, fmtMin, sanitizeDays, suggestDay, shortDay, offDay,
} from '../public/js/report.js';
import { mergeSettings, mergeProfile } from '../public/js/defaults.js';

const profile = mergeProfile({ fullName: 'כפיר בנאיס' });
const settings = (policies = {}) => mergeSettings({ policies });

// הסכומים נלקחו מהקבצים המקוריים (תא "ס"ה ש"ע בפועל")
test('June 2026 – plain month = 181:30', () => {
  const { days } = autoFill('2026-06', {}, settings(), profile);
  assert.equal(fmtMin(summarize('2026-06', days, profile).netMin), '181:30');
});

test('July 2026 – Tisha B\'Av short day without break = 178:15', () => {
  const { days, pending } = autoFill('2026-07', {}, settings({ fast: 'short' }), profile);
  assert.deepEqual(pending, []);
  assert.deepEqual(days['2026-07-23'], { type: 'work', in1: '08:00', out1: '13:00', in2: '', out2: '', noBreak: true, note: 'תשעה באב' });
  assert.equal(fmtMin(summarize('2026-07', days, profile).netMin), '178:15');
});

test('August 2026 – vacation days = 140:15', () => {
  let { days } = autoFill('2026-08', {}, settings(), profile);
  for (const d of ['09', '10', '11', '12', '31']) days[`2026-08-${d}`] = { type: 'vacation', note: 'חופש' };
  const s = summarize('2026-08', days, profile);
  assert.equal(fmtMin(s.netMin), '140:15');
  assert.equal(s.vacation, 5);
  assert.deepEqual(validate('2026-08', days, settings(), profile), []);
});

test('September 2026 – holidays, sick and vacation = 107:15', () => {
  const pre = {
    '2026-09-14': { type: 'sick', note: 'מחלה' },
    '2026-09-17': { type: 'vacation', note: 'חופש' },
  };
  const ask = autoFill('2026-09', pre, settings({ erev: 'ask', cholhamoed: 'ask' }), profile);
  // במדיניות "להשאיר לבחירה" – ערב יום כיפור וחול המועד נשארים להחלטה
  assert.deepEqual(ask.pending, ['2026-09-20', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
  const errs = validate('2026-09', ask.days, settings({ erev: 'ask', cholhamoed: 'ask' }), profile);
  assert.equal(errs.length, 5);
  assert.match(errs[0].msg, /ערב יום כיפור/);

  const { days } = autoFill('2026-09', pre, settings({ erev: 'off', cholhamoed: 'off' }), profile);
  assert.equal(days['2026-09-12'].note, 'ראש השנה');
  assert.equal(days['2026-09-21'].type, 'holiday');
  const s = summarize('2026-09', days, profile);
  assert.equal(fmtMin(s.netMin), '107:15');
  assert.equal(s.sick, 1);
  assert.equal(s.vacation, 3, '17/09 + four days of chol hamoed not worked (½ each)');
  assert.deepEqual(validate('2026-09', days, settings(), profile), []);
});

test('default policy: erev chag is a day off, chol hamoed is left for the user, "didn\'t work" on chol hamoed = half vacation', () => {
  const pre = { '2026-09-14': { type: 'sick', note: 'מחלה' }, '2026-09-17': { type: 'vacation', note: 'חופש' } };
  const { days, pending } = autoFill('2026-09', pre, settings(), profile);
  assert.deepEqual(pending, ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'], 'chol hamoed waits for a choice');
  assert.deepEqual(days['2026-09-20'], { type: 'holiday', in1: '', out1: '', in2: '', out2: '', noBreak: false, note: 'ערב יום כיפור' });
  assert.equal(days['2026-09-28'], undefined);

  // the quick choices: worked 08:00–13:00 / didn't work
  days['2026-09-27'] = shortDay(settings(), 'חול המועד סוכות');
  for (const d of ['28', '29', '30']) days[`2026-09-${d}`] = offDay('חול המועד סוכות');
  const s = summarize('2026-09', days, profile);
  assert.equal(fmtMin(s.netMin), '112:15'); // 107:15 + 5:00
  assert.equal(s.vacation, 2.5, '1 vacation day + 3 × half a day of chol hamoed');
  assert.equal(s.holiday, 3, 'erev / chag are not vacation: ראש השנה (13/9), ערב יום כיפור, יום כיפור');
  assert.deepEqual(validate('2026-09', days, settings(), profile), []);

  // "vacation" on chol hamoed is also half a day
  days['2026-09-30'] = { type: 'vacation', note: 'חצי יום חופש (חוה״מ)' };
  assert.equal(summarize('2026-09', days, profile).vacation, 2.5);

  // his real September (all chol hamoed days off) = 107:15 and 3 vacation days (1 + 4 × ½)
  const real = autoFill('2026-09', pre, settings({ cholhamoed: 'off' }), profile).days;
  const r = summarize('2026-09', real, profile);
  assert.equal(fmtMin(r.netMin), '107:15');
  assert.equal(r.vacation, 3);

  // October: Oct 1 (chol hamoed) waits; Hoshana Raba / Simchat Torah fall on the weekend and cost nothing
  const oct = autoFill('2026-10', {}, settings(), profile);
  assert.deepEqual(oct.pending, ['2026-10-01']);
  assert.equal(oct.days['2026-10-02'].note, 'הושענא רבה');
  assert.equal(summarize('2026-10', oct.days, profile).vacation, 0);
});

test('election day 27/10/2026 is a day off by default', () => {
  assert.deepEqual(suggestDay('2026-10-27', settings(), profile), { type: 'holiday', in1: '', out1: '', in2: '', out2: '', noBreak: false, note: 'בחירות לכנסת' });
});

test('calcDay follows the Excel formula', () => {
  const d = { type: 'work', in1: '08:00', out1: '16:45' };
  assert.deepEqual(calcDay('2026-10-04', d, 30), { gross: 525, net: 495 });
  // Friday (WEEKDAY=6 > 5) – no break deduction
  assert.deepEqual(calcDay('2026-10-09', d, 30), { gross: 525, net: 525 });
  // split shift + no break
  assert.deepEqual(calcDay('2026-10-04', { ...d, out1: '12:00', in2: '13:00', out2: '17:00', noBreak: true }, 30), { gross: 480, net: 480 });
  // absence types ignore any stray hours
  assert.deepEqual(calcDay('2026-10-04', { ...d, type: 'vacation' }, 30), { gross: 0, net: 0 });
});

test('validation catches the common mistakes', () => {
  const s = settings();
  const days = {
    '2026-10-04': { type: 'work', in1: '08:00', out1: '' },
    '2026-10-05': { type: 'work', in1: '17:00', out1: '08:00' },
    '2026-10-06': { type: 'other', note: '' },
    '2026-10-07': { type: 'work', in1: '08:00', out1: '08:20' },
  };
  const issues = validate('2026-10', days, s, profile, { uptoISO: '2026-10-08' });
  const by = (d) => issues.filter((i) => i.date === d).map((i) => i.msg).join(' | ');
  assert.match(by('2026-10-01'), /חול המועד/);
  assert.match(by('2026-10-04'), /לא מלאה/);
  assert.match(by('2026-10-05'), /אחרי שעת הכניסה/);
  assert.match(by('2026-10-06'), /לפרט/);
  assert.match(by('2026-10-07'), /אין הפסקה/);
  assert.match(by('2026-10-08'), /חסר דיווח/);
  assert.equal(by('2026-10-11'), ''); // future days are not errors while the month is running
});

test('sanitizeDays drops junk and out-of-month dates', () => {
  const clean = sanitizeDays('2026-10', {
    '2026-10-04': { type: 'work', in1: '08:00', out1: '25:00', note: 'x'.repeat(500), evil: 1 },
    '2026-11-01': { type: 'work' },
    '../etc': { type: 'work' },
    '2026-10-05': { type: 'hack' },
  });
  assert.deepEqual(Object.keys(clean), ['2026-10-04']);
  assert.equal(clean['2026-10-04'].out1, '');
  assert.equal(clean['2026-10-04'].note.length, 120);
  assert.equal(clean['2026-10-04'].evil, undefined);
});
