import React, { useState } from 'react';

const DeptSelect = ({ value, onChange, departments }) => (
  <select value={value || ''} onChange={onChange}><option value="">No department</option>{departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}{value && !departments.some((d) => d.name === value) && <option value={value}>{value} (not in the list)</option>}</select>
);
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ROLES, fmtDate, fmtDateTime, titlesFor } from '../meta.js';
import { Avatar, Empty, ErrorNote, Field, Loading, Modal, PasswordInput, PickList, Tag, TempPassword, useLoad } from '../ui.jsx';

const RANK = { member: 1, team_leader: 2, director: 3, ceo: 4, admin: 4 };
const managersFor = (users, role, selfId) => users.filter((u) => u.status === 'active' && u.id !== selfId && RANK[u.role] > RANK[role]);

function RoleAndManager({ f, setF, users, selfId }) {
  const options = managersFor(users, f.role, selfId);
  return (
    <div className="row2">
      <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, managerId: '' })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Reports to" hint={options.length ? '' : 'Nobody sits above this role.'}><select value={f.managerId || ''} onChange={(e) => setF({ ...f, managerId: e.target.value })} disabled={!options.length}><option value="">Nobody</option>{options.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLES[u.role]})</option>)}</select></Field>
    </div>
  );
}

export default function AdminUsers() {
  const { user: me, settings } = useAuth(); const titles = settings.jobTitles;
  const { data, error, loading, reload } = useLoad(() => api.get('/users'), []);
  const depts = useLoad(() => api.get('/departments'), []); const departments = depts.data?.departments || [];
  const [modal, setModal] = useState(null); const [temp, setTemp] = useState(null); const [q, setQ] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const users = data.users; const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const pending = users.filter((u) => u.status === 'pending');
  const rest = users.filter((u) => u.status !== 'pending' && (u.name + u.username + u.email + u.department).toLowerCase().includes(q.toLowerCase()));
  const link = window.location.origin + '/register';
  const reset = async (u) => {
    if (!window.confirm(`Reset the password for ${u.name}? They will be signed out everywhere.`)) return;
    try { const r = await api.post(`/users/${u.id}/reset-password`); setTemp({ name: u.name, password: r.temporaryPassword }); } catch (e) { setErr(e.message); }
  };
  const reject = async (u) => { if (!window.confirm(`Reject and delete the request from ${u.name}?`)) return; try { await api.post(`/users/${u.id}/reject`); reload(); } catch (e) { setErr(e.message); } };
  const done = (t) => { setModal(null); if (t) setTemp(t); reload(); };
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>People and access</h1><p className="muted">Create accounts, approve requests, place people in the structure and reset passwords.</p></div>
        <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>Add person</button>
      </header>
      <ErrorNote error={err} />
      <section className="card invite">
        <div><h2>Sign-up link</h2><p className="muted">Anyone with this link can request an account. Nobody gets in until you approve them here.</p></div>
        <div className="secret"><code>{link}</code><button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Waiting for approval</h2>{pending.length > 0 && <Tag tone="warn">{pending.length} waiting</Tag>}</div>
        {pending.length === 0 ? <Empty title="No requests waiting">New sign-up requests show up here.</Empty> : (
          <ul className="rows">{pending.map((u) => (
            <li key={u.id}>
              <div><b>{u.name}</b><small>@{u.username}, {u.email}{u.title && `, ${u.title}`}{u.department && `, ${u.department}`}{u.requestedRole && `, asked for ${ROLES[u.requestedRole].toLowerCase()}`}. Requested {fmtDate(u.createdAt)}</small></div>
              <span className="actions"><button className="btn btn-quiet" onClick={() => reject(u)}>Reject</button><button className="btn btn-primary" onClick={() => setModal({ type: 'approve', user: u })}>Approve</button></span>
            </li>))}</ul>)}
      </section>
      <section className="card flush">
        <div className="card-head pad"><h2>Accounts</h2><input type="search" placeholder="Search name, username, email or department" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" /></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Reports to</th><th>Department</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>{rest.map((u) => (
            <tr key={u.id} className={u.status === 'disabled' ? 'dim' : ''}>
              <td><span className="person with-avatar"><Avatar user={u} size={30} /><span><b>{u.name}</b><small>@{u.username} · {u.email}</small></span></span></td>
              <td>{ROLES[u.role]}</td>
              <td>{byId[u.managerId]?.name || <span className="muted">nobody</span>}</td>
              <td>{u.department || <span className="muted">none</span>}</td>
              <td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="muted">never</span>}</td>
              <td>{u.status === 'active' ? <Tag tone="good">Active</Tag> : <Tag tone="bad">Disabled</Tag>}</td>
              <td className="row-actions"><button className="btn btn-quiet" onClick={() => setModal({ type: 'edit', user: u })}>Edit</button>{u.id !== me.id && <><button className="btn btn-quiet" onClick={() => reset(u)}>Reset password</button><button className="btn btn-quiet danger" onClick={() => setModal({ type: 'delete', user: u })}>Delete</button></>}</td>
            </tr>))}
          </tbody>
        </table></div>
      </section>
      {modal?.type === 'new' && <NewUser users={users} departments={departments} titles={titles} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'approve' && <Approve user={modal.user} users={users} departments={departments} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'edit' && <EditUser user={modal.user} users={users} departments={departments} titles={titles} isSelf={modal.user.id === me.id} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'delete' && <DeleteUser user={modal.user} onClose={() => setModal(null)} onDone={done} />}
      {temp && <TempPassword info={temp} onClose={() => setTemp(null)} />}
    </div>
  );
}

function NewUser({ users, departments, titles, onClose, onDone }) {
  const [f, setF] = useState({ name: '', username: '', email: '', role: 'member', managerId: '', department: '', title: '', mode: 'set', password: '', confirm: '', mustChangePassword: true }); const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = { name: f.name, username: f.username, email: f.email, role: f.role, managerId: f.managerId || null, department: f.department, title: f.title };
    if (f.mode === 'set') {
      if (f.password.length < 8) return setError('Password must be at least 8 characters.');
      if (f.password !== f.confirm) return setError('The two passwords do not match.');
      body.password = f.password; body.mustChangePassword = f.mustChangePassword;
    }
    try { const r = await api.post('/users', body); onDone(r.temporaryPassword ? { name: r.user.name, password: r.temporaryPassword } : null); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="Add person" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Full name"><input required autoFocus value={f.name} onChange={set('name')} /></Field>
        <div className="row2">
          <Field label="Username" hint="They sign in with this. Leave empty to use the start of the email."><input autoCapitalize="none" spellCheck={false} value={f.username} onChange={set('username')} /></Field>
          <Field label="Email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        </div>
        <RoleAndManager f={f} setF={setF} users={users} />
        <div className="row2"><Field label="Department"><DeptSelect value={f.department} onChange={set('department')} departments={departments} /></Field><Field label="Job title"><PickList key={f.department} value={f.title} onChange={set('title')} options={titlesFor(departments, f.department, titles)} empty="No job title" /></Field></div>
        <div className="field"><span>Password</span>
          <div className="seg-control" role="tablist">
            <button type="button" role="tab" aria-selected={f.mode === 'set'} className={f.mode === 'set' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'set' })}>Set it myself</button>
            <button type="button" role="tab" aria-selected={f.mode === 'auto'} className={f.mode === 'auto' ? 'on' : ''} onClick={() => setF({ ...f, mode: 'auto' })}>Generate one for me</button>
          </div>
        </div>
        {f.mode === 'set' ? <>
          <div className="row2">
            <Field label="Password" hint="At least 8 characters"><PasswordInput autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
            <Field label="Confirm password" hint={f.confirm && f.confirm !== f.password ? 'Does not match yet' : ''}><PasswordInput autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></Field>
          </div>
          <label className="check block"><input type="checkbox" checked={f.mustChangePassword} onChange={(e) => setF({ ...f, mustChangePassword: e.target.checked })} />Make them choose their own password at first sign-in</label>
        </> : <p className="muted small">A random temporary password is shown to you once after the account is created. They choose their own at first sign-in.</p>}
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Create account</button></div>
      </form>
    </Modal>
  );
}

function Approve({ user, users, departments, onClose, onDone }) {
  const [f, setF] = useState({ role: user.requestedRole || 'member', managerId: '', department: user.department }); const [error, setError] = useState('');
  const submit = async (e) => { e.preventDefault(); try { await api.post(`/users/${user.id}/approve`, { ...f, managerId: f.managerId || null }); onDone(); } catch (err) { setError(err.message); } };
  return (
    <Modal title={'Approve ' + user.name} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">@{user.username}, {user.email}{user.requestedRole && `. They asked to join as ${ROLES[user.requestedRole].toLowerCase()}`}. Pick where they sit in the structure. They sign in with the password they chose.</p>
        <RoleAndManager f={f} setF={setF} users={users} selfId={user.id} />
        <Field label="Department"><DeptSelect value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} departments={departments} /></Field>
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Approve account</button></div>
      </form>
    </Modal>
  );
}

function EditUser({ user, users, departments, titles, isSelf, onClose, onDone }) {
  const [f, setF] = useState({ name: user.name, username: user.username || '', email: user.email, role: user.role, managerId: user.managerId || '', department: user.department, title: user.title, status: user.status }); const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => { e.preventDefault(); try { await api.patch('/users/' + user.id, { ...f, managerId: f.managerId || null }); onDone(); } catch (err) { setError(err.message); } };
  return (
    <Modal title={'Edit ' + user.name} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Full name"><input required value={f.name} onChange={set('name')} /></Field>
        <div className="row2">
          <Field label="Username" hint="Changing it signs them out."><input required autoCapitalize="none" spellCheck={false} value={f.username} onChange={set('username')} /></Field>
          <Field label="Email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        </div>
        <RoleAndManager f={f} setF={setF} users={users} selfId={user.id} />
        <div className="row2"><Field label="Department"><DeptSelect value={f.department} onChange={set('department')} departments={departments} /></Field><Field label="Job title"><PickList key={f.department} value={f.title} onChange={set('title')} options={titlesFor(departments, f.department, titles)} empty="No job title" /></Field></div>
        {!isSelf && <Field label="Account" hint="A disabled account cannot sign in. Its tasks and history stay."><select value={f.status} onChange={set('status')}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field>}
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save changes</button></div>
      </form>
    </Modal>
  );
}

/** Permanent removal. Shows exactly what goes with the account and asks for the username before deleting. */
function DeleteUser({ user, onClose, onDone }) {
  const [info, setInfo] = useState(null); const [error, setError] = useState(''); const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false);
  React.useEffect(() => { api.get(`/users/${user.id}/delete-check`).then(setInfo).catch((e) => setError(e.message)); }, [user.id]);
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const ok = info && typed.trim().toLowerCase() === (info.username || '').toLowerCase();
  const submit = async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); setError(''); try { await api.del('/users/' + user.id, { confirm: typed }); onDone(); } catch (err) { setError(err.message); setBusy(false); } };
  return (
    <Modal title={'Delete ' + user.name} onClose={onClose}>
      {!info ? (error ? <><ErrorNote error={error} /><div className="actions"><button className="btn" onClick={onClose}>Close</button></div></> : <Loading />) : (
        <form onSubmit={submit}>
          <p>This permanently deletes <b>{info.name}</b> (@{info.username}). It cannot be undone.</p>
          <ul className="delete-list">
            <li>{n(info.kpis, 'KPI', 'KPIs')} they own{info.tasks ? `, ${n(info.tasks, 'task', 'tasks')}` : ''}{info.plans ? `, ${n(info.plans, 'weekly plan', 'weekly plans')}` : ''}{info.reports ? `, ${n(info.reports, 'report', 'reports')}` : ''} and their notifications are deleted.</li>
            {info.directReports.length > 0 && <li>{n(info.directReports.length, 'person reports', 'people report')} to them ({info.directReports.slice(0, 4).join(', ')}{info.directReports.length > 4 ? '…' : ''}). They will report to <b>{info.newManager || 'nobody (top of the structure)'}</b> instead.</li>}
            <li>KPIs they set for other people stay with those people. The activity log keeps a record of the deletion.</li>
          </ul>
          <p className="muted small">If you only want to stop them signing in and keep their history, use Edit and set the account to Disabled instead.</p>
          <Field label={`Type ${info.username} to confirm`}><input autoFocus autoCapitalize="none" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-danger-solid" disabled={!ok || busy}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div>
        </form>)}
    </Modal>
  );
}
