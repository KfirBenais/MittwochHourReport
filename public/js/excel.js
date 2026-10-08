// יצירת קובץ האקסל החודשי – משחזר את התבנית "נוסח 1" (כולל הנוסחאות) מקבצי הדיווח המקוריים.
// ExcelJS מועבר כפרמטר כדי שהקוד ירוץ גם בדפדפן (window.ExcelJS) וגם בבדיקות ב-Node.

import { monthDays, weekday } from './calendar.js';
import { effectiveDay, calcDay, toMin } from './report.js';

const FONT = 'Arial';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E3E3' } };
const NAVY = { argb: 'FF000080' };
const RED = { argb: 'FFFF0000' };
const TIME_FMT = '[$-409]h:mm';
const SUM_FMT = '[h]:mm';

const thin = { style: 'thin' };
const hair = { style: 'hair' };
const medium = { style: 'medium' };

/** מספר סידורי של אקסל לתאריך (1900 date system) */
export function excelDateSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

const timeValue = (hhmm) => {
  const min = toMin(hhmm);
  return min == null ? null : min / 1440;
};

/**
 * בונה את חוברת העבודה.
 * @param ExcelJS ספריית ExcelJS
 * @param {{ ym: string, days: object, profile: object, settings: object }} data
 */
export function buildWorkbook(ExcelJS, { ym, days, profile, settings }) {
  const [year, month] = ym.split('-').map(Number);
  const dates = monthDays(ym);
  const first = 12;
  const last = first + dates.length - 1;
  const totalRow = last + 1;
  const signRow = totalRow + 5;
  const breakMin = Number(profile.breakMin) || 0;

  const wb = new ExcelJS.Workbook();
  wb.creator = profile.fullName || '';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const ws = wb.addWorksheet('נוסח 1', {
    views: [{ rightToLeft: true, showGridLines: true }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.39, right: 0.39, top: 0.51, bottom: 0.51, header: 0.3, footer: 0.3 },
      printArea: `A1:J${signRow + 1}`,
    },
    properties: { defaultRowHeight: 12.75 },
  });

  const widths = { A: 12.28, B: 7.28, C: 6.85, D: 8.57, E: 7.7, F: 7.99, G: 8.57, H: 7.57, I: 8.71, J: 24 };
  for (const [col, w] of Object.entries(widths)) ws.getColumn(col).width = w;

  const set = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { name: FONT, size: 10, ...(style.font || {}) };
    if (style.fill) c.fill = style.fill;
    if (style.border) c.border = style.border;
    if (style.alignment) c.alignment = style.alignment;
    if (style.numFmt) c.numFmt = style.numFmt;
    return c;
  };

  // כותרת
  ws.getRow(1).height = 20.25;
  set('A1', 'שם עובד:', { font: { size: 14, bold: true }, alignment: { horizontal: 'right' } });
  set('B1', profile.fullName || '', { font: { size: 14, bold: true }, alignment: { horizontal: 'right' } });
  set('J1', settings.companyName || '', { font: { size: 12, bold: true }, alignment: { horizontal: 'left' } });
  ws.getRow(2).height = 15.75;
  set('A2', 'זמן הפסקה:', { font: { size: 12, bold: true }, alignment: { horizontal: 'right' } });
  set('B2', breakMin / 1440, { font: { size: 12, bold: true }, alignment: { horizontal: 'right' }, numFmt: TIME_FMT });

  ws.getRow(4).height = 19.15;
  ws.mergeCells('D4:F4');
  set('D4', 'דיווח ש"ע בחודש:', {
    font: { size: 14, bold: true }, fill: HEADER_FILL,
    border: { left: medium, top: medium, bottom: medium },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  for (const a of ['E4', 'F4']) ws.getCell(a).border = { top: medium, bottom: medium };
  set('G4', `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`, {
    font: { size: 13, bold: true }, fill: HEADER_FILL,
    border: { right: medium, top: medium, bottom: medium },
    alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '@',
  });

  const note = { font: { bold: true, color: RED } };
  set('A7', 'שים לב: ', { font: { bold: true, underline: true, color: RED }, alignment: { horizontal: 'left' } });
  set('B7', 'בימים א-ה בהם אין צורך בקיזוז הפסקה (ע.חג/חוה"מ) יש לרשום x בטור "אין הפסקה".', note);
  set('B8', "נא לציין בטור הערות דיווחים על יום/חצי יום העדרות (חופש/מחלה/מ.חולה/מילואים/יום בחירה וכו')", note);

  // כותרות טבלה (שתי שורות)
  const head1 = ['תאריך', 'יום ', 'אין', 'שעת', 'שעת ', 'שעת', 'שעת ', 'ש"ע', 'ש"ע', 'הערה'];
  const head2 = ['', 'בשבוע', 'הפסקה', 'כניסה', 'יציאה', 'כניסה', 'יציאה', 'ברוטו', 'בפועל', ''];
  const cols = 'ABCDEFGHIJ'.split('');
  ws.getRow(10).height = 16.15;
  ws.getRow(11).height = 16.15;
  cols.forEach((col, i) => {
    const hs = { font: { bold: true, color: NAVY }, fill: HEADER_FILL, alignment: { horizontal: 'center' } };
    set(`${col}10`, head1[i], { ...hs, border: { left: thin, right: thin, top: thin } });
    set(`${col}11`, head2[i], { ...hs, border: { left: thin, right: thin, bottom: medium } });
  });

  // שורות הימים
  const rowBorder = { left: thin, right: thin, top: hair, bottom: hair };
  const center = { horizontal: 'center', vertical: 'middle' };
  dates.forEach((iso, i) => {
    const r = first + i;
    ws.getRow(r).height = 17.25;
    const e = effectiveDay(days[iso]);
    const { gross, net } = calcDay(iso, days[iso], breakMin);
    const base = { border: rowBorder, alignment: center };

    set(`A${r}`, excelDateSerial(iso), { ...base, numFmt: 'dd/mm/yy' });
    set(`B${r}`, { formula: `IF(A${r}>0,WEEKDAY(A${r}),"")`, result: weekday(iso) + 1 }, base);
    set(`C${r}`, e.noBreak ? 'x' : null, { ...base, numFmt: '@' });
    set(`D${r}`, timeValue(e.in1), { ...base, numFmt: TIME_FMT });
    set(`E${r}`, timeValue(e.out1), { ...base, numFmt: TIME_FMT });
    set(`F${r}`, timeValue(e.in2), { ...base, numFmt: TIME_FMT });
    set(`G${r}`, timeValue(e.out2), { ...base, numFmt: TIME_FMT });
    set(`H${r}`, { formula: `(E${r}-D${r})+(G${r}-F${r})`, result: gross / 1440 }, { ...base, numFmt: SUM_FMT });
    set(`I${r}`, {
      formula: `IF(H${r}>0,IF(OR($B${r}>5,$C${r}="x",$C${r}="X"),H${r},H${r}-$B$2),0)`,
      result: net / 1440,
    }, { ...base, numFmt: SUM_FMT });
    set(`J${r}`, e.note || null, { border: rowBorder, alignment: { horizontal: 'right', vertical: 'middle' }, numFmt: '@' });
  });

  // סיכום
  const totalNet = dates.reduce((sum, iso) => sum + calcDay(iso, days[iso], breakMin).net, 0);
  ws.getRow(totalRow).height = 18.6;
  ws.mergeCells(`D${totalRow}:H${totalRow}`);
  set(`D${totalRow}`, 'ס"ה ש"ע בפועל:', { font: { size: 12, bold: true }, alignment: { horizontal: 'left' }, border: { right: thin } });
  set(`I${totalRow}`, { formula: `SUM(I${first}:I${last})`, result: totalNet / 1440 }, {
    font: { bold: true }, border: { left: thin, right: thin, bottom: { style: 'double' } }, alignment: { horizontal: 'center' }, numFmt: SUM_FMT,
  });

  ws.getRow(signRow).height = 15.75;
  ws.mergeCells(`A${signRow}:B${signRow}`);
  set(`A${signRow}`, 'חתימת העובד', { font: { size: 12, bold: true }, alignment: { horizontal: 'center' }, border: { top: thin } });
  ws.getCell(`B${signRow}`).border = { top: thin };

  return wb;
}

/** מחזיר Uint8Array של קובץ xlsx */
export async function buildXlsx(ExcelJS, data) {
  const wb = buildWorkbook(ExcelJS, data);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
