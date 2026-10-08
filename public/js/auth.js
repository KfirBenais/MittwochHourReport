// מסכי כניסה: התחברות, הרשמה עם מייל החברה, שכחתי סיסמה, איפוס סיסמה ואימות מייל.

import {
  h, clear, icon, field, emailInput, passwordInput,
} from './ui.js';

const MIN_PASSWORD = 8;

/**
 * @param ctx       הקשר האפליקציה (store)
 * @param container האלמנט שבו מציירים
 * @param initial   { mode: 'login'|'register'|'forgot'|'reset'|'verify', token }
 * @param onLogin   נקרא אחרי כניסה מוצלחת
 * @param footer    פונקציה שמחזירה את שורת התחתית
 */
export function renderAuth(ctx, container, initial, onLogin, footer) {
  const { store } = ctx;
  const health = store.health || {};
  const local = store.mode === 'local';
  const domain = health.emailDomain || '';
  const state = {
    mode: initial?.mode || (local || health.needsSetup ? 'register' : 'login'),
    token: initial?.token || '',
    email: '',
    check: null, // { title, text, resend }
  };
  const card = h('div', { class: 'auth-card' });
  const go = (mode, extra = {}) => {
    Object.assign(state, { mode }, extra);
    render();
  };
  const linkBtn = (label, onclick) => h('button', { type: 'button', class: 'link', onclick }, label);

  function form(children, onSubmit) {
    const err = h('div', { class: 'form-error', role: 'alert' });
    const f = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        clear(err);
        try {
          await onSubmit(err);
        } catch (ex) {
          clear(err, ex.message);
          if (ex.code === 'unverified') {
            err.append(' ', linkBtn('לשלוח שוב את קישור האימות', async () => {
              await store.resendVerification(state.email);
              go('check', { check: verifyCheck(state.email) });
            }));
          }
        } finally {
          btn.disabled = false;
        }
      },
    }, children(err));
    return f;
  }

  const approvalCheck = (email) => ({
    title: 'ההרשמה התקבלה!',
    text: `מנהל הצוות צריך לאשר את החשבון (${email}). אחרי האישור נכנסים עם המייל והסיסמה שבחרת.`,
  });

  /** אחרי הרשמה / אימות / איפוס – לפי תשובת השרת */
  const after = async (res) => {
    if (res?.pendingVerification) go('check', { check: verifyCheck(res.email, res.mailError) });
    else if (res?.pendingApproval) go('check', { check: approvalCheck(res.email) });
    else await onLogin();
  };

  const verifyCheck = (email, mailError = false) => ({
    title: mailError ? 'נרשמת! נשאר רק אישור' : 'בדקו את תיבת המייל',
    text: mailError
      ? 'לא הצלחנו לשלוח את מייל האימות. מנהל הצוות יכול לאשר אותך ידנית (מסך הצוות) – ואז אפשר להתחבר.'
      : `שלחנו קישור אימות ל-${email}. פותחים את המייל ולוחצים "אימות המייל וכניסה". (לא הגיע? כדאי לבדוק גם בדואר הזבל)`,
    resend: mailError ? null : email,
  });

  function render() {
    let body;
    let subtitle = 'ממלאים שעות, מקבלים התראות על חגים, ושולחים לכוכי בלחיצה.';

    if (local) {
      const name = h('input', { type: 'text', name: 'fullName', required: true, autocomplete: 'name', placeholder: 'לדוגמה: כפיר בנאיס' });
      const email = h('input', { type: 'email', name: 'email', dir: 'ltr', autocomplete: 'email' });
      body = form((err) => [
        h('p', { class: 'muted' }, 'רק פעם אחת: איך קוראים לך? השם יופיע בקובץ האקסל ובנושא המייל.'),
        field('שם מלא (בעברית)', name),
        field('אימייל (לא חובה)', email),
        err,
        h('button', { class: 'btn primary big wide', type: 'submit' }, 'בואו נתחיל'),
      ], async () => {
        if (!name.value.trim()) throw new Error('יש להזין שם מלא');
        await store.register({ fullName: name.value.trim(), email: email.value.trim() });
        await onLogin();
      });
    } else if (state.mode === 'login') {
      const email = emailInput({ domain, value: state.email });
      const pw = passwordInput();
      body = form((err) => [
        field('המייל שלך בחברה', email.el),
        field('סיסמה', pw.el),
        h('div', { class: 'forgot-row' }, linkBtn('שכחתי סיסמה', () => go('forgot', { email: email.value() }))),
        err,
        h('button', { class: 'btn primary big wide', type: 'submit' }, 'כניסה'),
        h('p', { class: 'switch' }, 'עוד לא נרשמת? ', linkBtn('להרשמה', () => go('register', { email: email.value() }))),
      ], async () => {
        state.email = email.value();
        if (!state.email || !pw.input.value) throw new Error('יש להזין מייל וסיסמה');
        await store.login(state.email, pw.input.value);
        await onLogin();
      });
    } else if (state.mode === 'register') {
      const name = h('input', { type: 'text', name: 'fullName', required: true, autocomplete: 'name', placeholder: 'לדוגמה: כפיר בנאיס' });
      const email = emailInput({ domain, value: state.email, autocomplete: 'email' });
      const phone = h('input', { type: 'tel', name: 'phone', dir: 'ltr', autocomplete: 'tel', placeholder: '050-0000000' });
      const pw = passwordInput({ autocomplete: 'new-password', minlength: MIN_PASSWORD });
      const code = health.teamCodeRequired ? h('input', { type: 'text', name: 'teamCode', dir: 'ltr', autocomplete: 'off' }) : null;
      body = form((err) => [
        health.needsSetup ? h('div', { class: 'note-box' }, 'זו ההרשמה הראשונה באתר – החשבון הזה יוגדר כמנהל הצוות.') : null,
        field('שם מלא בעברית', name, 'כפי שיופיע בדוח ובנושא המייל'),
        field('המייל שלך בחברה', email.el, domain ? `רק כתובות @${domain}` : null),
        field('טלפון נייד (לא חובה)', phone),
        field('סיסמה', pw.el, `לפחות ${MIN_PASSWORD} תווים`),
        code ? field('קוד צוות', code, 'מקבלים ממנהל הצוות') : null,
        err,
        h('button', { class: 'btn primary big wide', type: 'submit' }, 'הרשמה'),
        health.needsSetup ? null : h('p', { class: 'switch' }, 'כבר רשום/ה? ', linkBtn('לכניסה', () => go('login', { email: email.value() }))),
      ], async () => {
        if (!name.value.trim()) throw new Error('יש להזין שם מלא');
        if (!email.input.value.trim()) throw new Error('יש להזין את המייל בחברה');
        if (pw.input.value.length < MIN_PASSWORD) throw new Error(`הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים`);
        state.email = email.value();
        const res = await store.register({
          fullName: name.value.trim(), email: state.email, phone: phone.value.trim(), password: pw.input.value, teamCode: code?.value.trim(),
        });
        await after(res);
      });
      subtitle = 'הרשמה – פעם אחת, פחות מדקה.';
    } else if (state.mode === 'forgot') {
      const email = emailInput({ domain, value: state.email });
      body = form((err) => [
        h('p', {}, 'נשלח אליך קישור לבחירת סיסמה חדשה.'),
        field('המייל שלך בחברה', email.el),
        err,
        h('button', { class: 'btn primary big wide', type: 'submit' }, 'שליחת קישור לאיפוס'),
        h('p', { class: 'switch' }, linkBtn('חזרה לכניסה', () => go('login', { email: email.value() }))),
      ], async () => {
        state.email = email.value();
        if (!email.input.value.trim()) throw new Error('יש להזין את המייל');
        const res = await store.forgotPassword(state.email);
        go('check', {
          check: res.viaAdmin
            ? { title: 'הבקשה הועברה למנהל הצוות', text: `מנהל הצוות יקבל התראה באתר וישלח אל ${state.email} קישור לבחירת סיסמה חדשה.` }
            : { title: 'בדקו את תיבת המייל', text: `אם ${state.email} רשום באתר – נשלח אליו קישור לבחירת סיסמה חדשה. הקישור בתוקף שעה. (לא הגיע תוך כמה דקות? כדאי לבדוק בדואר הזבל)` },
        });
      });
      subtitle = 'שכחתי סיסמה';
    } else if (state.mode === 'check') {
      const c = state.check || {};
      body = h('div', { class: 'check-mail' },
        h('div', { class: 'done-icon' }, icon('inbox', 36)),
        h('h2', {}, c.title),
        h('p', {}, c.text),
        c.resend ? h('p', {}, linkBtn('לשלוח שוב', async (e) => {
          e.target.disabled = true;
          await store.resendVerification(c.resend);
          e.target.textContent = 'נשלח שוב ✓';
        })) : null,
        h('button', { class: 'btn wide', onclick: () => go('login') }, 'חזרה לכניסה'));
      subtitle = '';
    } else if (state.mode === 'reset') {
      const pw = passwordInput({ autocomplete: 'new-password', minlength: MIN_PASSWORD });
      const pw2 = passwordInput({ name: 'password2', autocomplete: 'new-password', minlength: MIN_PASSWORD });
      body = form((err) => [
        field('סיסמה חדשה', pw.el, `לפחות ${MIN_PASSWORD} תווים`),
        field('הסיסמה שוב', pw2.el),
        err,
        h('button', { class: 'btn primary big wide', type: 'submit' }, 'שמירה וכניסה'),
        h('p', { class: 'switch' }, linkBtn('חזרה לכניסה', () => go('login'))),
      ], async () => {
        if (pw.input.value.length < MIN_PASSWORD) throw new Error(`הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD} תווים`);
        if (pw.input.value !== pw2.input.value) throw new Error('שתי הסיסמאות לא זהות');
        await after(await store.resetPassword(state.token, pw.input.value));
      });
      subtitle = 'בחירת סיסמה חדשה';
    } else if (state.mode === 'verify') {
      const status = h('div', { class: 'check-mail' }, h('div', { class: 'loading' }, 'מאמת את המייל…'));
      body = status;
      subtitle = '';
      store.verify(state.token).then(after).catch((err) => {
        clear(status,
          h('h2', {}, 'הקישור לא עבד'),
          h('p', {}, err.message),
          h('button', { class: 'btn primary wide', onclick: () => go('login') }, 'לכניסה'));
      });
    }

    clear(card,
      h('img', { src: 'img/ncr-square.png', alt: 'NCR – I.E. Mittwoch & Sons', class: 'auth-logo' }),
      h('h1', {}, 'דיווח שעות'),
      subtitle ? h('p', { class: 'muted center' }, subtitle) : null,
      body);
    setTimeout(() => card.querySelector('input:not([type=hidden])')?.focus(), 30);
  }

  render();
  clear(container, h('div', { class: 'auth' }, card), footer());
}
