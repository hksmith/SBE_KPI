import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { COPYRIGHT, SIGNUP_ROLES } from '../meta.js';
import { ErrorNote, Field, PasswordInput, PickList } from '../ui.jsx';

const EMPTY = { orgName: '', logo: '', jobTitles: [], departments: [], roles: ['member', 'team_leader', 'director'] };
function useOptions() {
  const [o, setO] = useState(EMPTY);
  useEffect(() => { api.get('/auth/options').then(setO).catch(() => {}); }, []);
  return o;
}

const Frame = ({ title, lead, options, children }) => (
  <div className="auth">
    <section className="auth-art" aria-hidden="true">
      <div className="brand">{options?.logo ? <img className="brand-logo" src={options.logo} alt="" /> : <span className="brand-mark"><i /><i /><i /></span>}{options?.orgName || 'WorkTrack'}</div>
      <p className="auth-line">Every KPI and target, from each desk up to the top.</p>
      <div className="auth-bars">{[92, 74, 58, 81, 40, 66].map((w, i) => <span key={i} style={{ width: w + '%' }} />)}</div>
    </section>
    <section className="auth-form"><h1>{title}</h1><p className="muted">{lead}</p>{children}<p className="copyright">{COPYRIGHT}</p></section>
  </div>
);

export function Login() {
  const { signIn } = useAuth(); const options = useOptions();
  const [f, setF] = useState({ username: '', password: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError(''); try { signIn(await api.post('/auth/login', f)); } catch (err) { setError(err.message); } setBusy(false); };
  return (
    <Frame title="Sign in" lead="Use the username and password your admin set up for you." options={options}>
      <form onSubmit={submit}>
        <Field label="Username"><input autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Password"><PasswordInput autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="muted small">No account yet? <Link to="/register">Request one</Link>. Forgot your password? Ask your director or admin to reset it.</p>
    </Frame>
  );
}

export function Register() {
  const options = useOptions();
  const [f, setF] = useState({ name: '', username: '', email: '', password: '', confirm: '', department: '', title: '', requestedRole: 'member' });
  const [error, setError] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dept = options.departments.find((d) => d.name === f.department);
  const titles = dept && dept.jobTitles.length ? dept.jobTitles : options.jobTitles; // titles listed under the chosen department
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (f.password.length < 8) return setError('Password must be at least 8 characters.');
    if (f.password !== f.confirm) return setError('The two passwords do not match.');
    setBusy(true); try { await api.post('/auth/register', f); setDone(true); } catch (err) { setError(err.message); } setBusy(false);
  };
  if (done) return <Frame options={options} title="Request sent" lead="An admin needs to approve your account before you can sign in. You will sign in with the username and password you just chose."><Link className="btn btn-primary" to="/login">Back to sign in</Link></Frame>;
  return (
    <Frame title="Request an account" lead="Fill this in and an admin will approve it and place you in the right team." options={options}>
      <form onSubmit={submit}>
        <Field label="Full name"><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Username" hint="What you sign in with. 3 to 30 letters, numbers, dot, dash or underscore."><input required autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" value={f.username} onChange={set('username')} /></Field>
        <Field label="Work email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        <div className="row2">
          <Field label="Department"><PickList value={f.department} onChange={(e) => setF({ ...f, department: e.target.value, title: '' })} options={options.departments.map((d) => d.name)} empty="Choose your department" required /></Field>
          <Field label="Job title">{options.departments.length && !f.department ? <select disabled><option>Choose a department first</option></select> : <PickList key={f.department} value={f.title} onChange={set('title')} options={titles} empty="Choose your job title" required />}</Field>
        </div>
        <Field label="Role" hint="The admin confirms this when approving you."><select value={f.requestedRole} onChange={set('requestedRole')}>{options.roles.map((r) => <option key={r} value={r}>{SIGNUP_ROLES[r] || r}</option>)}</select></Field>
        <div className="row2">
          <Field label="Password" hint="At least 8 characters"><PasswordInput autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
          <Field label="Confirm password" hint={f.confirm && f.confirm !== f.password ? 'Does not match yet' : ''}><PasswordInput autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></Field>
        </div>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Request account'}</button>
      </form>
      <p className="muted small">Already approved? <Link to="/login">Sign in</Link></p>
    </Frame>
  );
}

export function ChangePasswordForm({ onDone }) {
  const { signIn } = useAuth();
  const blank = { currentPassword: '', newPassword: '', confirm: '' };
  const [f, setF] = useState(blank); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (f.newPassword !== f.confirm) return setError('The two new passwords do not match.');
    setBusy(true); try { signIn(await api.post('/auth/change-password', f)); setF(blank); onDone?.(); } catch (err) { setError(err.message); } setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      <Field label="Current password"><PasswordInput autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
      <Field label="New password" hint="At least 8 characters"><PasswordInput autoComplete="new-password" required minLength={8} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
      <Field label="Confirm new password" hint={f.confirm && f.confirm !== f.newPassword ? 'Does not match yet' : ''}><PasswordInput autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      <ErrorNote error={error} />
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function ForceChangePassword() {
  const { signOut } = useAuth(); const options = useOptions();
  return (
    <Frame title="Choose a new password" lead="You signed in with a temporary password. Set your own to continue." options={options}>
      <ChangePasswordForm />
      <p className="muted small"><button className="link" onClick={signOut}>Sign out</button></p>
    </Frame>
  );
}
