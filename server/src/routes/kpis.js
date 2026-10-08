const router = require('express').Router();
const { Kpi, User, TASK_STATUSES, PRIORITIES } = require('../models');
const { fail, visibleIds, audit, notify, escapeRegex } = require('../lib');

const POP = [{ path: 'owner', select: 'name avatarColor avatarUrl role title department' }, { path: 'createdBy', select: 'name' }, { path: 'checkins.by', select: 'name' }];
const num = (v, label) => { const n = Number(v); if (v === '' || v == null || !isFinite(n)) fail(400, `${label} must be a number.`); return n; };
const optDate = (v) => { if (!v) return undefined; const d = new Date(v); if (isNaN(d)) fail(400, 'Enter a valid date.'); return d; };
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** How far along a KPI is, 0 to 100. Percent KPIs hold it directly; number KPIs work it out from start, current and target. */
function kpiPct(k) {
  if (k.mode === 'percent') return clamp(k.progress || 0);
  const span = k.target - k.baseline;
  return span === 0 ? (k.current === k.target ? 100 : 0) : clamp(((k.current - k.baseline) / span) * 100);
}
/** Status as stored, or worked out for KPIs created before statuses existed. */
function kpiStatus(k) { if (k.status) return k.status; const p = kpiPct(k); return p >= 100 ? 'done' : p > 0 ? 'in_progress' : 'not_started'; }
/** Percent, status, and a pace reading against the time elapsed. */
function kpiHealth(k) {
  const pct = kpiPct(k); const status = kpiStatus(k); let health;
  if (status === 'cancelled') health = 'cancelled';
  else if (status === 'done' || pct >= 100) health = 'achieved';
  else if (['delayed', 'blocked'].includes(status)) health = 'off_track';
  else if (k.startDate && k.dueDate && k.dueDate > k.startDate) {
    const expected = Math.max(0, Math.min(1, (Date.now() - k.startDate) / (k.dueDate - k.startDate))) * 100;
    health = Date.now() > k.dueDate ? 'off_track' : expected < 5 || pct >= expected * 0.9 ? 'on_track' : pct >= expected * 0.6 ? 'at_risk' : 'off_track';
  } else health = pct >= 70 ? 'on_track' : pct >= 40 ? 'at_risk' : 'off_track';
  return { pct, health, status };
}
const isOverdue = (k) => !!k.dueDate && new Date(k.dueDate) < new Date() && !['done', 'cancelled'].includes(kpiStatus(k));
// Admin and CEO can set KPIs for anyone; managers for the people under them.
const canManage = (user, reports, ownerId) => ['admin', 'ceo'].includes(user.role) || reports.includes(String(ownerId));
const shape = (k, me, manage) => {
  const o = k.toObject ? k.toObject() : k; const mine = String(o.owner?._id || o.owner) === String(me._id);
  return { ...o, id: String(o._id), mode: o.mode || 'number', priority: o.priority || 'medium', unseen: !!o.unseen, isNew: !!o.unseen && mine, ...kpiHealth(o), overdue: isOverdue(o), mine, canUpdate: mine || manage, canEdit: manage || (mine && String(o.createdBy?._id || o.createdBy) === String(me._id)) };
};

async function findVisible(req, id) {
  const kpi = await Kpi.findById(id).catch(() => null);
  const { ids, reports } = await visibleIds(req.user);
  if (!kpi || !ids.includes(String(kpi.owner))) fail(404, 'KPI not found.');
  return { kpi, manage: canManage(req.user, reports, kpi.owner), mine: String(kpi.owner) === String(req.user._id), reports };
}
async function checkOwner(req, ownerId, reports) {
  if (!ownerId || String(ownerId) === String(req.user._id)) return req.user._id;
  if (!canManage(req.user, reports, ownerId)) fail(403, 'You can only set KPIs for people in your own teams.');
  const u = await User.findById(ownerId).catch(() => null);
  if (!u || u.status !== 'active') fail(400, 'Pick an active person.');
  return u._id;
}

/** Apply a progress update. Returns true when something changed. */
function applyUpdate(k, b, userId) {
  let changed = false;
  if (b.status !== undefined && b.status !== k.status) { if (!TASK_STATUSES.includes(b.status)) fail(400, 'Pick a valid status.'); k.status = b.status; changed = true; }
  if (k.mode === 'percent') {
    if (b.progress !== undefined && b.progress !== '') { const p = Math.round(num(b.progress, 'Progress')); if (p < 0 || p > 100) fail(400, 'Progress must be between 0 and 100.'); if (p !== k.progress) { k.progress = p; changed = true; } }
    else if (b.status === 'done' && changed) k.progress = 100;
  } else if (b.value !== undefined && b.value !== '') { const v = num(b.value, 'Value'); if (v !== k.current) { k.current = v; changed = true; } }
  const pct = kpiPct(k);
  if (k.mode !== 'percent') k.progress = pct;
  if (!k.status) k.status = 'not_started';
  if (pct >= 100 && !['done', 'cancelled'].includes(k.status)) k.status = 'done';
  else if (pct < 100 && k.status === 'done' && b.status !== 'done') k.status = 'in_progress';
  else if (pct > 0 && k.status === 'not_started' && b.status !== 'not_started') k.status = 'in_progress';
  if (k.status === 'done' && !k.completedAt) k.completedAt = new Date();
  if (k.status !== 'done') k.completedAt = undefined;
  if (changed) { k.checkins.push({ value: k.mode === 'percent' ? k.progress : k.current, status: k.status, note: String(b.note || '').slice(0, 300), by: userId }); if (k.checkins.length > 200) k.checkins = k.checkins.slice(-200); }
  return changed;
}

/** The KPIs this person may see, narrowed by the same query filters the page uses. */
async function listKpis(req) {
  const { ids, reports } = await visibleIds(req.user);
  const { scope = 'mine', owner, status, q } = req.query;
  const filter = {};
  if (owner) { if (!ids.includes(String(owner))) fail(403, 'You cannot see this person\'s KPIs.'); filter.owner = owner; }
  else if (scope === 'team') filter.owner = { $in: reports };
  else if (scope === 'all') filter.owner = { $in: ids };
  else filter.owner = req.user._id;
  if (q) filter.name = { $regex: escapeRegex(String(q).slice(0, 80)), $options: 'i' };
  let kpis = (await Kpi.find(filter).sort({ createdAt: -1 }).limit(1000).populate(POP)).map((k) => shape(k, req.user, canManage(req.user, reports, k.owner._id)));
  if (status === 'overdue') kpis = kpis.filter((k) => k.overdue); else if (status && TASK_STATUSES.includes(status)) kpis = kpis.filter((k) => k.status === status);
  if (req.query.priority && PRIORITIES.includes(req.query.priority)) kpis = kpis.filter((k) => k.priority === req.query.priority);
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 }; const closed = (k) => (['done', 'cancelled'].includes(k.status) ? 1 : 0);
  kpis.sort((a, b) => (b.isNew - a.isNew) || (closed(a) - closed(b)) || (rank[a.priority] - rank[b.priority]) || (new Date(b.createdAt) - new Date(a.createdAt)));
  return kpis;
}

router.get('/', async (req, res) => res.json({ kpis: await listKpis(req) }));

// Excel download of whatever list the person is looking at (same scope, filters and visibility rules).
const STATUS_LABEL = { not_started: 'Not started', started: 'Started', in_progress: 'In progress', done: 'Done', delayed: 'Delayed', blocked: 'Blocked', on_hold: 'On hold', cancelled: 'Cancelled' };
const HEALTH_LABEL = { achieved: 'Achieved', on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', cancelled: 'Cancelled' };
const URGENCY_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v); // a cell must never run as a formula
const FILLS = { done: 'FFD9F2E3', achieved: 'FFD9F2E3', in_progress: 'FFDCE9FB', started: 'FFDCE9FB', on_track: 'FFDCE9FB', delayed: 'FFFDE7C8', at_risk: 'FFFDE7C8', blocked: 'FFFAD4D4', off_track: 'FFFAD4D4', urgent: 'FFFAD4D4', high: 'FFFDE7C8' };

router.get('/export.xlsx', async (req, res) => {
  const ExcelJS = require('exceljs');
  const kpis = await listKpis(req);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WorkTrack'; wb.created = new Date();
  const ws = wb.addWorksheet('KPIs', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'KPI', key: 'name', width: 38 }, { header: 'Description', key: 'desc', width: 44 }, { header: 'Assigned to', key: 'owner', width: 22 },
    { header: 'Job title', key: 'title', width: 22 }, { header: 'Department', key: 'dept', width: 20 }, { header: 'Urgency', key: 'urg', width: 11 },
    { header: 'Status', key: 'status', width: 14 }, { header: 'Pace', key: 'health', width: 12 }, { header: 'Progress', key: 'pct', width: 11 },
    { header: 'Measured by', key: 'mode', width: 13 }, { header: 'Start value', key: 'base', width: 12 }, { header: 'Current', key: 'cur', width: 12 },
    { header: 'Target', key: 'target', width: 12 }, { header: 'Unit', key: 'unit', width: 10 }, { header: 'Deadline', key: 'due', width: 13 },
    { header: 'Past deadline', key: 'over', width: 13 }, { header: 'Assigned by', key: 'by', width: 20 }, { header: 'Created', key: 'created', width: 13 },
    { header: 'Opened by owner', key: 'opened', width: 16 }, { header: 'Last update', key: 'last', width: 13 }, { header: 'Completed', key: 'done', width: 13 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.alignment = { vertical: 'middle' }; head.height = 22;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A4D8F' } }; });
  const day = (d) => (d ? new Date(d) : null);
  for (const k of kpis) {
    const last = k.checkins?.length ? k.checkins[k.checkins.length - 1].at : null;
    const pctMode = k.mode === 'percent';
    const row = ws.addRow({
      name: safe(k.name), desc: safe(k.description || ''), owner: safe(k.owner?.name || ''), title: safe(k.owner?.title || ''), dept: safe(k.owner?.department || ''),
      urg: URGENCY_LABEL[k.priority] || k.priority, status: STATUS_LABEL[k.status] || k.status, health: HEALTH_LABEL[k.health] || '', pct: k.pct / 100,
      mode: pctMode ? 'Percentage' : 'Number', base: pctMode ? null : k.baseline, cur: pctMode ? null : k.current, target: pctMode ? null : k.target, unit: pctMode ? '' : safe(k.unit || ''),
      due: day(k.dueDate), over: k.overdue ? 'Yes' : 'No', by: safe(k.createdBy?.name || ''), created: day(k.createdAt), opened: k.unseen ? 'Not yet' : 'Yes', last: day(last), done: day(k.completedAt),
    });
    row.getCell('pct').numFmt = '0%';
    for (const key of ['due', 'created', 'last', 'done']) row.getCell(key).numFmt = 'yyyy-mm-dd';
    for (const [key, val] of [['urg', k.priority], ['status', k.status], ['health', k.health]]) if (FILLS[val]) row.getCell(key).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILLS[val] } };
    row.getCell('desc').alignment = { wrapText: true, vertical: 'top' };
    if (k.overdue) row.getCell('due').font = { color: { argb: 'FFB42318' }, bold: true };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 26 }, { width: 12 }];
  sum.addRow(['KPI export']).font = { bold: true, size: 14 };
  sum.addRow(['Exported by', req.user.name]); sum.addRow(['Exported on', new Date()]).getCell(2).numFmt = 'yyyy-mm-dd hh:mm';
  sum.addRow(['KPIs in this file', kpis.length]); sum.addRow([]);
  sum.addRow(['Status', 'KPIs']).font = { bold: true };
  for (const [key, label] of Object.entries(STATUS_LABEL)) { const n = kpis.filter((k) => k.status === key).length; if (n) sum.addRow([label, n]); }
  sum.addRow([]); sum.addRow(['Urgency', 'KPIs']).font = { bold: true };
  for (const [key, label] of Object.entries(URGENCY_LABEL)) { const n = kpis.filter((k) => k.priority === key).length; if (n) sum.addRow([label, n]); }
  sum.addRow([]); sum.addRow(['Past deadline', kpis.filter((k) => k.overdue).length]);
  sum.addRow(['Average progress', kpis.length ? Math.round(kpis.reduce((a, k) => a + k.pct, 0) / kpis.length) / 100 : 0]).getCell(2).numFmt = '0%';

  await audit(req, 'report.exported', 'kpis', `${kpis.length} rows (xlsx)`);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="kpis-${new Date().toISOString().slice(0, 10)}.xlsx"` });
  await wb.xlsx.write(res);
  res.end();
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) fail(400, 'Give the KPI a name.');
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) fail(400, 'Pick a valid urgency.');
  const { reports } = await visibleIds(req.user);
  // one KPI per person when several people are picked
  const wanted = Array.isArray(b.ownerIds) && b.ownerIds.length ? [...new Set(b.ownerIds.map(String))].slice(0, 200) : [b.ownerId];
  const owners = []; for (const id of wanted) owners.push(await checkOwner(req, id, reports));
  const mode = b.mode === 'percent' ? 'percent' : 'number';
  const base = { name: String(b.name).slice(0, 120), description: String(b.description || '').slice(0, 2000), createdBy: req.user._id, mode, priority: b.priority || 'medium', startDate: optDate(b.startDate) || new Date(), dueDate: optDate(b.dueDate), status: 'not_started' };
  if (mode === 'number') {
    base.unit = String(b.unit || '').slice(0, 20);
    base.baseline = b.baseline === undefined || b.baseline === '' ? 0 : num(b.baseline, 'Starting value');
    base.target = num(b.target, 'Target');
    if (base.target === base.baseline) fail(400, 'Target must be different from the starting value.');
    base.current = b.current === undefined || b.current === '' ? base.baseline : num(b.current, 'Current value');
  } else Object.assign(base, { unit: '%', baseline: 0, target: 100, current: 0 });
  const made = [];
  for (const owner of owners) {
    const other = String(owner) !== String(req.user._id);
    const kpi = new Kpi({ ...base, owner, unseen: other, checkins: [] });
    applyUpdate(kpi, { status: b.status, progress: b.progress }, req.user._id);
    if (!kpi.checkins.length) kpi.checkins.push({ value: mode === 'percent' ? kpi.progress : kpi.current, status: kpi.status, note: 'Starting point', by: req.user._id });
    await kpi.save();
    if (other) await notify(owner, `${req.user.name} assigned you a KPI`, `${kpi.name}${['high', 'urgent'].includes(kpi.priority) ? ` (${kpi.priority})` : ''}`, '/kpis?open=' + kpi._id);
    await kpi.populate(POP); made.push(kpi);
  }
  await audit(req, 'kpi.created', base.name, owners.length > 1 ? `Assigned to ${owners.length} people` : String(owners[0]) !== String(req.user._id) ? `Assigned to ${made[0].owner.name}` : '');
  res.status(201).json({ kpi: shape(made[0], req.user, true), kpis: made.map((k) => shape(k, req.user, true)) });
});

// One KPI. The owner opening it is what clears the "new" flag, so whoever assigned it can see it was opened.
router.get('/:id', async (req, res) => {
  const { kpi, manage, mine } = await findVisible(req, req.params.id);
  if (mine && kpi.unseen) { kpi.unseen = false; kpi.openedAt = new Date(); await kpi.save(); await audit(req, 'kpi.opened', kpi.name); }
  await kpi.populate(POP);
  res.json({ kpi: shape(kpi, req.user, manage) });
});

// Change what the KPI is: name, target, deadline, who owns it
router.patch('/:id', async (req, res) => {
  const { kpi, manage, mine, reports } = await findVisible(req, req.params.id);
  if (!(manage || (mine && String(kpi.createdBy) === String(req.user._id)))) fail(403, 'Only the person who set this KPI can change its definition. You can still update its progress.');
  const b = req.body || {};
  if (b.name !== undefined) { if (!String(b.name).trim()) fail(400, 'Give the KPI a name.'); kpi.name = String(b.name).slice(0, 120); }
  if (b.description !== undefined) kpi.description = String(b.description).slice(0, 2000);
  if (b.dueDate !== undefined) kpi.dueDate = optDate(b.dueDate);
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) fail(400, 'Pick a valid urgency.'); kpi.priority = b.priority; }
  if (kpi.mode !== 'percent') {
    if (b.unit !== undefined) kpi.unit = String(b.unit).slice(0, 20);
    if (b.target !== undefined) kpi.target = num(b.target, 'Target');
    if (b.baseline !== undefined) kpi.baseline = num(b.baseline, 'Starting value');
    if (kpi.target === kpi.baseline) fail(400, 'Target must be different from the starting value.');
  }
  if (b.ownerId !== undefined && String(b.ownerId) !== String(kpi.owner)) {
    if (!manage) fail(403, 'Only a manager can move a KPI to someone else.');
    kpi.owner = await checkOwner(req, b.ownerId, reports);
    const other = String(kpi.owner) !== String(req.user._id); kpi.unseen = other; kpi.openedAt = undefined;
    if (other) await notify(kpi.owner, `${req.user.name} assigned you a KPI`, kpi.name, '/kpis?open=' + kpi._id);
  }
  applyUpdate(kpi, {}, req.user._id);
  await kpi.save();
  await audit(req, 'kpi.updated', kpi.name);
  await kpi.populate(POP);
  res.json({ kpi: shape(kpi, req.user, manage) });
});

// Report progress: status, and the percentage or the current value
router.post('/:id/checkin', async (req, res) => {
  const { kpi, manage, mine } = await findVisible(req, req.params.id);
  if (!mine && !manage) fail(403, 'You can view this KPI but not update it.');
  const b = req.body || {};
  if (kpi.mode !== 'percent' && b.status === undefined) num(b.value, 'Value');
  applyUpdate(kpi, b, req.user._id);
  await kpi.save();
  await audit(req, 'kpi.checkin', kpi.name, `${kpi.status.replace('_', ' ')}, ${kpiPct(kpi)}%`);
  if (!mine) await notify(kpi.owner, `${req.user.name} updated your KPI`, `${kpi.name}: ${kpi.status.replace('_', ' ')}, ${kpiPct(kpi)}%`, '/kpis?open=' + kpi._id);
  await kpi.populate(POP);
  res.json({ kpi: shape(kpi, req.user, manage) });
});

router.delete('/:id', async (req, res) => {
  const { kpi, manage } = await findVisible(req, req.params.id);
  if (!manage && String(kpi.createdBy) !== String(req.user._id)) fail(403, 'Only the person who set this KPI can delete it.');
  await Kpi.deleteOne({ _id: kpi._id });
  await audit(req, 'kpi.deleted', kpi.name);
  res.json({ ok: true });
});

module.exports = router;
module.exports.kpiHealth = kpiHealth;
module.exports.kpiStatus = kpiStatus;
