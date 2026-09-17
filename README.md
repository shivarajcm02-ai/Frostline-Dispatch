# Frostline Dispatch

A one-screen job board for a small field-service business: who to call
today, and where every job stands. Runs on your own server — no
third-party account required beyond wherever you choose to host it.

**Stack:** Node.js + Express + SQLite (a single file on disk, no
separate database server to manage). Frontend is plain HTML/CSS/JS
served by the same process.

## Run it locally

```bash
npm install
cp .env.example .env
# edit .env — set DASH_USER and DASH_PASS to a real login
npm start
```

Open http://localhost:3000 and sign in with the username/password you
set in `.env`.

Job data is stored in `data/frostline.db` (created automatically on
first run). Back that file up the way you'd back up any small database
— copying it is enough.

## How the pieces fit together

- `server.js` — the whole backend: a handful of REST endpoints
  (`GET/POST /api/jobs`, `PATCH /api/jobs/:id`,
  `POST /api/jobs/:id/log-call`, `DELETE /api/jobs/:id`) backed by
  SQLite, plus a login check in front of all of it.
- `public/index.html` — the board itself. It talks to the API with
  `fetch`, and polls every 5 seconds so that if two people have it
  open at once, they both see changes show up without refreshing.
- No build step. Nothing to compile. Edit `public/index.html` directly
  if you want to change how it looks or behaves.

## Deploying it somewhere real

Any host that runs a long-lived Node process works. A few
straightforward options, roughly cheapest/simplest to most involved:

**Railway / Render / Fly.io** (recommended for a first deploy)
1. Push this folder to a GitHub repo.
2. Create a new web service on the platform, pointing at that repo.
3. Set the environment variables from `.env.example` in the platform's
   dashboard (`DASH_USER`, `DASH_PASS`, and optionally `DB_PATH`).
4. Set the start command to `npm start` (most platforms detect this
   automatically from `package.json`).
5. **Important:** SQLite writes to a file on disk. On Railway/Render,
   attach a persistent volume/disk to the service and point `DB_PATH`
   at a path inside it (e.g. `/data/frostline.db`) — otherwise the
   database resets on every redeploy. Fly.io calls this a "volume";
   Render calls it a "disk."

**A VPS you already have** (DigitalOcean droplet, a home server, etc.)
1. Install Node 18+.
2. Copy this folder over (`scp`, `git clone`, whatever you're used to).
3. `npm install --production`, set up `.env`.
4. Run it under a process manager so it restarts on crash/reboot —
   `pm2 start server.js --name frostline` is the simplest option, or
   a `systemd` service if you prefer.
5. Put it behind a reverse proxy (nginx or Caddy) so you can serve it
   over HTTPS on your own domain. Caddy is the easiest: point a domain
   at the server and it handles the HTTPS certificate automatically.

## Security notes for a real deployment

- Change `DASH_USER`/`DASH_PASS` from the example values before you
  deploy anywhere reachable from the internet. This is deliberately
  simple (one shared login) since it's a small team — if you want
  separate logins per tech later, that's a bigger change (a real
  users table + sessions), and worth doing before handling anything
  more sensitive than job notes.
- Always run behind HTTPS in production (see the Caddy/nginx note
  above) — HTTP Basic Auth sends the password on every request, so it
  needs an encrypted connection.
- Back up `data/frostline.db` periodically. It's the only copy of
  your job history.

## Extending it

- **True real-time instead of 5-second polling:** swap the polling
  loop in `public/index.html` for a WebSocket connection (`ws` package
  on the server) if the 5-second delay ever feels slow in practice.
- **Per-tech logins:** add a `users` table, hash passwords (`bcrypt`),
  and replace the Basic Auth middleware with session-based login.
- **Postgres instead of SQLite:** if this grows past one small team,
  swap `better-sqlite3` for `pg` — the query shapes in `server.js`
  stay almost identical.
