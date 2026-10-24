const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, ROLES, Kpi, Task, Plan, Report, Attachment, Notification, Department } = require('../models');
const { RANK, fail, requireRole, loadOrg, visibleIds, manages, publicUser, tempPassword, checkPassword, isEmail, cleanUsername, freeUsername, audit, cleanImage } = require('../lib');

const admin = requireRole('admin');
const AVATAR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/** A manager must exist, be active, and sit above the person in the structure. */
async function checkManager(role, managerId, selfId) {
  if (!managerId) return null;
  if (String(managerId) === String(selfId)) fail(400, 'A person cannot report to themselves.');
  const m = await User.findById(managerId).catch(() => null);
  if (!m || m.status !== 'active') fail(400, 'Pick an active person as the manager.');
  if (RANK[m.role] <= RANK[role]) fail(400, `A ${role.replace('_', ' ')} must report to someone above them in the structure.`);
  return m._id;
}
async function activeAdminCount() { return User.countDocuments({ role: 'admin', status: 'active' }); }

// People I can see (admin/CEO: everyone, plus pending requests for admin)
router.get('/', async (req, res) => {
  const { ids } = await visibleIds(req.user);
  const filter = req.user.role === 'admin' ? {} : { _id: { $in: ids } };
  const users = await User.find(filter).sort({ name: 1 });
  res.json({ users: users.map(publicUser) });
});

// Lightweight directory of managers for pickers (admin only needs it)
router.get('/managers', admin, async (req, res) => {
  const users = await User.find({ status: 'active', role: { $in: ['admin', 'ceo', 'director', 'team_leader'] } }).sort({ name: 1 });
  res.json({ users: users.map(publicUser) });
});

router.patch('/me', async (req, res) => {
  const u = req.user; const b = req.body || {};
  if (b.name !== undefined) { if (!String(b.name).trim()) fail(400, 'Name cannot be empty.'); u.name = String(b.name).slice(0, 80); }
  for (const k of ['phone', 'title']) if (b[k] !== undefined) u[k] = String(b[k]).slice(0, 80); // department is set by an admin: it drives report compliance
  if (b.bio !== undefined) u.bio = String(b.bio).slice(0, 500);
  if (b.avatarColor !== undefined && AVATAR_COLORS.includes(b.avatarColor)) u.avatarColor = b.avatarColor;
  if (b.avatarUrl !== undefined) u.avatarUrl = cleanImage(b.avatarUrl, 150000, 'Profile picture');
  await u.save();
  await audit(req, 'profile.updated', u.email);
  res.json({ user: publicUser(u) });
});

// Admin creates an account directly (already approved). Returns a one-time temporary password.
router.post('/', admin, async (req, res) => {
  const { name, username, email, role = 'member', managerId = null, department = '', title = '', password } = req.body || {};
  if (!name || !String(name).trim()) fail(400, 'Enter a name.');
  const uname = username ? cleanUsername(username) : await freeUsername(User, email);
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  if (!ROLES.includes(role)) fail(400, 'Pick a valid role.');
  if (await User.findOne({ username: uname })) fail(409, 'That username is taken. Pick another one.');
  if (await User.findOne({ email: email.toLowerCase().trim() })) fail(409, 'An account with this email already exists.');
  const mgr = await checkManager(role, managerId, null);
  const pw = password || tempPassword();
  checkPassword(pw);
  const count = await User.countDocuments({});
  const user = await User.create({
    name: String(name).trim(), username: uname, email, role, managerId: mgr, department, title, status: 'active',
    passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: req.body.mustChangePassword !== false, avatarColor: AVATAR_COLORS[count % AVATAR_COLORS.length],
  });
  await audit(req, 'user.created', user.email, `Role: ${role}`);
  res.status(201).json({ user: publicUser(user), temporaryPassword: password ? null : pw });
});

router.post('/:id/approve', admin, async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) fail(404, 'Account not found.');
  if (user.status !== 'pending') fail(400, 'This account is not waiting for approval.');
  const role = req.body?.role || 'member';
  if (!ROLES.includes(role)) fail(400, 'Pick a valid role.');
  user.managerId = await checkManager(role, req.body?.managerId, user._id);
  user.role = role; user.status = 'active';
  if (req.body?.department !== undefined) user.department = String(req.body.department).slice(0, 80);
  await user.save();
  await audit(req, 'user.approved', user.email, `Role: ${role}`);
  res.json({ user: publicUser(user) });
});

router.post('/:id/reject', admin, async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) fail(404, 'Account not found.');
  if (user.status !== 'pending') fail(400, 'Only pending requests can be rejected.');
  await User.deleteOne({ _id: user._id });
  await audit(req, 'user.rejected', user.email);
  res.json({ ok: true });
});

router.patch('/:id', admin, async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) fail(404, 'Account not found.');
  const b = req.body || {}; const changes = [];
  const isSelf = String(user._id) === String(req.user._id);
  const newRole = b.role !== undefined ? b.role : user.role;
  if (!ROLES.includes(newRole)) fail(400, 'Pick a valid role.');
  const newStatus = b.status !== undefined ? b.status : user.status;
  if (!['active', 'disabled'].includes(newStatus) && newStatus !== user.status) fail(400, 'Status must be active or disabled.');
  const losingAdmin = user.role === 'admin' && user.status === 'active' && (newRole !== 'admin' || newStatus !== 'active');
  if (losingAdmin && isSelf) fail(400, 'You cannot remove your own admin access.');
  if (losingAdmin && (await activeAdminCount()) <= 1) fail(400, 'There must be at least one active admin.');

  if (b.name !== undefined) { if (!String(b.name).trim()) fail(400, 'Name cannot be empty.'); user.name = String(b.name).slice(0, 80); changes.push('name'); }
  if (b.username !== undefined && String(b.username).toLowerCase().trim() !== user.username) {
    const un = cleanUsername(b.username);
    if (await User.findOne({ username: un, _id: { $ne: user._id } })) fail(409, 'That username is taken. Pick another one.');
    user.username = un; user.tokenVersion += 1; changes.push('username');
  }
  if (b.email !== undefined && b.email.toLowerCase().trim() !== user.email) {
    if (!isEmail(b.email)) fail(400, 'Enter a valid email address.');
    if (await User.findOne({ email: b.email.toLowerCase().trim() })) fail(409, 'An account with this email already exists.');
    user.email = b.email; changes.push('email');
  }
  for (const k of ['department', 'title']) if (b[k] !== undefined) { user[k] = String(b[k]).slice(0, 80); changes.push(k); }
  if (b.role !== undefined || b.managerId !== undefined) {
    const mgrId = b.managerId !== undefined ? b.managerId : user.managerId;
    user.managerId = await checkManager(newRole, mgrId, user._id);
    if (newRole !== user.role) {
      // people who reported to this person must still report to someone above them
      const reports = await User.find({ managerId: user._id, status: { $ne: 'pending' } });
      const broken = reports.filter((r) => RANK[newRole] <= RANK[r.role]);
      if (broken.length) fail(400, `Move ${broken.length} direct report(s) to another manager before changing this role.`);
      changes.push(`role ${user.role} → ${newRole}`); user.role = newRole;
    }
    if (b.managerId !== undefined) changes.push('manager');
  }
  if (newStatus !== user.status) {
    if (newStatus === 'disabled' && (await User.countDocuments({ managerId: user._id, status: 'active' })) > 0) fail(400, 'Move this person\'s direct reports to another manager before disabling the account.');
    changes.push(`status ${user.status} → ${newStatus}`); user.status = newStatus;
    if (newStatus === 'disabled') user.tokenVersion += 1;
  }
  await user.save();
  await audit(req, newStatus === 'disabled' && changes.some((c) => c.startsWith('status')) ? 'user.disabled' : 'user.updated', user.email, changes.join(', '));
  res.json({ user: publicUser(user) });
});

// ---- deleting an account (admin only) --------------------------------------------------------
// What will go with the account, shown in the confirmation before anything is deleted.
async function deletionCheck(req, id) {
  const user = await User.findById(id).catch(() => null);
  if (!user) fail(404, 'Account not found.');
  if (String(user._id) === String(req.user._id)) fail(400, 'You cannot delete your own account.');
  if (user.role === 'admin' && user.status === 'active' && (await activeAdminCount()) <= 1) fail(400, 'There must be at least one active admin.');
  const [kpis, tasks, plans, reports, directReports, manager] = await Promise.all([
    Kpi.countDocuments({ owner: user._id }), Task.countDocuments({ owner: user._id }), Plan.countDocuments({ owner: user._id }), Report.countDocuments({ author: user._id }),
    User.find({ managerId: user._id }).select('name').lean(), user.managerId ? User.findById(user.managerId).select('name').lean() : null,
  ]);
  return { user, kpis, tasks, plans, reports, directReports: directReports.map((r) => r.name), newManager: manager ? manager.name : null };
}
router.get('/:id/delete-check', admin, async (req, res) => {
  const { user, ...rest } = await deletionCheck(req, req.params.id);
  res.json({ name: user.name, username: user.username, ...rest });
});
// Removes the person and their own KPIs, tasks, plans, reports and notifications.
// People who reported to them move up to their manager. KPIs they set for others stay with those people.
router.delete('/:id', admin, async (req, res) => {
  const { user, kpis, tasks, plans, reports, directReports, newManager } = await deletionCheck(req, req.params.id);
  if (String(req.body?.confirm || '').toLowerCase().trim() !== String(user.username || '').toLowerCase()) fail(400, `Type the username ${user.username} to confirm.`);
  const id = user._id;
  const theirReports = (await Report.find({ author: id }).select('_id').lean()).map((r) => r._id);
  await User.updateMany({ managerId: id }, { managerId: user.managerId || null });
  await Promise.all([
    Kpi.deleteMany({ owner: id }), Task.deleteMany({ owner: id }), Plan.deleteMany({ owner: id }), Notification.deleteMany({ user: id }),
    Attachment.deleteMany({ report: { $in: theirReports } }), Report.deleteMany({ _id: { $in: theirReports } }),
    Report.updateMany({ reviewer: id }, { reviewer: null }), Department.updateMany({ head: id }, { head: null }),
  ]);
  await User.deleteOne({ _id: id });
  const moved = directReports.length ? `; ${directReports.length} direct report(s) moved to ${newManager || 'the top of the structure'}` : '';
  await audit(req, 'user.deleted', user.email, `${user.name} (@${user.username}), ${user.role}: removed ${kpis} KPIs, ${tasks} tasks, ${plans} plans, ${reports} reports${moved}`);
  res.json({ ok: true });
});

// Admin can reset anyone; a director can reset the team leaders and members under them.
router.post('/:id/reset-password', requireRole('admin', 'director'), async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user || user.status === 'pending') fail(404, 'Account not found.');
  if (String(user._id) === String(req.user._id)) fail(400, 'Use "Change password" on your profile for your own account.');
  if (!(await manages(req.user, user._id))) fail(403, 'You can only reset passwords for people in your own teams.');
  const pw = tempPassword();
  user.passwordHash = await bcrypt.hash(pw, 10);
  user.mustChangePassword = true;
  user.tokenVersion += 1;
  await user.save();
  await audit(req, 'user.password_reset', user.email);
  res.json({ temporaryPassword: pw });
});

// Org tree for what I can see
router.get('/tree', async (req, res) => {
  const { org, ids } = await visibleIds(req.user);
  const set = new Set(ids);
  res.json({ users: org.users.filter((u) => set.has(String(u._id))).map(publicUser) });
});

module.exports = router;
