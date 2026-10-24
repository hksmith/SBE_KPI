# WorkTrack

KPI tracking for a whole organisation: people get KPIs (set by themselves, their manager, a director or the CEO),
keep the status and percentage up to date, and each level of the structure sees a visual roll-up of the people below it.

Tasks, weekly plans and formal reports are built in too, but **switched off by default**. An admin can turn
each one on under Settings.

**Stack:** Node + Express + MongoDB (Mongoose) API, React + Vite dashboard. One server serves both in production.

## Who sees what

| Role | Sees | Can do |
|---|---|---|
| Admin | Everyone | Everything below, plus create/approve/edit/disable accounts, reset any password, read the activity log |
| CEO | Everyone | Set KPIs for anyone and update them, view everything, review weekly plans. No account management |
| Director | Their team leaders and everyone under those leaders | Set KPIs (and tasks) for them, review plans, reset their passwords |
| Team leader | Their team members | Set KPIs (and tasks) for them, review plans |
| Team member | Only themselves | Own KPIs (status and %), profile |

Visibility follows the "reports to" chain, so it works for any depth. These rules are enforced on the
server, not just hidden in the interface.

## Features

- **KPIs** with a status (not started, started, in progress, done, delayed, blocked, on hold, cancelled) and a percentage. A KPI is measured either by a percentage the owner types in, or by a number against a target (the % is worked out). The owner can change status and % at any time; every change is kept in the KPI's history. Past-deadline KPIs are flagged, and a pace reading compares progress with the time used.
- **Assigning KPIs**: admin and CEO to anyone, directors and team leaders to the people under them. Pick several people at once and each gets their own copy. Each KPI has an urgency (low, medium, high, urgent). Only whoever set a KPI (or a manager above) can change its definition or delete it.
- **KPI view**: every KPI opens into a view with its description, who assigned it, deadline, urgency and history, with the update form beside it. Nothing is saved until "Update" is clicked, and closing with unsaved changes asks first.
- **New and opened**: the owner gets a notification that opens that exact KPI, a "New" tag on the card and a count in the menu. Until the owner opens it, whoever assigned it sees "Not opened yet"; after that, when it was opened.
- **Branding**: admin uploads a logo and sets the organisation name; both show in the sidebar and on the sign-in page. The copyright line is at the bottom of the sidebar and the sign-in pages.
- **Profile pictures**: everyone can upload their own photo (cropped square, shrunk in the browser).
- **Account requests** pick a department, then a job title from the titles the admin listed under that department (Settings, "Departments and job titles"), then a role. The role is a request: the admin confirms it when approving.
- **Passwords**: every password box has a show/hide eye, and creating an account or changing a password asks for it twice.

The next three are optional modules (Settings, "What the app includes"):

- **Tasks** with status (not started, started, in progress, done, delayed, blocked, on hold, cancelled), progress %, priority, due date, comments and a change history. Managers can assign tasks down the structure.
- **Weekly plans**: a list of items for the week, each with its own status and progress, plus what got done, blockers and carry-over. Submit to your manager; managers review with a comment and a 1 to 5 rating, and see who has not submitted.
- **Formal reports** built from templates an admin designs (text, paragraph, number, percentage, date, choice list and tick-box fields) on a daily, weekly, monthly, quarterly or yearly schedule, or with no schedule.
- **Approval chain**: a submitted report goes to the author's manager, then (if the template asks for 2 or 3 levels) on up the structure. Each reviewer approves, returns it with a reason, or rejects it. The report shows who has it now and keeps the full history. Approved reports are locked.
- **Deadlines and compliance**: each template says how many days after the period people have to submit. "Who has filed" shows on time / late / overdue per department and per person.
- **Supporting files** on reports (PDF, Word, Excel, PowerPoint, CSV, text, images; 8 MB each, 10 per report), stored in the database so a database backup includes them.
- **Activities pulled in automatically**: a report can include the author's tasks for the period, frozen at the moment of submission.
- **Management report**: one printable page per month rolling up every department's activities, delays, KPI achievement and reports.
- **Notifications** in the app: a report needs your review, came back to you, or was approved; a task or KPI was assigned; a plan was reviewed; a report deadline is close or passed.
- **Departments** managed by the admin (with an optional parent department and head), and an organisation name shown in the sidebar and on printouts.
- **Print or save as PDF** from any report and from the management report; CSV export of report lists.
- **Overview dashboard** per person, per team, or for the whole organisation: average progress, status split, pace against deadlines, team comparison, 8-week added vs finished trend, what needs attention, and a per-person table. Click any person or team to drill in. It runs on KPIs, or on tasks when the tasks module is on.
- **Team structure** tree with a roll-up bar for each person covering everyone below them.
- **Sign-in**: people sign in with a **username** (3 to 30 letters, numbers, dot, dash or underscore). Email is kept as contact info and still works as a fallback at sign-in. When updating from an older version, everyone automatically gets a username from the first part of their email (an admin can change it under People and access).
- **KPI export**: the KPIs page has an **Export to Excel** button. It downloads a real .xlsx of exactly the list on screen (same tab and filters, only what you are allowed to see), with a Summary sheet.
- **Assigning**: pick people from the dropdown and press Add; they appear as chips you can remove. "Everyone listed" adds all at once.
- **Accounts**: admin creates accounts and either types the password (with confirmation) or has one generated; by default the person must choose their own at first sign-in. Anyone with the sign-up link can request an account, but cannot sign in until an admin approves it and places them in the structure.
- **Password resets**: admin for anyone, directors for the team leaders and members under them. A reset signs the person out everywhere.
- **Activity log** (admin): sign-ins, failed sign-ins, account changes, resets, and every task/plan/KPI change, with filters and CSV export.
- **Profiles**: everyone can edit their own name, title, department, phone, bio and avatar colour, and change their password.
- CSV export of tasks.

## Live updates

Open pages update by themselves: no refresh needed. Every few seconds (only while the tab is visible) the app asks
`GET /api/sync` whether anything the person can see has changed. If it has, lists, dashboards, the team structure,
notification counts and any open KPI reload quietly in place. A new notification also pops up in the corner, and the
browser tab shows the unread count. This works the same on a normal server and on Vercel (no sockets needed).

## Run it locally

You need Node 18+ and a MongoDB database (a free MongoDB Atlas cluster works, or a local MongoDB).

```bash
npm run setup                      # installs server + client packages
cp server/.env.example server/.env # then edit it: MONGODB_URI, JWT_SECRET, admin email/password
npm run build                      # builds the dashboard into client/dist
npm start                          # http://localhost:4000
```

On first start the server creates the admin account from `ADMIN_USERNAME` (optional, defaults to the first part of `ADMIN_EMAIL`), `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.
Sign in with the username, set a new password, then add people under **People and access**.

### Demo data (optional)

```bash
npm run seed            # only works on an empty database
npm run seed -- --force # wipes everything and reseeds
```

This creates a 17-person demo organisation. Password for all demo accounts is `Demo1234!`:
`admin@worktrack.demo`, `selam@worktrack.demo` (CEO), `daniel@worktrack.demo` (director),
`yonas@worktrack.demo` (team leader), `abel@worktrack.demo` (member). Do not seed a database you use for real.

### Developing

Run `npm run dev:server` and `npm run dev:client` in two terminals. The dashboard is on
http://localhost:5173 and proxies `/api` to the server on port 4000.

### Updating an existing install

Your data and `server/.env` are not part of the code, so updating never touches them.

1. Stop the server (Ctrl+C, or `pm2 stop worktrack`).
2. Unzip the new version over the old folder and let it replace files.
3. `npm run setup`, then `npm run build`, then `npm start` (or `pm2 restart worktrack`).

On first start after an update the server turns the department names people already have into real departments,
and starts each department's job-title list from the titles its people already hold.
Tasks, weekly plans and formal reports are hidden until an admin switches them on under Settings; their data is kept.

### Tests

With the server running on freshly seeded data: `node server/test/smoke.js`. It signs in as each role
and checks 156 visibility, permission and workflow rules end to end.

## Deploying (free tier)

1. Create a free cluster on MongoDB Atlas, add a database user, allow network access, copy the connection string.
2. Push this folder to GitHub.
3. On Render (or Railway, Fly, a VPS): new Web Service from the repo.
   - Build command: `npm run setup && npm run build`
   - Start command: `npm start`
   - Environment: `MONGODB_URI`, `JWT_SECRET` (long random string), `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NODE_ENV=production`
4. Open the URL, sign in as the admin, change the password.

The sign-up link to share is `https://your-domain/register` (also shown on the People and access page).

## Things to know

- There is no email sending. "Forgot password" means asking a director or admin to reset it; they get a temporary password to pass on.
- Accounts are disabled, not deleted, so history stays intact. A manager's direct reports must be moved before the manager is disabled or demoted.
- Weeks start on Monday (UTC).
- Report deadlines fall at the end of the day, UTC.
- Notifications are in-app only. Email, SMS and Telegram are not wired up.
- Export is print/PDF and CSV (opens in Excel). There is no Word export.
- Sessions last 12 hours and are stored in the browser; changing or resetting a password ends all other sessions.

## Layout

```
server/src/models.js        data models (User, Task, Plan, Kpi, Log)
server/src/lib.js           auth, who-can-see-whom, audit logging
server/src/routes/          auth, users, tasks, plans, kpis, reports (dashboard numbers), workreports (formal reports), settings, logs
server/src/seed.js          demo data
client/src/pages/           Dashboard, Tasks, Plans, Reports, ReportDetail, Management, Kpis, Team, Notifications, AdminUsers, AdminLogs, AdminSettings, Profile, Auth
client/src/ui.jsx           shared components and chart pieces
```


## Deploying on Vercel (two projects: API + website)

The app is already built on MongoDB (Mongoose). On Vercel you need a MongoDB that is reachable from the internet, so use **MongoDB Atlas** (free tier is fine).

**1. MongoDB Atlas**
- Create a free cluster, a database user, and under *Network Access* allow `0.0.0.0/0` (Vercel's IP addresses change).
- Copy the connection string and add the database name, e.g. `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/worktrack?retryWrites=true&w=majority`.

**2. Create the first admin (run once, from your computer)**
```
cd server
copy .env.example .env      (then fill in MONGODB_URI and the ADMIN_* values)
npm run seed:admin
```
This only creates one admin and never deletes anything, so it is safe to run again. Sign in with that username, you will be asked to change the password, then approve people under *People and access*. (`npm run seed:demo -- --force` fills a demo company instead and wipes the database, so never run it on real data.)

**3. Backend project** (Vercel, *Add New > Project*, import the repo)
- Root Directory: `server`. Framework preset: Other. `server/vercel.json` already sends every request to `api/index.js`.
- Environment variables: `MONGODB_URI`, `JWT_SECRET` (long random string), `NODE_ENV=production`, `CLIENT_ORIGIN=https://<your-website>.vercel.app`.
  Optional: `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (creates the admin on first request if none exists, so step 2 becomes optional).
- Check `https://<your-api>.vercel.app/api/health` shows `{"ok":true}`.

**4. Website project** (a second Vercel project from the same repo)
- Root Directory: `client`. Framework preset: Vite. `client/vercel.json` makes every page (like /kpis) load `index.html`, so refreshing no longer gives a 404.
- Environment variable: `VITE_API_URL=https://<your-api>.vercel.app` (no trailing slash). Redeploy after changing it, it is baked in at build time.

**Limits on Vercel to know about**
- Uploaded files are capped at about 4 MB (Vercel's request limit).
- The sign-in rate limit is kept in memory per server instance, so it is a speed bump, not a hard lock.
- Cold starts add a second or so to the first request after idle time.
