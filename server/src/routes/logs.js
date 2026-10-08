const router = require('express').Router();
const { Log } = require('../models');
const { requireRole, escapeRegex, csv, audit } = require('../lib');

router.use(requireRole('admin'));

function buildFilter(q) {
  const f = {};
  if (q.action) f.action = { $regex: '^' + escapeRegex(String(q.action).slice(0, 40)) };
  if (q.q) { const r = { $regex: escapeRegex(String(q.q).slice(0, 80)), $options: 'i' }; f.$or = [{ actorName: r }, { target: r }, { details: r }]; }
  const at = {};
  if (q.from && !isNaN(new Date(q.from))) at.$gte = new Date(q.from);
  if (q.to && !isNaN(new Date(q.to))) { const d = new Date(q.to); d.setUTCDate(d.getUTCDate() + 1); at.$lt = d; }
  if (Object.keys(at).length) f.at = at;
  return f;
}

router.get('/', async (req, res) => {
  const f = buildFilter(req.query);
  const limit = 50; const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [logs, total] = await Promise.all([Log.find(f).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(), Log.countDocuments(f)]);
  res.json({ logs: logs.map((l) => ({ ...l, id: String(l._id) })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/export.csv', async (req, res) => {
  const logs = await Log.find(buildFilter(req.query)).sort({ at: -1 }).limit(10000).lean();
  const rows = [['Time (UTC)', 'Who', 'Action', 'Target', 'Details', 'IP']];
  for (const l of logs) rows.push([l.at.toISOString(), l.actorName, l.action, l.target, l.details, l.ip]);
  await audit(req, 'report.exported', 'activity log', `${logs.length} rows`);
  res.type('text/csv').attachment('activity-log.csv').send(csv(rows));
});

module.exports = router;
