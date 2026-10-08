require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Department, Template } = require('./models');
const { freeUsername } = require('./lib');

async function ensureAdmin() {
  if (await User.findOne({ role: 'admin' })) return;
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return console.warn('No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create one.');
  const username = await freeUsername(User, process.env.ADMIN_USERNAME || email);
  await User.create({ name: process.env.ADMIN_NAME || 'System Admin', username, email, passwordHash: await bcrypt.hash(password, 10), role: 'admin', status: 'active', mustChangePassword: true });
  console.log(`Created first admin. Sign in with username: ${username}`);
}

/** First run after an update: turn the department names people already have into real departments, and add a starter template. */
async function ensureDefaults() {
  // Update from a version that signed in by email: give everyone a username (the first part of their email).
  for (const u of await User.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] })) {
    u.username = await freeUsername(User, u.email); await u.save();
  }
  const names = [...new Set((await User.find({}).select('department').lean()).map((u) => (u.department || '').trim()).filter(Boolean))];
  for (const name of names) if (!(await Department.findOne({ name }))) await Department.create({ name });
  // Job titles now live under departments: start each empty department off with the titles its people already hold.
  for (const d of await Department.find({})) {
    if (d.jobTitles && d.jobTitles.length) continue;
    const titles = [...new Set((await User.find({ department: d.name, status: { $ne: 'pending' } }).select('title').lean()).map((u) => (u.title || '').trim()).filter(Boolean))].sort();
    if (titles.length) { d.jobTitles = titles; await d.save(); }
  }
  if (!(await Template.countDocuments({}))) {
    await Template.create({
      name: 'Monthly Department Report', description: 'What the department did this month, what is planned, and what is in the way.', periodType: 'monthly', dueDays: 5, approvalLevels: 2,
      requiredRoles: ['director', 'team_leader'], includeTasks: true,
      fields: [
        { id: 'completed', label: 'Activities completed', type: 'longtext', required: true },
        { id: 'in_progress', label: 'Activities in progress', type: 'longtext' },
        { id: 'planned', label: 'Planned for next month', type: 'longtext', required: true },
        { id: 'achievements', label: 'Achievements', type: 'longtext' },
        { id: 'challenges', label: 'Challenges', type: 'longtext' },
        { id: 'budget', label: 'Budget used', type: 'percent', help: 'Share of this month\'s budget spent' },
        { id: 'recommendations', label: 'Recommendations', type: 'longtext' },
      ],
    });
  }
}


/** Connect once and run the first-start checks once. Safe to call on every request (serverless) or at startup (normal server). */
let ready = null;
function boot() {
  if (ready) return ready;
  ready = (async () => {
    if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me')) throw new Error('Set a real JWT_SECRET before running in production.');
    mongoose.set('bufferCommands', false);
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/worktrack', { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
    await ensureAdmin();
    await ensureDefaults();
  })().catch((e) => { ready = null; throw e; }); // try again on the next request if it failed
  return ready;
}
module.exports = { boot, ensureAdmin };
