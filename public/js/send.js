// חלון השליחה: בדיקת תקינות, תצוגה מקדימה של המייל, יצירת אקסל וקובץ eml לאאוטלוק.

import { monthLabel, monthDays, todayISO, formatShort, weekday, WEEKDAY_NAMES } from './calendar.js';
import { validate, summarize, fmtMin } from './report.js';
import { buildXlsx, XLSX_MIME } from './excel.js';
import {
  buildSubject, buildFileName, buildBody, buildEml, greetingOptions, mailtoLink,
} from './email.js';
import {
  h, clear, icon, modal, toast, download, loadScript, formatDays,
} from './ui.js';

async function makeXlsx(ctx, { ym, days, profile }) {
  await loadScript('vendor/exceljs.min.js');
  return buildXlsx(window.ExcelJS, { ym, days, profile, settings: ctx.settings });
}

/** הורדת קובץ האקסל בלבד (משמש גם במסך הצוות) */
export async function downloadExcel(ctx, { ym, days, profile }) {
  try {
    const bytes = await makeXlsx(ctx, { ym, days, profile });
    download(bytes, buildFileName(ctx.settings, profile, ym), XLSX_MIME);
  } catch (err) {
    toast(`יצירת האקסל נכשלה: ${err.message}`, 'error', 7000);
  }
}

const fileSafe = (s) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();

export async function openSendDialog(ctx, {
  ym, days, profile = ctx.user.profile, onSent, onJump,
}) {
  const { settings, store } = ctx;
  const today = todayISO();
  const lastDay = monthDays(ym).at(-1);
  const issues = validate(ym, days, settings, profile);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  if (today <= lastDay) warns.unshift({ date: null, level: 'warn', msg: `${monthLabel(ym)} עוד לא הסתיים – בדרך כלל שולחים ביום העבודה הראשון של החודש הבא.` });
  const s = summarize(ym, days, profile, settings.special);

  const options = greetingOptions(ym, today, settings.special);
  let greetingIdx = 0;
  let bodyEdited = false;
  const makeBody = () => buildBody({ recipientName: settings.recipientName, greeting: options[greetingIdx], ym, fullName: profile.fullName });

  const subject = h('input', { type: 'text', value: buildSubject(settings, profile, ym), 'aria-label': 'נושא' });
  const cc = h('input', { type: 'text', value: settings.ccEmail || '', placeholder: 'אופציונלי', 'aria-label': 'עותק' });
  const body = h('textarea', { rows: 8, 'aria-label': 'גוף המייל', oninput: () => { bodyEdited = true; } });
  body.value = makeBody();
  const fileName = buildFileName(settings, profile, ym);

  const nextGreeting = () => {
    if (bodyEdited) {
      const cur = options[greetingIdx];
      greetingIdx = (greetingIdx + 1) % options.length;
      if (body.value.includes(cur)) body.value = body.value.replace(cur, options[greetingIdx]);
      else body.value = makeBody();
    } else {
      greetingIdx = (greetingIdx + 1) % options.length;
      body.value = makeBody();
    }
  };

  const issueList = (list, cls) => h('ul', { class: `issue-list ${cls}` }, list.map((i) => h('li', {},
    i.date ? h('button', { class: 'link', onclick: () => { m.close(); onJump?.(i.date); } }, `${WEEKDAY_NAMES[weekday(i.date)]} ${formatShort(i.date)}`) : null,
    i.date ? ' – ' : null,
    i.date ? i.msg.replace(/^[^–]+– /, '') : i.msg)));

  const checks = h('div', { class: 'checks' },
    errors.length
      ? h('div', { class: 'check-box bad' }, h('strong', {}, icon('alert', 16), ` יש ${errors.length} ימים שדורשים תיקון לפני השליחה:`), issueList(errors, 'bad'))
      : h('div', { class: 'check-box good' }, h('strong', {}, icon('check', 16), ' כל ימי העבודה מדווחים – הדוח נראה תקין')),
    warns.length ? h('div', { class: 'check-box warn' }, h('strong', {}, 'שימו לב:'), issueList(warns, 'warn')) : null);

  const summary = h('div', { class: 'send-summary' },
    h('div', {}, h('b', {}, fmtMin(s.netMin)), h('span', {}, 'שעות בפועל')),
    h('div', {}, h('b', {}, String(s.workDays)), h('span', {}, 'ימי עבודה')),
    h('div', {}, h('b', {}, formatDays(s.vacation)), h('span', {}, 'חופש')),
    h('div', {}, h('b', {}, formatDays(s.sick + s.familySick)), h('span', {}, 'מחלה')),
    s.reserve ? h('div', {}, h('b', {}, String(s.reserve)), h('span', {}, 'מילואים')) : null);

  const form = h('div', { class: 'mail-form' },
    h('div', { class: 'field-row' }, h('label', {}, 'אל'), h('div', { class: 'to' }, `${settings.recipientName} <${settings.recipientEmail}>`)),
    h('div', { class: 'field-row' }, h('label', {}, 'עותק'), cc),
    h('div', { class: 'field-row' }, h('label', {}, 'נושא'), subject),
    h('div', { class: 'field-row top' }, h('label', {}, 'תוכן'),
      h('div', { class: 'body-wrap' }, body,
        h('button', { class: 'btn ghost small', onclick: nextGreeting, title: 'ברכה אחרת' }, icon('refresh', 14), ' ברכה אחרת'))),
    h('div', { class: 'field-row' }, h('label', {}, 'מצורף'),
      h('button', { class: 'attachment', title: 'הורדה לבדיקה', onclick: () => downloadExcel(ctx, { ym, days, profile }) }, icon('file', 16), ` ${fileName}`)));

  const content = h('div', { class: 'send' }, checks, summary, form);

  const goBtn = h('button', { class: 'btn primary big', disabled: errors.length > 0 }, icon('mail'), ' פתיחה באאוטלוק');
  const override = errors.length ? h('button', { class: 'link small', onclick: () => { goBtn.disabled = false; override.remove(); } }, 'להמשיך בכל זאת') : null;

  const m = modal({
    title: `שליחת דיווח ${monthLabel(ym)} ל${settings.recipientName}`,
    body: content,
    wide: true,
    actions: [
      goBtn,
      override,
      h('button', { class: 'btn ghost', onclick: () => downloadExcel(ctx, { ym, days, profile }) }, icon('download'), ' אקסל בלבד'),
      h('a', {
        class: 'btn ghost',
        href: '#',
        title: 'פותח מייל רגיל – את קובץ האקסל יש לצרף ידנית',
        onclick: (e) => {
          e.currentTarget.href = mailtoLink({ to: settings.recipientEmail, cc: cc.value.trim(), subject: subject.value, text: body.value });
        },
      }, 'מייל בלי קובץ'),
    ],
  });

  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true;
    try {
      const bytes = await makeXlsx(ctx, { ym, days, profile });
      const eml = buildEml({
        to: settings.recipientEmail,
        cc: cc.value.trim(),
        subject: subject.value.trim(),
        text: body.value,
        attachment: { filename: fileName, contentType: XLSX_MIME, bytes },
      });
      download(eml, `${fileSafe(subject.value) || 'דיווח שעות'}.eml`, 'message/rfc822');
      const r = await store.markSent(ym).catch(() => null);
      if (r) onSent?.(r);
      clear(content,
        h('div', { class: 'done' },
          h('div', { class: 'done-icon' }, icon('check', 40)),
          h('h3', {}, 'המייל מוכן!'),
          h('ol', {},
            h('li', {}, 'לפתוח את הקובץ שירד ', h('b', {}, `"${fileSafe(subject.value)}.eml"`), ' (בסרגל ההורדות של הדפדפן) – הוא ייפתח באאוטלוק כהודעה חדשה.'),
            h('li', {}, 'לוודא שהכול נראה תקין ושהאקסל מצורף.'),
            h('li', {}, 'ללחוץ ', h('b', {}, 'Send / שלח'), '.')),
          h('p', { class: 'muted small' },
            'טיפ: ב-Edge או Chrome אפשר ללחוץ על ⋯ ליד ההורדה ולבחור "פתח תמיד קבצים מסוג זה" – ובפעם הבאה המייל ייפתח מיד. ',
            'אם הקובץ לא נפתח באאוטלוק: קליק ימני ← "פתח באמצעות" ← Outlook.')));
      goBtn.remove();
    } catch (err) {
      goBtn.disabled = false;
      toast(`יצירת המייל נכשלה: ${err.message}`, 'error', 7000);
    }
  });
}
