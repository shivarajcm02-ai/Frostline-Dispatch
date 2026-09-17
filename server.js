require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const basicAuth = require('express-basic-auth');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'frostline.db');

// --- auth ------------------------------------------------------------
// Simple shared-login protection so the board isn't sitting open on the
// public internet. Set DASH_USER / DASH_PASS in your environment (see
// .env.example). If they're not set, the server refuses to boot in
// production so nobody accidentally ships an unlocked board.
const DASH_USER = process.env.DASH_USER;
const DASH_PASS = process.env.DASH_PASS;
const AUTH_DISABLED = process.env.DISABLE_AUTH === 'true';

if (!AUTH_DISABLED && (!DASH_USER || !DASH_PASS)) {
  console.error(
    '\nMissing DASH_USER / DASH_PASS environment variables.\n' +
    'Set them (see .env.example) so the board is password-protected, or\n' +
    'set DISABLE_AUTH=true to run without a login for local testing.\n'
  );
  process.exit(1);
}

// --- database ----------------------------------------------------------
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    desc TEXT DEFAULT '',
    source TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    lastContact TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const STATUSES = ['new', 'quoted', 'awaiting_yes', 'scheduled', 'done'];
const todayStr = () => new Date().toISOString().slice(0, 10);

// --- app ---------------------------------------------------------------
const app = express();
app.use(express.json());

// Health check for your hosting platform — deliberately unauthenticated
// so Railway/Render/Fly's automatic health probes don't fail on login.
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Intake endpoint for automation tools (e.g. Make.com watching an inbox).
// Deliberately NOT behind the browser login — Make.com can't fill in a
// username/password prompt — but it requires a shared secret instead, so
// it's not just an open door to the internet. Set INTAKE_SECRET in your
// environment; this route is disabled entirely if it's not set.
const INTAKE_SECRET = process.env.INTAKE_SECRET;
app.post('/api/jobs/intake', (req, res) => {
  if (!INTAKE_SECRET) {
    return res.status(503).json({ error: 'intake not configured — set INTAKE_SECRET' });
  }
  const provided = req.header('x-intake-secret') || req.query.secret;
  if (provided !== INTAKE_SECRET) {
    return res.status(401).json({ error: 'invalid or missing secret' });
  }
  const { name, phone, desc, notes } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const now = todayStr();
  const job = {
    id: uuidv4(),
    name: name.trim(),
    phone: (phone || '').trim(),
    desc: (desc || '').trim(),
    source: 'Website form',
    status: 'new',
    notes: (notes || '').trim(),
    created: now,
    lastContact: now,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO jobs (id, name, phone, desc, source, status, notes, created, lastContact, updatedAt)
     VALUES (@id, @name, @phone, @desc, @source, @status, @notes, @created, @lastContact, @updatedAt)`
  ).run(job);
  res.status(201).json(job);
});

if (!AUTH_DISABLED) {
  app.use(
    basicAuth({
      users: { [DASH_USER]: DASH_PASS },
      challenge: true,
      realm: 'Frostline Dispatch',
    })
  );
}

// List all jobs
app.get('/api/jobs', (req, res) => {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created DESC').all();
  res.json(rows);
});

// Create a job
app.post('/api/jobs', (req, res) => {
  const { name, phone, desc, source, notes, status } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const finalStatus = STATUSES.includes(status) ? status : 'new';
  const now = todayStr();
  const job = {
    id: uuidv4(),
    name: name.trim(),
    phone: (phone || '').trim(),
    desc: (desc || '').trim(),
    source: (source || '').trim(),
    status: finalStatus,
    notes: (notes || '').trim(),
    created: now,
    lastContact: now,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO jobs (id, name, phone, desc, source, status, notes, created, lastContact, updatedAt)
     VALUES (@id, @name, @phone, @desc, @source, @status, @notes, @created, @lastContact, @updatedAt)`
  ).run(job);
  res.status(201).json(job);
});

// Update a job (partial)
app.patch('/api/jobs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const allowed = ['name', 'phone', 'desc', 'source', 'status', 'notes', 'lastContact'];
  const updates = {};
  for (const key of allowed) {
    if (key in (req.body || {})) updates[key] = req.body[key];
  }
  if (updates.status && !STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  db.prepare(
    `UPDATE jobs SET name=@name, phone=@phone, desc=@desc, source=@source,
     status=@status, notes=@notes, created=@created, lastContact=@lastContact,
     updatedAt=@updatedAt WHERE id=@id`
  ).run(merged);
  res.json(merged);
});

// Log a call — convenience endpoint, just bumps lastContact to today
app.post('/api/jobs/:id/log-call', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged = { ...existing, lastContact: todayStr(), updatedAt: new Date().toISOString() };
  db.prepare('UPDATE jobs SET lastContact=@lastContact, updatedAt=@updatedAt WHERE id=@id').run(merged);
  res.json(merged);
});

// Delete a job
app.delete('/api/jobs/:id', (req, res) => {
  const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Frostline Dispatch running on http://localhost:${PORT}`);
  if (AUTH_DISABLED) console.log('⚠️  Auth is disabled (DISABLE_AUTH=true) — do not use this in production.');
});
