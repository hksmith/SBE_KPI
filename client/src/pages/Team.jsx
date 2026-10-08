import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ROLES } from '../meta.js';
import { Avatar, ErrorNote, Loading, ProgressBar, StatusLegend, StatusStrip, Tag, TempPassword, useLoad } from '../ui.jsx';

export default function Team() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api.get('/reports/overview'), []);
  const [temp, setTemp] = useState(null); const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const noun = data.source === 'kpis' ? 'KPIs' : 'tasks';
  const kids = new Map();
  for (const p of data.people) { const k = p.managerId || 'root'; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(p); }
  const canReset = (p) => p.id !== user.id && (user.role === 'admin' || user.role === 'director');
  const reset = async (p) => {
    if (!window.confirm(`Reset the password for ${p.name}? They will be signed out and need the new temporary password.`)) return;
    try { const r = await api.post(`/users/${p.id}/reset-password`); setTemp({ name: p.name, password: r.temporaryPassword }); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="page">
      <header className="page-head"><div><h1>Team structure</h1><p className="muted">Who reports to whom. Each bar rolls up the person's own {noun} plus everyone below them.</p></div></header>
      <ErrorNote error={err} />
      <section className="card">
        <StatusLegend byStatus={data.totals.byStatus} />
        <ul className="tree">{(kids.get('root') || []).map((p) => <Node key={p.id} p={p} depth={0} kids={kids} canReset={canReset} reset={reset} noun={noun} />)}</ul>
      </section>
      {temp && <TempPassword info={temp} onClose={() => setTemp(null)} />}
    </div>
  );
}

function Node({ p, depth, kids, canReset, reset, noun }) {
    const children = kids.get(p.id) || [];
    const [open, setOpen] = useState(depth < 2);
    return (
      <li>
        <div className="node">
          <button className="twist" onClick={() => setOpen(!open)} disabled={!children.length} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}>{children.length ? (open ? '▾' : '▸') : ''}</button>
          <Avatar user={p} size={38} />
          <div className="node-who"><Link to={'/?root=' + p.id}><b>{p.name}</b></Link><small>{p.title || ROLES[p.role]}{children.length > 0 && `, ${p.rollup.headcount - 1} below`}</small></div>
          <Tag>{ROLES[p.role]}</Tag>
          <div className="node-strip"><StatusStrip byStatus={p.rollup.byStatus} /><small>{p.rollup.total} {noun}{children.length > 0 && ' incl. team'}</small></div>
          <ProgressBar value={p.rollup.avgProgress} />
          <span className="node-late">{p.rollup.overdue ? <Tag tone="bad">{p.rollup.overdue} late</Tag> : null}</span>
          {canReset(p) && <button className="btn btn-quiet" onClick={() => reset(p)}>Reset password</button>}
        </div>
        {open && children.length > 0 && <ul>{children.map((c) => <Node key={c.id} p={c} depth={depth + 1} kids={kids} canReset={canReset} reset={reset} noun={noun} />)}</ul>}
      </li>
    );
  }
