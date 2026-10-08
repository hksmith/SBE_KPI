const router = require('express').Router();
const { Task, Kpi, TASK_STATUSES, PRIORITIES } = require('../models');
const { fail, visibleIds, manages, audit, escapeRegex, csv, notify } = require('../lib');

const POP = [{ path: 'owner', select: 'name avatarColor avatarUrl role' }, { path: 'createdBy', select: 'name' }, { path: 'comments.author', select: 'name avatarColor avatarUrl' }, { path: 'history.by', select: 'name' }];
const isOverdue = (t) => !!t.dueDate && new Date(t.dueDate) < new Date() && !['done', 'cancelled'].includes(t.status);
const shape = (t, me, canManage) => {
  const o = t.toObject ? t.toObject() : t;
  const mine = String(o.owner?._id || o.owner) === String(me._id);
  return { ...o, id: String(o._id), overdue: isOverdue(o), canEdit: mine || canManage, canDelete: canManage || (mine && String(o.createdBy?._id || o.createdBy) === String(me._id)) };
};
const parseDate = (v) => { if (v === null || v === '') return null; const d = new Date(v); if (isNaN(d)) fail(400, 'Enter a valid date.'); return d; };

async function findVisible(req, id) {
  const task = await Task.findById(id).catch(() => null);
  if (!task) fail(404, 'Task not found.');
  const { ids, reports } = await visibleIds(req.user);
  if (!ids.includes(String(task.owner))) fail(404, 'Task not found.');
  const canManage = req.user.role === 'admin' || (req.user.role !== 'ceo' && reports.includes(String(task.owner)));
  return { task, canManage, mine: String(task.owner) === String(req.user._id) };
}

async function buildFilter(req) {
  const { ids, reports } = await visibleIds(req.user);
  const { scope = 'mine', owner, status, priority, q, overdue } = req.query;
  const filter = {};
  if (owner) { if (!ids.includes(String(owner))) fail(403, 'You cannot see this person\'s work.'); filter.owner = owner; }
  else if (scope === 'team') filter.owner = { $in: reports };
  else if (scope === 'all') filter.owner = { $in: ids };
  else filter.owner = req.user._id;
  if (status && TASK_STATUSES.includes(status)) filter.status = status;
  if (priority && PRIORITIES.includes(priority)) filter.priority = priority;
  if (q) filter.title = { $regex: escapeRegex(String(q).slice(0, 80)), $options: 'i' };
  if (overdue === '1') { filter.dueDate = { $lt: new Date() }; filter.status = { $nin: ['done', 'cancelled'] }; }
  return { filter, reports };
}

router.get('/', async (req, res) => {
  const { filter, reports } = await buildFilter(req);
  const tasks = await Task.find(filter).sort({ updatedAt: -1 }).limit(1000).populate(POP[0]).populate(POP[1]).select('-comments -history');
  const canManage = (t) => req.user.role === 'admin' || (req.user.role !== 'ceo' && reports.includes(String(t.owner?._id)));
  res.json({ tasks: tasks.map((t) => shape(t, req.user, canManage(t))) });
});

router.get('/export.csv', async (req, res) => {
  const { filter } = await buildFilter(req);
  const tasks = await Task.find(filter).sort({ updatedAt: -1 }).limit(5000).populate(POP[0]).lean();
  const rows = [['Title', 'Owner', 'Status', 'Progress %', 'Priority', 'Due date', 'Overdue', 'Created', 'Completed']];
  for (const t of tasks) rows.push([t.title, t.owner?.name, t.status, t.progress, t.priority, t.dueDate?.toISOString().slice(0, 10), isOverdue(t) ? 'yes' : 'no', t.createdAt.toISOString().slice(0, 10), t.completedAt?.toISOString().slice(0, 10)]);
  await audit(req, 'report.exported', 'tasks', `${tasks.length} rows`);
  res.type('text/csv').attachment('tasks.csv').send(csv(rows));
});

router.get('/:id', async (req, res) => {
  const { task, canManage } = await findVisible(req, req.params.id);
  await task.populate(POP);
  res.json({ task: shape(task, req.user, canManage) });
});

function applyProgress(task, b, userId, note) {
  let changed = false;
  if (b.status !== undefined && b.status !== task.status) {
    if (!TASK_STATUSES.includes(b.status)) fail(400, 'Pick a valid status.');
    task.status = b.status; changed = true;
    if (b.status === 'done') task.progress = 100;
  }
  if (b.progress !== undefined && b.status !== 'done') {
    const p = Math.round(Number(b.progress));
    if (!(p >= 0 && p <= 100)) fail(400, 'Progress must be between 0 and 100.');
    if (p !== task.progress) {
      task.progress = p; changed = true;
      if (p === 100 && !['done', 'cancelled'].includes(task.status)) task.status = 'done';
      else if (p < 100 && task.status === 'done') task.status = 'in_progress';
      else if (p > 0 && task.status === 'not_started') task.status = 'in_progress';
    }
  }
  if (task.status === 'done' && !task.completedAt) task.completedAt = new Date();
  if (task.status !== 'done') task.completedAt = undefined;
  if (changed) task.history.push({ by: userId, status: task.status, progress: task.progress, note: note ? String(note).slice(0, 300) : '' });
  return changed;
}

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) fail(400, 'Give the task a title.');
  let owner = req.user._id;
  if (b.ownerId && String(b.ownerId) !== String(req.user._id)) {
    if (!(await manages(req.user, b.ownerId))) fail(403, 'You can only assign tasks to people in your own teams.');
    owner = b.ownerId;
  }
  if (b.priority && !PRIORITIES.includes(b.priority)) fail(400, 'Pick a valid priority.');
  const task = new Task({
    title: String(b.title).slice(0, 200), description: String(b.description || '').slice(0, 4000), owner, createdBy: req.user._id,
    priority: b.priority || 'medium', dueDate: b.dueDate ? parseDate(b.dueDate) : undefined,
  });
  if (b.kpiId) { const k = await Kpi.findById(b.kpiId).catch(() => null); if (k && String(k.owner) === String(owner)) task.kpiId = k._id; }
  applyProgress(task, { status: b.status, progress: b.progress }, req.user._id);
  if (!task.history.length) task.history.push({ by: req.user._id, status: task.status, progress: task.progress, note: 'Created' });
  await task.save();
  await audit(req, 'task.created', task.title, String(owner) !== String(req.user._id) ? 'Assigned to a team member' : '');
  if (String(owner) !== String(req.user._id)) await notify(owner, `${req.user.name} assigned you a task`, task.title, '/tasks?open=' + task._id);
  await task.populate(POP);
  res.status(201).json({ task: shape(task, req.user, true) });
});

router.patch('/:id', async (req, res) => {
  const { task, canManage, mine } = await findVisible(req, req.params.id);
  if (!mine && !canManage) fail(403, 'You can view this task but not change it.');
  const b = req.body || {}; const changes = [];
  if (b.title !== undefined) { if (!String(b.title).trim()) fail(400, 'Give the task a title.'); task.title = String(b.title).slice(0, 200); changes.push('title'); }
  if (b.description !== undefined) { task.description = String(b.description).slice(0, 4000); changes.push('description'); }
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) fail(400, 'Pick a valid priority.'); task.priority = b.priority; changes.push('priority'); }
  if (b.dueDate !== undefined) { task.dueDate = parseDate(b.dueDate) || undefined; changes.push('due date'); }
  if (b.ownerId !== undefined && String(b.ownerId) !== String(task.owner)) {
    if (!canManage || !(String(b.ownerId) === String(req.user._id) || await manages(req.user, b.ownerId))) fail(403, 'You can only reassign tasks within your own teams.');
    task.owner = b.ownerId; changes.push('owner');
  }
  if (applyProgress(task, b, req.user._id, b.note)) changes.push(`${task.status} ${task.progress}%`);
  await task.save();
  await audit(req, 'task.updated', task.title, changes.join(', '));
  await task.populate(POP);
  res.json({ task: shape(task, req.user, canManage) });
});

router.post('/:id/comments', async (req, res) => {
  const { task, canManage } = await findVisible(req, req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text) fail(400, 'Write a comment first.');
  task.comments.push({ author: req.user._id, text: text.slice(0, 1000) });
  await task.save();
  await audit(req, 'task.commented', task.title);
  if (String(task.owner) !== String(req.user._id)) await notify(task.owner, `${req.user.name} commented on your task`, `${task.title}: ${text.slice(0, 120)}`, '/tasks?open=' + task._id);
  await task.populate(POP);
  res.status(201).json({ task: shape(task, req.user, canManage) });
});

router.delete('/:id', async (req, res) => {
  const { task, canManage, mine } = await findVisible(req, req.params.id);
  if (!(canManage || (mine && String(task.createdBy) === String(req.user._id)))) fail(403, 'Only the person who assigned this task can delete it.');
  await Task.deleteOne({ _id: task._id });
  await audit(req, 'task.deleted', task.title);
  res.json({ ok: true });
});

module.exports = router;
