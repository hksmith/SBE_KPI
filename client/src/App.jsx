import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LiveCtx } from './live.js';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, hasToken, setToken, setUnauthorizedHandler } from './api.js';
import { COPYRIGHT, ROLES, isManager } from './meta.js';
import { Avatar, Loading } from './ui.jsx';
import { Login, Register, ForceChangePassword } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Plans from './pages/Plans.jsx';
import Kpis from './pages/Kpis.jsx';
import Team from './pages/Team.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminLogs from './pages/AdminLogs.jsx';
import Profile from './pages/Profile.jsx';
import Reports from './pages/Reports.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import Management from './pages/Management.jsx';
import Notifications from './pages/Notifications.jsx';
import AdminSettings from './pages/AdminSettings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!hasToken());
  const navigate = useNavigate();

  const signOut = () => { setToken(null); setUser(null); navigate('/login'); };
  const signIn = ({ token, user }) => { setToken(token); setUser(user); };
  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    if (hasToken()) api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  // organisation name + the little number badges in the menu
  const [settings, setSettings] = useState({ orgName: '', logo: '', jobTitles: [], modules: { tasks: false, plans: false, reports: false } }); const [counts, setCounts] = useState({ notifications: 0, toReview: 0, newKpis: 0 });
  const org = settings.orgName; const setOrg = (orgName) => setSettings((x) => ({ ...x, orgName })); const reportsOn = settings.modules.reports;
  const uid = user?.id, locked = user?.mustChangePassword;

  // ---- live updates ----------------------------------------------------------------------------
  // Every few seconds (only while the tab is visible) ask the server whether anything changed.
  // When it did, bump `tick`: every list and dashboard re-reads its data quietly, without a page refresh.
  const [tick, setTick] = useState(0); const [toast, setToast] = useState(null);
  const stamp = useRef(null); const unreadRef = useRef(null); const busy = useRef(false);
  const reportsRef = useRef(reportsOn); reportsRef.current = reportsOn;
  const refreshCounts = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try {
      const d = await api.get('/sync');
      const toReview = reportsRef.current ? (await api.get('/workreports/summary').catch(() => ({ toReview: 0 }))).toReview : 0;
      setCounts({ notifications: d.count, toReview, newKpis: d.newKpis || 0 });
      if (unreadRef.current !== null && d.unread > unreadRef.current) {
        api.get('/notifications').then((n) => { const fresh = n.notifications.find((x) => !x.read); if (fresh) setToast({ ...fresh, key: Date.now() }); }).catch(() => {});
      }
      unreadRef.current = d.unread;
      if (stamp.current !== null && stamp.current !== d.stamp) setTick((t) => t + 1);
      stamp.current = d.stamp;
    } catch { /* offline for a moment: try again on the next beat */ }
    busy.current = false;
  }, []);
  useEffect(() => {
    if (!uid || locked) return undefined;
    stamp.current = null; unreadRef.current = null;
    api.get('/settings').then((d) => setSettings({ ...d, loaded: true })).catch(() => setSettings((x) => ({ ...x, loaded: true })));
    refreshCounts();
    const beat = () => { if (document.visibilityState === 'visible') refreshCounts(); };
    const timer = setInterval(beat, 4000);
    document.addEventListener('visibilitychange', beat); window.addEventListener('focus', beat);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', beat); window.removeEventListener('focus', beat); };
  }, [uid, locked, refreshCounts]);
  // Something changed: pick up new settings (modules, logo) and changes to my own account (role, name).
  useEffect(() => {
    if (!tick) return;
    api.get('/settings').then((d) => setSettings({ ...d, loaded: true })).catch(() => {});
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => {});
  }, [tick]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const n = counts.notifications; document.title = (n > 0 ? `(${n}) ` : '') + (org || 'WorkTrack'); }, [counts.notifications, org]);

  if (!ready) return <Loading />;
  const ctx = { user, setUser, signIn, signOut, org, setOrg, settings, setSettings, counts, refreshCounts, toast, setToast };
  if (!user) {
    return (
      <AuthCtx.Provider value={ctx}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Login />} />
        </Routes>
      </AuthCtx.Provider>
    );
  }
  if (user.mustChangePassword) return <AuthCtx.Provider value={ctx}><ForceChangePassword /></AuthCtx.Provider>;
  return <AuthCtx.Provider value={ctx}><LiveCtx.Provider value={tick}><Shell /></LiveCtx.Provider></AuthCtx.Provider>;
}

function Shell() {
  const { user, signOut, org, settings, counts, refreshCounts, toast, setToast } = useAuth();
  const navigate = useNavigate();
  const m = settings.modules;
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); refreshCounts(); }, [loc.pathname, loc.search]); // eslint-disable-line
  const manager = isManager(user);
  if (!settings.loaded) return <Loading />;
  const link = (to, label, end, badge) => <NavLink to={to} end={end} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>{label}{badge > 0 && <span className="badge" aria-label={`${badge} waiting`}>{badge}</span>}</NavLink>;
  return (
    <div className="shell">
      <aside className={'side' + (open ? ' open' : '')}>
        <div className="brand">{settings.logo ? <img className="brand-logo" src={settings.logo} alt="" /> : <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>}<span>{org || 'WorkTrack'}</span></div>
        <nav>
          {link('/', 'Overview', true)}
          {link('/kpis', 'KPIs', false, counts.newKpis)}
          {m.tasks && link('/tasks', 'Tasks')}
          {m.plans && link('/plans', 'Weekly plans')}
          {m.reports && link('/reports', 'Reports', false, counts.toReview)}
          {manager && link('/team', 'Team structure')}
          {manager && m.reports && link('/management', 'Management report')}
          {link('/notifications', 'Notifications', false, counts.notifications)}
          {user.role === 'admin' && <>
            <div className="nav-group">Administration</div>
            {link('/admin/people', 'People and access')}
            {link('/admin/activity', 'Activity log')}
            {link('/admin/settings', 'Settings')}
          </>}
        </nav>
        <div className="side-foot">
          <NavLink to="/profile" className="me">
            <Avatar user={user} size={36} />
            <span><b>{user.name}</b><small>{ROLES[user.role]}</small></span>
          </NavLink>
          <button className="btn btn-quiet" onClick={signOut}>Sign out</button>
          <p className="copyright">{COPYRIGHT}</p>
        </div>
      </aside>
      {toast && (
        <div className="toast" role="status">
          <div><b>{toast.title}</b>{toast.body && <small>{toast.body}</small>}</div>
          {toast.link && <button className="btn btn-primary" onClick={() => { const l = toast.link; setToast(null); api.post('/notifications/read', { id: toast.id }).catch(() => {}); navigate(l); }}>Open</button>}
          <button className="icon-btn" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>)}
      <div className="main">
        <header className="topbar"><button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</button><span className="brand">{org || 'WorkTrack'}</span></header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tasks" element={m.tasks ? <Tasks /> : <Navigate to="/" />} />
          <Route path="/plans" element={m.plans ? <Plans /> : <Navigate to="/" />} />
          <Route path="/kpis" element={<Kpis />} />
          <Route path="/reports" element={m.reports ? <Reports /> : <Navigate to="/" />} />
          <Route path="/reports/:id" element={m.reports ? <ReportDetail /> : <Navigate to="/" />} />
          <Route path="/management" element={manager && m.reports ? <Management /> : <Navigate to="/" />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin/settings" element={user.role === 'admin' ? <AdminSettings /> : <Navigate to="/" />} />
          <Route path="/team" element={manager ? <Team /> : <Navigate to="/" />} />
          <Route path="/admin/people" element={user.role === 'admin' ? <AdminUsers /> : <Navigate to="/" />} />
          <Route path="/admin/activity" element={user.role === 'admin' ? <AdminLogs /> : <Navigate to="/" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </div>
  );
}
