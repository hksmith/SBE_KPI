import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { HEALTH, PRIORITIES, ROLES, STATUS, STATUSES, cap, fmtDate, fmtDateTime, fmtDue, fmtShort, fmtVal, isManager } from '../meta.js';
import { useLiveTick } from '../live.js';
import { Avatar, Empty, ErrorNote, Field, Loading, Modal, Sparkline, StatusPill, Tag, useLoad } from '../ui.jsx';

export const UrgencyTag = ({ priority }) => <Tag tone={priority === 'urgent' ? 'bad' : priority === 'high' ? 'warn' : ''}>{priority === 'urgent' ? 'Urgent' : `${cap(priority)} urgency`}</Tag>;

export default function Kpis() {
  const { user, refreshCounts } = useAuth();
  const manager = isManager(user); const everyone = user.role === 'admin' || user.role === 'ceo';
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState(everyone ? 'team' : 'mine');
  const [f, setF] = useState({ q: '', status: '', priority: '', owner: '' });
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === search ? x : { ...x, q: search })), 250); return () => clearTimeout(t); }, [search]);
  const [modal, setModal] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api.get('/kpis' + qs({ scope, ...f })), [scope, f.q, f.status, f.priority, f.owner]);
  const people = useLoad(() => (manager ? api.get('/users/tree') : Promise.resolve({ users: [] })), [manager]);
  const others = (people.data?.users || []).filter((p) => p.id !== user.id && p.role !== 'admin');
  // a notification link like /kpis?open=<id> lands straight on that KPI
  const openId = params.get('open');
  useEffect(() => { if (openId) setModal({ type: 'view', id: openId }); }, [openId]);
  const close = () => { setModal(null); if (openId) setParams({}, { replace: true }); reload(); refreshCounts(); };
  const remove = async (k) => { if (!window.confirm(`Delete "${k.name}"? Its history goes with it.`)) return; await api.del('/kpis/' + k.id).catch(() => {}); reload(); };
  const kpis = data?.kpis || [];
  const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState('');
  const exportXlsx = async () => {
    setExporting(true); setExportError('');
    try { await api.saveFile('/kpis/export.xlsx' + qs({ scope, ...f }), `kpis-${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (err) { setExportError(err.message); }
    setExporting(false);
  };
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>KPIs</h1><p className="muted">{manager ? 'Set KPIs for yourself or for people in your structure, then follow their status and progress.' : 'Open a KPI to see what it is and to update its status and progress.'}</p></div>
        <div className="head-actions">
          <button className="btn" onClick={exportXlsx} disabled={exporting || kpis.length === 0} title="Download what you see here as an Excel file">{exporting ? 'Preparing…' : 'Export to Excel'}</button>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'form' })}>{manager ? 'Add or assign KPI' : 'Add KPI'}</button>
        </div>
      </header>
      <div className="toolbar">
        {manager && <div className="seg-control" role="tablist">
          {[['mine', 'Mine'], ['team', everyone ? 'Everyone else' : 'My teams']].map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => { setScope(k); setF({ ...f, owner: '' }); }}>{l}</button>)}
        </div>}
        <input type="search" placeholder="Search KPIs" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search KPIs" />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}<option value="overdue">Past the deadline</option></select>
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Urgency"><option value="">Any urgency</option>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        {scope === 'team' && <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} aria-label="Person"><option value="">Everyone</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>
      <ErrorNote error={error || exportError} />
      {loading && !data ? <Loading /> : kpis.length === 0 ? <section className="card"><Empty title="No KPIs here">{scope === 'mine' ? 'Add a KPI, or wait for your manager to assign one.' : 'Nothing matches. Use "Add or assign KPI" to set one for someone.'}</Empty></section> : (
        <div className="kpi-grid">{kpis.map((k) => {
          const st = STATUS[k.status]; const pace = !['done', 'cancelled'].includes(k.status) && HEALTH[k.health];
          return (
            <article className={'card kpi' + (k.isNew ? ' is-new' : '')} key={k.id}>
              <header><h3>{k.isNew && <span className="new-tag">New</span>}{k.name}</h3><StatusPill status={k.status} /></header>
              {scope !== 'mine' && <p className="with-avatar muted small"><Avatar user={k.owner} size={20} />{k.owner.name}{k.unseen && <Tag tone="warn">Not opened yet</Tag>}</p>}
              <div className="kpi-num"><b>{k.pct}%</b><span>{k.mode === 'percent' ? 'complete' : `${fmtVal(k.current, k.unit)} of ${fmtVal(k.target, k.unit)}`}</span><Sparkline values={k.checkins.map((c) => c.value)} color={st.color} /></div>
              <div className="meter" role="img" aria-label={`${k.pct}% complete`}><span style={{ width: k.pct + '%', background: st.color }} /></div>
              <p className="kpi-tags"><UrgencyTag priority={k.priority} />{k.overdue ? <Tag tone="bad">Past deadline</Tag> : pace && <Tag tone={k.health === 'on_track' ? 'good' : k.health === 'at_risk' ? 'warn' : 'bad'}>{pace.label}</Tag>}</p>
              <p className="muted small kpi-meta">{k.dueDate ? `Due ${fmtDue(k.dueDate)}. ` : ''}Updated {fmtShort(k.checkins.at(-1)?.at)}.{k.createdBy && String(k.createdBy._id) !== String(k.owner._id) ? ` Assigned by ${k.createdBy.name}.` : ''}</p>
              <div className="actions left">
                <button className="btn btn-primary" onClick={() => setModal({ type: 'view', id: k.id })}>{k.canUpdate ? 'View and update' : 'View'}</button>
                {k.canEdit && <><button className="btn btn-quiet" onClick={() => setModal({ type: 'form', kpi: k })}>Edit</button><button className="btn btn-quiet" onClick={() => remove(k)}>Delete</button></>}
              </div>
            </article>);
        })}</div>)}
      {modal?.type === 'form' && <KpiForm kpi={modal.kpi} people={others} canAssign={manager} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.type === 'view' && <KpiView id={modal.id} onClose={close} />}
    </div>
  );
}

function KpiForm({ kpi, people, canAssign, onClose, onDone }) {
  const { user } = useAuth();
  const selfOk = user.role !== 'ceo';
  const [f, setF] = useState(kpi ? { name: kpi.name, description: kpi.description || '', ownerId: kpi.owner._id, mode: kpi.mode, priority: kpi.priority, unit: kpi.mode === 'percent' ? '' : kpi.unit, baseline: kpi.baseline, target: kpi.target, dueDate: kpi.dueDate ? kpi.dueDate.slice(0, 10) : '' }
    : { name: '', description: '', mode: 'percent', priority: 'medium', unit: '', baseline: 0, target: '', dueDate: '' });
  // Managers start with nobody picked, so a KPI can never silently land on themselves instead of the person they meant.
  const [picked, setPicked] = useState(canAssign && people.length ? [] : [user.id]);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const left = people.filter((p) => !picked.includes(p.id));
  const nameOf = (id) => id === user.id ? 'Me' : people.find((p) => p.id === id)?.name || 'Unknown';
  const addChoice = (choice) => {
    if (!choice) return;
    setPicked(choice === '__all' ? [...new Set([...picked, ...left.map((p) => p.id)])] : picked.includes(choice) ? picked : [...picked, choice]);
    setError('');
  };
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      if (kpi) await api.patch('/kpis/' + kpi.id, f);
      else { if (!picked.length) return setError('Pick at least one person to assign this KPI to.'); await api.post('/kpis', { ...f, ownerIds: picked }); }
      onDone();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={kpi ? 'Edit KPI' : canAssign ? 'Add or assign KPI' : 'Add KPI'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="KPI"><input required autoFocus value={f.name} onChange={set('name')} placeholder="Customer calls made" maxLength={120} /></Field>
        <Field label="What it is and how it will be judged"><textarea rows={3} value={f.description} onChange={set('description')} /></Field>
        <div className="row2">
          <Field label="Urgency"><select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
          <Field label="Deadline"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        </div>
        {canAssign && people.length > 0 && (kpi ? (
          <Field label="Assigned to"><select value={f.ownerId} onChange={set('ownerId')}>{selfOk && <option value={user.id}>Me</option>}{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? `, ${p.title}` : ''}</option>)}{!people.some((p) => p.id === f.ownerId) && f.ownerId !== user.id && <option value={f.ownerId}>{kpi.owner.name}</option>}</select></Field>
        ) : (
          <div className="field"><span>Assign to <em className="count">{picked.length} picked</em></span>
            {picked.length > 0 && <ul className="chips">{picked.map((id) => <li key={id} className="chip-x">{nameOf(id)}<button type="button" className="icon-btn" onClick={() => setPicked(picked.filter((x) => x !== id))} aria-label={'Remove ' + nameOf(id)}>×</button></li>)}</ul>}
            <div className="comment-form">
              <select value="" onChange={(e) => addChoice(e.target.value)} aria-label="Choose who to assign to" disabled={!left.length && !(selfOk && !picked.includes(user.id))}>
                <option value="">{left.length || (selfOk && !picked.includes(user.id)) ? 'Choose a person…' : 'Everyone is added'}</option>
                {selfOk && !picked.includes(user.id) && <option value={user.id}>Me</option>}
                {left.length > 1 && <option value="__all">Everyone listed ({left.length})</option>}
                {left.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? `, ${p.title}` : ''}</option>)}
              </select>
            </div>
            <small>{picked.length ? 'Pick more people to add them. Each one gets their own copy to update.' : 'Pick who this KPI is for. Choose "Me" for your own KPI.'}</small></div>
        ))}
        {!kpi && <div className="field"><span>How progress is measured</span>
          <div className="seg-control" role="tablist">
            <button type="button" role="tab" aria-selected={f.mode === 'percent'} className={f.mode === 'percent' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'percent' })}>By percentage</button>
            <button type="button" role="tab" aria-selected={f.mode === 'number'} className={f.mode === 'number' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'number' })}>By a number and target</button>
          </div>
          <small>{f.mode === 'percent' ? 'The owner types the % complete.' : 'The owner enters the current number and the % is worked out against the target.'}</small></div>}
        {f.mode === 'number' && <div className="row3 tight">
          <Field label="Starting value"><input type="number" step="any" required value={f.baseline} onChange={set('baseline')} /></Field>
          <Field label="Target"><input type="number" step="any" required value={f.target} onChange={set('target')} /></Field>
          <Field label="Unit" hint="calls, hrs, ETB…"><input value={f.unit} onChange={set('unit')} maxLength={20} /></Field>
        </div>}
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{kpi ? 'Save changes' : picked.length > 1 ? `Assign to ${picked.length} people` : picked.length === 1 && picked[0] !== user.id ? `Assign to ${nameOf(picked[0])}` : 'Add KPI'}</button></div>
      </form>
    </Modal>
  );
}

/** Everything about one KPI, with the update form beside it. Nothing changes until "Update" is clicked. */
function KpiView({ id, onClose }) {
  const [k, setK] = useState(null); const [error, setError] = useState(''); const [saved, setSaved] = useState('');
  const [status, setStatus] = useState(''); const [progress, setProgress] = useState(0); const [value, setValue] = useState(0); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const adopt = (kpi) => { setK(kpi); setStatus(kpi.status); setProgress(kpi.pct); setValue(kpi.current); setNote(''); };
  useEffect(() => { setK(null); setError(''); api.get('/kpis/' + id).then((d) => adopt(d.kpi)).catch((e) => setError(e.message)); }, [id]);
  const percent = k?.mode === 'percent';
  const dirty = !!k && (status !== k.status || note.trim() !== '' || (percent ? Number(progress) !== k.pct : Number(value) !== k.current));
  // Someone else changed this KPI while it is open: show it, unless the person is in the middle of an update.
  const tick = useLiveTick();
  useEffect(() => { if (!tick || !k || dirty || busy) return; api.get('/kpis/' + id).then((d) => adopt(d.kpi)).catch((e) => setError(e.message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!k) return <Modal title="KPI" onClose={onClose}>{error ? <><ErrorNote error={error} /><p className="muted">It may have been deleted, or it is not in your structure.</p></> : <Loading />}</Modal>;
  const tryClose = () => { if (!dirty || window.confirm('You have changes that are not saved. Close without updating?')) onClose(); };
  const pickStatus = (s) => { setSaved(''); setStatus(s); if (percent && s === 'done') setProgress(100); if (percent && s === 'not_started') setProgress(0); };
  const setPct = (p) => { setSaved(''); const n = Math.max(0, Math.min(100, Number(p) || 0)); setProgress(p === '' ? '' : n); if (n === 100) setStatus('done'); else if (status === 'done') setStatus('in_progress'); else if (n > 0 && status === 'not_started') setStatus('in_progress'); };
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError(''); try { adopt((await api.post(`/kpis/${k.id}/checkin`, percent ? { status, progress: progress === '' ? 0 : progress, note } : { status, value, note })).kpi); setSaved('Updated.'); } catch (err) { setError(err.message); } setBusy(false); };
  const st = STATUS[k.status]; const assigned = k.createdBy && String(k.createdBy._id) !== String(k.owner._id);
  return (
    <Modal title={k.name} onClose={tryClose} wide>
      <div className="detail">
        <div>
          <p className="kpi-tags"><StatusPill status={k.status} /><UrgencyTag priority={k.priority} />{k.overdue && <Tag tone="bad">Past deadline</Tag>}{!k.overdue && !['done', 'cancelled'].includes(k.status) && <Tag tone={k.health === 'on_track' ? 'good' : k.health === 'at_risk' ? 'warn' : 'bad'}>{HEALTH[k.health].label}</Tag>}</p>
          <div className="kpi-num big"><b>{k.pct}%</b><span>{percent ? 'complete' : `${fmtVal(k.current, k.unit)} of ${fmtVal(k.target, k.unit)}`}</span><Sparkline values={k.checkins.map((c) => c.value)} color={st.color} width={160} height={40} /></div>
          <div className="meter" role="img" aria-label={`${k.pct}% complete`}><span style={{ width: k.pct + '%', background: st.color }} /></div>
          <h3 className="sub">What this KPI is</h3>
          <p className="desc">{k.description || <span className="muted">No description was written for this KPI.</span>}</p>
          <dl className="facts">
            <div><dt>Assigned to</dt><dd className="with-avatar"><Avatar user={k.owner} size={22} />{k.owner.name}{k.owner.title ? `, ${k.owner.title}` : ''}</dd></div>
            <div><dt>{assigned ? 'Assigned by' : 'Set by'}</dt><dd>{k.createdBy?.name || 'Unknown'} on {fmtDate(k.createdAt)}</dd></div>
            <div><dt>Measured</dt><dd>{percent ? 'By percentage' : `From ${fmtVal(k.baseline, k.unit)} to a target of ${fmtVal(k.target, k.unit)}`}</dd></div>
            <div><dt>Deadline</dt><dd>{k.dueDate ? `${fmtDue(k.dueDate)}, end of the day` : 'None set'}</dd></div>
            {assigned && <div><dt>Opened by {k.owner.name.split(' ')[0]}</dt><dd>{k.unseen ? <Tag tone="warn">Not opened yet</Tag> : k.openedAt ? fmtDateTime(k.openedAt) : 'Yes'}</dd></div>}
            {k.completedAt && <div><dt>Finished</dt><dd>{fmtDate(k.completedAt)}</dd></div>}
          </dl>
        </div>
        <aside>
          {k.canUpdate ? (
            <form className="update-box" onSubmit={submit}>
              <h3>Update this KPI</h3>
              <Field label="Status"><select value={status} onChange={(e) => pickStatus(e.target.value)}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
              {percent ? (
                <div className="field"><span>Progress</span>
                  <div className="pct-edit"><input type="range" min="0" max="100" step="1" value={progress === '' ? 0 : progress} onChange={(e) => setPct(e.target.value)} aria-label="Progress slider" /><input type="number" min="0" max="100" value={progress} onChange={(e) => setPct(e.target.value)} aria-label="Progress percent" /><b>%</b></div></div>
              ) : <Field label={`Current value${k.unit ? ' (' + k.unit + ')' : ''}`} hint="The % is worked out from this."><input type="number" step="any" required value={value} onChange={(e) => { setValue(e.target.value); setSaved(''); }} /></Field>}
              <Field label="Note" hint="Optional. Saved in the history."><input value={note} onChange={(e) => { setNote(e.target.value); setSaved(''); }} maxLength={300} /></Field>
              <ErrorNote error={error} />{saved && !dirty && <p className="ok" role="status">{saved}</p>}
              <button className="btn btn-primary btn-block" disabled={busy || !dirty}>{busy ? 'Updating…' : 'Update'}</button>
              <small>{dirty ? 'Not saved yet. Click Update to save these changes.' : 'Nothing is saved until you click Update.'}</small>
            </form>
          ) : <p className="muted small">You can view this KPI but not update it.</p>}
          <h3 className="sub">History</h3>
          <ul className="history">{[...k.checkins].reverse().slice(0, 15).map((c, i) => <li key={i}>{c.status && <StatusPill status={c.status} />}<span>{percent ? c.value + '%' : fmtVal(c.value, k.unit)}</span><small>{c.by?.name}, {fmtDateTime(c.at)}{c.note && `: ${c.note}`}</small></li>)}</ul>
        </aside>
      </div>
    </Modal>
  );
}
