import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
  const refreshCounts = useCallback(() => {
    Promise.all([api.get('/notifications'), reportsOn ? api.get('/workreports/summary') : { toReview: 0 }]).then(([n, r]) => setCounts({ notifications: n.count, toReview: r.toReview, newKpis: n.newKpis || 0 })).catch(() => {});
  }, [reportsOn]);
  const uid = user?.id, locked = user?.mustChangePassword;
  useEffect(() => {
    if (!uid || locked) return undefined;
    api.get('/settings').then((d) => setSettings({ ...d, loaded: true })).catch(() => setSettings((x) => ({ ...x, loaded: true })));
    refreshCounts(); const timer = setInterval(refreshCounts, 60000); return () => clearInterval(timer);
  }, [uid, locked, refreshCounts]);

  if (!ready) return <Loading />;
  const ctx = { user, setUser, signIn, signOut, org, setOrg, settings, setSettings, counts, refreshCounts };
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
  return <AuthCtx.Provider value={ctx}><Shell /></AuthCtx.Provider>;
}

function Shell() {
  const { user, signOut, org, settings, counts, refreshCounts } = useAuth();
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
