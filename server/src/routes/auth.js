const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, Department } = require('../models');
const { fail, signToken, requireAuth, publicUser, checkPassword, isEmail, cleanUsername, audit, notify, adminIds, getSettings } = require('../lib');

const SIGNUP_ROLES = ['member', 'team_leader', 'director'];
// What the sign-in and sign-up pages need before anyone is signed in: branding and the pick lists.
router.get('/options', async (req, res) => {
  const [s, depts] = await Promise.all([getSettings(), Department.find({}).sort({ name: 1 }).select('name jobTitles').lean()]);
  res.json({ orgName: s.orgName, logo: s.logo, jobTitles: s.jobTitles, departments: depts.map((d) => ({ name: d.name, jobTitles: d.jobTitles || [] })), roles: SIGNUP_ROLES });
});

// Anyone with the link can ask for an account. It stays pending until an admin approves it.
router.post('/register', async (req, res) => {
  const { name, username, email, password, department = '', title = '', requestedRole = 'member' } = req.body || {};
  if (!name || !String(name).trim()) fail(400, 'Enter your full name.');
  const uname = cleanUsername(username);
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  checkPassword(password);
  if (await User.findOne({ username: uname })) fail(409, 'That username is taken. Pick another one.');
  if (await User.findOne({ email: email.toLowerCase().trim() })) fail(409, 'An account with this email already exists.');
  const user = await User.create({
    name: String(name).trim(), username: uname, email, passwordHash: await bcrypt.hash(password, 10),
    department: String(department).slice(0, 80), title: String(title).slice(0, 80), role: 'member', status: 'pending', requestedRole: SIGNUP_ROLES.includes(requestedRole) ? requestedRole : 'member',
  });
  await audit(req, 'auth.register', user.email, 'Account requested, waiting for admin approval', user);
  await notify(await adminIds(), 'New account request', `${user.name} (${user.email}) is waiting for approval`, '/admin/people');
  res.status(201).json({ message: 'Account requested. An admin needs to approve it before you can sign in.' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string') fail(400, 'Enter your username and password.');
  const who = username.toLowerCase().trim();
  // The username is the way in; an email address is still accepted as a fallback.
  const user = await User.findOne(isEmail(who) ? { email: who } : { username: who });
  const ok = user && await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await audit(req, 'auth.login_failed', String(username).slice(0, 120), 'Wrong username or password', user || { name: '' });
    fail(401, 'Wrong username or password.');
  }
  if (user.status !== 'active') {
    await audit(req, 'auth.login_failed', user.username || user.email, user.status === 'pending' ? 'Account not approved yet' : 'Account is disabled', user);
    fail(403, user.status === 'pending' ? 'Your account is waiting for admin approval.' : 'This account has been disabled. Contact your admin.');
  }
  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, 'auth.login', user.email, '', user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, req.user.passwordHash))) fail(400, 'Current password is not correct.');
  checkPassword(newPassword);
  if (newPassword === currentPassword) fail(400, 'Choose a password different from the current one.');
  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  req.user.mustChangePassword = false;
  req.user.tokenVersion += 1; // signs out every other session
  await req.user.save();
  await audit(req, 'auth.password_changed', req.user.email);
  res.json({ token: signToken(req.user), user: publicUser(req.user) });
});

module.exports = router;
