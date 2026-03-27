# Deployment Guide: Dreamweaver on Render

## What Changed
Your game now uses **WebSockets** instead of raw TCP sockets, making it compatible with Render's free tier.

### Files Modified/Created:
- ✅ `server.py` - Converted to async WebSocket server
- ✅ `network.py` - Updated to WebSocket client
- ✅ `requirements.txt` - Added dependencies (pygame, websockets, websocket-client)
- ✅ `Procfile` - Tells Render how to start your server
- ✅ `.gitignore` - Standard Python gitignore

---

## Step 1: Push to GitHub

1. Initialize git in your project folder:
   ```powershell
   cd c:\Users\snowy\Downloads\Inception
   git init
   git add .
   git commit -m "Add WebSocket support for Render deployment"
   ```

2. Create a repository on [github.com](https://github.com) and push:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/Inception.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign up (free)

2. Click **"New +"** → **"Web Service"**

3. Connect your GitHub repository:
   - Select your Inception repo
   - Choose branch: `main`

4. Fill in the settings:
   - **Name:** `dreamweaver-server` (or any name)
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python src/server.py`
   - **Region:** Choose closest to you
   - **Plan:** Free (it's enough for your game)

5. Click **"Create Web Service"** and wait for deployment (~2 min)

6. Once deployed, you'll see a URL like: `dreamweaver-server.onrender.com`

---

## Step 3: Set Environment Variable on Render

1. In your Render Web Service dashboard, go to **Environment** (left sidebar)

2. Add a new environment variable:
   - **Key:** `GAME_SERVER`
   - **Value:** `wss://dreamweaver-server.onrender.com`

3. Click **"Save"** and Render will auto-redeploy

---

## Step 4: Update Your Friends' `network.py`

Before friends run the game, they need to update their `network.py` to point to your server:

```python
# In network.py, change this line:
self.server = os.getenv("GAME_SERVER", "ws://127.0.0.1:5555")

# To your Render URL (set via environment variable)
# Or just set the environment variable before running:
# On Windows CMD:
set GAME_SERVER=wss://dreamweaver-server.onrender.com
python src/main.py

# On Windows PowerShell:
$env:GAME_SERVER="wss://dreamweaver-server.onrender.com"
python src/main.py
```

---

## Step 5: Play Together!

1. **You (host):** Run `python src/main.py` and click **HOST**
2. **Friends:** Run their copy with the environment variable set (see Step 4)
3. Share the room code from your lobby screen
4. Friends click **JOIN** and enter the code
5. Once everyone is in, you start the game!

---

## Key URLs Reference

- **Server URL:** `wss://dreamweaver-server.onrender.com` (from Render dashboard)
- **Render Dashboard:** https://dashboard.render.com/

---

## Troubleshooting

**"Connection failed" error:**
- Check that your environment variable `GAME_SERVER` is set correctly
- Make sure Render shows "Live" status (check your Render dashboard)
- Verify WebSocket URL uses `wss://` (secure) not `ws://`

**Server won't start:**
- Check Render logs: Dashboard → Logs tab
- Make sure `Procfile` exists with correct command

**Free tier spins down:**
- Render keeps free tiers running (they changed this recently)
- If issues occur, upgrade to Starter Plan (~$7/month)

---

## Optional: Custom Domain

If you want a memorable URL:
1. In Render, go to Settings
2. Add a custom domain you own
3. Update DNS records (Render gives instructions)

---

## That's it! 🎮

Your game is now playable with friends online. No ngrok, no keeping your PC on 24/7!
