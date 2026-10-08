const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Log, Notification, Setting } = require('./models');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const RANK = { member: 1, team_leader: 2, director: 3, ceo: 4, admin: 4 };
const seesAll = (u) => u.role === 'admin' || u.role === 'ceo';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

const signToken = (u) => jwt.sign({ sub: String(u._id), v: u.tokenVersion }, JWT_SECRET, { expiresIn: '12h' });

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) fail(401, 'Sign in to continue.');
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); } catch { fail(401, 'Your session expired. Sign in again.'); }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.v) fail(401, 'Your session expired. Sign in again.');
  req.user = user;
  next();
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : fail(403, 'You do not have access to this.');

// ---- organisation helpers -------------------------------------------------
async function loadOrg() {
  const users = await User.find({ status: 'active' }).select('-passwordHash -tokenVersion').lean();
  const children = new Map();
  for (const u of users) {
    const k = u.managerId ? String(u.managerId) : 'root';
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(u);
  }
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return { users, children, byId };
}
function descendantsOf(org, id) {
  const out = []; const queue = [String(id)]; const seen = new Set(queue);
  while (queue.length) {
    for (const c of org.children.get(queue.shift()) || []) {
      const cid = String(c._id);
      if (!seen.has(cid)) { seen.add(cid); out.push(cid); queue.push(cid); }
    }
  }
  return out;
}
/** Ids of everyone this user may see: themselves plus everyone below them (everyone, for admin/CEO). */
async function visibleIds(user, org) {
  org = org || await loadOrg();
  if (seesAll(user)) return { org, ids: org.users.map((u) => String(u._id)), reports: org.users.map((u) => String(u._id)).filter((i) => i !== String(user._id)) };
  const reports = descendantsOf(org, user._id);
  return { org, ids: [String(user._id), ...reports], reports };
}
/** Can `user` manage (assign to, edit, reset) the person with id `targetId`? */
async function manages(user, targetId) {
  if (user.role === 'admin') return true;
  if (user.role === 'ceo') return false;
  const { reports } = await visibleIds(user);
  return reports.includes(String(targetId));
}

// ---- misc -----------------------------------------------------------------
const publicUser = (u) => ({
  id: String(u._id), name: u.name, username: u.username || '', email: u.email, role: u.role, managerId: u.managerId ? String(u.managerId) : null,
  department: u.department, title: u.title, phone: u.phone, bio: u.bio, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || '', requestedRole: u.requestedRole || '', status: u.status,
  mustChangePassword: !!u.mustChangePassword, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});
const tempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (b) => chars[b % chars.length]).join('') + '#7';
};
const checkPassword = (p) => { if (typeof p !== 'string' || p.length < 8) fail(400, 'Password must be at least 8 characters.'); };
// Usernames: 3-30 chars, letters/numbers/dot/dash/underscore, stored lowercase.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const cleanUsername = (u) => {
  const v = String(u || '').toLowerCase().trim();
  if (!USERNAME_RE.test(v)) fail(400, 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.');
  return v;
};
/** Make a free username out of any text (an email's first part, a name). Adds a number when taken. */
const freeUsername = async (User, base) => {
  let b = String(base || '').toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 26);
  if (b.length < 3) b = (b + 'user').slice(0, 26);
  let name = b, n = 1;
  while (await User.findOne({ username: name }).select('_id').lean()) name = b + (++n);
  return name;
};
const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function audit(req, action, target = '', details = '', actor) {
  const a = actor || req.user;
  try {
    await Log.create({ actor: a?._id || null, actorName: a?.name || '', action, target, details: String(details).slice(0, 500), ip: req.ip || '' });
  } catch (e) { console.error('audit log failed', e.message); }
}

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
function weekStart(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const csv = (rows) => rows.map((r) => r.map((c) => {
  let s = c == null ? '' : String(c);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n');


// ---- reporting periods ------------------------------------------------------
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayLabel = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
/** The reporting period of the given type that contains `date`. */
function periodFor(type, date = new Date()) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate();
  if (type === 'weekly') { const s = new Date(weekStart(date) + 'T00:00:00Z'); const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6); return { start: iso(s), end: iso(e), label: 'Week of ' + dayLabel(s) }; }
  if (type === 'monthly') return { start: iso(utc(y, m, 1)), end: iso(utc(y, m + 1, 0)), label: `${MONTHS[m]} ${y}` };
  if (type === 'quarterly') { const q = Math.floor(m / 3); return { start: iso(utc(y, q * 3, 1)), end: iso(utc(y, q * 3 + 3, 0)), label: `Q${q + 1} ${y}` }; }
  if (type === 'yearly') return { start: iso(utc(y, 0, 1)), end: iso(utc(y, 11, 31)), label: String(y) };
  const t = utc(y, m, d); return { start: iso(t), end: iso(t), label: dayLabel(t) }; // daily + adhoc
}
/** The current period and the `n - 1` before it, newest first. */
function recentPeriods(type, n = 6, from = new Date()) {
  const out = []; let cursor = from;
  for (let i = 0; i < n; i++) { const p = periodFor(type, cursor); out.push(p); cursor = new Date(new Date(p.start + 'T00:00:00Z').getTime() - 864e5); }
  return out;
}
const dueDateFor = (periodEnd, dueDays) => new Date(new Date(periodEnd + 'T23:59:59Z').getTime() + (dueDays || 0) * 864e5);

/** The managers above a person, nearest first. Stops at anyone inactive. */
function chainAbove(org, userId) {
  const out = []; const seen = new Set([String(userId)]); let cur = org.byId.get(String(userId));
  while (cur && cur.managerId) { const id = String(cur.managerId); if (seen.has(id) || !org.byId.has(id)) break; seen.add(id); out.push(id); cur = org.byId.get(id); }
  return out;
}

async function notify(userIds, title, body = '', link = '') {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  try { await Notification.insertMany(ids.map((user) => ({ user, title: String(title).slice(0, 160), body: String(body).slice(0, 400), link }))); } catch (e) { console.error('notify failed', e.message); }
}
const adminIds = async () => (await User.find({ role: 'admin', status: 'active' }).select('_id').lean()).map((u) => String(u._id));

const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** Accepts '' (remove) or a small image data URL. */
function cleanImage(v, maxChars, label) {
  if (v === '' || v === null) return '';
  if (typeof v !== 'string' || !IMAGE_URL.test(v)) fail(400, `${label} must be a PNG, JPG or WebP image.`);
  if (v.length > maxChars) fail(400, `${label} is too large. Use a smaller image.`);
  return v;
}
async function getSettings() {
  const s = await Setting.findOne({ key: 'org' }).lean();
  return { orgName: s?.orgName || '', logo: s?.logo || '', jobTitles: s?.jobTitles || [], modules: { tasks: !!s?.modules?.tasks, plans: !!s?.modules?.plans, reports: !!s?.modules?.reports } };
}

module.exports = { cleanImage, getSettings, periodFor, recentPeriods, dueDateFor, chainAbove, notify, adminIds, JWT_SECRET, RANK, seesAll, HttpError, fail, signToken, requireAuth, requireRole, loadOrg, descendantsOf, visibleIds, manages, publicUser, tempPassword, checkPassword, isEmail, cleanUsername, freeUsername, escapeRegex, audit, weekStart, csv };
