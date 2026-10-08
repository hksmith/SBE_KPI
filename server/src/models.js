const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const oid = Schema.Types.ObjectId;

const ROLES = ['admin', 'ceo', 'director', 'team_leader', 'member'];
const TASK_STATUSES = ['not_started', 'started', 'in_progress', 'done', 'delayed', 'blocked', 'on_hold', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true }, // what people sign in with
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ROLES, default: 'member' },
  managerId: { type: oid, ref: 'User', default: null },
  department: { type: String, default: '', trim: true },
  title: { type: String, default: '', trim: true },
  phone: { type: String, default: '', trim: true },
  bio: { type: String, default: '', trim: true },
  avatarColor: { type: String, default: '#2a78d6' },
  avatarUrl: { type: String, default: '' }, // small resized photo, stored as a data URL
  requestedRole: { type: String, default: '' }, // what the person asked for when signing up; the admin decides
  status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
  mustChangePassword: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: Date,
}, { timestamps: true });

const taskSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  owner: { type: oid, ref: 'User', required: true, index: true },
  createdBy: { type: oid, ref: 'User', required: true },
  status: { type: String, enum: TASK_STATUSES, default: 'not_started' },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  priority: { type: String, enum: PRIORITIES, default: 'medium' },
  dueDate: Date,
  completedAt: Date,
  kpiId: { type: oid, ref: 'Kpi', default: null },
  comments: [{ author: { type: oid, ref: 'User' }, text: String, at: { type: Date, default: Date.now } }],
  history: [{ by: { type: oid, ref: 'User' }, status: String, progress: Number, note: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

const planSchema = new Schema({
  owner: { type: oid, ref: 'User', required: true, index: true },
  weekStart: { type: String, required: true }, // Monday, YYYY-MM-DD
  items: [{ text: { type: String, required: true }, status: { type: String, enum: TASK_STATUSES, default: 'not_started' }, progress: { type: Number, min: 0, max: 100, default: 0 } }],
  achievements: { type: String, default: '' },
  blockers: { type: String, default: '' },
  nextWeek: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'submitted', 'reviewed'], default: 'draft' },
  submittedAt: Date,
  review: { by: { type: oid, ref: 'User' }, comment: String, rating: Number, at: Date },
}, { timestamps: true });
planSchema.index({ owner: 1, weekStart: 1 }, { unique: true });

const kpiSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  owner: { type: oid, ref: 'User', required: true, index: true },
  createdBy: { type: oid, ref: 'User', required: true },
  priority: { type: String, enum: PRIORITIES, default: 'medium' }, // shown as "urgency"
  unseen: { type: Boolean, default: false }, // assigned by someone else and not opened by the owner yet
  openedAt: Date,
  mode: { type: String, enum: ['number', 'percent'], default: 'number' }, // measured by a number against a target, or by a percentage typed in directly
  unit: { type: String, default: '' },
  baseline: { type: Number, default: 0 },
  target: { type: Number, default: 100 },
  current: { type: Number, default: 0 },
  status: { type: String, enum: TASK_STATUSES },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  startDate: Date,
  dueDate: Date,
  completedAt: Date,
  checkins: [{ value: Number, status: String, note: String, by: { type: oid, ref: 'User' }, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

const logSchema = new Schema({
  actor: { type: oid, ref: 'User', default: null },
  actorName: { type: String, default: '' },
  action: { type: String, required: true, index: true },
  target: { type: String, default: '' },
  details: { type: String, default: '' },
  ip: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true },
});


const FIELD_TYPES = ['text', 'longtext', 'number', 'percent', 'date', 'select', 'checkbox'];
const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'adhoc'];
const REPORT_STATUSES = ['draft', 'submitted', 'under_review', 'returned', 'approved', 'rejected', 'archived'];

const departmentSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  parent: { type: oid, ref: 'Department', default: null },
  head: { type: oid, ref: 'User', default: null },
  jobTitles: [String], // the job titles that exist in this department
}, { timestamps: true });

const fieldSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: FIELD_TYPES, default: 'longtext' },
  options: [String],
  required: { type: Boolean, default: false },
  help: { type: String, default: '' },
}, { _id: false });

const templateSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  periodType: { type: String, enum: PERIOD_TYPES, default: 'monthly' },
  dueDays: { type: Number, min: 0, max: 90, default: 5 }, // days after the period ends
  approvalLevels: { type: Number, min: 1, max: 3, default: 1 },
  requiredRoles: [{ type: String, enum: ROLES }], // who is expected to file it each period
  departments: [String], // empty = every department
  includeTasks: { type: Boolean, default: true },
  fields: [fieldSchema],
  active: { type: Boolean, default: true },
}, { timestamps: true });

const reportSchema = new Schema({
  template: { type: oid, ref: 'Template', required: true, index: true },
  templateName: String,
  title: { type: String, required: true, trim: true },
  author: { type: oid, ref: 'User', required: true, index: true },
  department: { type: String, default: '' },
  periodType: { type: String, enum: PERIOD_TYPES },
  periodStart: String, periodEnd: String, periodLabel: String,
  dueDate: Date,
  fields: [fieldSchema], // copy of the template's fields when the report was started
  values: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: REPORT_STATUSES, default: 'draft', index: true },
  statusBeforeArchive: String,
  approvalLevels: { type: Number, default: 1 },
  step: { type: Number, default: 0 },
  reviewer: { type: oid, ref: 'User', default: null }, // whose turn it is; null = an admin
  firstSubmittedAt: Date, submittedAt: Date, decidedAt: Date,
  late: { type: Boolean, default: false },
  activity: Schema.Types.Mixed, // snapshot of the author's tasks for the period, taken at submit
  history: [{ action: String, by: { type: oid, ref: 'User' }, comment: String, step: Number, at: { type: Date, default: Date.now } }],
  comments: [{ author: { type: oid, ref: 'User' }, text: String, at: { type: Date, default: Date.now } }],
  attachments: [{ file: { type: oid, ref: 'Attachment' }, name: String, size: Number, mime: String, by: { type: oid, ref: 'User' }, at: { type: Date, default: Date.now } }],
}, { timestamps: true, minimize: false });

const attachmentSchema = new Schema({
  report: { type: oid, ref: 'Report', required: true, index: true },
  name: String, mime: String, size: Number, data: Buffer,
}, { timestamps: true });

const notificationSchema = new Schema({
  user: { type: oid, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  read: { type: Boolean, default: false },
  at: { type: Date, default: Date.now },
});

const settingSchema = new Schema({
  key: { type: String, unique: true }, orgName: { type: String, default: '' }, logo: { type: String, default: '' }, jobTitles: [String],
  modules: { tasks: { type: Boolean, default: false }, plans: { type: Boolean, default: false }, reports: { type: Boolean, default: false } }, // optional parts of the app; KPIs are always on
});

module.exports = {
  ROLES, TASK_STATUSES, PRIORITIES, FIELD_TYPES, PERIOD_TYPES, REPORT_STATUSES,
  Department: model('Department', departmentSchema),
  Template: model('Template', templateSchema),
  Report: model('Report', reportSchema),
  Attachment: model('Attachment', attachmentSchema),
  Notification: model('Notification', notificationSchema),
  Setting: model('Setting', settingSchema),
  User: model('User', userSchema),
  Task: model('Task', taskSchema),
  Plan: model('Plan', planSchema),
  Kpi: model('Kpi', kpiSchema),
  Log: model('Log', logSchema),
};
