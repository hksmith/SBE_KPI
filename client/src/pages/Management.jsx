import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { fmtDate, fmtDateTime } from '../meta.js';
import { Empty, ErrorNote, Loading, ProgressBar, Tag, useLoad } from '../ui.jsx';

export default function Management() {
  const { org } = useAuth();
  const [month, setMonth] = useState('');
  const { data: d, error, loading } = useLoad(() => api.get('/workreports/management' + (month ? '?month=' + month : '')), [month]);
  if (loading && !d) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const t = d.totals; const value = month || d.period.start.slice(0, 7);
  const Row = ({ x, total }) => (
    <tr className={total ? 'total' : ''}>
      <td><b>{x.name}</b></td><td>{x.people}</td><td>{x.activities}</td><td>{x.completed}</td><td>{x.inProgress}</td><td>{x.notStarted}</td>
      <td>{x.delayed ? <Tag tone="bad">{x.delayed}</Tag> : 0}</td><td><ProgressBar value={x.avgProgress} /></td><td>{x.kpiPct == null ? <span className="muted">none</span> : `${x.kpiPct}%`}</td>
      <td>{x.reportsFiled ? `${x.reportsApproved} of ${x.reportsFiled} approved` : <span className="muted">none</span>}{x.reportsLate > 0 && <small>, {x.reportsLate} late</small>}</td>
    </tr>
  );
  return (
    <div className="page report-page">
      <header className="page-head">
        <div><h1>{d.period.label} management report</h1><p className="muted">{org || 'Organisation'} summary across {d.departments.length} department{d.departments.length === 1 ? '' : 's'}. Generated {fmtDateTime(d.generatedAt)}.</p></div>
        <div className="head-actions no-print"><label className="inline-field">Month<input type="month" value={value} onChange={(e) => setMonth(e.target.value)} /></label><button className="btn" onClick={() => window.print()}>Print or save as PDF</button></div>
      </header>
      <section className="card">
        <div className="stats flat five">
          <div className="stat"><span>Departments</span><b>{d.departments.length}</b><small>{t.people} people</small></div>
          <div className="stat"><span>Activities</span><b>{t.activities}</b><small>active in the month</small></div>
          <div className="stat"><span>Completed</span><b>{t.completed}</b><small>{t.activities ? Math.round((t.completed / t.activities) * 100) : 0}% of activities</small></div>
          <div className={'stat' + (t.delayed ? ' stat-bad' : '')}><span>Delayed</span><b>{t.delayed}</b><small>{t.inProgress} in progress</small></div>
          <div className="stat"><span>KPI achievement</span><b>{t.kpiPct == null ? 'n/a' : t.kpiPct + '%'}</b><small>across {t.kpis} KPIs</small></div>
        </div>
      </section>
      <section className="card">
        <h2>Department by department</h2>
        {d.departments.length === 0 ? <Empty title="Nothing to report">No people or activity in your view for this month.</Empty> : (
          <div className="table-wrap"><table className="table tight">
            <thead><tr><th>Department</th><th>People</th><th>Activities</th><th>Completed</th><th>In progress</th><th>Not started</th><th>Delayed</th><th>Average progress</th><th>KPI achievement</th><th>Reports for the month</th></tr></thead>
            <tbody>{d.departments.map((x) => <Row key={x.name} x={x} />)}<Row x={t} total /></tbody>
          </table></div>)}
      </section>
      {d.delayed.length > 0 && (
        <section className="card">
          <h2>Delayed activities</h2>
          <div className="table-wrap"><table className="table tight"><thead><tr><th className="wide">Activity</th><th>Responsible</th><th>Department</th><th>Progress</th><th>Was due</th></tr></thead>
            <tbody>{d.delayed.map((x, i) => <tr key={i}><td className="wide">{x.title}</td><td>{x.owner}</td><td>{x.department}</td><td><ProgressBar value={x.progress} /></td><td className="nowrap">{x.dueDate ? fmtDate(x.dueDate) : ''}</td></tr>)}</tbody></table></div>
        </section>)}
    </div>
  );
}
