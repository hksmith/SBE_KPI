import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { AVATAR_COLORS, ROLES, fmtDate, resizeImage, titlesFor } from '../meta.js';
import { Avatar, ErrorNote, Field, PickList, useLoad } from '../ui.jsx';
import { ChangePasswordForm } from './Auth.jsx';

export default function Profile() {
  const { user, setUser, settings } = useAuth(); const photoRef = useRef(null);
  const depts = useLoad(() => api.get('/departments'), []);
  const savePhoto = async (avatarUrl) => { setError(''); try { setUser((await api.patch('/users/me', { avatarUrl })).user); } catch (err) { setError(err.message); } };
  const pickPhoto = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; try { await savePhoto(await resizeImage(file, { max: 200, square: true })); } catch (err) { setError(err.message); } };
  const [f, setF] = useState({ name: user.name, title: user.title, phone: user.phone, bio: user.bio, avatarColor: user.avatarColor });
  const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [pwDone, setPwDone] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  const submit = async (e) => { e.preventDefault(); setError(''); try { setUser((await api.patch('/users/me', f)).user); setSaved(true); } catch (err) { setError(err.message); } };
  return (
    <div className="page narrow">
      <header className="page-head"><div className="with-avatar"><Avatar user={{ ...user, ...f }} size={56} /><div><h1>{user.name}</h1><p className="muted">{ROLES[user.role]}, @{user.username} · {user.email}. Joined {fmtDate(user.createdAt)}</p></div></div></header>
      <section className="card">
        <h2>Profile</h2>
        <div className="logo-row">
          <Avatar user={user} size={84} />
          <div><b>Profile picture</b><p className="muted small">A photo of you. It is cropped to a square and shown next to your name everywhere.</p>
            <input ref={photoRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={pickPhoto} />
            <div className="actions left"><button type="button" className="btn" onClick={() => photoRef.current.click()}>{user.avatarUrl ? 'Change picture' : 'Upload picture'}</button>{user.avatarUrl && <button type="button" className="btn btn-quiet" onClick={() => savePhoto('')}>Remove</button>}</div></div>
        </div>
        <form onSubmit={submit}>
          <Field label="Full name"><input required value={f.name} onChange={set('name')} /></Field>
          <div className="row2"><Field label="Job title"><PickList value={f.title} onChange={set('title')} options={titlesFor(depts.data?.departments, user.department, settings.jobTitles)} empty="No job title" /></Field><Field label="Department"><input value={user.department || 'Not set'} disabled /></Field></div>
          <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="About"><textarea rows={3} value={f.bio} onChange={set('bio')} maxLength={500} /></Field>
          <div className="field"><span>Colour used when there is no picture</span><div className="swatches">{AVATAR_COLORS.map((c) => <button type="button" key={c} style={{ background: c }} className={f.avatarColor === c ? 'on' : ''} onClick={() => { setF({ ...f, avatarColor: c }); setSaved(false); }} aria-label={'Colour ' + c} aria-pressed={f.avatarColor === c} />)}</div></div>
          <p className="muted small">Your role, username, email, department and who you report to are set by an admin.</p>
          <ErrorNote error={error} />{saved && <p className="ok" role="status">Changes saved.</p>}
          <div className="actions"><button className="btn btn-primary">Save changes</button></div>
        </form>
      </section>
      <section className="card"><h2>Password</h2>{pwDone && <p className="ok" role="status">Password changed. Other devices were signed out.</p>}<ChangePasswordForm onDone={() => setPwDone(true)} /></section>
    </div>
  );
}
