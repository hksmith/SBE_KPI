// Vercel entry point: every request under /api lands here (see vercel.json).
const { boot } = require('../src/boot');
const app = require('../src/app');

module.exports = async (req, res) => {
  try { await boot(); }
  catch (e) {
    console.error('Startup failed:', e.message);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'The server could not start. Check MONGODB_URI and JWT_SECRET in the Vercel environment variables.' }));
  }
  return app(req, res);
};
