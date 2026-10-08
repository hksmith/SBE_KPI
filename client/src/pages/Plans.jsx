import React, { useEffect, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../App.jsx';
import { STATUSES, fmtDateTime, isManager, shiftWeek, weekLabel } from '../meta.js';
import { Avatar, Empty, ErrorNote, Field, Loading, ProgressBar, StatusPill, Tag, useLoad } from '../ui.jsx';

const PLAN_TAG = { draft: ['Draft, not sent', 'warn'], submitted: ['Submitted', ''], reviewed: ['Reviewed', 'good'] };

export default function Plans() {
  const { user } = useAuth();
  const manager = isManager(user);
  const [tab, setTab] = useState(user.role === 'admin' || user.role === 'ceo' ? 'team' : 'mine');
  const [week, setWeek] = useState('');
  const cur = useLoad(() => api.get('/plans?week=none'), []);
  useEffect(() => { if (cur.data && !week) setWeek(cur.data.currentWeek); }, [cur.data, week]);
  if (!week) return <Loading />;
  const isCurrent = week === cur.data.currentWeek;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Weekly plans</h1><p className="muted">List what you plan to do each week, then update each item as the week goes.</p></div>
        <div className="week-nav">
          <button className="btn" onClick={() => setWeek(shiftWeek(week, -1))} aria-label="Previous week">‹</button>
          <span><b>{weekLabel(week)}</b><small>{isCurrent ? 'This week' : week > cur.data.currentWeek ? 'Upcoming' : 'Past week'}</small></span>
          <button className="btn" onClick={() => setWeek(shiftWeek(week, 1))} disabled={week >= shiftWeek(cur.data.currentWeek, 1)} aria-label="Next week">›</button>
        </div>
      </header>
      {manager && <div className="toolbar"><div className="seg-control" role="tablist">
        {[['mine', 'My plan'], ['team', user.role === 'admin' || user.role === 'ceo' ? 'Everyone' : 'My teams']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div></div>}
      {tab === 'mine' ? <MyPlan key={week} week={week} /> : <TeamPlans key={week} week={week} />}
    </div>
  );
}

function MyPlan({ week }) {
  const { data, error, loading, reload } = useLoad(() => api.get('/plans' + qs({ week })), [week]);
  const [f, setF] = useState(null); const [err, setErr] = useState(''); const [saved, setSaved] = useState('');
  const plan = data?.plans[0];
  useEffect(() => { if (data) setF(plan ? { items: plan.items.map((i) => ({ text: i.text, status: i.status, progress: i.progress })), achievements: plan.achievements, blockers: plan.blockers, nextWeek: plan.nextWeek } : { items: [{ text: '', status: 'not_started', progress: 0 }], achievements: '', blockers: '', nextWeek: '' }); }, [data]); // eslint-disable-line
  if (loading && !data || !f) return error ? <ErrorNote error={error} /> : <Loading />;
  const setItem = (i, patch) => setF({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch, ...(patch.status === 'done' ? { progress: 100 } : {}) } : it)) });
  const save = async (submit) => {
    setErr(''); setSaved('');
    try {
      if (plan) await api.patch('/plans/' + plan.id, { ...f, submit });
      else { const p = (await api.post('/plans', { ...f, weekStart: week })).plan; if (submit) await api.patch('/plans/' + p.id, { submit: true }); }
      setSaved(submit ? 'Submitted to your manager.' : 'Saved.'); reload();
    } catch (e) { setErr(e.message); }
  };
  const avg = f.items.filter((i) => i.text.trim()).length ? Math.round(f.items.filter((i) => i.text.trim()).reduce((s, i) => s + Number(i.progress), 0) / f.items.filter((i) => i.text.trim()).length) : 0;
  return (
    <section className="card">
      <div className="card-head"><h2>My plan</h2><span className="with-avatar">{plan ? <Tag tone={PLAN_TAG[plan.status][1]}>{PLAN_TAG[plan.status][0]}</Tag> : <Tag tone="warn">Not started</Tag>}<ProgressBar value={avg} /></span></div>
      {plan?.review && <div className="review"><b>Review from {plan.review.by?.name}</b>{plan.review.rating && <span className="stars" aria-label={`${plan.review.rating} out of 5`}>{'★'.repeat(plan.review.rating)}{'☆'.repeat(5 - plan.review.rating)}</span>}<p>{plan.review.comment || 'No comment.'}</p></div>}
      <ol className="plan-items">
        {f.items.map((it, i) => (
          <li key={i}>
            <input placeholder="What will you do?" value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} aria-label={`Item ${i + 1}`} />
            <select value={it.status} onChange={(e) => setItem(i, { status: e.target.value })} aria-label="Status">{STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            <span className="range"><input type="range" min="0" max="100" step="5" value={it.progress} disabled={it.status === 'done'} onChange={(e) => setItem(i, { progress: Number(e.target.value) })} aria-label="Progress" /><b>{it.progress}%</b></span>
            <button className="icon-btn" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })} aria-label="Remove item">×</button>
          </li>))}
      </ol>
      <button className="btn" onClick={() => setF({ ...f, items: [...f.items, { text: '', status: 'not_started', progress: 0 }] })}>Add item</button>
      <div className="row3">
        <Field label="What got done"><textarea rows={3} value={f.achievements} onChange={(e) => setF({ ...f, achievements: e.target.value })} /></Field>
        <Field label="What is in the way"><textarea rows={3} value={f.blockers} onChange={(e) => setF({ ...f, blockers: e.target.value })} /></Field>
        <Field label="Carrying into next week"><textarea rows={3} value={f.nextWeek} onChange={(e) => setF({ ...f, nextWeek: e.target.value })} /></Field>
      </div>
      <ErrorNote error={err} />{saved && <p className="ok" role="status">{saved}</p>}
      <div className="actions">
        {(!plan || plan.status === 'draft') && <button className="btn" onClick={() => save(false)}>Save draft</button>}
        <button className="btn btn-primary" onClick={() => save(true)}>{plan && plan.status !== 'draft' ? 'Save and resubmit' : 'Submit to manager'}</button>
      </div>
    </section>
  );
}

function TeamPlans({ week }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/plans' + qs({ week, scope: 'team' })), api.get('/users/tree')]), [week]);
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const [{ plans }, { users }] = data;
  const have = new Set(plans.map((p) => p.owner._id));
  const missing = users.filter((u) => u.id !== user.id && !['admin', 'ceo'].includes(u.role) && !have.has(u.id));
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Submitted this week</h2><span className="muted">{plans.length} of {plans.length + missing.length} people</span></div>
        {plans.length === 0 ? <Empty title="No plans in yet">Plans appear here once people submit them.</Empty> : (
          <ul className="plan-list">{plans.map((p) => (
            <li key={p.id} className={open === p.id ? 'open' : ''}>
              <button className="plan-row" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                <span className="with-avatar"><Avatar user={p.owner} size={30} /><span><b>{p.owner.name}</b><small>{p.items.length} items</small></span></span>
                <ProgressBar value={p.progress} /><Tag tone={PLAN_TAG[p.status][1]}>{PLAN_TAG[p.status][0]}</Tag>
              </button>
              {open === p.id && <PlanView plan={p} onReviewed={reload} />}
            </li>))}
          </ul>)}
      </section>
      {missing.length > 0 && <section className="card"><h2>Not submitted yet</h2><ul className="chips">{missing.map((u) => <li key={u.id}><Avatar user={u} size={22} />{u.name}</li>)}</ul></section>}
    </>
  );
}

function PlanView({ plan, onReviewed }) {
  const [comment, setComment] = useState(plan.review?.comment || ''); const [rating, setRating] = useState(plan.review?.rating || 0); const [err, setErr] = useState('');
  const send = async (e) => { e.preventDefault(); try { await api.post(`/plans/${plan.id}/review`, { comment, rating: rating || undefined }); onReviewed(); } catch (x) { setErr(x.message); } };
  return (
    <div className="plan-view">
      <ul className="rows">{plan.items.map((i, k) => <li key={k}><div><b>{i.text}</b></div><span className="kpi-mini"><ProgressBar value={i.progress} /><StatusPill status={i.status} /></span></li>)}</ul>
      <div className="row3 notes">
        <div><h4>What got done</h4><p>{plan.achievements || 'Nothing written.'}</p></div>
        <div><h4>What is in the way</h4><p>{plan.blockers || 'Nothing written.'}</p></div>
        <div><h4>Carrying into next week</h4><p>{plan.nextWeek || 'Nothing written.'}</p></div>
      </div>
      {plan.review && <p className="muted small">Reviewed by {plan.review.by?.name} on {fmtDateTime(plan.review.at)}</p>}
      {plan.canReview && (
        <form className="review-form" onSubmit={send}>
          <Field label="Your feedback"><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="rating" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={rating === n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n === rating ? 0 : n)} aria-label={`${n} of 5`}>★</button>)}</div>
          <ErrorNote error={err} />
          <button className="btn btn-primary">{plan.review ? 'Update review' : 'Mark as reviewed'}</button>
        </form>)}
    </div>
  );
}
