import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { FIELD_TYPES, PERIODS, ROLES, resizeImage } from '../meta.js';
import { Empty, ErrorNote, Field, Loading, Modal, Tag, useLoad } from '../ui.jsx';

export default function AdminSettings() {
  const { org, setOrg, settings, setSettings } = useAuth();
  const logoRef = useRef(null);
  const patch = async (body) => { setErr(''); try { const d = await api.patch('/settings', body); setSettings({ ...d, loaded: true }); return true; } catch (x) { setErr(x.message); return false; } };
  const pickLogo = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; try { await patch({ logo: await resizeImage(file, { max: 320, type: 'image/png' }) }); } catch (x) { setErr(x.message); } };
  const MODULES = [['tasks', 'Tasks', 'Day-to-day tasks with status, progress, priority and comments.'], ['plans', 'Weekly plans', 'A weekly list each person submits to their manager for review.'], ['reports', 'Formal reports', 'Template-based reports with an approval chain, deadlines, files and the management report.']];
  const [name, setName] = useState(org); const [saved, setSaved] = useState(false); const [err, setErr] = useState(''); const [modal, setModal] = useState(null);
  const depts = useLoad(() => api.get('/departments'), []);
  const tpls = useLoad(() => api.get('/workreports/templates?all=1'), []);
  const people = useLoad(() => api.get('/users'), []);
  const saveOrg = async (e) => { e.preventDefault(); try { setOrg((await api.patch('/settings', { orgName: name })).orgName); setSaved(true); } catch (x) { setErr(x.message); } };
  const delDept = async (d) => { if (!window.confirm(`Delete the ${d.name} department?`)) return; try { await api.del('/departments/' + d.id); depts.reload(); } catch (x) { setErr(x.message); } };
  const toggle = async (t) => { try { await api.patch('/workreports/templates/' + t.id, { active: !t.active }); tpls.reload(); } catch (x) { setErr(x.message); } };
  const delTpl = async (t) => { if (!window.confirm(`Delete the "${t.name}" template?`)) return; try { await api.del('/workreports/templates/' + t.id); tpls.reload(); } catch (x) { setErr(x.message); } };
  if (depts.loading && !depts.data) return <Loading />;
  const D = depts.data?.departments || []; const byId = Object.fromEntries(D.map((d) => [d.id, d])); const users = (people.data?.users || []).filter((u) => u.status === 'active'); const uById = Object.fromEntries(users.map((u) => [u.id, u]));
  return (
    <div className="page">
      <header className="page-head"><div><h1>Settings</h1><p className="muted">Branding, what the app includes, and the lists people pick from.</p></div></header>
      <ErrorNote error={err || depts.error || tpls.error} />
      <section className="card">
        <h2>Organisation</h2>
        <form className="inline-form" onSubmit={saveOrg}><Field label="Name" hint="Shown in the sidebar, on the sign-in page and on printed reports"><input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={80} /></Field><button className="btn btn-primary">Save name</button>{saved && <span className="ok">Saved.</span>}</form>
        <div className="logo-row">
          <div className="logo-box">{settings.logo ? <img src={settings.logo} alt="Current logo" /> : <span className="muted small">No logo</span>}</div>
          <div><b>Logo</b><p className="muted small">PNG, JPG or WebP. Shown in the sidebar and on the sign-in page. A wide or square image on a transparent background works best.</p>
            <input ref={logoRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={pickLogo} />
            <div className="actions left"><button className="btn" onClick={() => logoRef.current.click()}>{settings.logo ? 'Replace logo' : 'Upload logo'}</button>{settings.logo && <button className="btn btn-quiet" onClick={() => patch({ logo: '' })}>Remove</button>}</div></div>
        </div>
      </section>
      <section className="card">
        <h2>What the app includes</h2>
        <p className="muted">KPIs are always on. Switch the others on only if you want them. Switching one off hides it for everyone; nothing is deleted.</p>
        <ul className="rows">{MODULES.map(([k, l, hint]) => <li key={k}><div><b>{l}</b><small>{hint}</small></div><label className="switch"><input type="checkbox" checked={settings.modules[k]} onChange={(e) => patch({ modules: { [k]: e.target.checked } })} aria-label={l} /><span>{settings.modules[k] ? 'On' : 'Off'}</span></label></li>)}</ul>
      </section>
      <section className="card">
        <div className="card-head"><h2>Departments and job titles</h2><button className="btn btn-primary" onClick={() => setModal({ type: 'dept' })}>Add department</button></div>
        <p className="muted">These are the choices on the account request form: a person picks a department, then one of the job titles you listed under it.</p>
        {D.length === 0 ? <Empty title="No departments yet">Add departments here. They become the choices on the account request form and under People and access.</Empty> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Department</th><th className="wide">Job titles</th><th>Sits under</th><th>Head</th><th>People</th><th></th></tr></thead>
            <tbody>{D.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td className="wide">{d.jobTitles.length ? <span className="title-list">{d.jobTitles.map((t) => <Tag key={t}>{t}</Tag>)}</span> : <button className="link" onClick={() => setModal({ type: 'dept', dept: d })}>Add job titles</button>}</td><td>{byId[d.parent]?.name || <span className="muted">top level</span>}</td><td>{uById[d.head]?.name || <span className="muted">not set</span>}</td><td>{d.people}</td>
              <td className="row-actions"><button className="btn btn-quiet" onClick={() => setModal({ type: 'dept', dept: d })}>Edit</button><button className="btn btn-quiet" onClick={() => delDept(d)}>Delete</button></td></tr>)}</tbody></table></div>)}
      </section>
      {settings.modules.reports && (
      <section className="card">
        <div className="card-head"><h2>Report templates</h2><button className="btn btn-primary" onClick={() => setModal({ type: 'tpl' })}>New template</button></div>
        {(tpls.data?.templates || []).length === 0 ? <Empty title="No templates yet">A template defines the fields, the schedule and who approves.</Empty> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Template</th><th>Schedule</th><th>Deadline</th><th>Approvals</th><th>Who must file</th><th>Status</th><th></th></tr></thead>
            <tbody>{tpls.data.templates.map((t) => <tr key={t.id} className={t.active ? '' : 'dim'}>
              <td><span className="person"><b>{t.name}</b><small>{t.fields.length} fields{t.includeTasks && ', pulls in tasks'}</small></span></td><td>{PERIODS[t.periodType]}</td>
              <td>{t.periodType === 'adhoc' ? <span className="muted">none</span> : t.dueDays === 0 ? 'Last day of the period' : `${t.dueDays} day${t.dueDays > 1 ? 's' : ''} after it ends`}</td><td>{t.approvalLevels} level{t.approvalLevels > 1 ? 's' : ''}</td>
              <td>{t.requiredRoles.length ? t.requiredRoles.map((r) => ROLES[r] + 's').join(', ') : <span className="muted">optional for everyone</span>}{t.departments.length > 0 && <small> in {t.departments.join(', ')}</small>}</td>
              <td>{t.active ? <Tag tone="good">In use</Tag> : <Tag>Turned off</Tag>}</td>
              <td className="row-actions"><button className="btn btn-quiet" onClick={() => setModal({ type: 'tpl', tpl: t })}>Edit</button><button className="btn btn-quiet" onClick={() => toggle(t)}>{t.active ? 'Turn off' : 'Turn on'}</button><button className="btn btn-quiet" onClick={() => delTpl(t)}>Delete</button></td></tr>)}</tbody></table></div>)}
      </section>
      )}
      {modal?.type === 'dept' && <DeptForm dept={modal.dept} departments={D} users={users} onClose={() => setModal(null)} onDone={() => { setModal(null); depts.reload(); }} />}
      {modal?.type === 'tpl' && <TemplateForm tpl={modal.tpl} departments={D} onClose={() => setModal(null)} onDone={() => { setModal(null); tpls.reload(); }} />}
    </div>
  );
}

function DeptForm({ dept, departments, users, onClose, onDone }) {
  const [f, setF] = useState({ name: dept?.name || '', parent: dept?.parent || '', head: dept?.head || '', jobTitles: dept?.jobTitles || [] }); const [error, setError] = useState(''); const [title, setTitle] = useState('');
  const addTitle = () => { const t = title.trim(); if (t && !f.jobTitles.some((x) => x.toLowerCase() === t.toLowerCase())) setF({ ...f, jobTitles: [...f.jobTitles, t] }); setTitle(''); };
  const submit = async (e) => {
    e.preventDefault();
    const jobTitles = title.trim() && !f.jobTitles.includes(title.trim()) ? [...f.jobTitles, title.trim()] : f.jobTitles; // include one typed but not yet added
    try { const body = { name: f.name, parent: f.parent || null, head: f.head || null, jobTitles }; dept ? await api.patch('/departments/' + dept.id, body) : await api.post('/departments', body); onDone(); } catch (x) { setError(x.message); }
  };
  return (
    <Modal title={dept ? 'Edit department' : 'Add department'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Department name" hint={dept ? 'Renaming moves its people and past reports with it.' : ''}><input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
        <div className="field"><span>Job titles in this department</span>
          {f.jobTitles.length > 0 && <ul className="chips">{f.jobTitles.map((t) => <li key={t} className="chip-x">{t}<button type="button" className="icon-btn" onClick={() => setF({ ...f, jobTitles: f.jobTitles.filter((x) => x !== t) })} aria-label={'Remove ' + t}>×</button></li>)}</ul>}
          <div className="comment-form"><input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTitle(); } }} placeholder="Customer Service Agent" maxLength={80} aria-label="New job title" /><button type="button" className="btn" onClick={addTitle} disabled={!title.trim()}>Add title</button></div>
          <small>Type a title and press Enter. People in this department choose from these when they request an account.</small></div>
        <div className="row2">
          <Field label="Sits under"><select value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}><option value="">Top level</option>{departments.filter((d) => d.id !== dept?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Head of department"><select value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })}><option value="">Not set</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLES[u.role]})</option>)}</select></Field>
        </div>
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{dept ? 'Save changes' : 'Add department'}</button></div>
      </form>
    </Modal>
  );
}

const blankField = () => ({ id: '', label: '', type: 'longtext', options: '', required: false });
function TemplateForm({ tpl, departments, onClose, onDone }) {
  const [f, setF] = useState(tpl ? { ...tpl, fields: tpl.fields.map((x) => ({ ...x, options: x.options.join(', ') })) } : { name: '', description: '', periodType: 'monthly', dueDays: 5, approvalLevels: 1, requiredRoles: [], departments: [], includeTasks: true, fields: [blankField()] });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const flip = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const setField = (i, patch) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i, by) => { const a = [...f.fields]; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setF({ ...f, fields: a }); };
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: f.name, description: f.description, periodType: f.periodType, dueDays: f.dueDays, approvalLevels: f.approvalLevels, requiredRoles: f.requiredRoles, departments: f.departments, includeTasks: f.includeTasks, fields: f.fields.filter((x) => x.label.trim()) };
    try { tpl ? await api.patch('/workreports/templates/' + tpl.id, body) : await api.post('/workreports/templates', body); onDone(); } catch (x) { setError(x.message); }
  };
  return (
    <Modal title={tpl ? 'Edit template' : 'New report template'} onClose={onClose} wide>
      <form onSubmit={submit} className="builder">
        <div className="row2"><Field label="Template name"><input required autoFocus value={f.name} onChange={set('name')} placeholder="Monthly Department Report" /></Field><Field label="Description"><input value={f.description} onChange={set('description')} /></Field></div>
        <div className="row3 tight">
          <Field label="How often"><select value={f.periodType} onChange={set('periodType')}>{Object.entries(PERIODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Days to submit after the period ends" hint={f.periodType === 'monthly' ? `Due on day ${Number(f.dueDays) || 'the last'} of the next month` : ''}><input type="number" min="0" max="90" value={f.dueDays} onChange={set('dueDays')} disabled={f.periodType === 'adhoc'} /></Field>
          <Field label="Approval levels" hint="Each level is the next manager up"><select value={f.approvalLevels} onChange={set('approvalLevels')}><option value="1">1: direct manager</option><option value="2">2: manager, then theirs</option><option value="3">3 levels up</option></select></Field>
        </div>
        <div className="row2">
          <div className="field"><span>Who must file it each period</span><div className="ticks">{['member', 'team_leader', 'director'].map((r) => <label className="check" key={r}><input type="checkbox" checked={f.requiredRoles.includes(r)} onChange={() => flip('requiredRoles', r)} />{ROLES[r]}s</label>)}</div><small>Leave all unticked to make it optional. Anyone can still file it.</small></div>
          <div className="field"><span>Only these departments</span><div className="ticks">{departments.length ? departments.map((d) => <label className="check" key={d.id}><input type="checkbox" checked={f.departments.includes(d.name)} onChange={() => flip('departments', d.name)} />{d.name}</label>) : <small>No departments set up.</small>}</div><small>Leave all unticked for every department.</small></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.includeTasks} onChange={(e) => setF({ ...f, includeTasks: e.target.checked })} />Pull in the author's tasks for the period automatically</label>
        <h3>Fields</h3>
        <ol className="field-list">{f.fields.map((x, i) => (
          <li key={i}>
            <input placeholder="Question or heading" value={x.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label={`Field ${i + 1} label`} />
            <select value={x.type} onChange={(e) => setField(i, { type: e.target.value })} aria-label="Answer type">{Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="check"><input type="checkbox" checked={x.required} onChange={(e) => setField(i, { required: e.target.checked })} />Required</label>
            <span className="nowrap"><button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button><button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === f.fields.length - 1} aria-label="Move down">↓</button><button type="button" className="icon-btn" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} aria-label="Remove field">×</button></span>
            {x.type === 'select' && <input className="opts" placeholder="Choices, separated by commas" value={x.options} onChange={(e) => setField(i, { options: e.target.value })} aria-label="Choices" />}
          </li>))}</ol>
        <button type="button" className="btn" onClick={() => setF({ ...f, fields: [...f.fields, blankField()] })}>Add field</button>
        {tpl && <p className="muted small">Changes apply to reports started from now on. Reports already started keep the fields they had.</p>}
        <ErrorNote error={error} />
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{tpl ? 'Save template' : 'Create template'}</button></div>
      </form>
    </Modal>
  );
}
