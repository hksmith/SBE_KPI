// Formal reports: templates, drafting, submission, the approval chain, attachments, compliance and the management roll-up.
const express = require('express');
const router = express.Router();
const { Template, Report, Attachment, Task, Kpi, User, FIELD_TYPES, PERIOD_TYPES, ROLES, REPORT_STATUSES } = require('../models');
const { fail, requireRole, loadOrg, visibleIds, descendantsOf, audit, escapeRegex, csv, periodFor, recentPeriods, dueDateFor, chainAbove, notify, adminIds } = require('../lib');
const { kpiHealth } = require('./kpis');

const admin = requireRole('admin');
const OPEN = ['submitted', 'under_review'];
const FILED = ['submitted', 'under_review', 'returned', 'approved', 'rejected'];
const ALLOWED_FILES = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_FILE = (process.env.VERCEL ? 4 : 8) * 1024 * 1024, MAX_FILES = 10;
const POP = [{ path: 'author', select: 'name avatarColor avatarUrl role title' }, { path: 'reviewer', select: 'name' }, { path: 'history.by', select: 'name' }, { path: 'comments.author', select: 'name avatarColor avatarUrl' }];
const effectiveStatus = (r) => (r.status === 'archived' ? r.statusBeforeArchive || 'approved' : r.status);

// ---- templates ------------------------------------------------------------
function cleanTemplate(b, existing) {
  const t = {};
  if (b.name !== undefined || !existing) { if (!b.name || !String(b.name).trim()) fail(400, 'Give the template a name.'); t.name = String(b.name).trim().slice(0, 120); }
  if (b.description !== undefined) t.description = String(b.description).slice(0, 500);
  if (b.periodType !== undefined) { if (!PERIOD_TYPES.includes(b.periodType)) fail(400, 'Pick a valid reporting period.'); t.periodType = b.periodType; }
  if (b.dueDays !== undefined) { const n = Math.round(Number(b.dueDays)); if (!(n >= 0 && n <= 90)) fail(400, 'Days to submit must be between 0 and 90.'); t.dueDays = n; }
  if (b.approvalLevels !== undefined) { const n = Math.round(Number(b.approvalLevels)); if (!(n >= 1 && n <= 3)) fail(400, 'Approval levels must be 1, 2 or 3.'); t.approvalLevels = n; }
  if (b.requiredRoles !== undefined) t.requiredRoles = (Array.isArray(b.requiredRoles) ? b.requiredRoles : []).filter((r) => ROLES.includes(r));
  if (b.departments !== undefined) t.departments = (Array.isArray(b.departments) ? b.departments : []).map((d) => String(d).trim()).filter(Boolean).slice(0, 100);
  if (b.includeTasks !== undefined) t.includeTasks = !!b.includeTasks;
  if (b.active !== undefined) t.active = !!b.active;
  if (b.fields !== undefined || !existing) {
    if (!Array.isArray(b.fields) || !b.fields.length) fail(400, 'Add at least one field to the template.');
    const seen = new Set();
    t.fields = b.fields.slice(0, 40).map((f, i) => {
      if (!f || !String(f.label || '').trim()) fail(400, `Field ${i + 1} needs a label.`);
      const type = FIELD_TYPES.includes(f.type) ? f.type : 'longtext';
      let id = String(f.id || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'f' + Math.random().toString(36).slice(2, 9);
      while (seen.has(id)) id += 'x'; seen.add(id);
      const options = type === 'select' ? (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((o) => String(o).trim()).filter(Boolean).slice(0, 30) : [];
      if (type === 'select' && options.length < 2) fail(400, `"${f.label}" needs at least two choices.`);
      return { id, label: String(f.label).trim().slice(0, 120), type, options, required: !!f.required, help: String(f.help || '').slice(0, 200) };
    });
  }
  return t;
}
const tplOut = (t) => ({ ...t.toObject(), id: String(t._id) });

router.get('/templates', async (req, res) => {
  const filter = req.user.role === 'admin' && req.query.all === '1' ? {} : { active: true };
  res.json({ templates: (await Template.find(filter).sort({ name: 1 })).map(tplOut) });
});
router.post('/templates', admin, async (req, res) => {
  const t = await Template.create(cleanTemplate(req.body || {}, null));
  await audit(req, 'template.created', t.name);
  res.status(201).json({ template: tplOut(t) });
});
router.patch('/templates/:id', admin, async (req, res) => {
  const t = await Template.findById(req.params.id).catch(() => null);
  if (!t) fail(404, 'Template not found.');
  Object.assign(t, cleanTemplate(req.body || {}, t));
  await t.save();
  await audit(req, 'template.updated', t.name);
  res.json({ template: tplOut(t) });
});
router.delete('/templates/:id', admin, async (req, res) => {
  const t = await Template.findById(req.params.id).catch(() => null);
  if (!t) fail(404, 'Template not found.');
  if (await Report.countDocuments({ template: t._id })) fail(400, 'Reports already use this template. Turn it off instead of deleting it.');
  await Template.deleteOne({ _id: t._id });
  await audit(req, 'template.deleted', t.name);
  res.json({ ok: true });
});

// ---- helpers --------------------------------------------------------------
const listShape = (r) => ({
  id: String(r._id), title: r.title, templateName: r.templateName, template: String(r.template), author: r.author, department: r.department, periodLabel: r.periodLabel, periodStart: r.periodStart,
  status: r.status, dueDate: r.dueDate, late: r.late, submittedAt: r.submittedAt, reviewer: r.reviewer, step: r.step, approvalLevels: r.approvalLevels, attachments: (r.attachments || []).length, updatedAt: r.updatedAt,
});
const canAct = (user, r) => OPEN.includes(r.status) && String(r.author._id || r.author) !== String(user._id) && (user.role === 'admin' || (r.reviewer && String(r.reviewer._id || r.reviewer) === String(user._id)));
function detailShape(r, user) {
  const o = r.toObject();
  const mine = String(o.author._id || o.author) === String(user._id);
  const editable = mine && ['draft', 'returned'].includes(o.status);
  return { ...o, id: String(o._id), mine, editable, canReview: canAct(user, o), canArchive: ['approved', 'rejected'].includes(o.status) && (mine || user.role === 'admin'), canDelete: mine && o.status === 'draft',
    attachments: o.attachments.map((a) => ({ id: String(a.file), name: a.name, size: a.size, mime: a.mime, at: a.at })) };
}
async function findVisible(req, id) {
  const report = await Report.findById(id).catch(() => null);
  if (!report) fail(404, 'Report not found.');
  const mine = String(report.author) === String(req.user._id);
  if (!mine) { const { ids } = await visibleIds(req.user); if (!ids.includes(String(report.author)) || report.status === 'draft') fail(404, 'Report not found.'); }
  return { report, mine };
}
function cleanValues(fields, input, current = {}) {
  const out = { ...current };
  for (const f of fields) {
    if (!input || !(f.id in input)) continue;
    const v = input[f.id];
    if (v === null || v === '' || v === undefined) { delete out[f.id]; continue; }
    if (f.type === 'number' || f.type === 'percent') { const n = Number(v); if (!isFinite(n)) fail(400, `"${f.label}" must be a number.`); out[f.id] = n; }
    else if (f.type === 'checkbox') out[f.id] = v === true || v === 'true';
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) fail(400, `"${f.label}" must be a date.`); out[f.id] = String(v); }
    else if (f.type === 'select') { if (!f.options.includes(String(v))) fail(400, `Pick one of the choices for "${f.label}".`); out[f.id] = String(v); }
    else out[f.id] = String(v).slice(0, f.type === 'text' ? 300 : 8000);
  }
  return out;
}
async function taskSnapshot(authorId, start, end) {
  const s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T23:59:59Z');
  const tasks = (await Task.find({ owner: authorId, createdAt: { $lte: e } }).select('title status progress priority dueDate completedAt').lean())
    .filter((t) => t.status !== 'cancelled' && !(t.completedAt && t.completedAt < s));
  const byStatus = {}; for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return { total: tasks.length, byStatus, avgProgress: tasks.length ? Math.round(tasks.reduce((a, t) => a + t.progress, 0) / tasks.length) : 0,
    tasks: tasks.slice(0, 60).map((t) => ({ title: t.title, status: t.status, progress: t.progress, priority: t.priority, dueDate: t.dueDate })) };
}

// ---- lists ----------------------------------------------------------------
async function buildFilter(req) {
  const { ids, reports } = await visibleIds(req.user);
  const q = req.query; const me = req.user._id; const f = {};
  const box = q.box || 'mine';
  if (box === 'review') { f.status = { $in: OPEN }; f.author = { $ne: me }; if (req.user.role === 'admin') f.$or = [{ reviewer: me }, { reviewer: null }]; else f.reviewer = me; }
  else if (box === 'team') f.author = { $in: reports };
  else f.author = me;
  if (q.author) { if (!ids.includes(String(q.author))) fail(403, 'You cannot see this person\'s reports.'); f.author = q.author; }
  if (box !== 'review') {
    const hideDrafts = box === 'team' || (q.author && String(q.author) !== String(me));
    if (q.status && REPORT_STATUSES.includes(q.status)) f.status = q.status === 'draft' && hideDrafts ? { $in: [] } : q.status;
    else { const nin = []; if (hideDrafts) nin.push('draft'); if (q.archived !== '1') nin.push('archived'); if (nin.length) f.status = { $nin: nin }; else delete f.status; }
  }
  if (q.template) f.template = q.template;
  if (q.department) f.department = String(q.department);
  if (q.period) f.periodStart = String(q.period);
  if (q.q) { const r = { $regex: escapeRegex(String(q.q).slice(0, 80)), $options: 'i' }; const or = [{ title: r }, { templateName: r }, { periodLabel: r }]; f.$and = [{ $or: or }]; }
  return f;
}
router.get('/', async (req, res) => {
  const reports = await Report.find(await buildFilter(req)).sort({ updatedAt: -1 }).limit(500).select('-values -fields -activity -history -comments').populate(POP[0]).populate(POP[1]).lean();
  const mine = { status: { $in: OPEN }, author: { $ne: req.user._id }, ...(req.user.role === 'admin' ? { $or: [{ reviewer: req.user._id }, { reviewer: null }] } : { reviewer: req.user._id }) };
  res.json({ reports: reports.map(listShape), toReview: await Report.countDocuments(mine) });
});
router.get('/export.csv', async (req, res) => {
  const reports = await Report.find(await buildFilter(req)).sort({ updatedAt: -1 }).limit(5000).select('-values -fields -activity -history -comments').populate(POP[0]).populate(POP[1]).lean();
  const rows = [['Title', 'Type', 'Author', 'Department', 'Period', 'Status', 'Due', 'Submitted', 'On time', 'Waiting on']];
  for (const r of reports) rows.push([r.title, r.templateName, r.author?.name, r.department, r.periodLabel, r.status, r.dueDate?.toISOString().slice(0, 10), r.submittedAt?.toISOString().slice(0, 10), r.submittedAt ? (r.late ? 'late' : 'yes') : '', OPEN.includes(r.status) ? r.reviewer?.name || 'Admin' : '']);
  await audit(req, 'report.exported', 'reports', `${reports.length} rows`);
  res.type('text/csv').attachment('reports.csv').send(csv(rows));
});

// Periods I can file this template for, and what I already have
router.get('/periods', async (req, res) => {
  const t = await Template.findById(req.query.template).catch(() => null);
  if (!t || !t.active) fail(404, 'Template not found.');
  const periods = recentPeriods(t.periodType, t.periodType === 'adhoc' ? 1 : 6);
  const mine = await Report.find({ template: t._id, author: req.user._id, periodStart: { $in: periods.map((p) => p.start) } }).select('periodStart status').lean();
  const have = new Map(mine.map((r) => [r.periodStart, r]));
  res.json({ periods: periods.map((p) => ({ ...p, dueDate: dueDateFor(p.end, t.dueDays), existing: t.periodType === 'adhoc' ? null : have.has(p.start) ? { id: String(have.get(p.start)._id), status: have.get(p.start).status } : null })) });
});

// Numbers for the dashboard
router.get('/summary', async (req, res) => {
  const { org, ids } = await visibleIds(req.user);
  let set = ids;
  if (req.query.root) { if (!ids.includes(String(req.query.root))) fail(403, 'You cannot see this person\'s reports.'); set = [String(req.query.root), ...descendantsOf(org, req.query.root)]; }
  else if (!['admin', 'ceo'].includes(req.user.role)) set = ids;
  const reports = await Report.find({ author: { $in: set }, status: { $nin: ['draft', 'archived'] } }).select('status late firstSubmittedAt').lean();
  const byStatus = { submitted: 0, under_review: 0, returned: 0, approved: 0, rejected: 0 };
  for (const r of reports) byStatus[r.status]++;
  const since = new Date(Date.now() - 90 * 864e5); const recent = reports.filter((r) => r.firstSubmittedAt && r.firstSubmittedAt >= since);
  const mine = { status: { $in: OPEN }, author: { $ne: req.user._id }, ...(req.user.role === 'admin' ? { $or: [{ reviewer: req.user._id }, { reviewer: null }] } : { reviewer: req.user._id }) };
  res.json({ total: reports.length, byStatus, onTimePct: recent.length ? Math.round((recent.filter((r) => !r.late).length / recent.length) * 100) : null, recent: recent.length, toReview: await Report.countDocuments(mine) });
});

// Who was expected to file, who did, and how it splits by department
router.get('/compliance', async (req, res) => {
  const t = await Template.findById(req.query.template).catch(() => null);
  if (!t) fail(404, 'Template not found.');
  const periods = recentPeriods(t.periodType, 12);
  const period = periods.find((p) => p.start === req.query.period) || periods[t.periodType === 'adhoc' ? 0 : Math.min(1, periods.length - 1)];
  const { org, ids } = await visibleIds(req.user); const set = new Set(ids);
  const expected = org.users.filter((u) => set.has(String(u._id)) && t.requiredRoles.includes(u.role) && (!t.departments.length || t.departments.includes(u.department)));
  const reports = await Report.find({ template: t._id, periodStart: period.start, author: { $in: expected.map((u) => u._id) } }).select('author status statusBeforeArchive firstSubmittedAt late').lean();
  const by = new Map(reports.map((r) => [String(r.author), r]));
  const due = dueDateFor(period.end, t.dueDays); const now = new Date();
  const people = expected.map((u) => {
    const r = by.get(String(u._id)); const status = r ? effectiveStatus(r) : 'missing'; const filed = r && FILED.includes(status);
    const timing = filed ? (r.late ? 'late' : 'on_time') : now > due ? 'overdue' : due - now < 3 * 864e5 ? 'due_soon' : 'pending';
    return { id: String(u._id), name: u.name, role: u.role, department: u.department || 'No department', avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || '', status, timing, reportId: r && status !== 'draft' ? String(r._id) : null };
  }).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  const depts = new Map();
  for (const p of people) { if (!depts.has(p.department)) depts.set(p.department, { name: p.department, expected: 0, filed: 0, approved: 0, late: 0, overdue: 0 }); const d = depts.get(p.department); d.expected++; if (['on_time', 'late'].includes(p.timing)) d.filed++; if (p.status === 'approved') d.approved++; if (p.timing === 'late') d.late++; if (p.timing === 'overdue') d.overdue++; }
  const count = (k) => people.filter((p) => p.timing === k).length;
  res.json({
    template: { id: String(t._id), name: t.name, periodType: t.periodType }, period: { ...period, dueDate: due }, periods: periods.map((p) => ({ start: p.start, label: p.label })),
    totals: { expected: people.length, filed: count('on_time') + count('late'), onTime: count('on_time'), late: count('late'), overdue: count('overdue'), dueSoon: count('due_soon'), pending: count('pending'), approved: people.filter((p) => p.status === 'approved').length },
    departments: [...depts.values()].map((d) => ({ ...d, pct: d.expected ? Math.round((d.filed / d.expected) * 100) : 0 })), people,
  });
});

// One page for management: every department's activity, KPIs and reporting for a month
router.get('/management', async (req, res) => {
  if (!['admin', 'ceo', 'director', 'team_leader'].includes(req.user.role)) fail(403, 'You do not have access to this.');
  const m = /^(\d{4})-(\d{2})$/.exec(req.query.month || ''); const base = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 15)) : new Date();
  const period = periodFor('monthly', base); const s = new Date(period.start + 'T00:00:00Z'), e = new Date(period.end + 'T23:59:59Z'); const now = new Date();
  const { org, ids } = await visibleIds(req.user);
  const people = org.users.filter((u) => ids.includes(String(u._id)) && !['admin', 'ceo'].includes(u.role));
  const pid = people.map((u) => u._id); const deptOf = new Map(people.map((u) => [String(u._id), u.department || 'No department']));
  const [tasks, kpis, reports] = await Promise.all([
    Task.find({ owner: { $in: pid }, createdAt: { $lte: e } }).select('title owner status progress dueDate completedAt').lean(),
    Kpi.find({ owner: { $in: pid } }).select('-checkins').lean(),
    Report.find({ author: { $in: pid }, periodStart: { $gte: period.start, $lte: period.end }, status: { $ne: 'draft' } }).select('author status statusBeforeArchive late').lean(),
  ]);
  const blank = (name) => ({ name, people: 0, activities: 0, completed: 0, inProgress: 0, delayed: 0, notStarted: 0, progressSum: 0, kpis: 0, kpiSum: 0, reportsFiled: 0, reportsApproved: 0, reportsLate: 0 });
  const depts = new Map(); const get = (n) => { if (!depts.has(n)) depts.set(n, blank(n)); return depts.get(n); };
  for (const u of people) get(deptOf.get(String(u._id))).people++;
  const delayedList = [];
  for (const t of tasks) {
    if (t.status === 'cancelled' || (t.completedAt && t.completedAt < s)) continue;
    const d = get(deptOf.get(String(t.owner))); d.activities++; d.progressSum += t.progress;
    const overdue = t.dueDate && t.dueDate < (e < now ? e : now) && t.status !== 'done';
    if (t.status === 'done') d.completed++;
    else if (overdue || ['delayed', 'blocked'].includes(t.status)) { d.delayed++; delayedList.push({ title: t.title, owner: org.byId.get(String(t.owner))?.name, department: d.name, progress: t.progress, dueDate: t.dueDate }); }
    else if (t.status === 'not_started') d.notStarted++;
    else d.inProgress++;
  }
  for (const k of kpis) { const d = get(deptOf.get(String(k.owner))); d.kpis++; d.kpiSum += kpiHealth(k).pct; }
  for (const r of reports) { const d = get(deptOf.get(String(r.author))); d.reportsFiled++; if (effectiveStatus(r) === 'approved') d.reportsApproved++; if (r.late) d.reportsLate++; }
  const fin = (d) => ({ ...d, avgProgress: d.activities ? Math.round(d.progressSum / d.activities) : 0, kpiPct: d.kpis ? Math.round(d.kpiSum / d.kpis) : null, progressSum: undefined, kpiSum: undefined });
  const rows = [...depts.values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.reduce((a, d) => { for (const k of Object.keys(a)) if (k !== 'name') a[k] += d[k]; return a; }, blank('All departments'));
  res.json({ period, departments: rows.map(fin), totals: fin(total), delayed: delayedList.sort((a, b) => (a.dueDate || e) - (b.dueDate || e)).slice(0, 15), generatedAt: now });
});

// ---- one report -----------------------------------------------------------
router.post('/', async (req, res) => {
  const t = await Template.findById(req.body?.templateId).catch(() => null);
  if (!t || !t.active) fail(404, 'Template not found.');
  const periods = recentPeriods(t.periodType, t.periodType === 'adhoc' ? 1 : 6);
  const period = periods.find((p) => p.start === req.body?.periodStart) || periods[0];
  if (t.periodType !== 'adhoc') { const dup = await Report.findOne({ template: t._id, author: req.user._id, periodStart: period.start }); if (dup) fail(409, 'You already have this report for that period. Open it instead.'); }
  const report = await Report.create({
    template: t._id, templateName: t.name, title: t.periodType === 'adhoc' ? String(req.body?.title || t.name).slice(0, 160) : `${t.name}, ${period.label}`, author: req.user._id, department: req.user.department,
    periodType: t.periodType, periodStart: period.start, periodEnd: period.end, periodLabel: period.label, dueDate: dueDateFor(period.end, t.dueDays),
    fields: t.fields.map((f) => f.toObject()), values: {}, approvalLevels: t.approvalLevels, history: [{ action: 'created', by: req.user._id }], activity: t.includeTasks ? { pending: true } : null,
  });
  await audit(req, 'wreport.created', report.title);
  await report.populate(POP);
  res.status(201).json({ report: detailShape(report, req.user) });
});

router.get('/:id', async (req, res) => {
  const { report } = await findVisible(req, req.params.id);
  // the reviewer opening it is what moves it to "under review"
  if (report.status === 'submitted' && report.reviewer && String(report.reviewer) === String(req.user._id)) {
    report.status = 'under_review'; report.history.push({ action: 'review_started', by: req.user._id, step: report.step }); await report.save();
    await audit(req, 'wreport.review_started', report.title);
  }
  await report.populate(POP);
  const out = detailShape(report, req.user);
  if (out.editable && out.activity) out.activity = await taskSnapshot(report.author._id, report.periodStart, report.periodEnd); // live preview while drafting
  res.json({ report: out });
});

router.patch('/:id', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!mine || !['draft', 'returned'].includes(report.status)) fail(403, 'This report can no longer be edited.');
  const b = req.body || {};
  if (b.title !== undefined && report.periodType === 'adhoc') { if (!String(b.title).trim()) fail(400, 'Give the report a title.'); report.title = String(b.title).slice(0, 160); }
  if (b.values !== undefined) { report.values = cleanValues(report.fields, b.values, report.values || {}); report.markModified('values'); }
  await report.save();
  await audit(req, 'wreport.updated', report.title);
  await report.populate(POP);
  res.json({ report: detailShape(report, req.user) });
});

router.post('/:id/submit', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!mine || !['draft', 'returned'].includes(report.status)) fail(403, 'This report cannot be submitted right now.');
  if (req.body?.values) { report.values = cleanValues(report.fields, req.body.values, report.values || {}); report.markModified('values'); }
  const missing = report.fields.filter((f) => f.required && (report.values?.[f.id] === undefined || report.values[f.id] === '' || (f.type === 'checkbox' && !report.values[f.id])));
  if (missing.length) fail(400, `Fill in: ${missing.map((f) => f.label).join(', ')}.`);
  const org = await loadOrg(); const chain = chainAbove(org, report.author);
  const resubmit = report.status === 'returned'; const now = new Date();
  report.status = 'submitted'; report.step = 1; report.reviewer = chain[0] || null; report.submittedAt = now;
  if (!report.firstSubmittedAt) { report.firstSubmittedAt = now; report.late = !!report.dueDate && now > report.dueDate; }
  if (report.activity) { report.activity = await taskSnapshot(report.author, report.periodStart, report.periodEnd); report.markModified('activity'); }
  report.history.push({ action: resubmit ? 'resubmitted' : 'submitted', by: req.user._id, step: 1, comment: report.late && !resubmit ? 'Submitted after the deadline' : '' });
  await report.save();
  await notify(chain[0] ? [chain[0]] : await adminIds(), `${req.user.name} submitted a report for your review`, report.title, '/reports/' + report._id);
  await audit(req, resubmit ? 'wreport.resubmitted' : 'wreport.submitted', report.title, report.late ? 'late' : 'on time');
  await report.populate(POP);
  res.json({ report: detailShape(report, req.user) });
});

router.post('/:id/decision', async (req, res) => {
  const { report } = await findVisible(req, req.params.id);
  if (!canAct(req.user, report)) fail(403, OPEN.includes(report.status) ? 'It is not your turn to review this report.' : 'This report is not waiting for review.');
  const action = req.body?.action; const comment = String(req.body?.comment || '').trim().slice(0, 2000);
  if (!['approve', 'return', 'reject'].includes(action)) fail(400, 'Pick approve, return or reject.');
  if (action !== 'approve' && !comment) fail(400, 'Write the reason so the author knows what to fix.');
  const link = '/reports/' + report._id; const author = report.author;
  if (action === 'approve') {
    const org = await loadOrg(); const chain = chainAbove(org, author); const levels = Math.max(1, Math.min(report.approvalLevels, chain.length || 1));
    report.history.push({ action: 'approved', by: req.user._id, step: report.step, comment });
    if (report.step < levels) {
      report.step += 1; report.status = 'submitted'; report.reviewer = chain[report.step - 1] || null;
      await notify(report.reviewer ? [report.reviewer] : await adminIds(), 'A report is waiting for your approval', `${report.title} (level ${report.step} of ${levels})`, link);
      await notify(author, `${req.user.name} approved your report, level ${report.step - 1} of ${levels}`, report.title, link);
    } else {
      report.status = 'approved'; report.reviewer = null; report.decidedAt = new Date();
      await notify(author, 'Your report was approved', report.title, link);
    }
  } else {
    report.history.push({ action: action === 'return' ? 'returned' : 'rejected', by: req.user._id, step: report.step, comment });
    report.status = action === 'return' ? 'returned' : 'rejected'; report.reviewer = null; report.step = 0; if (action === 'reject') report.decidedAt = new Date();
    await notify(author, action === 'return' ? `${req.user.name} returned your report for changes` : `${req.user.name} rejected your report`, `${report.title}: ${comment}`, link);
  }
  await report.save();
  await audit(req, 'wreport.' + (action === 'approve' ? 'approved' : action === 'return' ? 'returned' : 'rejected'), report.title, comment);
  await report.populate(POP);
  res.json({ report: detailShape(report, req.user) });
});

router.post('/:id/comments', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text) fail(400, 'Write a comment first.');
  report.comments.push({ author: req.user._id, text: text.slice(0, 2000) });
  await report.save();
  await notify(mine ? [report.reviewer] : [report.author], `${req.user.name} commented on a report`, `${report.title}: ${text.slice(0, 120)}`, '/reports/' + report._id);
  await audit(req, 'wreport.commented', report.title);
  await report.populate(POP);
  res.status(201).json({ report: detailShape(report, req.user) });
});

router.post('/:id/archive', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!['approved', 'rejected'].includes(report.status) || !(mine || req.user.role === 'admin')) fail(403, 'Only finished reports can be archived, by their author or an admin.');
  report.statusBeforeArchive = report.status; report.status = 'archived'; report.history.push({ action: 'archived', by: req.user._id });
  await report.save();
  await audit(req, 'wreport.archived', report.title);
  await report.populate(POP);
  res.json({ report: detailShape(report, req.user) });
});

router.delete('/:id', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!mine || report.status !== 'draft') fail(403, 'Only your own drafts can be deleted.');
  await Attachment.deleteMany({ report: report._id }); await Report.deleteOne({ _id: report._id });
  await audit(req, 'wreport.deleted', report.title);
  res.json({ ok: true });
});

// ---- attachments (stored in the database so backups include them) ----------
router.post('/:id/attachments', express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!mine || !['draft', 'returned'].includes(report.status)) fail(403, 'Files can only be added while the report is being edited.');
  const name = String(req.query.name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120); const ext = name.split('.').pop().toLowerCase();
  if (!name || !ALLOWED_FILES[ext]) fail(400, 'That file type is not allowed. Use PDF, Word, Excel, PowerPoint, CSV, text or an image.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) fail(400, 'The file is empty.');
  if (report.attachments.length >= MAX_FILES) fail(400, `A report can hold up to ${MAX_FILES} files.`);
  const file = await Attachment.create({ report: report._id, name, mime: ALLOWED_FILES[ext], size: req.body.length, data: req.body });
  report.attachments.push({ file: file._id, name, size: file.size, mime: file.mime, by: req.user._id });
  await report.save();
  await audit(req, 'wreport.file_added', report.title, name);
  await report.populate(POP);
  res.status(201).json({ report: detailShape(report, req.user) });
});
router.get('/:id/attachments/:fileId', async (req, res) => {
  const { report } = await findVisible(req, req.params.id);
  if (!report.attachments.some((a) => String(a.file) === req.params.fileId)) fail(404, 'File not found.');
  const file = await Attachment.findById(req.params.fileId).lean().catch(() => null);
  const data = file && (Buffer.isBuffer(file.data) ? file.data : file.data?.buffer ? Buffer.from(file.data.buffer) : null); // the driver hands back a BSON Binary
  if (!data) fail(404, 'File not found.');
  res.set({ 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"` }).send(data);
});
router.delete('/:id/attachments/:fileId', async (req, res) => {
  const { report, mine } = await findVisible(req, req.params.id);
  if (!mine || !['draft', 'returned'].includes(report.status)) fail(403, 'Files can only be removed while the report is being edited.');
  const att = report.attachments.find((a) => String(a.file) === req.params.fileId);
  if (!att) fail(404, 'File not found.');
  report.attachments = report.attachments.filter((a) => String(a.file) !== req.params.fileId);
  await report.save(); await Attachment.deleteOne({ _id: req.params.fileId });
  await audit(req, 'wreport.file_removed', report.title, att.name);
  await report.populate(POP);
  res.json({ report: detailShape(report, req.user) });
});

module.exports = router;
