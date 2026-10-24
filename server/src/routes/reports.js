const router = require('express').Router();
const { Task, Plan, Kpi, TASK_STATUSES } = require('../models');
const { fail, visibleIds, descendantsOf, weekStart, getSettings, pastDue } = require('../lib');
const { kpiHealth } = require('./kpis');
const { planProgress } = require('./plans');

const emptyStats = () => ({ total: 0, done: 0, overdue: 0, progressSum: 0, counted: 0, byStatus: Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) });
const addTask = (s, t, now) => {
  s.total++; s.byStatus[t.status]++;
  if (t.status === 'done') s.done++;
  if (t.status !== 'cancelled') { s.progressSum += t.progress; s.counted++; }
  if (pastDue(t.dueDate, now) && !['done', 'cancelled'].includes(t.status)) s.overdue++;
};
const merge = (a, b) => { a.total += b.total; a.done += b.done; a.overdue += b.overdue; a.progressSum += b.progressSum; a.counted += b.counted; for (const k of TASK_STATUSES) a.byStatus[k] += b.byStatus[k]; return a; };
const finish = (s) => ({ total: s.total, done: s.done, overdue: s.overdue, byStatus: s.byStatus, avgProgress: s.counted ? Math.round(s.progressSum / s.counted) : 0 });

router.get('/overview', async (req, res) => {
  const { org, ids } = await visibleIds(req.user);
  const visible = new Set(ids);
  const seesEveryone = req.user.role === 'admin' || req.user.role === 'ceo';
  let rootId = req.query.root ? String(req.query.root) : (seesEveryone ? null : String(req.user._id));
  if (rootId && !visible.has(rootId)) fail(403, 'You cannot see this person\'s report.');
  const setIds = rootId ? [rootId, ...descendantsOf(org, rootId)] : ids;
  const inSet = new Set(setIds);
  const now = new Date(); const thisWeek = weekStart(now);

  // With the tasks module off, the whole overview is driven by KPIs instead.
  const settings = await getSettings(); const source = settings.modules.tasks ? 'tasks' : 'kpis';
  const [taskRows, plans, kpis] = await Promise.all([
    source === 'tasks' ? Task.find({ owner: { $in: setIds } }).select('title owner status progress priority dueDate completedAt createdAt').lean() : [],
    Plan.find({ owner: { $in: setIds }, weekStart: thisWeek }).select('owner status items').lean(),
    Kpi.find({ owner: { $in: setIds } }).select('-checkins').lean(),
  ]);

  const tasks = source === 'tasks' ? taskRows : kpis.map((k) => { const h = kpiHealth(k); return { _id: k._id, title: k.name, owner: k.owner, status: h.status, progress: h.pct, priority: k.priority || 'medium', dueDate: k.dueDate, completedAt: k.completedAt, createdAt: k.createdAt }; });
  // per person
  const own = new Map(setIds.map((id) => [id, emptyStats()]));
  for (const t of tasks) { const s = own.get(String(t.owner)); if (s) addTask(s, t, now); }
  const planBy = new Map(plans.map((p) => [String(p.owner), p]));
  const kpiBy = new Map();
  const kpiOut = kpis.map((k) => ({ id: String(k._id), name: k.name, mode: k.mode || 'number', unit: k.unit, owner: String(k.owner), baseline: k.baseline, target: k.target, current: k.current, dueDate: k.dueDate, ...kpiHealth(k) }));
  for (const k of kpiOut) { if (!kpiBy.has(k.owner)) kpiBy.set(k.owner, []); kpiBy.get(k.owner).push(k); }

  const rollup = (id) => { const s = emptyStats(); const members = [id, ...descendantsOf(org, id)].filter((x) => inSet.has(x)); for (const m of members) merge(s, own.get(m)); return { ...finish(s), headcount: members.length }; };
  const people = setIds.map((id) => {
    const u = org.byId.get(id); const p = planBy.get(id); const ks = kpiBy.get(id) || [];
    return {
      id, name: u.name, role: u.role, title: u.title, department: u.department, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl || '',
      managerId: u.managerId && inSet.has(String(u.managerId)) ? String(u.managerId) : null,
      tasks: finish(own.get(id)), rollup: rollup(id),
      plan: p && p.status !== 'draft' ? { status: p.status, progress: planProgress(p), items: p.items.length } : null,
      kpis: { count: ks.length, avgPct: ks.length ? Math.round(ks.reduce((s, k) => s + k.pct, 0) / ks.length) : null },
    };
  });

  // totals
  const total = emptyStats(); for (const s of own.values()) merge(total, s);
  const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
  for (const t of tasks) if (!['done', 'cancelled'].includes(t.status)) byPriority[t.priority]++;
  const kpiHealthCount = { achieved: 0, on_track: 0, at_risk: 0, off_track: 0 };
  for (const k of kpiOut) if (k.health in kpiHealthCount) kpiHealthCount[k.health]++;

  // groups: the teams directly under the root (or the top of the structure)
  // With no root, start from the top of the structure; a CEO/admin at the top is replaced by the directors under them.
  const kidsOf = (id) => (org.children.get(id) || []).map((u) => String(u._id)).filter((x) => inSet.has(x));
  const tops = rootId ? kidsOf(rootId) : people.filter((p) => !p.managerId).flatMap((p) => (['admin', 'ceo'].includes(p.role) && kidsOf(p.id).length ? kidsOf(p.id) : [p.id]));
  const groups = tops.map((id) => { const u = org.byId.get(id); return { id, name: u.name, role: u.role, title: u.title, ...rollup(id) }; })
    .filter((g) => g.total > 0 || g.headcount > 1 || !['admin', 'ceo'].includes(g.role));

  // 8 week trend
  const weeks = []; const cur = new Date(thisWeek + 'T00:00:00Z');
  for (let i = 7; i >= 0; i--) { const d = new Date(cur); d.setUTCDate(d.getUTCDate() - i * 7); weeks.push({ week: d.toISOString().slice(0, 10), created: 0, completed: 0 }); }
  const idx = new Map(weeks.map((w, i) => [w.week, i]));
  for (const t of tasks) {
    const c = idx.get(weekStart(t.createdAt)); if (c !== undefined) weeks[c].created++;
    if (t.completedAt) { const d = idx.get(weekStart(t.completedAt)); if (d !== undefined) weeks[d].completed++; }
  }

  const soon = new Date(now.getTime() + 7 * 864e5);
  const attention = tasks.filter((t) => !['done', 'cancelled'].includes(t.status) && ((t.dueDate && t.dueDate < soon) || ['delayed', 'blocked'].includes(t.status)))
    .sort((a, b) => (a.dueDate || soon) - (b.dueDate || soon)).slice(0, 10)
    .map((t) => ({ id: String(t._id), title: t.title, owner: org.byId.get(String(t.owner))?.name, status: t.status, progress: t.progress, dueDate: t.dueDate, overdue: pastDue(t.dueDate, now) }));

  const expected = people.filter((p) => !['admin', 'ceo'].includes(p.role)).length;
  res.json({
    root: rootId ? { id: rootId, name: org.byId.get(rootId).name, role: org.byId.get(rootId).role } : null,
    source, modules: settings.modules, week: thisWeek, headcount: setIds.length,
    totals: { ...finish(total), completionRate: total.total ? Math.round((total.done / total.total) * 100) : 0 },
    byPriority, groups, people, trend: weeks, attention,
    plans: { submitted: people.filter((p) => p.plan && !['admin', 'ceo'].includes(p.role)).length, expected },
    kpis: { byHealth: kpiHealthCount, avgPct: kpiOut.length ? Math.round(kpiOut.reduce((s, k) => s + k.pct, 0) / kpiOut.length) : null, list: kpiOut.filter((k) => !['achieved', 'cancelled'].includes(k.health)).sort((a, b) => a.pct - b.pct).slice(0, 12).map((k) => ({ ...k, ownerName: org.byId.get(k.owner)?.name })) },
  });
});

module.exports = router;
