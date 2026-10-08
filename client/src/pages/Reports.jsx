import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { REPORT_STATUS, REPORT_STATUSES, ROLES, TIMING, fmtDue, isManager } from '../meta.js';
import { Avatar, Empty, ErrorNote, Field, Loading, Modal, ProgressBar, Tag, useLoad } from '../ui.jsx';

export const ReportPill = ({ status }) => { const s = REPORT_STATUS[status] || REPORT_STATUS.draft; return <span className="pill"><i style={{ background: s.color }}>{s.icon}</i>{s.label}</span>; };
const dueTag = (r) => {
  if (r.submittedAt) return r.late ? <Tag tone="warn">Late</Tag> : <Tag tone="good">On time</Tag>;
  if (!r.dueDate) return null;
  const left = new Date(r.dueDate) - Date.now();
  return left < 0 ? <Tag tone="bad">Overdue</Tag> : left < 3 * 864e5 ? <Tag tone="warn">Due soon</Tag> : null;
};

export default function Reports() {
  const { user } = useAuth();
  const manager = isManager(user);
  const [params, setParams] = useSearchParams();
  const [box, setBox] = useState(params.get('box') || (user.role === 'admin' || user.role === 'ceo' ? 'team' : 'mine'));
  const [f, setF] = useState({ q: '', status: '', template: '', department: '', archived: '' });
  const [creating, setCreating] = useState(!!params.get('new'));
  const [err, setErr] = useState('');
  const templates = useLoad(() => api.get('/workreports/templates'), []);
  const depts = useLoad(() => api.get('/departments'), []);
  const list = useLoad(() => (box === 'compliance' ? Promise.resolve(null) : api.get('/workreports' + qs({ box, ...f }))), [box, f.q, f.status, f.template, f.department, f.archived]);
  const tabs = [['mine', 'My reports'], ...(manager ? [['review', 'To review'], ['team', user.role === 'admin' || user.role === 'ceo' ? 'All reports' : 'My teams'], ['compliance', 'Who has filed']] : [])];
  const reports = list.data?.reports || [];
  const closeNew = () => { setCreating(false); if (params.get('new')) setParams({}); };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Reports</h1><p className="muted">Formal reports on a schedule: fill in the template, submit, and it moves up the approval chain.</p></div>
        <div className="head-actions">
          {box !== 'compliance' && <button className="btn" onClick={() => api.download('/workreports/export.csv' + qs({ box, ...f }), 'reports.csv').catch((e) => setErr(e.message))}>Export CSV</button>}
          {user.role !== 'ceo' && <button className="btn btn-primary" onClick={() => setCreating(true)}>New report</button>}
        </div>
      </header>
      <div className="toolbar">
        <div className="seg-control" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={box === k} className={box === k ? 'on' : ''} onClick={() => setBox(k)}>{l}{k === 'review' && list.data?.toReview > 0 && <span className="badge">{list.data.toReview}</span>}</button>)}</div>
        {box !== 'compliance' && <>
          <input type="search" placeholder="Search title, type or period" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search reports" />
          {box !== 'review' && <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Any status</option>{REPORT_STATUSES.filter((s) => s.key !== 'missing' && (box === 'mine' || s.key !== 'draft')).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}
          <select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} aria-label="Report type"><option value="">Any type</option>{(templates.data?.templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          {box === 'team' && <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} aria-label="Department"><option value="">Any department</option>{(depts.data?.departments || []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select>}
          {box !== 'review' && <label className="check"><input type="checkbox" checked={f.archived === '1'} onChange={(e) => setF({ ...f, archived: e.target.checked ? '1' : '' })} />Include archived</label>}
        </>}
      </div>
      <ErrorNote error={list.error || err} />
      {box === 'compliance' ? <Compliance templates={templates.data?.templates || []} /> : list.loading && !list.data ? <Loading /> : reports.length === 0 ? (
        <section className="card"><Empty title={box === 'review' ? 'Nothing waiting for you' : 'No reports here'}>{box === 'mine' ? 'Start a report from a template with "New report".' : box === 'review' ? 'Reports that need your decision show up here.' : 'Nothing matches these filters.'}</Empty></section>
      ) : (
        <section className="card flush"><div className="table-wrap"><table className="table">
          <thead><tr><th className="wide">Report</th>{box !== 'mine' && <th>From</th>}<th>Period</th><th>Status</th><th>Deadline</th><th>Waiting on</th></tr></thead>
          <tbody>{reports.map((r) => (
            <tr key={r.id}>
              <td className="wide"><Link className="person" to={'/reports/' + r.id}><b>{r.title}</b><small>{r.templateName}{r.attachments > 0 && `, ${r.attachments} file${r.attachments > 1 ? 's' : ''}`}</small></Link></td>
              {box !== 'mine' && <td><span className="with-avatar"><Avatar user={r.author} size={24} /><span><b>{r.author?.name}</b><small>{r.department}</small></span></span></td>}
              <td className="nowrap">{r.periodLabel}</td>
              <td><ReportPill status={r.status} /></td>
              <td className="nowrap">{r.dueDate ? fmtDue(r.dueDate) : ''} {dueTag(r)}</td>
              <td>{['submitted', 'under_review'].includes(r.status) ? <>{r.reviewer?.name || 'An admin'}{r.approvalLevels > 1 && <small> (level {r.step} of {r.approvalLevels})</small>}</> : <span className="muted">nobody</span>}</td>
            </tr>))}
          </tbody>
        </table></div></section>
      )}
      {creating && <NewReport templates={templates.data?.templates || []} preset={{ template: params.get('new'), period: params.get('period') }} onClose={closeNew} />}
    </div>
  );
}

function NewReport({ templates, preset, onClose }) {
  const navigate = useNavigate();
  const [tpl, setTpl] = useState(preset.template || ''); const [periods, setPeriods] = useState([]); const [period, setPeriod] = useState(''); const [title, setTitle] = useState(''); const [error, setError] = useState('');
  const t = templates.find((x) => x.id === tpl);
  useEffect(() => { if (!tpl && templates.length === 1) setTpl(templates[0].id); }, [templates, tpl]);
  useEffect(() => {
    if (!tpl) return; setError('');
    api.get('/workreports/periods?template=' + tpl).then((d) => { setPeriods(d.periods); setPeriod((d.periods.find((p) => p.start === preset.period) || d.periods.find((p) => !p.existing) || d.periods[0]).start); }).catch((e) => setError(e.message));
  }, [tpl]); // eslint-disable-line
  const chosen = periods.find((p) => p.start === period);
  const start = async (e) => {
    e.preventDefault();
    if (chosen?.existing) return navigate('/reports/' + chosen.existing.id);
    try { const r = await api.post('/workreports', { templateId: tpl, periodStart: period, title }); navigate('/reports/' + r.report.id); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="New report" onClose={onClose}>
      {templates.length === 0 ? <Empty title="No report templates yet">An admin needs to create one under Settings first.</Empty> : (
        <form onSubmit={start}>
          <Field label="Report type" hint={t?.description}><select required value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">Choose a template</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          {t && t.periodType !== 'adhoc' && periods.length > 0 && <Field label="Reporting period" hint={chosen ? `Due ${fmtDue(chosen.dueDate)}` : ''}><select value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p.start} value={p.start}>{p.label}{p.existing ? ` (already ${REPORT_STATUS[p.existing.status].label.toLowerCase()})` : ''}</option>)}</select></Field>}
          {t && t.periodType === 'adhoc' && <Field label="Title"><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.name} /></Field>}
          <ErrorNote error={error} />
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!tpl}>{chosen?.existing ? 'Open existing report' : 'Start report'}</button></div>
        </form>)}
    </Modal>
  );
}

function Compliance({ templates }) {
  const scheduled = templates.filter((t) => t.periodType !== 'adhoc');
  const [tpl, setTpl] = useState(''); const [period, setPeriod] = useState('');
  useEffect(() => { if (!tpl && scheduled.length) setTpl(scheduled[0].id); }, [scheduled, tpl]);
  const { data: d, error, loading } = useLoad(() => (tpl ? api.get('/workreports/compliance' + qs({ template: tpl, period })) : Promise.resolve(null)), [tpl, period]);
  if (!scheduled.length) return <section className="card"><Empty title="No scheduled report types">Compliance is tracked for templates with a reporting period.</Empty></section>;
  if (error) return <ErrorNote error={error} />;
  if (!d) return <Loading />;
  const t = d.totals; const parts = [['onTime', 'On time', '#0ca30c'], ['late', 'Late', '#fab219'], ['overdue', 'Overdue', '#d03b3b'], ['dueSoon', 'Due soon', '#ec835a'], ['pending', 'Not due yet', '#aab2bd']];
  return (
    <>
      <div className="toolbar">
        <select value={tpl} onChange={(e) => { setTpl(e.target.value); setPeriod(''); }} aria-label="Report type">{scheduled.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select value={d.period.start} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{d.periods.map((p) => <option key={p.start} value={p.start}>{p.label}</option>)}</select>
        <span className="muted">Due {fmtDue(d.period.dueDate)}</span>
      </div>
      {t.expected === 0 ? <section className="card"><Empty title="Nobody in your view is expected to file this">The template decides which roles and departments must submit it.</Empty></section> : <>
        <section className="card">
          <div className="stats flat">
            <div className="stat"><span>Filed</span><b>{t.filed}/{t.expected}</b><small>{Math.round((t.filed / t.expected) * 100)}% of people</small></div>
            <div className="stat"><span>On time</span><b>{t.filed ? Math.round((t.onTime / t.filed) * 100) + '%' : 'n/a'}</b><small>{t.late} late</small></div>
            <div className={'stat' + (t.overdue ? ' stat-bad' : '')}><span>Overdue</span><b>{t.overdue}</b><small>not filed, past the deadline</small></div>
            <div className="stat"><span>Approved</span><b>{t.approved}</b><small>through every level</small></div>
          </div>
          <span className="strip" style={{ height: 22, marginTop: 18 }}>{parts.filter(([k]) => t[k]).map(([k, l, c]) => <span key={k} className="seg" style={{ flexGrow: t[k], background: c }} data-tip={`${l}: ${t[k]}`} tabIndex={0} />)}</span>
          <ul className="legend">{parts.filter(([k]) => t[k]).map(([k, l, c]) => <li key={k}><i style={{ background: c }} />{l}<b>{t[k]}</b></li>)}</ul>
        </section>
        <div className="grid g-1-1">
          <section className="card">
            <h2>By department</h2>
            <ul className="rows">{d.departments.map((x) => <li key={x.name}><div><b>{x.name}</b><small>{x.filed} of {x.expected} filed{x.late > 0 && `, ${x.late} late`}{x.overdue > 0 && `, ${x.overdue} overdue`}</small></div><ProgressBar value={x.pct} color={x.pct === 100 ? 'var(--good)' : undefined} /></li>)}</ul>
          </section>
          <section className="card">
            <h2>Person by person</h2>
            <ul className="rows">{d.people.map((p) => (
              <li key={p.id}>
                <div className="with-avatar"><Avatar user={p} size={28} /><span>{p.reportId ? <Link to={'/reports/' + p.reportId}><b>{p.name}</b></Link> : <b>{p.name}</b>}<small>{ROLES[p.role]}, {p.department}</small></span></div>
                <span className="kpi-mini"><ReportPill status={p.status} /><Tag tone={TIMING[p.timing][1]}>{TIMING[p.timing][0]}</Tag></span>
              </li>))}</ul>
          </section>
        </div>
      </>}
    </>
  );
}
