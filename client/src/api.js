const KEY = 'worktrack_token';
let token = null;
try { token = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
// Set VITE_API_URL at build time when the API lives on another address (e.g. a separate Vercel project). Empty = same address.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api';
let onUnauthorized = () => {};

export const setToken = (t) => { token = t; try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };
export const hasToken = () => !!token;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized();
    throw new Error((isJson && data.error) || 'Something went wrong.');
  }
  return data;
}
export const api = {
  get: (p) => request('GET', p), post: (p, b) => request('POST', p, b || {}), patch: (p, b) => request('PATCH', p, b), del: (p) => request('DELETE', p),
  /** Send one file as the raw request body. */
  async upload(path, file) {
    let res;
    try { res = await fetch(API + path + (path.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + token }, body: file }); }
    catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 413 ? 'That file is too big. The limit is 4 MB on the hosted version and 8 MB when self-hosted.' : data.error || 'Upload failed.');
    return data;
  },
  /** Download a protected file and hand it to the browser. */
  async saveFile(path, filename) {
    const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Could not download the file.');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
  async download(path, filename) {
    const text = await request('GET', path);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
};
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
