# 🎮 Dreamweaver - Web Version

A fully web-based version of the Dreamweaver multiplayer cooking game. Play directly in your browser with friends!

## Features

✨ **No Installation Required** - Play via browser link
🎯 **Full Multiplayer** - Up to 4 players in one lobby
🌐 **Cloud Hosted** - Runs on Vercel/Netlify + Render
⚡ **Real-time Sync** - WebSocket-based multiplayer
🎨 **Same Great Gameplay** - All features from the desktop version

## Quick Start (For Playing)

1. Friends receive a link from you (e.g., `https://dreamweaver.vercel.app`)
2. They open the link in their browser
3. Enter their name, create or join a room code
4. Play together!

## For Developers/Deploying

### Local Development

1. Install server dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Start the server:
   ```bash
   python src/server.py
   ```

3. Open `web/index.html` in your browser or use a local server:
   ```bash
   cd web
   python -m http.server 8000
   ```
   Visit: `http://localhost:8000`

### Deploy to Vercel

1. Push to GitHub
2. Sign in to [vercel.com](https://vercel.com) with GitHub
3. Create new project from your repository
4. Set **Root Directory** to `web`
5. Deploy!
6. Your game is live! Share the Vercel URL with friends.

### Deploy to Netlify

1. Push to GitHub
2. Go to [netlify.com](https://netlify.com)
3. Connect your repo, set **Publish directory** to `web`
4. Deploy!

### Full Guide

See [WEB_DEPLOYMENT_GUIDE.md](../WEB_DEPLOYMENT_GUIDE.md) for detailed deployment instructions, troubleshooting, and advanced setup.

## How It Works

- **Frontend**: HTML5 Canvas + JavaScript (runs in browser)
- **Backend**: Python WebSocket server on Render
- **Communication**: WebSocket (same as desktop version)
- **Hosting**: Vercel/Netlify (free tier available) + Render (free tier available)

## Controls

- **Arrow Keys** - Move
- **Shift + Arrow** - Dash
- **Space** - Interact with stations

## Architecture

```
Desktop Version          Web Version
─────────────────────────────────────
Client: Pygame      →    Client: HTML5/Canvas/JS
Server: Socket      →    Server: WebSocket (same)
```

The server code is identical - only the client changed from Pygame to web!

## Browser Compatibility

- Chrome/Chromium ✅
- Firefox ✅
- Safari ✅
- Edge ✅
- Any modern browser with WebSocket support ✅

## Tips for Hosting

**Best for always-on, free tier:**
- Web Frontend: Vercel (free)
- Server: Render free tier (auto-hibernates after 15 min)

**Best for always-on server:**
- Web Frontend: Vercel (free)
- Server: Railway (~$5/mo for always-on)

See [WEB_DEPLOYMENT_GUIDE.md](../WEB_DEPLOYMENT_GUIDE.md) for more options.

## Files Structure

```
web/
├── index.html       - Main game UI
├── style.css        - Styling
├── game.js          - Full game logic (ported from Pygame)
├── network.js       - WebSocket client
├── vercel.json      - Vercel config
└── package.json     - (Optional) for npm dependencies
```

## Support

For issues, check [WEB_DEPLOYMENT_GUIDE.md](../WEB_DEPLOYMENT_GUIDE.md)'s Troubleshooting section.
