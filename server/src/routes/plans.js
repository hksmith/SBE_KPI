const router = require('express').Router();
const { Plan, TASK_STATUSES } = require('../models');
const { fail, visibleIds, audit, weekStart, notify } = require('../lib');

const POP = [{ path: 'owner', select: 'name avatarColor avatarUrl role title' }, { path: 'review.by', select: 'name' }];
const planProgress = (p) => p.items.length ? Math.round(p.items.reduce((s, i) => s + (i.progress || 0), 0) / p.items.length) : 0;
const shape = (p, me, canReview) => { const o = p.toObject(); return { ...o, id: String(o._id), progress: planProgress(o), mine: String(o.owner?._id || o.owner) === String(me._id), canReview }; };
const isWeek = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || '') && weekStart(new Date(w + 'T00:00:00Z')) === w;

function cleanItems(items) {
  if (!Array.isArray(items)) fail(400, 'Add at least one item to the plan.');
  return items.filter((i) => i && String(i.text || '').trim()).slice(0, 50).map((i) => {
    const status = TASK_STATUSES.includes(i.status) ? i.status : 'not_started';
    let progress = Math.max(0, Math.min(100, Math.round(Number(i.progress) || 0)));
    if (status === 'done') progress = 100;
    return { text: String(i.text).trim().slice(0, 300), status, progress };
  });
}
const canReviewPlan = (user, reports, ownerId) => String(ownerId) !== String(user._id) && (user.role === 'admin' || user.role === 'ceo' || reports.includes(String(ownerId)));

router.get('/', async (req, res) => {
  const { ids, reports } = await visibleIds(req.user);
  const { scope = 'mine', week, owner } = req.query;
  const filter = {};
  if (owner) { if (!ids.includes(String(owner))) fail(403, 'You cannot see this person\'s plans.'); filter.owner = owner; }
  else if (scope === 'team') { filter.owner = { $in: reports }; filter.status = { $ne: 'draft' }; }
  else filter.owner = req.user._id;
  if (week) filter.weekStart = week;
  if (owner && String(owner) !== String(req.user._id)) filter.status = { $ne: 'draft' };
  const plans = await Plan.find(filter).sort({ weekStart: -1 }).limit(300).populate(POP);
  res.json({ plans: plans.map((p) => shape(p, req.user, canReviewPlan(req.user, reports, p.owner._id))), currentWeek: weekStart() });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const week = b.weekStart || weekStart();
  if (!isWeek(week)) fail(400, 'Week must start on a Monday.');
  if (await Plan.findOne({ owner: req.user._id, weekStart: week })) fail(409, 'You already have a plan for this week. Open it to edit.');
  const items = cleanItems(b.items);
  const plan = await Plan.create({ owner: req.user._id, weekStart: week, items, achievements: String(b.achievements || '').slice(0, 3000), blockers: String(b.blockers || '').slice(0, 3000), nextWeek: String(b.nextWeek || '').slice(0, 3000) });
  await audit(req, 'plan.created', `Week of ${week}`, `${items.length} items`);
  await plan.populate(POP);
  res.status(201).json({ plan: shape(plan, req.user, false) });
});

router.patch('/:id', async (req, res) => {
  const plan = await Plan.findById(req.params.id).catch(() => null);
  if (!plan || String(plan.owner) !== String(req.user._id)) fail(404, 'Plan not found.');
  const b = req.body || {};
  if (b.items !== undefined) plan.items = cleanItems(b.items);
  for (const k of ['achievements', 'blockers', 'nextWeek']) if (b[k] !== undefined) plan[k] = String(b[k]).slice(0, 3000);
  let action = 'plan.updated';
  if (b.submit) {
    if (!plan.items.length) fail(400, 'Add at least one item before submitting.');
    if (plan.status === 'draft') action = 'plan.submitted';
    plan.status = 'submitted'; plan.submittedAt = new Date(); plan.review = undefined;
  }
  await plan.save();
  await audit(req, action, `Week of ${plan.weekStart}`);
  await plan.populate(POP);
  res.json({ plan: shape(plan, req.user, false) });
});

router.post('/:id/review', async (req, res) => {
  const plan = await Plan.findById(req.params.id).catch(() => null);
  const { ids, reports } = await visibleIds(req.user);
  if (!plan || !ids.includes(String(plan.owner)) || plan.status === 'draft') fail(404, 'Plan not found.');
  if (!canReviewPlan(req.user, reports, plan.owner)) fail(403, 'Only this person\'s managers can review their plan.');
  const rating = req.body?.rating ? Math.max(1, Math.min(5, Math.round(Number(req.body.rating)))) : undefined;
  plan.review = { by: req.user._id, comment: String(req.body?.comment || '').slice(0, 2000), rating, at: new Date() };
  plan.status = 'reviewed';
  await plan.save();
  await plan.populate(POP);
  await audit(req, 'plan.reviewed', `${plan.owner.name}, week of ${plan.weekStart}`);
  await notify(plan.owner._id, `${req.user.name} reviewed your weekly plan`, `Week of ${plan.weekStart}`, '/plans');
  res.json({ plan: shape(plan, req.user, true) });
});

router.delete('/:id', async (req, res) => {
  const plan = await Plan.findById(req.params.id).catch(() => null);
  if (!plan || String(plan.owner) !== String(req.user._id)) fail(404, 'Plan not found.');
  if (plan.status !== 'draft') fail(400, 'Submitted plans cannot be deleted.');
  await Plan.deleteOne({ _id: plan._id });
  await audit(req, 'plan.deleted', `Week of ${plan.weekStart}`);
  res.json({ ok: true });
});

module.exports = router;
module.exports.planProgress = planProgress;
