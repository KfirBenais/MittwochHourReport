import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  holidaysForYear, eventsOn, primaryEvent, hebrewDateLabel, gematria, weekday,
  monthDays, shiftMonth, firstWorkday, groupEvents, monthEvents,
} from '../public/js/calendar.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/hebcal-il-2024-2036.json', import.meta.url)));

test('holidays match hebcal (Israel) for 2024–2036', () => {
  const mine = {};
  for (let y = 2024; y <= 2036; y++) {
    for (const [iso, evs] of holidaysForYear(y)) mine[iso] = [...new Set(evs.map((e) => e.name))].sort();
  }
  assert.deepEqual(mine, fixture);
});

test('2026 high holidays as reported in the real sheets', () => {
  assert.equal(primaryEvent('2026-09-11').name, 'ערב ראש השנה');
  assert.equal(primaryEvent('2026-09-12').kind, 'holiday');
  assert.equal(primaryEvent('2026-09-20').name, 'ערב יום כיפור');
  assert.equal(primaryEvent('2026-09-21').name, 'יום כיפור');
  assert.equal(primaryEvent('2026-09-27').name, 'חול המועד סוכות');
  assert.equal(primaryEvent('2026-10-01').kind, 'cholhamoed');
  assert.equal(primaryEvent('2026-07-23').name, 'תשעה באב');
  assert.equal(primaryEvent('2026-07-23').kind, 'fast');
  assert.equal(primaryEvent('2026-10-04'), null);
});

test('special dates from settings are merged and ranked', () => {
  const special = [{ date: '2026-10-27', name: 'בחירות לכנסת', kind: 'holiday' }];
  const ev = eventsOn('2026-10-27', special);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].name, 'בחירות לכנסת');
  assert.equal(ev[0].special, true);
});

test('hebrew date labels and gematria', () => {
  assert.equal(gematria(15), 'ט״ו');
  assert.equal(gematria(16), 'ט״ז');
  assert.equal(gematria(1), 'א׳');
  assert.equal(gematria(787), 'תשפ״ז');
  assert.equal(hebrewDateLabel('2026-09-12'), 'א׳ בתשרי');
  assert.equal(hebrewDateLabel('2026-09-26', true), 'ט״ו בתשרי תשפ״ז');
});

test('date helpers', () => {
  assert.equal(weekday('2026-10-08'), 4); // Thursday
  assert.equal(monthDays('2026-02').length, 28);
  assert.equal(monthDays('2028-02').length, 29);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  // Oct 1 2026 is Thursday, chol hamoed – still a working day
  assert.equal(firstWorkday('2026-10'), '2026-10-01');
  // Sep 2025: Sep 1 is Monday
  assert.equal(firstWorkday('2025-09'), '2025-09-01');
  // Apr 2027: Pesach starts Apr 22 – Apr 1 is Thursday
  assert.equal(firstWorkday('2027-04'), '2027-04-01');
});

test('groupEvents merges consecutive days', () => {
  const groups = groupEvents(monthEvents('2026-09'));
  const ch = groups.find((g) => g.name === 'חול המועד סוכות');
  assert.deepEqual([ch.from, ch.to], ['2026-09-27', '2026-09-30']);
  const rh = groups.find((g) => g.name === 'ראש השנה');
  assert.deepEqual([rh.from, rh.to], ['2026-09-12', '2026-09-13']);
});
