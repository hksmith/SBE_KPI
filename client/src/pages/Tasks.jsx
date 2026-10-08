import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { PRIORITIES, STATUSES, cap, fmtDate, fmtDateTime, fmtShort, isManager } from '../meta.js';
import { Avatar, Empty, ErrorNote, Field, Loading, Modal, ProgressBar, StatusPill, Tag, useLoad } from '../ui.jsx';

export default function Tasks() {
  const { user } = useAuth();
  const manager = isManager(user);
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState('mine');
  const [f, setF] = useState({ status: '', priority: '', q: '', overdue: '' });
  const [editing, setEditing] = useState(null); // 'new' | task id
  const { data, error, loading, reload } = useLoad(() => api.get('/tasks' + qs({ scope, ...f })), [scope, f.status, f.priority, f.q, f.overdue]);
  const people = useLoad(() => (manager ? api.get('/users/tree') : Promise.resolve({ users: [] })), [manager]);
  useEffect(() => { if (params.get('open')) setEditing(params.get('open')); }, [params]);
  const close = (changed) => { setEditing(null); if (params.get('open')) setParams({}); if (changed) reload(); };
  const quick = async (t, body) => { try { await api.patch('/tasks/' + t.id, body); reload(); } catch (e) { alertError(e); } };
  const [toast, setToast] = useState('');
  const alertError = (e) => { setToast(e.message); setTimeout(() => setToast(''), 4000); };
  const tasks = data?.tasks || [];

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Tasks</h1><p className="muted">Add what you are working on and keep its status and progress current.</p></div>
        <div className="head-actions">
          <button className="btn" onClick={() => api.download('/tasks/export.csv' + qs({ scope, ...f }), 'tasks.csv').catch(alertError)}>Export CSV</button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>Add task</button>
        </div>
      </header>
      <div className="toolbar">
        {manager && <div className="seg-control" role="tablist">
          {[['mine', 'Mine'], ['team', user.role === 'admin' || user.role === 'ceo' ? 'Everyone else' : 'My teams']].map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}
        </div>}
        <input type="search" placeholder="Search by title" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search tasks" />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, overdue: '' })} aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <label className="check"><input type="checkbox" checked={f.overdue === '1'} onChange={(e) => setF({ ...f, overdue: e.target.checked ? '1' : '', status: '' })} />Overdue only</label>
      </div>
      <ErrorNote error={error || toast} />
      {loading && !data ? <Loading /> : tasks.length === 0 ? (
        <section className="card"><Empty title="No tasks here">{scope === 'mine' ? 'Add your first task to start reporting on it.' : 'Nobody in your teams has tasks matching these filters.'}</Empty></section>
      ) : (
        <section className="card flush"><div className="table-wrap"><table className="table">
          <thead><tr><th className="wide">Task</th>{scope !== 'mine' && <th>Owner</th>}<th>Status</th><th>Progress</th><th>Priority</th><th>Due</th></tr></thead>
          <tbody>{tasks.map((t) => (
            <tr key={t.id}>
              <td className="wide"><button className="link strong" onClick={() => setEditing(t.id)}>{t.title}</button></td>
              {scope !== 'mine' && <td><span className="with-avatar"><Avatar user={t.owner} size={24} />{t.owner?.name}</span></td>}
              <td>{t.canEdit ? <select className="status-select" value={t.status} onChange={(e) => quick(t, { status: e.target.value })} aria-label={'Status of ' + t.title}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select> : <StatusPill status={t.status} />}</td>
              <td>{t.canEdit ? <span className="pct-inline"><input type="number" min="0" max="100" defaultValue={t.progress} key={t.id + ':' + t.progress} onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (n !== t.progress && n >= 0 && n <= 100) quick(t, { progress: n }); else e.target.value = t.progress; }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label={'Progress of ' + t.title} /><b>%</b><ProgressBar value={t.progress} label={false} color={t.status === 'done' ? 'var(--good)' : undefined} /></span> : <ProgressBar value={t.progress} color={t.status === 'done' ? 'var(--good)' : undefined} />}</td>
              <td><Tag tone={t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : ''}>{cap(t.priority)}</Tag></td>
              <td>{t.dueDate ? <span className={t.overdue ? 'late' : ''}>{fmtShort(t.dueDate)}{t.overdue && ' (late)'}</span> : <span className="muted">none</span>}</td>
            </tr>))}
          </tbody>
        </table></div></section>
      )}
      {editing === 'new' && <TaskForm people={people.data?.users || []} onClose={close} />}
      {editing && editing !== 'new' && <TaskDetail id={editing} people={people.data?.users || []} onClose={close} />}
    </div>
  );
}

function TaskForm({ people, onClose }) {
  const { user } = useAuth();
  const canAssign = user.role !== 'ceo' && people.length > 1;
  const [f, setF] = useState({ title: '', description: '', ownerId: user.id, priority: 'medium', dueDate: '', status: 'not_started', progress: 0 });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => { e.preventDefault(); setBusy(true); try { await api.post('/tasks', f); onClose(true); } catch (err) { setError(err.message); setBusy(false); } };
  return (
    <Modal title="Add task" onClose={() => onClose(false)}>
      <form onSubmit={submit}>
        <Field label="Title"><input required autoFocus value={f.title} onChange={set('title')} maxLength={200} /></Field>
        <Field label="Details"><textarea rows={3} value={f.description} onChange={set('description')} /></Field>
        {canAssign && <Field label="Who is doing it"><select value={f.ownerId} onChange={set('ownerId')}><option value={user.id}>Me</option>{people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
        <div className="row2">
          <Field label="Priority"><select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
          <Field label="Due date"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        </div>
        <div className="row2">
          <Field label="Status"><select value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          <Field label={`Progress: ${f.status === 'done' ? 100 : f.progress}%`}><input type="range" min="0" max="100" step="5" value={f.status === 'done' ? 100 : f.progress} disabled={f.status === 'done'} onChange={set('progress')} /></Field>
        </div>
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>Add task</button></div>
      </form>
    </Modal>
  );
}

function TaskDetail({ id, people, onClose }) {
  const { user } = useAuth();
  const [task, setTask] = useState(null); const [f, setF] = useState(null);
  const [error, setError] = useState(''); const [comment, setComment] = useState(''); const [changed, setChanged] = useState(false);
  const adopt = (t) => { setTask(t); setF({ title: t.title, description: t.description, priority: t.priority, dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '', status: t.status, progress: t.progress, note: '', ownerId: t.owner.id || t.owner._id }); };
  useEffect(() => { api.get('/tasks/' + id).then((d) => adopt(d.task)).catch((e) => setError(e.message)); }, [id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setError(''); try { const body = { ...f, dueDate: f.dueDate || null }; if (body.ownerId === (task.owner._id)) delete body.ownerId; adopt((await api.patch('/tasks/' + id, body)).task); setChanged(true); } catch (err) { setError(err.message); } };
  const addComment = async (e) => { e.preventDefault(); try { adopt((await api.post(`/tasks/${id}/comments`, { text: comment })).task); setComment(''); } catch (err) { setError(err.message); } };
  const remove = async () => { if (!window.confirm('Delete this task? This cannot be undone.')) return; try { await api.del('/tasks/' + id); onClose(true); } catch (err) { setError(err.message); } };
  const canReassign = task?.canEdit && String(task.owner._id) !== user.id && people.length > 1;
  return (
    <Modal title={task ? task.title : 'Task'} onClose={() => onClose(changed)} wide>
      {!task ? (error ? <ErrorNote error={error} /> : <Loading />) : (
        <div className="detail">
          <form onSubmit={save}>
            <p className="muted small with-avatar"><Avatar user={task.owner} size={22} />{task.owner.name}, added by {task.createdBy?.name} on {fmtDate(task.createdAt)}{task.overdue && <Tag tone="bad">Overdue</Tag>}</p>
            <fieldset disabled={!task.canEdit}>
              <Field label="Title"><input required value={f.title} onChange={set('title')} /></Field>
              <Field label="Details"><textarea rows={3} value={f.description} onChange={set('description')} /></Field>
              <div className="row2">
                <Field label="Status"><select value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
                <Field label={`Progress: ${f.status === 'done' ? 100 : f.progress}%`}><input type="range" min="0" max="100" step="5" value={f.status === 'done' ? 100 : f.progress} disabled={f.status === 'done'} onChange={set('progress')} /></Field>
              </div>
              <div className="row2">
                <Field label="Priority"><select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
                <Field label="Due date"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
              </div>
              {canReassign && <Field label="Assigned to"><select value={f.ownerId} onChange={set('ownerId')}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
              <Field label="Note about this update" hint="Optional. Saved in the history below."><input value={f.note} onChange={set('note')} maxLength={300} /></Field>
            </fieldset>
            <ErrorNote error={error} />
            {task.canEdit ? <div className="actions">{task.canDelete && <button type="button" className="btn btn-danger" onClick={remove}>Delete task</button>}<button className="btn btn-primary">Save changes</button></div> : <p className="muted small">You can view and comment on this task but not change it.</p>}
          </form>
          <aside>
            <h3>Comments</h3>
            {task.comments.length === 0 && <p className="muted small">No comments yet.</p>}
            <ul className="feed">{task.comments.map((c, i) => <li key={i}><Avatar user={c.author} size={24} /><div><b>{c.author?.name}</b><small>{fmtDateTime(c.at)}</small><p>{c.text}</p></div></li>)}</ul>
            <form className="comment-form" onSubmit={addComment}><input placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" /><button className="btn" disabled={!comment.trim()}>Post</button></form>
            <h3>History</h3>
            <ul className="history">{[...task.history].reverse().slice(0, 12).map((h, i) => <li key={i}><StatusPill status={h.status} /><span>{h.progress}%</span><small>{h.by?.name}, {fmtDateTime(h.at)}{h.note && `: ${h.note}`}</small></li>)}</ul>
          </aside>
        </div>
      )}
    </Modal>
  );
}
