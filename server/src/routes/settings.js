// Organisation settings, departments and in-app notifications.
const router = require('express').Router();
const { Department, Setting, User, Template, Report, Notification, Kpi, Task, Plan } = require('../models');
const { fail, requireRole, audit, recentPeriods, dueDateFor, cleanImage, getSettings, visibleIds } = require('../lib');

const admin = requireRole('admin');
const deptOut = (d, counts) => ({ id: String(d._id), name: d.name, parent: d.parent ? String(d.parent) : null, head: d.head ? String(d.head) : null, jobTitles: d.jobTitles || [], people: counts?.get(d.name) || 0 });

router.get('/settings', async (req, res) => res.json(await getSettings()));
router.patch('/settings', admin, async (req, res) => {
  const b = req.body || {}; const set = { key: 'org' }; const changed = [];
  if (b.orgName !== undefined) { set.orgName = String(b.orgName).trim().slice(0, 80); changed.push('name'); }
  if (b.logo !== undefined) { set.logo = cleanImage(b.logo, 400000, 'Logo'); changed.push(set.logo ? 'logo' : 'logo removed'); }
  if (b.jobTitles !== undefined) { set.jobTitles = [...new Set((Array.isArray(b.jobTitles) ? b.jobTitles : []).map((t) => String(t).trim().slice(0, 80)).filter(Boolean))].slice(0, 200).sort((x, y) => x.localeCompare(y)); changed.push('job titles'); }
  if (b.modules !== undefined) { const cur = (await getSettings()).modules; for (const k of ['tasks', 'plans', 'reports']) if (b.modules[k] !== undefined) cur[k] = !!b.modules[k]; set.modules = cur; changed.push('modules: ' + (Object.keys(cur).filter((k) => cur[k]).join(', ') || 'KPIs only')); }
  await Setting.findOneAndUpdate({ key: 'org' }, { $set: set }, { upsert: true });
  await audit(req, 'settings.updated', 'Settings', changed.join(', '));
  res.json(await getSettings());
});

router.get('/departments', async (req, res) => {
  const [depts, users] = await Promise.all([Department.find({}).sort({ name: 1 }), User.find({ status: { $ne: 'pending' } }).select('department').lean()]);
  const counts = new Map(); for (const u of users) if (u.department) counts.set(u.department, (counts.get(u.department) || 0) + 1);
  res.json({ departments: depts.map((d) => deptOut(d, counts)) });
});
async function checkDept(b, self) {
  const out = {};
  if (b.name !== undefined || !self) {
    const name = String(b.name || '').trim().slice(0, 80); if (!name) fail(400, 'Give the department a name.');
    const dup = await Department.findOne({ name }); if (dup && String(dup._id) !== String(self?._id)) fail(409, 'A department with this name already exists.');
    out.name = name;
  }
  if (b.parent !== undefined) {
    if (!b.parent) out.parent = null;
    else {
      const p = await Department.findById(b.parent).catch(() => null); if (!p) fail(400, 'Pick an existing parent department.');
      for (let cur = p, i = 0; cur && i < 50; i++) { if (self && String(cur._id) === String(self._id)) fail(400, 'A department cannot sit under itself.'); cur = cur.parent ? await Department.findById(cur.parent) : null; }
      out.parent = p._id;
    }
  }
  if (b.jobTitles !== undefined) out.jobTitles = [...new Set((Array.isArray(b.jobTitles) ? b.jobTitles : []).map((t) => String(t).trim().slice(0, 80)).filter(Boolean))].slice(0, 100).sort((x, y) => x.localeCompare(y));
  if (b.head !== undefined) { if (!b.head) out.head = null; else { const u = await User.findById(b.head).catch(() => null); if (!u || u.status !== 'active') fail(400, 'Pick an active person as the head.'); out.head = u._id; } }
  return out;
}
router.post('/departments', admin, async (req, res) => {
  const d = await Department.create(await checkDept(req.body || {}, null));
  await audit(req, 'department.created', d.name);
  res.status(201).json({ department: deptOut(d) });
});
router.patch('/departments/:id', admin, async (req, res) => {
  const d = await Department.findById(req.params.id).catch(() => null); if (!d) fail(404, 'Department not found.');
  const old = d.name; Object.assign(d, await checkDept(req.body || {}, d)); await d.save();
  if (d.name !== old) { // keep people, templates and past reports pointing at the renamed department
    await User.updateMany({ department: old }, { department: d.name }); await Report.updateMany({ department: old }, { department: d.name });
    for (const t of await Template.find({ departments: old })) { t.departments = t.departments.map((x) => (x === old ? d.name : x)); await t.save(); }
  }
  await audit(req, 'department.updated', d.name, d.name !== old ? `Renamed from ${old}` : '');
  res.json({ department: deptOut(d) });
});
router.delete('/departments/:id', admin, async (req, res) => {
  const d = await Department.findById(req.params.id).catch(() => null); if (!d) fail(404, 'Department not found.');
  if (await User.countDocuments({ department: d.name, status: { $ne: 'pending' } })) fail(400, 'Move the people in this department somewhere else first.');
  if (await Department.countDocuments({ parent: d._id })) fail(400, 'Move the departments under this one first.');
  await Department.deleteOne({ _id: d._id });
  await audit(req, 'department.deleted', d.name);
  res.json({ ok: true });
});

/** Live deadline reminders for the reports this person is expected to file (only while the reports module is on). */
async function remindersFor(u, reportsOn) {
  if (!reportsOn) return [];
  const now = new Date(); const reminders = [];
  const templates = await Template.find({ active: true, requiredRoles: u.role }).lean();
  for (const t of templates) {
    if (t.periodType === 'adhoc' || (t.departments.length && !t.departments.includes(u.department))) continue;
    for (const p of recentPeriods(t.periodType, 2)) {
      const due = dueDateFor(p.end, t.dueDays); const end = new Date(p.end + 'T23:59:59Z');
      if (due - now > 3 * 864e5 || t.createdAt > end || u.createdAt > due) continue; // not close yet, or it predates the template / the account
      const r = await Report.findOne({ template: t._id, author: u._id, periodStart: p.start }).select('status').lean();
      if (r && r.status !== 'draft') continue;
      reminders.push({ id: `${t._id}-${p.start}`, overdue: now > due, title: now > due ? `Overdue: ${t.name}, ${p.label}` : `Due soon: ${t.name}, ${p.label}`, dueDate: due, link: r ? '/reports/' + r._id : `/reports?new=${t._id}&period=${p.start}` });
    }
  }
  return reminders;
}

// Stored notifications plus live deadline reminders for reports this person is expected to file
router.get('/notifications', async (req, res) => {
  const u = req.user;
  const [items, unread, newKpis, settings] = await Promise.all([
    Notification.find({ user: u._id }).sort({ at: -1 }).limit(60).lean(), Notification.countDocuments({ user: u._id, read: false }), Kpi.countDocuments({ owner: u._id, unseen: true }), getSettings(),
  ]);
  const reminders = await remindersFor(u, settings.modules.reports);
  res.json({ notifications: items.map((n) => ({ id: String(n._id), title: n.title, body: n.body, link: n.link, read: n.read, at: n.at })), unread, reminders, newKpis, count: unread + reminders.length });
});

/**
 * Cheap "has anything changed?" check that every open page polls every few seconds.
 * `stamp` changes whenever something this person can see changes; the page then reloads what it shows.
 */
const latest = (Model, filter, field = 'updatedAt') => Model.findOne(filter).sort({ [field]: -1 }).select(field).lean().then((d) => (d ? new Date(d[field]).getTime() : 0));
router.get('/sync', async (req, res) => {
  const u = req.user;
  const [{ ids }, settings, setting] = await Promise.all([visibleIds(u), getSettings(), Setting.findOne({ key: 'org' }).select('updatedAt').lean()]);
  const mine = { owner: { $in: ids } };
  const m = settings.modules;
  const parts = await Promise.all([
    latest(Kpi, mine), Kpi.countDocuments(mine),
    latest(Notification, { user: u._id }, 'at'), Notification.countDocuments({ user: u._id, read: false }), Kpi.countDocuments({ owner: u._id, unseen: true }),
    latest(User, {}), User.countDocuments({}), latest(Department, {}), Department.countDocuments({}),
    m.tasks ? latest(Task, mine) : 0, m.tasks ? Task.countDocuments(mine) : 0,
    m.plans ? latest(Plan, mine) : 0,
    m.reports ? latest(Report, { $or: [{ author: { $in: ids } }, { reviewer: u._id }] }) : 0,
  ]);
  const reminders = await remindersFor(u, m.reports);
  const unread = parts[3], newKpis = parts[4];
  res.set('Cache-Control', 'no-store');
  res.json({
    stamp: [setting?.updatedAt ? new Date(setting.updatedAt).getTime() : 0, JSON.stringify(m), ...parts, reminders.length, u.updatedAt ? new Date(u.updatedAt).getTime() : 0].join('.'),
    unread, newKpis, count: unread + reminders.length,
  });
});
router.post('/notifications/read', async (req, res) => {
  const filter = { user: req.user._id, read: false }; if (req.body?.id) filter._id = req.body.id;
  await Notification.updateMany(filter, { read: true });
  res.json({ ok: true });
});

module.exports = router;
