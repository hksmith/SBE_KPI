import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { fmtDateTime, fmtDue } from '../meta.js';
import { Empty, ErrorNote, Loading, Tag, useLoad } from '../ui.jsx';

export default function Notifications() {
  const navigate = useNavigate(); const { refreshCounts } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get('/notifications'), []);
  if (loading && !data) return <Loading />;
  const open = async (n) => { if (!n.read) { await api.post('/notifications/read', { id: n.id }).catch(() => {}); refreshCounts(); } if (n.link) navigate(n.link); else reload(); };
  const readAll = async () => { await api.post('/notifications/read', {}).catch(() => {}); refreshCounts(); reload(); };
  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Notifications</h1><p className="muted">Deadlines coming up and things that need you.</p></div>{data?.unread > 0 && <button className="btn" onClick={readAll}>Mark all as read</button>}</header>
      <ErrorNote error={error} />
      {data?.reminders.length > 0 && (
        <section className="card"><h2>Report deadlines</h2>
          <ul className="rows">{data.reminders.map((r) => <li key={r.id}><div><button className="link strong" onClick={() => navigate(r.link)}>{r.title}</button><small>{r.overdue ? 'Was due' : 'Due'} {fmtDue(r.dueDate)}</small></div><Tag tone={r.overdue ? 'bad' : 'warn'}>{r.overdue ? 'Overdue' : 'Due soon'}</Tag></li>)}</ul>
        </section>)}
      <section className="card">
        <h2>Recent</h2>
        {!data?.notifications.length ? <Empty title="Nothing yet">You will hear here when a report needs your review, comes back to you, or someone assigns you work.</Empty> : (
          <ul className="rows notes-list">{data.notifications.map((n) => <li key={n.id} className={n.read ? 'read' : 'unread'}><div><button className="link strong" onClick={() => open(n)}>{n.title}</button>{n.body && <small>{n.body}</small>}<small>{fmtDateTime(n.at)}</small></div>{!n.read && <Tag tone="warn">New</Tag>}</li>)}</ul>)}
      </section>
    </div>
  );
}
