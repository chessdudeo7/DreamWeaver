# Dreamweaver Web Version - Deployment Guide

## What We Just Built

Your Python Pygame game has been converted to a **web-based version** that runs in any browser. The WebSocket server (`server.py`) stays the same on Render, and the game client is now pure HTML5/JavaScript/Canvas.

## Quick Deployment

### Option 1: Deploy to Vercel (Recommended - Easiest)

1. **Push your `/web` folder to GitHub**
   ```powershell
   cd c:\Users\snowy\Downloads\Inception
   git add .
   git commit -m "Add web version of Dreamweaver"
   git push origin main
   ```

2. **Go to [vercel.com](https://vercel.com)**
   - Sign in with GitHub
   - Click "New Project"
   - Select your Inception repository
   - **Root Directory:** Set to `web`
   - Click "Deploy"

3. **After deployment**, you'll get a URL like: `dreamweaver.vercel.app`

4. **Update the server URL in `network.js`:**
   - In the `web/network.js` file, change this line:
   ```javascript
   this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://dreamweaver-server.onrender.com';
   ```
   - Replace `dreamweaver-server.onrender.com` with your actual Render server domain

5. **Done!** Share the Vercel URL with friends. They can play immediately in their browser.

---

### Option 2: Deploy to Netlify

1. Push to GitHub (same as above)
2. Go to [netlify.com](https://netlify.com)
3. Click "New site from Git"
4. Select your repository
5. **Build settings:**
   - Build command: (leave empty)
   - Publish directory: `web`
6. Deploy

---

### Option 3: Deploy to Render (Everything in One Place)

If you want everything on Render (web + server):

1. In your repository root, create a `render.yaml` file:
   ```yaml
   services:
     - type: web
       name: dreamweaver-web
       env: static
       buildCommand: echo "Static site"
       staticPublishPath: web
       routes:
         - type: http
           path: /
           matchType: prefix
   
     - type: web
       name: dreamweaver-server
       env: python
       buildCommand: pip install -r requirements.txt
       startCommand: python src/server.py
       routes:
         - type: http
           path: /
           matchType: prefix
   ```

2. Push to GitHub and link both services on Render

---

## How to Update the Server URL

The game automatically detects if you're running locally or in production. In `web/network.js`:

```javascript
const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://dreamweaver-server.onrender.com';
```

**For production:** Replace `dreamweaver-server.onrender.com` with your actual Render domain.

---

## Local Testing

To test the web version locally before deploying:

1. Start your Python server:
   ```powershell
   python src/server.py
   ```

2. Open `web/index.html` in your browser (or use a local HTTP server):
   ```powershell
   # Using Python's http.server
   cd c:\Users\snowy\Downloads\Inception\web
   python -m http.server 8000
   # Then visit: http://localhost:8000
   ```

3. The game will connect to your local server at `ws://localhost:5555`

---

## Sharing With Friends

Once deployed:

**Send them THIS link:** `https://your-vercel-domain.app`

That's it! No installation, no Python, no downloads. They click the link and play.

---

## Keyboard Controls

- **Arrow Keys**: Move player
- **Shift + Arrow Keys**: Dash (uses energy bar)
- **Space**: Interact with highlighted stations

---

## Troubleshooting

**"Connection failed" in-game:**
- Check that your Render server is running (`render.com/dashboard`)
- Verify the WebSocket URL in `network.js` is correct
- Make sure it uses `wss://` (secure WebSocket), not `ws://`

**Game loads but server connection fails:**
- You can still play locally (limited to single player)
- Check server status on Render dashboard

**Friends can't connect:**
- Make sure they're using a modern browser (Chrome, Firefox, Safari, Edge)
- Share the full Vercel/Netlify URL
- Check CORS if you see network errors (shouldn't be an issue with WebSockets)

---

## What Changed From Desktop to Web

✅ Same game logic
✅ Same multiplayer networking
✅ Same visual appearance
❌ No file system access (not needed)
❌ No window management (single fullscreen canvas)

Everything else works exactly like your Pygame version!
