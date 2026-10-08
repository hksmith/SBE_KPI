const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { requireAuth, HttpError } = require('./lib');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com'] } } }));
if (process.env.CLIENT_ORIGIN) app.use(cors({ origin: process.env.CLIENT_ORIGIN.split(',') }));
app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT) || 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/tasks', requireAuth, require('./routes/tasks'));
app.use('/api/plans', requireAuth, require('./routes/plans'));
app.use('/api/kpis', requireAuth, require('./routes/kpis'));
app.use('/api/reports', requireAuth, require('./routes/reports'));
app.use('/api/logs', requireAuth, require('./routes/logs'));
app.use('/api/workreports', requireAuth, require('./routes/workreports'));
app.use('/api', requireAuth, require('./routes/settings'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve the built frontend (client/dist) from the same server in production
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err?.name === 'ValidationError' || err?.name === 'CastError') return res.status(400).json({ error: 'Some of the values sent are not valid.' });
  if (err?.code === 11000) return res.status(409).json({ error: 'That already exists.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
