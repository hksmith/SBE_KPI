import React, { useEffect, useState, useCallback } from 'react';
import { STATUS, STATUSES, HEALTH } from './meta.js';

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const Avatar = ({ user, size = 32 }) => (user?.avatarUrl
  ? <img className="avatar" src={user.avatarUrl} alt="" style={{ width: size, height: size }} />
  : <span className="avatar" style={{ background: user?.avatarColor || '#5c6675', width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials(user?.name)}</span>);

const Eye = ({ off }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{off && <path d="M4 4l16 16" />}
  </svg>
);
/** Password box with a show/hide eye. */
export function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'}><Eye off={show} /></button>
    </span>
  );
}
/** A pick list that falls back to free text while the admin has not set any options yet. */
export const PickList = ({ value, onChange, options, empty = 'Choose', required }) => (options.length
  ? <select value={value || ''} onChange={onChange} required={required}><option value="">{empty}</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}{value && !options.includes(value) && <option value={value}>{value}</option>}</select>
  : <input value={value || ''} onChange={onChange} required={required} />);

export const StatusPill = ({ status }) => { const s = STATUS[status] || STATUS.not_started; return <span className="pill"><i style={{ background: s.color }}>{s.icon}</i>{s.label}</span>; };
export const HealthPill = ({ health }) => { const h = HEALTH[health]; return <span className="pill"><i style={{ background: h.color }}>{h.icon}</i>{h.label}</span>; };
export const Tag = ({ children, tone }) => <span className={'tag' + (tone ? ' tag-' + tone : '')}>{children}</span>;

export const ProgressBar = ({ value, color = 'var(--blue)', label = true }) => (
  <span className="pbar" role="img" aria-label={`${value}% complete`}>
    <span className="pbar-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></span>
    {label && <b>{value}%</b>}
  </span>
);

/** One segmented bar showing how work splits across statuses. */
export function StatusStrip({ byStatus, height = 14 }) {
  const total = STATUSES.reduce((s, x) => s + (byStatus[x.key] || 0), 0);
  if (!total) return <span className="strip strip-empty" style={{ height }} />;
  return (
    <span className="strip" style={{ height }}>
      {STATUSES.filter((s) => byStatus[s.key]).map((s) => (
        <span key={s.key} className="seg" style={{ flexGrow: byStatus[s.key], background: s.color }} data-tip={`${s.label}: ${byStatus[s.key]} (${Math.round((byStatus[s.key] / total) * 100)}%)`} tabIndex={0} />
      ))}
    </span>
  );
}
export const StatusLegend = ({ byStatus }) => (
  <ul className="legend">
    {STATUSES.filter((s) => byStatus[s.key]).map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}<b>{byStatus[s.key]}</b></li>)}
  </ul>
);

export function Ring({ value, size = 132, stroke = 12, color = 'var(--blue)', children }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${value}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(Math.max(0, Math.min(100, value)) / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{children}</span>
    </span>
  );
}

export function Sparkline({ values, width = 120, height = 32, color = 'var(--blue)' }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values); const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)]);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="3" fill={color} stroke="var(--card)" strokeWidth="2" />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">×</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export const Field = ({ label, hint, children }) => <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
export const ErrorNote = ({ error }) => error ? <p className="error" role="alert">{error}</p> : null;
export const Empty = ({ title, children }) => <div className="empty"><strong>{title}</strong><p>{children}</p></div>;
export const Loading = () => <div className="loading" aria-live="polite">Loading…</div>;

/** Loads data and exposes reload + error state. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn().then((data) => setState({ data, error: '', loading: false })).catch((e) => setState({ data: null, error: e.message, loading: false }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Shows a one-time temporary password after an account is created or reset. */
export function TempPassword({ info, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Temporary password" onClose={onClose}>
      <p>Give this to <b>{info.name}</b>. It is shown only once, and they will be asked to choose a new password when they sign in.</p>
      <div className="secret"><code>{info.password}</code>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(info.password).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button></div>
      <div className="actions"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
