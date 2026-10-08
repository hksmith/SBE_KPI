import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { HISTORY, fmtDate, fmtDateTime, fmtDue, fmtSize } from '../meta.js';
import { Avatar, ErrorNote, Loading, ProgressBar, StatusLegend, StatusPill, StatusStrip, Tag } from '../ui.jsx';
import { ReportPill } from './Reports.jsx';

const show = (f, v) => (v === undefined || v === '' ? <span className="muted">Not filled in</span> : f.type === 'percent' ? v + '%' : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : f.type === 'date' ? fmtDate(v + 'T00:00:00') : String(v));

export default function ReportDetail() {
  const { id } = useParams(); const navigate = useNavigate();
  const [r, setR] = useState(null); const [values, setValues] = useState({}); const [error, setError] = useState(''); const [note, setNote] = useState(''); const [dirty, setDirty] = useState(false);
  const [decision, setDecision] = useState(''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const fileRef = useRef(null);
  const adopt = (rep) => { setR(rep); setValues(rep.values || {}); setDirty(false); };
  useEffect(() => { setR(null); setError(''); api.get('/workreports/' + id).then((d) => adopt(d.report)).catch((e) => setError(e.message)); }, [id]);
  if (!r) return <div className="page">{error ? <><Link className="back" to="/reports">Back to reports</Link><ErrorNote error={error} /></> : <Loading />}</div>;

  const run = async (fn, okNote = '') => { setBusy(true); setError(''); setNote(''); try { const d = await fn(); if (d?.report) adopt(d.report); setNote(okNote); } catch (e) { setError(e.message); } setBusy(false); };
  const set = (fid, v) => { setValues({ ...values, [fid]: v }); setDirty(true); setNote(''); };
  const clean = () => Object.fromEntries(r.fields.map((f) => [f.id, values[f.id] === undefined ? '' : values[f.id]]));
  const save = () => run(() => api.patch('/workreports/' + id, { values: clean() }), 'Draft saved.');
  const submit = () => { if (window.confirm('Submit this report? You will not be able to edit it unless it is returned to you.')) run(() => api.post(`/workreports/${id}/submit`, { values: clean() }), 'Submitted.'); };
  const decide = (action) => run(async () => { const d = await api.post(`/workreports/${id}/decision`, { action, comment: decision }); setDecision(''); return d; }, action === 'approve' ? 'Approved.' : action === 'return' ? 'Returned to the author.' : 'Rejected.');
  const addFiles = async (e) => { const files = [...e.target.files]; e.target.value = ''; for (const file of files) await run(async () => { if (dirty) await api.patch('/workreports/' + id, { values: clean() }); return api.upload(`/workreports/${id}/attachments`, file); }); };
  const remove = async () => { if (!window.confirm('Delete this draft?')) return; try { await api.del('/workreports/' + id); navigate('/reports'); } catch (e) { setError(e.message); } };
  const lastReturn = r.status === 'returned' && [...r.history].reverse().find((h) => h.action === 'returned');
  const open = ['submitted', 'under_review'].includes(r.status);
  const levels = Array.from({ length: r.approvalLevels }, (_, i) => i + 1);
  const approvedSteps = (() => { let n = 0; for (const h of r.history) { if (['submitted', 'resubmitted'].includes(h.action)) n = 0; if (h.action === 'approved') n++; } return n; })();

  return (
    <div className="page report-page">
      <header className="page-head">
        <div>
          <Link className="back no-print" to="/reports">Back to reports</Link>
          <h1>{r.title}</h1>
          <p className="muted with-avatar"><Avatar user={r.author} size={22} />{r.author.name}{r.department && `, ${r.department}`}. Period: {r.periodLabel}.{r.dueDate && ` Due ${fmtDue(r.dueDate)}.`}</p>
        </div>
        <div className="head-actions no-print">
          <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>
          {r.canArchive && <button className="btn" onClick={() => run(() => api.post(`/workreports/${id}/archive`), 'Archived.')}>Archive</button>}
          {r.canDelete && <button className="btn btn-danger" onClick={remove}>Delete draft</button>}
        </div>
      </header>

      <section className="card track">
        <ReportPill status={r.status} />
        {r.submittedAt && (r.late ? <Tag tone="warn">Submitted late</Tag> : <Tag tone="good">Submitted on time</Tag>)}
        <ol className="steps">
          <li className={r.firstSubmittedAt ? 'done' : 'now'}>Written</li>
          {levels.map((n) => <li key={n} className={r.status === 'approved' || r.status === 'archived' || approvedSteps >= n ? 'done' : open && r.step === n ? 'now' : ''}>{r.approvalLevels > 1 ? `Approval ${n}` : 'Approval'}{open && r.step === n && <small> with {r.reviewer?.name || 'an admin'}</small>}</li>)}
          <li className={['approved', 'archived'].includes(r.status) ? 'done' : r.status === 'rejected' ? 'bad' : ''}>{r.status === 'rejected' ? 'Rejected' : 'Approved'}</li>
        </ol>
      </section>

      {lastReturn && <div className="review warn"><b>Returned by {lastReturn.by?.name}</b><p>{lastReturn.comment}</p>{r.editable && <small>Fix it below, then submit again.</small>}</div>}
      <ErrorNote error={error} />{note && <p className="ok no-print" role="status">{note}</p>}

      <section className="card">
        {r.editable ? r.fields.map((f) => (
          <label className="field" key={f.id}><span>{f.label}{f.required && <em className="req"> required</em>}</span>
            {f.type === 'longtext' ? <textarea rows={4} value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} />
              : f.type === 'select' ? <select value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)}><option value="">Choose</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
              : f.type === 'checkbox' ? <span className="check"><input type="checkbox" checked={!!values[f.id]} onChange={(e) => set(f.id, e.target.checked)} />Yes</span>
              : <input className={f.type === 'text' ? '' : 'short'} type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'} step="any" value={values[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} />}
            {f.help && <small>{f.help}</small>}
          </label>
        )) : <dl className="answers">{r.fields.map((f) => <div key={f.id}><dt>{f.label}</dt><dd>{show(f, r.values?.[f.id])}</dd></div>)}</dl>}
        {r.editable && <div className="actions no-print"><button className="btn" disabled={busy} onClick={save}>Save draft</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{r.status === 'returned' ? 'Submit again' : 'Submit for approval'}</button></div>}
      </section>

      {r.activity && r.activity.tasks && (
        <section className="card">
          <div className="card-head"><h2>Activities in this period</h2><span className="muted">{r.editable ? 'Pulled live from your tasks. A copy is frozen when you submit.' : 'From the author\'s tasks, as they stood at submission'}</span></div>
          {r.activity.total === 0 ? <p className="muted">No tasks were active in this period.</p> : <>
            <StatusStrip byStatus={r.activity.byStatus} height={18} /><StatusLegend byStatus={r.activity.byStatus} />
            <div className="table-wrap"><table className="table tight"><thead><tr><th className="wide">Activity</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead>
              <tbody>{r.activity.tasks.map((t, i) => <tr key={i}><td className="wide">{t.title}</td><td><StatusPill status={t.status} /></td><td><ProgressBar value={t.progress} /></td><td className="nowrap">{t.dueDate ? fmtDate(t.dueDate) : ''}</td></tr>)}</tbody></table></div>
          </>}
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Supporting files</h2>{r.editable && <><input ref={fileRef} type="file" multiple hidden onChange={addFiles} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp" /><button className="btn no-print" disabled={busy} onClick={() => fileRef.current.click()}>Attach files</button></>}</div>
        {r.attachments.length === 0 ? <p className="muted">{r.editable ? 'PDF, Word, Excel, PowerPoint, CSV, text or images, up to 4 MB each.' : 'No files attached.'}</p> : (
          <ul className="rows">{r.attachments.map((a) => <li key={a.id}><div><b>{a.name}</b><small>{fmtSize(a.size)}</small></div><span className="actions no-print"><button className="btn" onClick={() => api.saveFile(`/workreports/${id}/attachments/${a.id}`, a.name).catch((e) => setError(e.message))}>Download</button>{r.editable && <button className="btn btn-quiet" onClick={() => run(() => api.del(`/workreports/${id}/attachments/${a.id}`))}>Remove</button>}</span></li>)}</ul>)}
      </section>

      {r.canReview && (
        <section className="card decide no-print">
          <h2>Your decision</h2>
          <label className="field"><span>Comment</span><textarea rows={3} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Required when returning or rejecting" /></label>
          <div className="actions left"><button className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>Approve</button><button className="btn" disabled={busy || !decision.trim()} onClick={() => decide('return')}>Return for changes</button><button className="btn btn-danger" disabled={busy || !decision.trim()} onClick={() => window.confirm('Reject this report for good? Use "Return for changes" if it can be fixed.') && decide('reject')}>Reject</button></div>
        </section>
      )}

      <div className="grid g-1-1">
        <section className="card">
          <h2>Approval history</h2>
          <ol className="timeline">{r.history.map((h, i) => <li key={i} className={h.action}><b>{HISTORY[h.action] || h.action}{h.step > 0 && r.approvalLevels > 1 && ['approved', 'returned', 'rejected'].includes(h.action) ? ` (level ${h.step})` : ''}</b><small>{h.by?.name}, {fmtDateTime(h.at)}</small>{h.comment && <p>{h.comment}</p>}</li>)}</ol>
        </section>
        <section className="card no-print">
          <h2>Comments</h2>
          {r.comments.length === 0 && <p className="muted small">No comments yet.</p>}
          <ul className="feed">{r.comments.map((c, i) => <li key={i}><Avatar user={c.author} size={24} /><div><b>{c.author?.name}</b><small>{fmtDateTime(c.at)}</small><p>{c.text}</p></div></li>)}</ul>
          {r.status !== 'draft' && <form className="comment-form" onSubmit={(e) => { e.preventDefault(); run(async () => { if (dirty && r.editable) await api.patch('/workreports/' + id, { values: clean() }); const d = await api.post(`/workreports/${id}/comments`, { text: comment }); setComment(''); return d; }); }}><input placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" /><button className="btn" disabled={!comment.trim() || busy}>Post</button></form>}
        </section>
      </div>
    </div>
  );
}
