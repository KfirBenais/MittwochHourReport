// שכבת נתונים: מצב שרת (API) או מצב מקומי (localStorage) כשהאתר מוגש כקבצים סטטיים בלבד.

import { mergeSettings, mergeProfile } from './defaults.js';
import { sanitizeDays } from './report.js';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // אין גוף JSON
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || `שגיאה (${res.status})`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

const serverStore = {
  mode: 'server',
  health: null,
  async me() {
    const data = await api('GET', 'api/me');
    return data?.user ? data : null;
  },
  login: (email, password) => api('POST', 'api/login', { email, password }),
  register: (data) => api('POST', 'api/register', data),
  logout: () => api('POST', 'api/logout', {}),
  verify: (token) => api('POST', 'api/verify', { token }),
  resendVerification: (email) => api('POST', 'api/verify/resend', { email }),
  forgotPassword: (email) => api('POST', 'api/password/forgot', { email }),
  resetPassword: (token, password) => api('POST', 'api/password/reset', { token, password }),
  saveProfile: async (profile) => (await api('PUT', 'api/me', profile)).user,
  changePassword: (current, next) => api('POST', 'api/me/password', { current, next }),
  getReport: (ym) => api('GET', `api/reports/${ym}`),
  saveReport: (ym, days) => api('PUT', `api/reports/${ym}`, { days }),
  markSent: (ym, { manual = false } = {}) => api('POST', `api/reports/${ym}/sent`, { manual }),
  unmarkSent: (ym) => api('POST', `api/reports/${ym}/sent`, { sent: false }),
  yearReports: async (year) => (await api('GET', `api/reports?year=${year}`)).months,
  allReports: async () => (await api('GET', 'api/reports')).months,
  saveSettings: async (settings) => (await api('PUT', 'api/settings', settings)).settings,
  team: async (ym) => (await api('GET', `api/team?ym=${ym}`)).members,
  memberReport: (id, ym) => api('GET', `api/team/${encodeURIComponent(id)}/reports/${ym}`),
  adminResetLink: (id) => api('POST', `api/admin/users/${encodeURIComponent(id)}/reset-link`, {}),
  approveUser: (id) => api('PUT', `api/admin/users/${encodeURIComponent(id)}`, { approved: true }),
  setAdmin: (id, isAdmin) => api('PUT', `api/admin/users/${encodeURIComponent(id)}`, { isAdmin }),
  mailStatus: () => api('GET', 'api/admin/mail'),
  testMail: (to) => api('POST', 'api/admin/test-mail', { to }),
  deleteUser: (id) => api('DELETE', `api/admin/users/${encodeURIComponent(id)}`, {}),
};

// ---------- מצב מקומי ----------

const LS = 'hours-report:';

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(LS + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(LS + key, JSON.stringify(value));
  } catch {
    throw new ApiError(500, 'לא ניתן לשמור בדפדפן (האחסון המקומי חסום או מלא)');
  }
}

const localUser = () => {
  const profile = lsGet('profile', null);
  if (!profile?.fullName) return null;
  return {
    id: 'local', username: 'local', fullName: profile.fullName, email: profile.email, phone: profile.phone || '', isAdmin: true, verified: true, profile: mergeProfile(profile),
  };
};

const localStore = {
  mode: 'local',
  health: { needsSetup: true, teamCodeRequired: false },
  async me() {
    const user = localUser();
    return user ? { user, settings: mergeSettings(lsGet('settings', {})) } : null;
  },
  async login() {
    throw new ApiError(400, 'אין התחברות במצב מקומי');
  },
  async register({ fullName, email }) {
    lsSet('profile', mergeProfile({ fullName, email }));
    return { user: localUser() };
  },
  async logout() {},
  async saveProfile(profile) {
    lsSet('profile', { ...mergeProfile(profile), phone: profile.phone || '' });
    return localUser();
  },
  async changePassword() {
    throw new ApiError(400, 'אין סיסמה במצב מקומי');
  },
  async getReport(ym) {
    return lsGet(`report:${ym}`, { ym, days: {}, sentAt: null, updatedAt: null });
  },
  async saveReport(ym, days) {
    const r = { ...(await this.getReport(ym)), ym, days: sanitizeDays(ym, days), updatedAt: new Date().toISOString() };
    lsSet(`report:${ym}`, r);
    return r;
  },
  async unmarkSent(ym) {
    const r = { ...(await this.getReport(ym)), ym, sentAt: null };
    delete r.sentManually;
    delete r.snapshot;
    lsSet(`report:${ym}`, r);
    return r;
  },
  async markSent(ym, { manual = false } = {}) {
    const r = { ...(await this.getReport(ym)), ym, sentAt: new Date().toISOString(), sentManually: manual };
    r.updatedAt ||= r.sentAt;
    const p = mergeProfile(lsGet('profile', {}));
    r.snapshot ||= { fullName: p.fullName, breakMin: p.breakMin, companyName: mergeSettings(lsGet('settings', {})).companyName, at: r.sentAt };
    lsSet(`report:${ym}`, r);
    return r;
  },
  async yearReports(year) {
    const all = await this.allReports();
    return Object.fromEntries(Object.entries(all).filter(([ym]) => ym.startsWith(`${year}-`)));
  },
  async allReports() {
    const months = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k?.match(/^hours-report:report:(\d{4}-\d{2})$/);
        if (m) months[m[1]] = lsGet(`report:${m[1]}`, null);
      }
    } catch {
      // האחסון המקומי חסום
    }
    return months;
  },
  async saveSettings(settings) {
    const s = mergeSettings(settings);
    lsSet('settings', s);
    return s;
  },
  /** גיבוי מלא של כל הנתונים המקומיים */
  exportAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(LS)) out[k.slice(LS.length)] = JSON.parse(localStorage.getItem(k));
    }
    return { app: 'hours-report', version: 1, exportedAt: new Date().toISOString(), data: out };
  },
  importAll(backup) {
    if (backup?.app !== 'hours-report' || !backup.data) throw new ApiError(400, 'קובץ הגיבוי לא תקין');
    for (const [k, v] of Object.entries(backup.data)) lsSet(k, v);
  },
};

/** בודק אם יש שרת; אם לא – עובד במצב מקומי */
export async function connect() {
  try {
    const res = await fetch('api/health', { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data?.mode === 'server') {
        serverStore.health = data;
        return serverStore;
      }
    }
  } catch {
    // אין שרת
  }
  return localStore;
}
