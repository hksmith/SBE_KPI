import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { HEALTH, PRIORITIES, REPORT_STATUS, ROLES, fmtShort, fmtVal, isManager, weekLabel } from '../meta.js';
const fmtDueShort = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
import { Avatar, Empty, ErrorNote, HealthPill, Loading, ProgressBar, Ring, StatusLegend, StatusPill, StatusStrip, Tag, useLoad } from '../ui.jsx';

const Stat = ({ label, value, sub, tone }) => <div className={'stat' + (tone ? ' stat-' + tone : '')}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
const PACE = ['achieved', 'on_track', 'at_risk', 'off_track'];

export default function Dashboard() {
  const { user, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const root = params.get('root') || '';
  const { data: d, error, loading } = useLoad(() => api.get('/reports/overview' + qs({ root })), [root]);
  const rep = useLoad(() => (settings.modules.reports ? api.get('/workreports/summary' + qs({ root })) : Promise.resolve(null)), [root, settings.modules.reports]);
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const kpiMode = d.source === 'kpis'; const noun = kpiMode ? 'KPIs' : 'Tasks'; const plansOn = d.modules.plans;
  const everyone = user.role === 'admin' || user.role === 'ceo';
  const solo = d.headcount === 1;
  const mine = !root || root === user.id;
  const title = mine ? (solo ? 'My overview' : everyone ? 'Organisation overview' : 'My teams') : d.root.name;
  const t = d.totals;
  const maxPri = Math.max(1, ...Object.values(d.byPriority));
  const kpiTotal = PACE.reduce((a, k) => a + d.kpis.byHealth[k], 0);
  const onPace = d.kpis.byHealth.achieved + d.kpis.byHealth.on_track;
  const trend = d.trend.map((w) => ({ ...w, label: fmtShort(w.week + 'T00:00:00Z') }));
  const others = d.people.filter((p) => p.id !== (d.root?.id || user.id));

  const paceCard = (
    <section className="card">
      <h2>{kpiMode ? 'Pace against deadlines' : 'KPI health'}</h2>
      {kpiTotal ? <>
        <span className="strip" style={{ height: 28 }}>{PACE.filter((k) => d.kpis.byHealth[k]).map((k) => <span key={k} className="seg" style={{ flexGrow: d.kpis.byHealth[k], background: HEALTH[k].color }} data-tip={`${HEALTH[k].label}: ${d.kpis.byHealth[k]}`} tabIndex={0} />)}</span>
        <ul className="legend">{PACE.map((k) => <li key={k}><i style={{ background: HEALTH[k].color }} />{HEALTH[k].label}<b>{d.kpis.byHealth[k]}</b></li>)}</ul>
        {kpiMode && <p className="muted small" style={{ margin: '12px 0 0' }}>Compares progress with how much of the time to the deadline has gone.</p>}
      </> : <Empty title="No KPIs yet">Set a KPI and its pace shows here.</Empty>}
    </section>
  );
  const trendCard = (
    <section className="card">
      <h2>{noun} added and finished, last 8 weeks</h2>
      <div className="chart">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#e6e9ee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#5c6675' }} tickLine={false} axisLine={{ stroke: '#d5dae1' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#5c6675' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #d5dae1', fontSize: 13 }} labelFormatter={(l) => 'Week of ' + l} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 13 }} />
            <Line type="monotone" dataKey="created" name="Added" stroke="#2a78d6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="completed" name="Finished" stroke="#eb6834" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
  const attentionCard = (
    <section className="card">
      <h2>Needs attention</h2>
      {d.attention.length ? <ul className="rows">{d.attention.map((a) => (
        <li key={a.id}>
          <div><Link to={(kpiMode ? '/kpis?open=' : '/tasks?open=') + a.id}><b>{a.title}</b></Link><small>{solo ? '' : a.owner + ', '}{a.progress}% done, {a.dueDate ? (a.overdue ? 'was due ' : 'due ') + fmtDueShort(a.dueDate) : 'no deadline'}</small></div>
          {a.overdue ? <Tag tone="bad">Past deadline</Tag> : <StatusPill status={a.status} />}
        </li>))}</ul> : <Empty title="All clear">Nothing is late, blocked or due this week.</Empty>}
    </section>
  );
  const urgencyCard = (
    <section className="card">
      <h2>Open KPIs by urgency</h2>
      <ul className="hbars">
        {PRIORITIES.map((p) => <li key={p.key}><span>{p.label}</span><span className="hbar"><span style={{ width: `${(d.byPriority[p.key] / maxPri) * 100}%` }} data-tip={`${d.byPriority[p.key]} open ${p.label.toLowerCase()} KPIs`} tabIndex={0} /></span><b>{d.byPriority[p.key]}</b></li>)}
      </ul>
    </section>
  );
  const furthestCard = (
    <section className="card">
      <h2>{kpiMode ? 'Furthest behind' : 'KPIs furthest from target'}</h2>
      {d.kpis.list.length ? <ul className="rows">{d.kpis.list.slice(0, 7).map((k) => (
        <li key={k.id}>
          <div><Link to={'/kpis?open=' + k.id}><b>{k.name}</b></Link><small>{solo ? '' : k.ownerName + ', '}{k.mode === 'percent' ? `${k.pct}% complete` : `${fmtVal(k.current, k.unit)} of ${fmtVal(k.target, k.unit)}`}</small></div>
          <span className="kpi-mini"><ProgressBar value={k.pct} color={HEALTH[k.health].color} /><HealthPill health={k.health} /></span>
        </li>))}</ul> : <Empty title="Nothing behind">Open KPIs appear here, the furthest behind first.</Empty>}
    </section>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {!mine && <Link className="back" to="/">Back to {isManager(user) ? 'my overview' : 'overview'}</Link>}
          <h1>{title}</h1>
          <p className="muted">{!mine && `${ROLES[d.root.role]}. `}{solo ? (kpiMode ? 'Your KPIs' : 'Your tasks, plan and KPIs') : `${d.headcount} people`}{plansOn || !kpiMode ? ` for the week of ${weekLabel(d.week)}` : ''}</p>
        </div>
        {isManager(user) && d.people.length > 0 && (
          <label className="inline-field">Show report for
            <select value={root} onChange={(e) => setParams(e.target.value ? { root: e.target.value } : {})}>
              <option value="">{everyone ? 'Whole organisation' : 'Me and my teams'}</option>
              <PeopleOptions />
            </select>
          </label>
        )}
      </header>

      <section className="card hero">
        <Ring value={t.avgProgress}><b>{t.avgProgress}%</b><small>average progress</small></Ring>
        <div className="stats">
          <Stat label={noun} value={t.total} sub={`${t.done} done (${t.completionRate}%)`} />
          <Stat label="Past deadline" value={t.overdue} sub={t.overdue ? 'not finished in time' : 'nothing late'} tone={t.overdue ? 'bad' : ''} />
          {kpiMode ? <Stat label="On pace" value={kpiTotal ? Math.round((onPace / kpiTotal) * 100) + '%' : 'n/a'} sub={`${onPace} of ${kpiTotal} on track or achieved`} />
            : <Stat label="KPI progress" value={d.kpis.avgPct == null ? 'None' : d.kpis.avgPct + '%'} sub={kpiTotal ? `across ${kpiTotal} ${kpiTotal === 1 ? 'KPI' : 'KPIs'}` : 'no KPIs set yet'} />}
          {plansOn ? <Stat label="Weekly plans in" value={solo ? (d.plans.submitted ? 'Yes' : 'No') : `${d.plans.submitted}/${d.plans.expected}`} sub={solo ? 'this week' : 'submitted this week'} />
            : <Stat label={solo ? 'In progress' : 'People'} value={solo ? t.byStatus.in_progress + t.byStatus.started : d.headcount} sub={solo ? 'being worked on now' : `${d.people.filter((p) => p.tasks.total > 0).length} have ${kpiMode ? 'KPIs' : 'tasks'}`} />}
        </div>
      </section>

      <div className="grid g-2-1">
        <section className="card">
          <h2>{kpiMode ? 'Where the KPIs stand' : 'Where the work stands'}</h2>
          {t.total ? <><StatusStrip byStatus={t.byStatus} height={28} /><StatusLegend byStatus={t.byStatus} /></> : <Empty title={kpiMode ? 'No KPIs yet' : 'No tasks yet'}>{kpiMode ? 'Add a KPI and it shows up here.' : 'Add a task and it shows up here.'}</Empty>}
        </section>
        {kpiMode ? paceCard : (
          <section className="card">
            <h2>Open work by priority</h2>
            <ul className="hbars">
              {PRIORITIES.map((p) => <li key={p.key}><span>{p.label}</span><span className="hbar"><span style={{ width: `${(d.byPriority[p.key] / maxPri) * 100}%` }} data-tip={`${d.byPriority[p.key]} open ${p.label.toLowerCase()} tasks`} tabIndex={0} /></span><b>{d.byPriority[p.key]}</b></li>)}
            </ul>
          </section>)}
      </div>

      {rep.data && rep.data.total > 0 && (
        <section className="card">
          <div className="card-head"><h2>Formal reports</h2><Link to="/reports">Open reports</Link></div>
          <div className="stats flat five">
            {['submitted', 'under_review', 'returned', 'approved', 'rejected'].map((k) => <div className="stat" key={k}><span>{REPORT_STATUS[k].label}</span><b>{rep.data.byStatus[k]}</b></div>)}
          </div>
          <span className="strip" style={{ height: 14, marginTop: 16 }}>{['approved', 'under_review', 'submitted', 'returned', 'rejected'].filter((k) => rep.data.byStatus[k]).map((k) => <span key={k} className="seg" style={{ flexGrow: rep.data.byStatus[k], background: REPORT_STATUS[k].color }} data-tip={`${REPORT_STATUS[k].label}: ${rep.data.byStatus[k]}`} tabIndex={0} />)}</span>
          <p className="muted small" style={{ margin: '12px 0 0' }}>{rep.data.onTimePct == null ? 'No reports submitted in the last 90 days.' : `${rep.data.onTimePct}% of the ${rep.data.recent} reports submitted in the last 90 days were on time, ${100 - rep.data.onTimePct}% late.`}{rep.data.toReview > 0 && ` ${rep.data.toReview} waiting for your decision.`}</p>
        </section>
      )}

      {d.groups.length > 0 && (
        <section className="card">
          <h2>{d.root ? 'Teams under ' + d.root.name.split(' ')[0] : 'Teams compared'}</h2>
          <div className="table-wrap"><table className="table compare">
            <thead><tr><th>Led by</th><th>People</th><th>{noun}</th><th className="wide">Status split</th><th>Average progress</th><th>Past deadline</th></tr></thead>
            <tbody>{d.groups.map((g) => (
              <tr key={g.id}>
                <td><Link className="person" to={'/?root=' + g.id}><b>{g.name}</b><small>{g.title || ROLES[g.role]}</small></Link></td>
                <td>{g.headcount}</td><td>{g.total}</td>
                <td className="wide"><StatusStrip byStatus={g.byStatus} /></td>
                <td><ProgressBar value={g.avgProgress} /></td>
                <td>{g.overdue ? <Tag tone="bad">{g.overdue} late</Tag> : <span className="muted">0</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        </section>
      )}

      {kpiMode ? <><div className="grid g-1-1">{trendCard}{attentionCard}</div><div className="grid g-2-1">{furthestCard}{urgencyCard}</div></> : <><div className="grid g-2-1">{trendCard}{paceCard}</div><div className="grid g-1-1">{attentionCard}{furthestCard}</div></>}

      {others.length > 0 && (
        <section className="card">
          <h2>Everyone in this report</h2>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Person</th><th>{noun}</th><th className="wide">Status split</th><th>Progress</th><th>Past deadline</th>{plansOn && <th>This week's plan</th>}{!kpiMode && <th>KPIs</th>}</tr></thead>
            <tbody>{others.map((p) => (
              <tr key={p.id}>
                <td><Link className="person with-avatar" to={'/?root=' + p.id}><Avatar user={p} size={30} /><span><b>{p.name}</b><small>{p.title || ROLES[p.role]}</small></span></Link></td>
                <td>{p.tasks.total}</td>
                <td className="wide"><StatusStrip byStatus={p.tasks.byStatus} /></td>
                <td><ProgressBar value={p.tasks.avgProgress} /></td>
                <td>{p.tasks.overdue ? <Tag tone="bad">{p.tasks.overdue} late</Tag> : <span className="muted">0</span>}</td>
                {plansOn && <td>{p.plan ? <Tag tone={p.plan.status === 'reviewed' ? 'good' : ''}>{p.plan.status === 'reviewed' ? 'Reviewed' : 'Submitted'}, {p.plan.progress}%</Tag> : ['admin', 'ceo'].includes(p.role) ? <span className="muted">n/a</span> : <Tag tone="warn">Not submitted</Tag>}</td>}
                {!kpiMode && <td>{p.kpis.count ? `${p.kpis.count} at ${p.kpis.avgPct}%` : <span className="muted">none</span>}</td>}
              </tr>))}
            </tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}

function PeopleOptions() {
  const { user } = useAuth();
  const { data } = useLoad(() => api.get('/users/tree'), []);
  return (data?.users || []).filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLES[u.role]})</option>);
}
