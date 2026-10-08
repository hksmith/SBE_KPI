// Shared vocabulary: statuses, roles, colours. Status colours always appear with a label, never alone.
export const STATUSES = [
  { key: 'done', label: 'Done', color: '#0ca30c', icon: '✓' },
  { key: 'in_progress', label: 'In progress', color: '#2a78d6', icon: '◐' },
  { key: 'started', label: 'Started', color: '#86b6ef', icon: '◔' },
  { key: 'not_started', label: 'Not started', color: '#aab2bd', icon: '○' },
  { key: 'on_hold', label: 'On hold', color: '#fab219', icon: '‖' },
  { key: 'blocked', label: 'Blocked', color: '#ec835a', icon: '✕' },
  { key: 'delayed', label: 'Delayed', color: '#d03b3b', icon: '!' },
  { key: 'cancelled', label: 'Cancelled', color: '#5c6675', icon: '–' },
];
export const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
export const PRIORITIES = [{ key: 'urgent', label: 'Urgent' }, { key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }, { key: 'low', label: 'Low' }];
export const ROLES = { admin: 'Admin', ceo: 'CEO', director: 'Director', team_leader: 'Team leader', member: 'Team member' };
export const HEALTH = {
  achieved: { label: 'Achieved', color: '#0ca30c', icon: '★' },
  on_track: { label: 'On track', color: '#2a78d6', icon: '↗' },
  at_risk: { label: 'At risk', color: '#fab219', icon: '△' },
  off_track: { label: 'Off track', color: '#d03b3b', icon: '!' },
  cancelled: { label: 'Cancelled', color: '#5c6675', icon: '–' },
};
export const AVATAR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const ACTIONS = [['', 'All activity'], ['auth.', 'Sign-ins and passwords'], ['user.', 'Accounts'], ['profile.', 'Profiles'], ['task.', 'Tasks'], ['plan.', 'Weekly plans'], ['kpi.', 'KPIs'], ['wreport.', 'Reports'], ['template.', 'Report templates'], ['department.', 'Departments'], ['settings.', 'Settings'], ['report.', 'Exports']];

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtShort = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const weekLabel = (w) => { const a = new Date(w + 'T00:00:00Z'); const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6); const f = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); return `${f(a)} to ${f(b)}`; };
export const shiftWeek = (w, n) => { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n * 7); return d.toISOString().slice(0, 10); };
export const isManager = (u) => ['admin', 'ceo', 'director', 'team_leader'].includes(u.role);
export const fmtVal = (v, unit) => (unit === '%' ? `${v}%` : unit ? `${v} ${unit}` : `${v}`);
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Formal reports
export const REPORT_STATUSES = [
  { key: 'draft', label: 'Draft', color: '#aab2bd', icon: '○' },
  { key: 'submitted', label: 'Submitted', color: '#86b6ef', icon: '◔' },
  { key: 'under_review', label: 'Under review', color: '#2a78d6', icon: '◐' },
  { key: 'returned', label: 'Returned', color: '#fab219', icon: '↩' },
  { key: 'approved', label: 'Approved', color: '#0ca30c', icon: '✓' },
  { key: 'rejected', label: 'Rejected', color: '#d03b3b', icon: '✕' },
  { key: 'archived', label: 'Archived', color: '#5c6675', icon: '▪' },
  { key: 'missing', label: 'Not started', color: '#aab2bd', icon: '–' },
];
export const REPORT_STATUS = Object.fromEntries(REPORT_STATUSES.map((s) => [s.key, s]));
export const TIMING = { on_time: ['On time', 'good'], late: ['Late', 'warn'], overdue: ['Overdue', 'bad'], due_soon: ['Due soon', 'warn'], pending: ['Not due yet', ''] };
export const PERIODS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', adhoc: 'Any time (no schedule)' };
export const FIELD_TYPES = { longtext: 'Paragraph', text: 'Short text', number: 'Number', percent: 'Percentage', date: 'Date', select: 'Choice list', checkbox: 'Tick box' };
export const HISTORY = { created: 'Started the report', submitted: 'Submitted', resubmitted: 'Resubmitted', review_started: 'Opened it for review', approved: 'Approved', returned: 'Returned for changes', rejected: 'Rejected', archived: 'Archived' };
export const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
// Deadlines are end-of-day UTC; show the calendar day they were set for, whatever the viewer's time zone.
export const fmtDue = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
export const SIGNUP_ROLES = { member: 'Team member', team_leader: 'Team leader', director: 'Director' };
export const COPYRIGHT = `© ${new Date().getFullYear()} Shaggar BPO Enterprise. All rights reserved.`;
/** Shrink a picked image in the browser and return it as a data URL. `square` crops to the centre (profile photos). */
export function resizeImage(file, { max = 160, square = false, type = 'image/jpeg', quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Pick a PNG, JPG or WebP image.'));
    const fail = () => reject(new Error('That image could not be read.'));
    const reader = new FileReader(); reader.onerror = fail;
    reader.onload = () => {
      const img = new Image(); img.onerror = fail;
      img.onload = () => {
        const side = Math.min(img.width, img.height); const sw = square ? side : img.width, sh = square ? side : img.height;
        const scale = Math.min(1, max / Math.max(sw, sh)); const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h }); const ctx = c.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
        resolve(c.toDataURL(type, quality));
      };
      img.src = reader.result; // a data: URL, which the site's content policy allows (blob: is not)
    };
    reader.readAsDataURL(file);
  });
}
/** Job titles to offer for a department: its own list, else the old organisation-wide list. */
export const titlesFor = (departments, name, fallback = []) => { const d = (departments || []).find((x) => x.name === name); return d && d.jobTitles && d.jobTitles.length ? d.jobTitles : fallback; };
