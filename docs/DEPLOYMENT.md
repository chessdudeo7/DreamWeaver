# Deploying DreamWeaver

DreamWeaver runs as two pieces:

| Piece | What it is | Hosted on |
| --- | --- | --- |
| **Client** (`web/`) | Static HTML/CSS/JS — the game you see | Vercel |
| **Server** (`src/server.py`) | Python WebSocket server — authoritative game state | Render |
| **Database** (optional) | Postgres — leaderboard + room snapshots | Supabase |

The client connects to the server over WebSockets. Without a database the server
still runs fine — the leaderboard just falls back to in-memory and resets on restart.

---

## 1. Server (Render)

1. **New +** → **Web Service**, connect this repo, branch `main`.
2. Settings:
   - **Environment:** Python 3
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `python src/server.py`
3. Environment variables:
   - `DATABASE_URL` — your Supabase Postgres connection string. *Optional;* omit
     for in-memory mode.
   - `PORT` is provided by Render automatically.
4. Deploy. You'll get a domain like `dreamweaver-server.onrender.com`.

The server creates its own tables (`leaderboard`, `room_snapshots`) on startup and
migrates them in place, so there's no manual SQL step.

> Render's health checker sends plain HTTP `GET /` requests. The server answers
> those with a `200 OK` so it isn't mistaken for a dead service — see
> `process_request` in `src/server.py`.

## 2. Client (Vercel)

1. **New Project** → import this repo.
2. **Root Directory:** `web`
3. Deploy — no build step, it's static.

Then point the client at your server. In `web/network.js`:

```js
this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://YOUR-SERVER.onrender.com';
```

Use `wss://` (not `ws://`) in production, or browsers will block the connection
from an HTTPS page.

## 3. Deploy both together

`web/config.json` is read by **both** the client and the server. When you change
it, redeploy **both** services from the same commit so they don't disagree about
recipes, level layouts, or scoring.

---

## Troubleshooting

**"Connection failed" in game**
- Check the Render service is live.
- Verify the URL in `network.js` uses `wss://`.
- Render free tier can cold-start; the client retries automatically, so give it
  up to a minute on the first load.

**Changes don't show up after deploying**
- Hard-refresh (`Ctrl+Shift+R`). Browsers cache `game.js` / `config.json`
  aggressively.

**Leaderboard is empty after a restart**
- That's in-memory mode — `DATABASE_URL` isn't set or the connection failed.
  Check the Render logs for `Database connected and leaderboard table ready.`
