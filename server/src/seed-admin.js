// Creates the first admin account so you can sign in, approve people and set everything up.
// Safe to run any number of times: it never deletes anything, and does nothing if an admin already exists.
//
// Usage:  npm run seed:admin
// Reads (from server/.env or the environment):
//   MONGODB_URI, ADMIN_USERNAME, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
// Or pass them on the command line:
//   node src/seed-admin.js --username admin --email you@example.com --password "Something-Strong-1" --name "Your Name"
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models');
const { freeUsername, checkPassword, isEmail } = require('./lib');

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Put your MongoDB connection string in server/.env first.');
  const email = arg('email') || process.env.ADMIN_EMAIL, password = arg('password') || process.env.ADMIN_PASSWORD;
  const name = arg('name') || process.env.ADMIN_NAME || 'System Admin';
  if (!isEmail(email)) throw new Error('Set ADMIN_EMAIL (or pass --email) to a valid email address.');
  if (!password) throw new Error('Set ADMIN_PASSWORD (or pass --password).');
  checkPassword(password);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const existing = await User.findOne({ role: 'admin' });
  if (existing) {
    console.log(`An admin already exists (username: ${existing.username || existing.email}). Nothing changed.`);
  } else {
    const username = await freeUsername(User, arg('username') || process.env.ADMIN_USERNAME || email);
    await User.create({ name, username, email, passwordHash: await bcrypt.hash(password, 10), role: 'admin', status: 'active', title: 'Administrator', mustChangePassword: true });
    console.log(`Admin created.\n  Username: ${username}\n  Password: the one you provided (you will be asked to change it at first sign-in)`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
