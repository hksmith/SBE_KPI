// Fills the database with a demo organisation so you can click around straight away.
// Usage: npm run seed            (refuses if data already exists)
//        npm run seed -- --force (wipes everything first)
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Task, Plan, Kpi, Log, Department, Template, Report, Attachment, Notification, Setting } = require('./models');
const { weekStart, recentPeriods, dueDateFor } = require('./lib');

const PASSWORD = 'Demo1234!';
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
let seedN = 7; const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const days = (n) => new Date(Date.now() + n * 864e5);

const ORG = [
  ['Selam Tesfaye', 'ceo', null, 'Executive', 'Chief Executive'],
  ['Daniel Bekele', 'director', 'Selam Tesfaye', 'Operations', 'Director of Operations'],
  ['Hana Girma', 'director', 'Selam Tesfaye', 'Sales', 'Director of Sales'],
  ['Yonas Alemu', 'team_leader', 'Daniel Bekele', 'Operations', 'Support Team Lead'],
  ['Meron Tadesse', 'team_leader', 'Daniel Bekele', 'Operations', 'Logistics Team Lead'],
  ['Kaleb Worku', 'team_leader', 'Hana Girma', 'Sales', 'Field Sales Lead'],
  ['Ruth Haile', 'team_leader', 'Hana Girma', 'Sales', 'Accounts Lead'],
  ['Abel Mengistu', 'member', 'Yonas Alemu', 'Operations', 'Support Agent'],
  ['Liya Solomon', 'member', 'Yonas Alemu', 'Operations', 'Support Agent'],
  ['Nahom Desta', 'member', 'Yonas Alemu', 'Operations', 'Support Agent'],
  ['Bethel Assefa', 'member', 'Meron Tadesse', 'Operations', 'Dispatcher'],
  ['Samuel Kebede', 'member', 'Meron Tadesse', 'Operations', 'Inventory Clerk'],
  ['Tigist Lemma', 'member', 'Kaleb Worku', 'Sales', 'Sales Rep'],
  ['Elias Negash', 'member', 'Kaleb Worku', 'Sales', 'Sales Rep'],
  ['Mahlet Yohannes', 'member', 'Ruth Haile', 'Sales', 'Account Manager'],
  ['Dawit Fikru', 'member', 'Ruth Haile', 'Sales', 'Account Manager'],
];
const TASKS = ['Prepare monthly performance summary', 'Follow up with pending customer requests', 'Update the shared price list', 'Train new hire on the ticket system', 'Clean up the customer contact sheet', 'Draft proposal for the new client', 'Review last week\'s escalations', 'Reconcile stock count with records', 'Plan next month\'s visit schedule', 'Fix recurring delivery delays on route 3', 'Collect feedback from top 10 accounts', 'Document the refund process', 'Renew supplier contracts', 'Set up weekly team check-in', 'Audit open invoices older than 30 days', 'Build onboarding checklist'];
const STATUS_MIX = ['done', 'done', 'done', 'in_progress', 'in_progress', 'in_progress', 'started', 'not_started', 'delayed', 'blocked', 'on_hold', 'cancelled'];
const KPIS = { director: [['Team task completion rate', '%', 50, 90], ['Customer satisfaction score', '%', 70, 92]], team_leader: [['Weekly plans submitted on time', '%', 40, 100], ['Average resolution time', 'hrs', 30, 12]], member: [['Tickets closed', '', 0, 120], ['Customer calls made', '', 0, 200], ['New accounts opened', '', 0, 15]] };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/worktrack');
  const force = process.argv.includes('--force');
  if ((await User.countDocuments({})) > 1 && !force) { console.log('Database already has data. Run with --force to wipe and reseed.'); return mongoose.disconnect(); }
  await Promise.all([User.deleteMany({}), Task.deleteMany({}), Plan.deleteMany({}), Kpi.deleteMany({}), Log.deleteMany({}), Department.deleteMany({}), Template.deleteMany({}), Report.deleteMany({}), Attachment.deleteMany({}), Notification.deleteMany({}), Setting.deleteMany({})]);
  await Setting.create({ key: 'org', orgName: '' });
  const hash = await bcrypt.hash(PASSWORD, 10);
  const email = (n) => n.toLowerCase().split(' ')[0] + '@worktrack.demo';
  const admin = await User.create({ name: process.env.ADMIN_NAME || 'System Admin', username: 'admin', email: 'admin@worktrack.demo', passwordHash: hash, role: 'admin', status: 'active', title: 'Administrator', avatarColor: '#4a3aa7' });
  const byName = {};
  for (const [i, [name, role, mgr, department, title]] of ORG.entries()) {
    byName[name] = await User.create({ name, username: name.toLowerCase().split(' ')[0], email: email(name), passwordHash: hash, role, managerId: mgr ? byName[mgr]._id : null, department, title, status: 'active', avatarColor: COLORS[i % COLORS.length], createdAt: days(-120) });
  }
  await User.create({ name: 'Mekdes Abebe', username: 'mekdes', email: 'mekdes@worktrack.demo', passwordHash: hash, role: 'member', status: 'pending', department: 'Sales', title: 'Sales Rep' });
  await User.create({ name: 'Biruk Tsegaye', username: 'biruk', email: 'biruk@worktrack.demo', passwordHash: hash, role: 'member', status: 'pending', department: 'Operations', title: 'Support Agent' });

  const thisWeek = weekStart(); const tasks = []; const plans = []; const kpis = [];
  for (const u of Object.values(byName)) {
    if (u.role === 'ceo') continue;
    const n = u.role === 'member' ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const status = pick(STATUS_MIX); const createdAt = days(-Math.floor(rnd() * 54) - 1);
      const progress = status === 'done' ? 100 : status === 'not_started' ? 0 : status === 'started' ? 5 + Math.floor(rnd() * 15) : 20 + Math.floor(rnd() * 70);
      const completedAt = status === 'done' ? new Date(Math.min(Date.now(), createdAt.getTime() + (2 + rnd() * 12) * 864e5)) : undefined;
      const dueDate = status === 'delayed' ? days(-Math.floor(rnd() * 6) - 1) : days(Math.floor(rnd() * 24) - 4);
      const boss = u.managerId && rnd() > 0.6 ? u.managerId : u._id;
      tasks.push({ title: pick(TASKS), owner: u._id, createdBy: boss, status, progress, priority: pick(['low', 'medium', 'medium', 'high', 'urgent']), dueDate, completedAt, createdAt, updatedAt: completedAt || createdAt, history: [{ by: u._id, status, progress, note: '', at: completedAt || createdAt }] });
    }
    if (rnd() > 0.25) {
      const items = Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => { const status = pick(['done', 'done', 'in_progress', 'in_progress', 'started', 'delayed']); return { text: pick(TASKS), status, progress: status === 'done' ? 100 : 15 + Math.floor(rnd() * 70) }; });
      const reviewed = rnd() > 0.6 && u.managerId;
      plans.push({ owner: u._id, weekStart: thisWeek, items, achievements: 'Closed out most of last week\'s carry-over items.', blockers: rnd() > 0.5 ? 'Waiting on approval from finance for two items.' : '', nextWeek: 'Finish remaining items and start the monthly summary.', status: reviewed ? 'reviewed' : 'submitted', submittedAt: days(-1), review: reviewed ? { by: u.managerId, comment: 'Good pace. Keep the delayed item visible.', rating: 4, at: new Date() } : undefined });
    }
    for (const [name, unit, baseline, target] of KPIS[u.role] || []) {
      if (u.role === 'member' && rnd() > 0.7) continue;
      const frac = rnd() > 0.78 ? 1.12 : 0.15 + rnd() * 0.8; const steps = 6; const checkins = [];
      for (let s = 0; s <= steps; s++) { const v = Math.round(baseline + (target - baseline) * Math.min(1, frac * (s / steps) * (0.9 + rnd() * 0.1))); checkins.push({ value: v, note: '', by: u._id, at: days(-(steps - s) * 7) }); }
      const current = checkins[steps].value; const pct = Math.round(((current - baseline) / (target - baseline)) * 100);
      const status = pct >= 100 ? 'done' : pct < 25 ? pick(['started', 'delayed']) : pick(['in_progress', 'in_progress', 'in_progress', 'on_hold', 'delayed', 'blocked']);
      const late = status === 'delayed' && rnd() > 0.4;
      kpis.push({ name, mode: 'number', priority: pick(['low', 'medium', 'medium', 'high', 'urgent']), unit, baseline, target, current, progress: Math.max(0, Math.min(100, pct)), status, completedAt: status === 'done' ? days(-1 - Math.floor(rnd() * 20)) : undefined, owner: u._id, createdBy: u.managerId || u._id, startDate: days(-45), dueDate: late ? days(-4) : days(45), createdAt: days(-45 + Math.floor(rnd() * 30)), checkins });
    }
    if (u.role !== 'director' && rnd() > 0.35) { // a KPI tracked by percentage only
      const progress = pick([0, 20, 35, 50, 65, 80, 100]); const status = progress === 100 ? 'done' : progress === 0 ? 'not_started' : pick(['in_progress', 'in_progress', 'started', 'delayed']);
      kpis.push({ name: pick(['Process documentation completed', 'Training modules finished', 'Customer database cleanup']), mode: 'percent', priority: pick(['low', 'medium', 'high']), unit: '%', baseline: 0, target: 100, current: 0, progress, status, completedAt: status === 'done' ? days(-6) : undefined, owner: u._id, createdBy: u.managerId || u._id, startDate: days(-30), dueDate: days(30), createdAt: days(-30), checkins: [{ value: 0, status: 'not_started', by: u._id, at: days(-30) }, { value: Math.round(progress / 2), status: 'in_progress', by: u._id, at: days(-14) }, { value: progress, status, by: u._id, at: days(-2) }] });
    }
  }
  // departments, a report template, and last month's reports in various states
  for (const [name, head] of [['Executive', 'Selam Tesfaye'], ['Operations', 'Daniel Bekele'], ['Sales', 'Hana Girma']]) await Department.create({ name, head: byName[head]._id, jobTitles: [...new Set(ORG.filter((o) => o[3] === name).map((o) => o[4]))].sort() });
  const tpl = await Template.create({
    createdAt: days(-120), name: 'Monthly Department Report', description: 'What the department did this month, what is planned, and what is in the way.', periodType: 'monthly', dueDays: 5, approvalLevels: 2, requiredRoles: ['director', 'team_leader'], includeTasks: true,
    fields: [
      { id: 'completed', label: 'Activities completed', type: 'longtext', required: true }, { id: 'in_progress', label: 'Activities in progress', type: 'longtext' },
      { id: 'planned', label: 'Planned for next month', type: 'longtext', required: true }, { id: 'achievements', label: 'Achievements', type: 'longtext' },
      { id: 'challenges', label: 'Challenges', type: 'longtext' }, { id: 'budget', label: 'Budget used', type: 'percent', help: 'Share of this month\'s budget spent' }, { id: 'recommendations', label: 'Recommendations', type: 'longtext' },
    ],
  });
  const last = recentPeriods('monthly', 2)[1]; const due = dueDateFor(last.end, 5);
  const STATES = { 'Daniel Bekele': ['approved', -2], 'Hana Girma': ['submitted', 1], 'Yonas Alemu': ['approved', -3], 'Meron Tadesse': ['returned', -1], 'Kaleb Worku': ['under_review', -1], 'Ruth Haile': null };
  const reports = [];
  for (const [name, state] of Object.entries(STATES)) {
    if (!state) continue; const u = byName[name]; const [status, offset] = state; const at = new Date(due.getTime() + offset * 864e5); const boss = u.managerId;
    const history = [{ action: 'created', by: u._id, at: new Date(at.getTime() - 864e5) }, { action: 'submitted', by: u._id, step: 1, at, comment: offset > 0 ? 'Submitted after the deadline' : '' }];
    if (status === 'approved') history.push({ action: 'approved', by: boss, step: 1, comment: 'Clear and complete.', at: new Date(at.getTime() + 36e5) });
    if (status === 'returned') history.push({ action: 'returned', by: boss, step: 1, comment: 'Add the numbers behind the delivery delays.', at: new Date(at.getTime() + 36e5) });
    if (status === 'under_review') history.push({ action: 'review_started', by: boss, step: 1, at: new Date(at.getTime() + 36e5) });
    reports.push({
      template: tpl._id, templateName: tpl.name, title: `${tpl.name}, ${last.label}`, author: u._id, department: u.department, periodType: 'monthly', periodStart: last.start, periodEnd: last.end, periodLabel: last.label, dueDate: due,
      fields: tpl.fields.map((f) => f.toObject()), approvalLevels: 2, status, step: ['approved', 'returned'].includes(status) ? 0 : 1, reviewer: ['submitted', 'under_review'].includes(status) ? boss : null,
      firstSubmittedAt: at, submittedAt: at, late: offset > 0, decidedAt: status === 'approved' ? new Date(at.getTime() + 36e5) : undefined, history,
      values: { completed: 'Closed the quarter-end backlog and finished onboarding for two new hires.', in_progress: 'Rolling out the new ticket categories.', planned: 'Start the customer feedback round and renew two supplier contracts.', achievements: 'Response time down for the third month running.', challenges: 'Two open positions are slowing delivery.', budget: 60 + Math.floor(rnd() * 35), recommendations: 'Approve the two hires before next quarter.' },
    });
  }
  await Report.insertMany(reports);
  await Task.insertMany(tasks, { timestamps: false });
  await Plan.insertMany(plans);
  await Kpi.insertMany(kpis, { timestamps: false });
  await Log.create({ actor: admin._id, actorName: admin.name, action: 'system.seeded', target: 'demo data', details: `${tasks.length} tasks, ${plans.length} plans, ${kpis.length} KPIs, ${reports.length} reports` });
  console.log(`Seeded ${ORG.length + 1} people, ${tasks.length} tasks, ${plans.length} plans, ${kpis.length} KPIs, ${reports.length} reports.`);
  console.log(`Sign in with username admin, selam (CEO), daniel (director), yonas (team leader), abel (member). Password for all: ${PASSWORD}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
