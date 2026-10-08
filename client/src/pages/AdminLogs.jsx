import React, { useState } from 'react';
import { api, qs } from '../api.js';
import { ACTIONS, fmtDateTime } from '../meta.js';
import { Empty, ErrorNote, Loading, Tag, useLoad } from '../ui.jsx';

const LABELS = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Failed sign-in', 'auth.register': 'Requested an account', 'auth.password_changed': 'Changed own password',
  'user.created': 'Created account', 'user.approved': 'Approved account', 'user.rejected': 'Rejected request', 'user.updated': 'Edited account', 'user.disabled': 'Disabled account', 'user.password_reset': 'Reset password',
  'profile.updated': 'Updated profile', 'task.created': 'Added task', 'task.updated': 'Updated task', 'task.deleted': 'Deleted task', 'task.commented': 'Commented on task',
  'plan.created': 'Started weekly plan', 'plan.updated': 'Edited weekly plan', 'plan.submitted': 'Submitted weekly plan', 'plan.reviewed': 'Reviewed weekly plan', 'plan.deleted': 'Deleted weekly plan',
  'kpi.created': 'Added KPI', 'kpi.updated': 'Edited KPI', 'kpi.checkin': 'Updated KPI value', 'kpi.deleted': 'Deleted KPI', 'report.exported': 'Exported data',
  'wreport.created': 'Started report', 'wreport.updated': 'Edited report', 'wreport.submitted': 'Submitted report', 'wreport.resubmitted': 'Resubmitted report', 'wreport.review_started': 'Opened report for review',
  'wreport.approved': 'Approved report', 'wreport.returned': 'Returned report', 'wreport.rejected': 'Rejected report', 'wreport.archived': 'Archived report', 'wreport.deleted': 'Deleted draft report', 'wreport.commented': 'Commented on report',
  'wreport.file_added': 'Attached file', 'wreport.file_removed': 'Removed file', 'template.created': 'Created template', 'template.updated': 'Edited template', 'template.deleted': 'Deleted template',
  'department.created': 'Added department', 'department.updated': 'Edited department', 'department.deleted': 'Deleted department', 'settings.updated': 'Changed settings', 'system.seeded': 'Loaded demo data',
};
const tone = (a) => (a === 'auth.login_failed' || a.endsWith('deleted') || a.endsWith('rejected') || a === 'user.disabled' ? 'bad' : a === 'user.password_reset' || a === 'auth.password_changed' ? 'warn' : a.startsWith('user.') || a === 'wreport.approved' ? 'good' : a === 'wreport.returned' ? 'warn' : '');

export default function AdminLogs() {
  const [f, setF] = useState({ action: '', q: '', from: '', to: '' }); const [page, setPage] = useState(1); const [err, setErr] = useState('');
  const { data, error, loading } = useLoad(() => api.get('/logs' + qs({ ...f, page })), [f.action, f.q, f.from, f.to, page]);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Activity log</h1><p className="muted">Every sign-in, account change and update across the system, newest first.</p></div>
        <button className="btn" onClick={() => api.download('/logs/export.csv' + qs(f), 'activity-log.csv').catch((e) => setErr(e.message))}>Export CSV</button>
      </header>
      <div className="toolbar">
        <select value={f.action} onChange={set('action')} aria-label="Kind of activity">{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="search" placeholder="Search person, item or detail" value={f.q} onChange={set('q')} aria-label="Search the log" />
        <label className="inline-field">From<input type="date" value={f.from} onChange={set('from')} /></label>
        <label className="inline-field">To<input type="date" value={f.to} onChange={set('to')} /></label>
      </div>
      <ErrorNote error={error || err} />
      {loading && !data ? <Loading /> : !data ? null : data.logs.length === 0 ? <section className="card"><Empty title="Nothing matches">Change the filters to see more activity.</Empty></section> : (
        <section className="card flush">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th className="wide">On</th><th>Details</th><th>IP address</th></tr></thead>
            <tbody>{data.logs.map((l) => (
              <tr key={l.id}><td className="nowrap">{fmtDateTime(l.at)}</td><td>{l.actorName || <span className="muted">unknown</span>}</td><td><Tag tone={tone(l.action)}>{LABELS[l.action] || l.action}</Tag></td><td className="wide">{l.target}</td><td>{l.details}</td><td className="muted nowrap">{l.ip}</td></tr>))}
            </tbody>
          </table></div>
          <footer className="pager"><span className="muted">{data.total} entries</span><span><button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button><span>Page {data.page} of {data.pages}</span><button className="btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Older</button></span></footer>
        </section>)}
    </div>
  );
}
