// End-to-end permission check against a running, freshly seeded server.
// Usage: npm run seed -- --force && npm start   (then, in another terminal)   node test/smoke.js
const BASE = process.env.BASE || 'http://localhost:4000/api';
let pass = 0, failN = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : failN++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function call(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const login = async (who, password = 'Demo1234!') => (await call('POST', '/auth/login', null, { username: who, password })).body;

(async () => {
  const admin = await login('admin'), ceo = await login('selam'), dir = await login('daniel'), dir2 = await login('hana'), tl = await login('yonas'), mem = await login('abel'), mem2 = await login('tigist');
  ok('all roles can sign in', [admin, ceo, dir, dir2, tl, mem, mem2].every((x) => x.token));
  ok('username sign-in works', (await call('POST', '/auth/login', null, { username: 'ABEL', password: 'Demo1234!' })).status === 200);
  ok('email still accepted as fallback', (await call('POST', '/auth/login', null, { username: 'abel@worktrack.demo', password: 'Demo1234!' })).status === 200);
  ok('login without username rejected', (await call('POST', '/auth/login', null, { password: 'Demo1234!' })).status === 400);
  ok('wrong password rejected', (await call('POST', '/auth/login', null, { username: 'abel@worktrack.demo', password: 'nope-nope' })).status === 401);
  ok('no token rejected', (await call('GET', '/tasks')).status === 401);

  // visibility
  const count = async (t) => (await call('GET', '/users', t.token)).body.users.filter((u) => u.status === 'active').length;
  ok('admin sees all 17 active people', (await count(admin)) === 17);
  ok('ceo sees all 17', (await count(ceo)) === 17);
  ok('director sees self + 2 leads + 5 members = 8', (await count(dir)) === 8);
  ok('team leader sees self + 3 members = 4', (await count(tl)) === 4);
  ok('member sees only self', (await count(mem)) === 1);
  ok('admin sees pending requests', (await call('GET', '/users', admin.token)).body.users.filter((u) => u.status === 'pending').length === 2);
  ok('director does not see pending requests', (await call('GET', '/users', dir.token)).body.users.every((u) => u.status === 'active'));

  // tasks
  const t1 = await call('POST', '/tasks', mem.token, { title: 'Smoke test task', priority: 'high', dueDate: '2030-01-01' });
  ok('member creates own task', t1.status === 201 && t1.body.task.status === 'not_started');
  const id = t1.body.task.id;
  const up = await call('PATCH', '/tasks/' + id, mem.token, { progress: 40 });
  ok('progress moves status to in_progress', up.body.task.status === 'in_progress' && up.body.task.progress === 40);
  const done = await call('PATCH', '/tasks/' + id, mem.token, { status: 'done' });
  ok('done sets progress 100 + completedAt', done.body.task.progress === 100 && !!done.body.task.completedAt);
  ok('bad status rejected', (await call('PATCH', '/tasks/' + id, mem.token, { status: 'bogus' })).status === 400);
  ok('progress > 100 rejected', (await call('PATCH', '/tasks/' + id, mem.token, { status: 'in_progress', progress: 140 })).status === 400);
  ok('team leader sees member task', (await call('GET', '/tasks/' + id, tl.token)).status === 200);
  ok('director sees member task', (await call('GET', '/tasks/' + id, dir.token)).status === 200);
  ok('other director cannot see it', (await call('GET', '/tasks/' + id, dir2.token)).status === 404);
  ok('other member cannot see it', (await call('GET', '/tasks/' + id, mem2.token)).status === 404);
  ok('other member cannot edit it', (await call('PATCH', '/tasks/' + id, mem2.token, { progress: 1 })).status === 404);
  ok('ceo can view but not edit', (await call('GET', '/tasks/' + id, ceo.token)).status === 200 && (await call('PATCH', '/tasks/' + id, ceo.token, { progress: 5 })).status === 403);
  ok('ceo can comment', (await call('POST', '/tasks/' + id + '/comments', ceo.token, { text: 'Nice work' })).status === 201);
  ok('team leader assigns task to member', (await call('POST', '/tasks', tl.token, { title: 'Assigned by lead', ownerId: mem.user.id })).status === 201);
  ok('member cannot assign to someone else', (await call('POST', '/tasks', mem.token, { title: 'x', ownerId: mem2.user.id })).status === 403);
  ok('team leader cannot assign outside team', (await call('POST', '/tasks', tl.token, { title: 'x', ownerId: mem2.user.id })).status === 403);
  ok('member cannot filter by another owner', (await call('GET', '/tasks?owner=' + mem2.user.id, mem.token)).status === 403);
  const assigned = (await call('GET', '/tasks', mem.token)).body.tasks.find((t) => t.title === 'Assigned by lead');
  ok('member cannot delete a task assigned by lead', (await call('DELETE', '/tasks/' + assigned.id, mem.token)).status === 403);
  ok('member deletes own task', (await call('DELETE', '/tasks/' + id, mem.token)).status === 200);
  ok('csv export works', (await call('GET', '/tasks/export.csv?scope=all', dir.token)).body.startsWith('Title,Owner'));

  // plans
  const week = (await call('GET', '/plans', mem.token)).body.currentWeek;
  const mine = (await call('GET', '/plans?week=' + week, mem2.token)).body.plans[0];
  let planId = mine?.id;
  if (!planId) planId = (await call('POST', '/plans', mem2.token, { items: [{ text: 'Call clients', status: 'in_progress', progress: 30 }] })).body.plan.id;
  ok('duplicate week plan rejected', (await call('POST', '/plans', mem2.token, { items: [{ text: 'again' }] })).status === 409);
  ok('non-Monday week rejected', (await call('POST', '/plans', mem.token, { weekStart: '2026-10-07', items: [{ text: 'a' }] })).status === 400);
  await call('PATCH', '/plans/' + planId, mem2.token, { submit: true });
  ok('own manager chain can review', (await call('POST', '/plans/' + planId + '/review', dir2.token, { comment: 'ok', rating: 5 })).status === 200);
  ok('other director cannot review', (await call('POST', '/plans/' + planId + '/review', dir.token, { comment: 'x' })).status === 404);
  ok('owner cannot review own plan', (await call('POST', '/plans/' + planId + '/review', mem2.token, { comment: 'x' })).status === 403);

  // kpis
  const k = await call('POST', '/kpis', tl.token, { name: 'Smoke KPI', ownerId: mem.user.id, target: 50, unit: 'calls' });
  ok('team leader sets KPI for member', k.status === 201 && k.body.kpi.pct === 0);
  const ci = await call('POST', '/kpis/' + k.body.kpi.id + '/checkin', mem.token, { value: 25 });
  ok('member checks in, pct = 50', ci.body.kpi.pct === 50);
  ok('outsider cannot check in', (await call('POST', '/kpis/' + k.body.kpi.id + '/checkin', mem2.token, { value: 1 })).status === 404);
  ok('member cannot delete KPI set by lead', (await call('DELETE', '/kpis/' + k.body.kpi.id, mem.token)).status === 403);
  ok('target must be numeric', (await call('POST', '/kpis', mem.token, { name: 'x', target: 'abc' })).status === 400);

  // KPIs with status and editable progress; CEO can assign to anyone
  const ck = await call('POST', '/kpis', ceo.token, { name: 'CEO KPI', ownerId: mem2.user.id, mode: 'percent', dueDate: '2030-01-01' });
  ok('ceo sets a KPI for anyone in the structure', ck.status === 201 && ck.body.kpi.mode === 'percent' && ck.body.kpi.status === 'not_started' && ck.body.kpi.pct === 0);
  const kid = ck.body.kpi.id;
  const n2 = (await call('GET', '/notifications', mem2.token)).body;
  ok('owner is notified, and the notification opens that exact KPI', n2.notifications.some((n) => n.title.includes('assigned you a KPI') && n.link === '/kpis?open=' + kid) && n2.newKpis === 1);
  ok('assigned KPI is marked new for the owner', (await call('GET', '/kpis', mem2.token)).body.kpis[0].id === kid && (await call('GET', '/kpis', mem2.token)).body.kpis[0].isNew === true);
  ok('someone else viewing it does not clear the new flag', (await call('GET', '/kpis/' + kid, dir2.token)).body.kpi.unseen === true && (await call('GET', '/kpis/' + kid, ceo.token)).body.kpi.unseen === true);
  const opened = await call('GET', '/kpis/' + kid, mem2.token);
  ok('owner opening it clears the flag and records when', opened.body.kpi.unseen === false && !!opened.body.kpi.openedAt && (await call('GET', '/notifications', mem2.token)).body.newKpis === 0);
  ok('outsider cannot open the KPI view', (await call('GET', '/kpis/' + kid, mem.token)).status === 404);
  const urgent = await call('POST', '/kpis', mem.token, { name: 'Urgent own KPI', mode: 'percent', priority: 'urgent' });
  ok('urgency saves, own KPI is not flagged new', urgent.body.kpi.priority === 'urgent' && urgent.body.kpi.unseen === false);
  ok('bad urgency rejected', (await call('POST', '/kpis', mem.token, { name: 'x', mode: 'percent', priority: 'asap' })).status === 400);
  ok('urgency filter', (await call('GET', '/kpis?priority=urgent', mem.token)).body.kpis.every((x) => x.priority === 'urgent'));
  const team = (await call('GET', '/users', tl.token)).body.users.filter((u) => u.id !== tl.user.id).map((u) => u.id);
  const multi = await call('POST', '/kpis', tl.token, { name: 'Team-wide KPI', mode: 'percent', priority: 'high', ownerIds: team, dueDate: '2030-06-30' });
  ok('team leader assigns one KPI to every team member at once', multi.status === 201 && multi.body.kpis.length === 3 && multi.body.kpis.every((x) => x.unseen && x.priority === 'high') && new Set(multi.body.kpis.map((x) => x.owner._id)).size === 3);
  const before = (await call('GET', '/kpis?scope=all', admin.token)).body.kpis.length;
  ok('multi-assign with one outsider creates nothing', (await call('POST', '/kpis', tl.token, { name: 'Leak', mode: 'percent', ownerIds: [...team, mem2.user.id] })).status === 403 && (await call('GET', '/kpis?scope=all', admin.token)).body.kpis.length === before);
  const u1 = await call('POST', `/kpis/${kid}/checkin`, mem2.token, { status: 'delayed', progress: 40, note: 'Waiting on data' });
  ok('owner sets status and percent together', u1.body.kpi.status === 'delayed' && u1.body.kpi.pct === 40 && u1.body.kpi.health === 'off_track');
  ok('owner edits the percent on its own later', (await call('POST', `/kpis/${kid}/checkin`, mem2.token, { progress: 55 })).body.kpi.pct === 55);
  ok('percent over 100 rejected', (await call('POST', `/kpis/${kid}/checkin`, mem2.token, { progress: 130 })).status === 400);
  const u2 = await call('POST', `/kpis/${kid}/checkin`, mem2.token, { status: 'done' });
  ok('marking done fills it to 100', u2.body.kpi.pct === 100 && u2.body.kpi.status === 'done' && !!u2.body.kpi.completedAt);
  ok('dropping the percent reopens it', (await call('POST', `/kpis/${kid}/checkin`, mem2.token, { progress: 70 })).body.kpi.status === 'in_progress');
  ok('owner cannot redefine a KPI set by the ceo', (await call('PATCH', `/kpis/${kid}`, mem2.token, { name: 'Easier KPI' })).status === 403);
  ok('ceo can reassign it', (await call('PATCH', `/kpis/${kid}`, ceo.token, { ownerId: mem.user.id })).body.kpi.owner.name === 'Abel Mengistu');
  ok('director cannot set a KPI outside their teams', (await call('POST', '/kpis', dir.token, { name: 'x', ownerId: mem2.user.id, target: 5 })).status === 403);
  ok('kpi filter by status', (await call('GET', '/kpis?scope=all&status=delayed', admin.token)).body.kpis.every((x) => x.status === 'delayed'));
  const ov = (await call('GET', '/reports/overview', admin.token)).body;
  ok('overview runs on KPIs when tasks are switched off', ov.source === 'kpis' && ov.totals.total === (await call('GET', '/kpis?scope=all', admin.token)).body.kpis.length);

  // branding, sign-up options, photo, modules
  const opts = await call('GET', '/auth/options');
  ok('sign-up options are public', opts.status === 200 && opts.body.departments.some((d) => d.name === 'Sales' && d.jobTitles.includes('Sales Rep')) && !opts.body.departments.find((d) => d.name === 'Sales').jobTitles.includes('Dispatcher') && !opts.body.roles.includes('admin'));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  ok('profile picture saves', (await call('PATCH', '/users/me', mem2.token, { avatarUrl: png })).body.user.avatarUrl === png);
  ok('non-image picture rejected', (await call('PATCH', '/users/me', mem2.token, { avatarUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).status === 400);
  ok('only admin sets the logo', (await call('PATCH', '/settings', dir.token, { logo: png })).status === 403 && (await call('PATCH', '/settings', admin.token, { logo: png })).body.logo === png);
  ok('admin adds job titles', (await call('PATCH', '/settings', admin.token, { jobTitles: ['Zeta Analyst', 'Zeta Analyst', ' Alpha Lead '] })).body.jobTitles.join('|') === 'Alpha Lead|Zeta Analyst');
  const mods = await call('PATCH', '/settings', admin.token, { modules: { tasks: true, reports: true } });
  ok('admin switches modules on', mods.body.modules.tasks === true && mods.body.modules.reports === true && mods.body.modules.plans === false);
  ok('overview goes back to tasks when switched on', (await call('GET', '/reports/overview', admin.token)).body.source === 'tasks');

  // reports
  const ra = (await call('GET', '/reports/overview', admin.token)).body;
  const rd = (await call('GET', '/reports/overview', dir.token)).body;
  const rm = (await call('GET', '/reports/overview', mem.token)).body;
  ok('admin report covers everyone', ra.headcount === 17 && ra.groups.length >= 1);
  ok('director report covers 8, grouped by 2 leads', rd.headcount === 8 && rd.groups.length === 2);
  ok('member report covers self', rm.headcount === 1);
  ok('status counts add up', Object.values(ra.totals.byStatus).reduce((a, b) => a + b, 0) === ra.totals.total);
  ok('director totals = sum of people', rd.people.reduce((s, p) => s + p.tasks.total, 0) === rd.totals.total);
  ok('director cannot open other director report', (await call('GET', '/reports/overview?root=' + dir2.user.id, dir.token)).status === 403);
  ok('admin can drill into a director', (await call('GET', '/reports/overview?root=' + dir.user.id, admin.token)).body.headcount === 8);

  // ---- formal reports: templates, approval chain, files, compliance -----------
  const W = '/workreports';
  const tpls = (await call('GET', W + '/templates', tl.token)).body.templates;
  const monthly = tpls.find((t) => t.name === 'Monthly Department Report');
  ok('seeded template is listed', !!monthly && monthly.fields.length === 7);
  ok('director cannot create templates', (await call('POST', W + '/templates', dir.token, { name: 'x', fields: [{ label: 'a' }] })).status === 403);
  ok('select field needs choices', (await call('POST', W + '/templates', admin.token, { name: 'Bad', fields: [{ label: 'Pick', type: 'select', options: ['one'] }] })).status === 400);
  const newTpl = await call('POST', W + '/templates', admin.token, { name: 'Weekly Check-in', periodType: 'weekly', dueDays: 1, approvalLevels: 1, requiredRoles: ['member'], fields: [{ label: 'Summary', type: 'longtext', required: true }, { label: 'Mood', type: 'select', options: 'Good, OK, Bad' }, { label: 'Hours', type: 'number' }] });
  ok('admin creates a template', newTpl.status === 201 && newTpl.body.template.fields[1].options.length === 3);
  const periods = (await call('GET', W + '/periods?template=' + monthly.id, tl.token)).body.periods;
  ok('periods offered, newest first', periods.length === 6 && periods[0].start > periods[1].start);
  const made = await call('POST', W, tl.token, { templateId: monthly.id, periodStart: periods[0].start });
  ok('team leader starts a draft', made.status === 201 && made.body.report.status === 'draft' && made.body.report.editable);
  const rid = made.body.report.id;
  ok('same period twice rejected', (await call('POST', W, tl.token, { templateId: monthly.id, periodStart: periods[0].start })).status === 409);
  ok('manager cannot see a draft', (await call('GET', `${W}/${rid}`, dir.token)).status === 404);
  ok('submit blocked while required fields are empty', (await call('POST', `${W}/${rid}/submit`, tl.token, {})).status === 400);
  ok('number field rejects text', (await call('PATCH', `${W}/${rid}`, tl.token, { values: { budget: 'lots' } })).status === 400);
  ok('draft saves', (await call('PATCH', `${W}/${rid}`, tl.token, { values: { completed: 'Did things', planned: 'More things', budget: 72 } })).body.report.values.budget === 72);
  const raw = async (path, token, bytes) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + token }, body: bytes }); return { status: r.status, body: await r.json() }; };
  const bytes = Buffer.from('%PDF-1.4 smoke test file ' + 'x'.repeat(5000));
  const upl = await raw(`${W}/${rid}/attachments?name=evidence.pdf`, tl.token, bytes);
  ok('file attaches to a draft', upl.status === 201 && upl.body.report.attachments.length === 1 && upl.body.report.attachments[0].size === bytes.length);
  ok('exe upload refused', (await raw(`${W}/${rid}/attachments?name=virus.exe`, tl.token, bytes)).status === 400);
  ok('outsider cannot attach', (await raw(`${W}/${rid}/attachments?name=a.pdf`, mem2.token, bytes)).status === 404);
  const sub = await call('POST', `${W}/${rid}/submit`, tl.token, {});
  ok('submit goes to the direct manager', sub.status === 200 && sub.body.report.status === 'submitted' && sub.body.report.reviewer.name === 'Daniel Bekele' && sub.body.report.late === false);
  ok('task snapshot taken at submit', sub.body.report.activity.total >= 1 && Array.isArray(sub.body.report.activity.tasks));
  ok('author cannot edit after submitting', (await call('PATCH', `${W}/${rid}`, tl.token, { values: { completed: 'changed' } })).status === 403);
  ok('author cannot approve own report', (await call('POST', `${W}/${rid}/decision`, tl.token, { action: 'approve' })).status === 403);
  ok('other director cannot see it', (await call('GET', `${W}/${rid}`, dir2.token)).status === 404);
  ok('member below cannot see it', (await call('GET', `${W}/${rid}`, mem.token)).status === 404);
  ok('ceo sees it but it is not their turn', (await call('POST', `${W}/${rid}/decision`, ceo.token, { action: 'approve' })).status === 403);
  ok('manager got a notification', (await call('GET', '/notifications', dir.token)).body.notifications.some((n) => n.title.includes('submitted a report')));
  ok('review queue shows it', (await call('GET', W + '?box=review', dir.token)).body.reports.some((r) => r.id === rid));
  ok('opening it starts the review', (await call('GET', `${W}/${rid}`, dir.token)).body.report.status === 'under_review');
  const dl = await fetch(`${BASE}${W}/${rid}/attachments/${upl.body.report.attachments[0].id}`, { headers: { Authorization: 'Bearer ' + dir.token } });
  ok('reviewer downloads the exact file', dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(bytes));
  ok('return needs a reason', (await call('POST', `${W}/${rid}/decision`, dir.token, { action: 'return' })).status === 400);
  ok('manager returns it', (await call('POST', `${W}/${rid}/decision`, dir.token, { action: 'return', comment: 'Add numbers' })).body.report.status === 'returned');
  ok('author is told why', (await call('GET', '/notifications', tl.token)).body.notifications.some((n) => n.title.includes('returned') && n.body.includes('Add numbers')));
  await call('PATCH', `${W}/${rid}`, tl.token, { values: { completed: 'Did 12 things' } });
  ok('author resubmits', (await call('POST', `${W}/${rid}/submit`, tl.token, {})).body.report.history.some((h) => h.action === 'resubmitted'));
  const a1 = await call('POST', `${W}/${rid}/decision`, dir.token, { action: 'approve', comment: 'Good' });
  ok('level 1 approval passes it up to level 2', a1.body.report.status === 'submitted' && a1.body.report.step === 2 && a1.body.report.reviewer.name === 'Selam Tesfaye');
  ok('level 1 approver cannot approve twice', (await call('POST', `${W}/${rid}/decision`, dir.token, { action: 'approve' })).status === 403);
  const a2 = await call('POST', `${W}/${rid}/decision`, ceo.token, { action: 'approve' });
  ok('level 2 approval finishes it', a2.body.report.status === 'approved' && a2.body.report.history.filter((h) => h.action === 'approved').length === 2);
  ok('approved report is locked', (await call('PATCH', `${W}/${rid}`, tl.token, { values: { completed: 'sneaky' } })).status === 403 && (await call('DELETE', `${W}/${rid}`, tl.token)).status === 403);
  ok('author archives it, default list hides it', (await call('POST', `${W}/${rid}/archive`, tl.token)).body.report.status === 'archived' && !(await call('GET', W, tl.token)).body.reports.some((r) => r.id === rid));
  ok('search finds seeded reports', (await call('GET', W + '?box=team&q=monthly&status=approved', admin.token)).body.reports.every((r) => r.status === 'approved'));
  ok('report csv export', (await call('GET', W + '/export.csv?box=team', admin.token)).body.startsWith('Title,Type'));
  const cA = (await call('GET', `${W}/compliance?template=${monthly.id}`, admin.token)).body;
  ok('compliance: 6 expected last month, 5 filed, 1 late', cA.totals.expected === 6 && cA.totals.filed === 5 && cA.totals.late === 1 && cA.people.find((p) => p.name === 'Ruth Haile').status === 'missing');
  ok('compliance splits by department', cA.departments.length === 2 && cA.departments.reduce((a, d) => a + d.expected, 0) === 6);
  ok('director compliance covers only their side', (await call('GET', `${W}/compliance?template=${monthly.id}`, dir.token)).body.totals.expected === 3);
  ok('late filer is flagged on reminders', (await call('GET', '/notifications', (await login('ruth')).token)).body.reminders.some((r) => r.title.includes('Monthly Department Report')));
  const mg = await call('GET', W + '/management', admin.token);
  ok('management report rolls up departments', mg.status === 200 && mg.body.departments.length >= 2 && mg.body.totals.activities === mg.body.departments.reduce((a, d) => a + d.activities, 0));
  ok('member cannot open the management report', (await call('GET', W + '/management', mem.token)).status === 403);
  ok('dashboard summary counts', (await call('GET', W + '/summary', admin.token)).body.total >= 5);
  ok('mark notifications read', (await call('POST', '/notifications/read', dir.token, {})).status === 200 && (await call('GET', '/notifications', dir.token)).body.unread === 0);

  // departments + settings
  ok('departments listed with headcount', (await call('GET', '/departments', mem.token)).body.departments.find((d) => d.name === 'Sales').people === 7);
  ok('director cannot add departments', (await call('POST', '/departments', dir.token, { name: 'X' })).status === 403);
  const it = await call('POST', '/departments', admin.token, { name: 'IT' });
  ok('admin adds a department', it.status === 201 && (await call('POST', '/departments', admin.token, { name: 'IT' })).status === 409);
  const ops = (await call('GET', '/departments', admin.token)).body.departments.find((d) => d.name === 'Operations');
  await call('PATCH', '/departments/' + ops.id, admin.token, { name: 'Ops' });
  ok('renaming a department carries its people', (await call('GET', '/users', admin.token)).body.users.filter((u) => u.department === 'Ops' && u.status === 'active').length === 8);
  await call('PATCH', '/departments/' + ops.id, admin.token, { name: 'Operations' });
  ok('admin sets the job titles under a department', (await call('PATCH', '/departments/' + ops.id, admin.token, { jobTitles: ['Dispatcher', 'Night Supervisor', 'Dispatcher'] })).status === 200 && (await call('GET', '/auth/options')).body.departments.find((d) => d.name === 'Operations').jobTitles.join('|') === 'Dispatcher|Night Supervisor');
  ok('department cannot sit under itself', (await call('PATCH', '/departments/' + ops.id, admin.token, { parent: ops.id })).status === 400);
  ok('cannot delete a department with people', (await call('DELETE', '/departments/' + ops.id, admin.token)).status === 400);
  ok('empty department deletes', (await call('DELETE', '/departments/' + it.body.department.id, admin.token)).status === 200);
  ok('only admin sets the organisation name', (await call('PATCH', '/settings', dir.token, { orgName: 'x' })).status === 403 && (await call('PATCH', '/settings', admin.token, { orgName: 'Demo Org' })).body.orgName === 'Demo Org');
  const own = await call('POST', '/users', admin.token, { name: 'Own Password', email: 'ownpw@worktrack.demo', role: 'member', managerId: tl.user.id, password: 'ChosenByAdmin1', mustChangePassword: false });
  const ownLogin = await call('POST', '/auth/login', null, { username: 'ownpw@worktrack.demo', password: 'ChosenByAdmin1' });
  ok('admin sets the password at creation', own.status === 201 && own.body.temporaryPassword === null && ownLogin.status === 200 && ownLogin.body.user.mustChangePassword === false);
  ok('short admin-set password rejected', (await call('POST', '/users', admin.token, { name: 'Short', email: 'short@worktrack.demo', password: 'abc' })).status === 400);

  // accounts
  const email = `new${Date.now()}@worktrack.demo`;
  ok('public registration accepted', (await call('POST', '/auth/register', null, { name: 'New Person', username: 'np' + Date.now(), email, password: 'Secret123!', department: 'Sales', title: 'Sales Rep', requestedRole: 'team_leader' })).status === 201);
  ok('pending account cannot sign in', (await call('POST', '/auth/login', null, { username: email, password: 'Secret123!' })).status === 403);
  const pending = (await call('GET', '/users', admin.token)).body.users.find((u) => u.email === email);
  ok('requested role is shown to the admin, not granted', pending.requestedRole === 'team_leader' && pending.role === 'member');
  ok('director cannot approve', (await call('POST', `/users/${pending.id}/approve`, dir.token, {})).status === 403);
  ok('member cannot report to a member', (await call('POST', `/users/${pending.id}/approve`, admin.token, { role: 'member', managerId: mem.user.id })).status === 400);
  ok('admin approves with role + manager', (await call('POST', `/users/${pending.id}/approve`, admin.token, { role: 'member', managerId: tl.user.id })).status === 200);
  ok('approved account signs in', (await call('POST', '/auth/login', null, { username: email, password: 'Secret123!' })).status === 200);
  const created = await call('POST', '/users', admin.token, { name: 'Made By Admin', email: 'm' + email, role: 'team_leader', managerId: dir.user.id });
  ok('admin creates account with temp password', created.status === 201 && created.body.temporaryPassword.length >= 10);
  const firstLogin = await call('POST', '/auth/login', null, { username: 'm' + email, password: created.body.temporaryPassword });
  ok('new account must change password', firstLogin.body.user.mustChangePassword === true);
  ok('director cannot create accounts', (await call('POST', '/users', dir.token, { name: 'x', email: 'x' + email })).status === 403);
  ok('duplicate username rejected', (await call('POST', '/users', admin.token, { name: 'x', username: 'abel', email: 'dupu' + email })).status === 409);
  ok('bad username rejected', (await call('POST', '/users', admin.token, { name: 'x', username: 'a b', email: 'badu' + email })).status === 400);
  ok('register with taken username rejected', (await call('POST', '/auth/register', null, { name: 'x', username: 'Abel', email: 'dupr' + email, password: 'Secret123!' })).status === 409);
  const unm = await call('POST', '/users', admin.token, { name: 'Named Person', username: 'Named.Person', email: 'named' + email, role: 'member', managerId: tl.user.id, password: 'ChosenByAdmin1', mustChangePassword: false });
  ok('admin sets username (lowercased)', unm.status === 201 && unm.body.user.username === 'named.person');
  ok('duplicate email rejected', (await call('POST', '/users', admin.token, { name: 'x', email })).status === 409);

  // password resets
  ok('director resets own member', (await call('POST', `/users/${mem.user.id}/reset-password`, dir.token)).status === 200);
  ok('old session is signed out after reset', (await call('GET', '/auth/me', mem.token)).status === 401);
  ok('director cannot reset other director\'s member', (await call('POST', `/users/${mem2.user.id}/reset-password`, dir.token)).status === 403);
  ok('director cannot reset another director', (await call('POST', `/users/${dir2.user.id}/reset-password`, dir.token)).status === 403);
  ok('team leader cannot reset', (await call('POST', `/users/${mem.user.id}/reset-password`, tl.token)).status === 403);
  const reset = await call('POST', `/users/${dir2.user.id}/reset-password`, admin.token);
  ok('admin resets a director', reset.status === 200);
  const relog = await call('POST', '/auth/login', null, { username: 'hana@worktrack.demo', password: reset.body.temporaryPassword });
  const changed = await call('POST', '/auth/change-password', relog.body.token, { currentPassword: reset.body.temporaryPassword, newPassword: 'Demo1234!' });
  ok('temp password works and can be changed', changed.status === 200 && changed.body.user.mustChangePassword === false);

  // admin guards + profile + logs
  ok('admin cannot demote self', (await call('PATCH', `/users/${admin.user.id}`, admin.token, { role: 'member' })).status === 400);
  ok('cannot disable a manager who has reports', (await call('PATCH', `/users/${tl.user.id}`, admin.token, { status: 'disabled' })).status === 400);
  ok('cannot demote a lead who has reports', (await call('PATCH', `/users/${tl.user.id}`, admin.token, { role: 'member' })).status === 400);
  ok('admin disables an account', (await call('PATCH', `/users/${pending.id}`, admin.token, { status: 'disabled' })).status === 200);
  ok('disabled account cannot sign in', (await call('POST', '/auth/login', null, { username: email, password: 'Secret123!' })).status === 403);
  const prof = await call('PATCH', '/users/me', tl.token, { title: 'Senior Lead', role: 'admin', status: 'active' });
  ok('profile update works, role cannot be self-changed', prof.body.user.title === 'Senior Lead' && prof.body.user.role === 'team_leader');
  ok('non-admin cannot read logs', (await call('GET', '/logs', dir.token)).status === 403 && (await call('GET', '/logs', ceo.token)).status === 403);
  const logs = (await call('GET', '/logs', admin.token)).body;
  const actions = new Set(); for (let p = 1; p <= logs.pages; p++) (await call('GET', '/logs?page=' + p, admin.token)).body.logs.forEach((l) => actions.add(l.action));
  const want = ['auth.login', 'auth.login_failed', 'auth.register', 'auth.password_changed', 'user.created', 'user.approved', 'user.password_reset', 'user.disabled', 'profile.updated', 'task.created', 'task.updated', 'task.deleted', 'task.commented', 'plan.reviewed', 'kpi.created', 'kpi.checkin', 'report.exported'];
  ok('activity log captured every kind of action', want.every((a) => actions.has(a)), 'missing: ' + want.filter((a) => !actions.has(a)));
  ok('log filter works', (await call('GET', '/logs?action=user.', admin.token)).body.logs.every((l) => l.action.startsWith('user.')));

  // ---- KPI Excel export ----
  const getX = async (path, token) => { const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } }); return { status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }; };
  const ExcelJS = require('exceljs');
  const readX = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };
  const xAdmin = await getX('/kpis/export.xlsx?scope=all', admin.token);
  ok('xlsx export downloads a real workbook', xAdmin.status === 200 && xAdmin.type.includes('spreadsheetml') && xAdmin.buf.slice(0, 2).toString() === 'PK');
  const wbA = await readX(xAdmin.buf); const wsA = wbA.getWorksheet('KPIs');
  const apiAll = (await call('GET', '/kpis?scope=all', admin.token)).body.kpis;
  ok('xlsx has a header and one row per KPI', wsA.getRow(1).getCell(1).value === 'KPI' && wsA.rowCount === apiAll.length + 1, `${wsA.rowCount} rows vs ${apiAll.length}`);
  ok('xlsx has a summary sheet', !!wbA.getWorksheet('Summary'));
  const xMem = await readX((await getX('/kpis/export.xlsx?scope=all', mem2.token)).buf);
  const memApi = (await call('GET', '/kpis?scope=all', mem2.token)).body.kpis;
  ok('member export only holds what they can see', xMem.getWorksheet('KPIs').rowCount === memApi.length + 1 && memApi.length < apiAll.length);
  const xPri = await readX((await getX('/kpis/export.xlsx?scope=all&priority=urgent', admin.token)).buf);
  ok('export follows the filters', xPri.getWorksheet('KPIs').rowCount === apiAll.filter((k) => k.priority === 'urgent').length + 1);
  ok('export needs sign-in', (await getX('/kpis/export.xlsx', 'bad')).status === 401);
  ok('cannot export someone outside your view', (await getX('/kpis/export.xlsx?owner=' + admin.user.id, mem2.token)).status === 403);
  const evil = await call('POST', '/kpis', admin.token, { name: '=HYPERLINK("http://x")', ownerIds: [admin.user.id], mode: 'percent' });
  const xEvil = await readX((await getX('/kpis/export.xlsx?q=HYPERLINK', admin.token)).buf);
  ok('formula-looking names are neutralised', evil.status === 201 && String(xEvil.getWorksheet('KPIs').getRow(2).getCell(1).value).startsWith("'="));

  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
