// ========== CONSTANTS ==========
    const WIDTH = 900, HEIGHT = 700;
    const MISSED_ORDER_PENALTY = 20;

    const BLACK = [15, 10, 25];
    const WHITE = [240, 240, 255];
    const GOLD = [255, 215, 0];
    const SKY_BLUE = [0, 191, 255];
    const ORANGE = [255, 140, 0];
    const TEAL = [0, 255, 200];

    const STATION_COLORS = {
        "Happy Orbs": GOLD,
        "Calm Orbs": SKY_BLUE,
        "Adventure Orbs": ORANGE,
        "Orb Processor": [100, 110, 130],
        "Dream Visualizer": [180, 70, 255],
        "Gateway": [50, 255, 150],
        "Crate": [110, 70, 40],
        "The Void": [20, 20, 20],
        "Vessel Return": [80, 60, 120]
    };

    const RECIPES = {
        // 2-orb recipes
        "Joyful Slumber":  [GOLD, SKY_BLUE],
        "Action Flight":   [ORANGE, GOLD],
        "Deep Calm":       [SKY_BLUE, SKY_BLUE],
        // 3-orb recipes (level 3)
        "Vivid Odyssey":   [ORANGE, GOLD, SKY_BLUE],
        "Velvet Abyss":    [SKY_BLUE, SKY_BLUE, GOLD],
        "Ember Vision":    [ORANGE, ORANGE, GOLD],
    };

    const LEVEL_STAR_THRESHOLDS = [60, 120, 180];

    // Order timers (must match server.py constants)
    const TWO_ORB_BASE_TIME   = 60.0;
    const THREE_ORB_BASE_TIME = 90.0;

    // ── Star + Score persistence (session-only, resets on page load) ──────────
    const _sessionStars  = {};
    const _sessionScores = {};

    function getBestStars(levelKey) {
        return _sessionStars[levelKey] || 0;
    }
    function setBestStars(levelKey, stars) {
        if (stars > (_sessionStars[levelKey] || 0))
            _sessionStars[levelKey] = stars;
    }
    function getBestScore(levelKey) {
        return _sessionScores[levelKey] || 0;
    }
    function setBestScore(levelKey, score) {
        if (score > (_sessionScores[levelKey] || 0))
            _sessionScores[levelKey] = score;
    }
    function refreshStarDisplays() {
        document.querySelectorAll('.level-stars[data-level]').forEach(el => {
            const key  = el.dataset.level;
            const best = getBestStars(key);
            if (key === 'tutorial') {
                el.textContent = best >= 1 ? '★' : '☆';
            } else {
                el.textContent = [0,1,2].map(i => i < best ? '★' : '☆').join('');
            }
        });
        document.querySelectorAll('.level-highscore[data-level]').forEach(el => {
            const key  = el.dataset.level;
            const best = getBestScore(key);
            el.textContent = 'best: ' + best;
        });
    }

    // ========== UTILITY ==========
    function rgbToString(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }

    function drawRect(ctx, x, y, w, h, color, r = 0) {
        ctx.fillStyle = rgbToString(color);
        if (r > 0) { roundRect(ctx, x, y, w, h, r); ctx.fill(); }
        else ctx.fillRect(x, y, w, h);
    }

    function drawCircle(ctx, x, y, r, color) {
        ctx.fillStyle = rgbToString(color);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
        ctx.quadraticCurveTo(x+w, y, x+w, y+r);
        ctx.lineTo(x+w, y+h-r);
        ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
        ctx.lineTo(x+r, y+h);
        ctx.quadraticCurveTo(x, y+h, x, y+h-r);
        ctx.lineTo(x, y+r);
        ctx.quadraticCurveTo(x, y, x+r, y);
        ctx.closePath();
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    // ========== ITEM ==========
    class Item {
        constructor(name, color, isProcessed = false, isVessel = false) {
            this.name = name; this.color = color;
            this.isProcessed = isProcessed; this.isVessel = isVessel;
            this.bundle = []; this.dishName = null; this.dishColor = null;
        }

        toServerFormat() {
            return {
                name: this.name, color: this.color,
                is_processed: this.isProcessed, is_vessel: this.isVessel,
                bundle: this.bundle, dish_name: this.dishName, dish_color: this.dishColor
            };
        }

        draw(ctx, x, y, scale = 1.0) {
            const pulse = Math.sin(Date.now() * 0.01) * 2;
            const r = (12 + pulse) * scale;

            if (this.isVessel) {
                ctx.strokeStyle = rgbToString([120, 100, 200]); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(x, y, 24, 14, 0, 0, Math.PI*2); ctx.stroke();
                if (this.dishName) {
                    const dr = Math.max(3, r*0.6);
                    drawCircle(ctx, x, y-8, dr, this.dishColor);
                    drawCircle(ctx, x, y-8, Math.max(1, dr-3), WHITE);
                } else if (this.bundle.length > 0) {
                    for (let i = 0; i < this.bundle.length; i++) {
                        const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.005;
                        const ir = this.bundle.length > 2 ? 5 : 7;
                        const or = this.bundle.length > 2 ? 10 : 14;
                        drawCircle(ctx, x+Math.cos(a)*or, y-8+Math.sin(a)*or, ir, this.bundle[i]);
                        drawCircle(ctx, x+Math.cos(a)*or, y-8+Math.sin(a)*or, Math.max(1,ir-3), WHITE);
                    }
                }
            } else if (this.isProcessed && this.bundle.length > 0) {
                // Finished dream orb — show the woven color body + orbiting ingredient dots
                // so players can identify which dream it is even after processing
                ctx.strokeStyle = rgbToString(this.color); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(x, y, r+4, 0, Math.PI*2); ctx.stroke();
                drawCircle(ctx, x, y, r, this.color);
                // Sparkling inner highlight to signal "done"
                drawCircle(ctx, x, y, r * 0.35, WHITE);
                // Ingredient dots orbit tightly around the body
                const orbitR = r + 10;
                for (let i = 0; i < this.bundle.length; i++) {
                    const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.004;
                    const dx = Math.cos(a)*orbitR, dy = Math.sin(a)*orbitR;
                    drawCircle(ctx, x+dx, y+dy, 6, this.bundle[i]);
                    drawCircle(ctx, x+dx, y+dy, 3, WHITE);
                }
            } else {
                ctx.strokeStyle = rgbToString(this.color); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(x, y, r+4, 0, Math.PI*2); ctx.stroke();
                drawCircle(ctx, x, y, r, this.color);
                if (!this.isProcessed) drawCircle(ctx, x, y, r/2, WHITE);
                for (let i = 0; i < this.bundle.length; i++) {
                    const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.005;
                    drawCircle(ctx, x+Math.cos(a)*25, y+Math.sin(a)*25, 8, this.bundle[i]);
                    drawCircle(ctx, x+Math.cos(a)*25, y+Math.sin(a)*25, 4, WHITE);
                }
            }
        }
    }

    function deserializeItem(d) {
        if (!d) return null;
        const item = new Item(
            d.name, d.color,
            d.is_processed ?? d.isProcessed ?? false,
            d.is_vessel ?? d.isVessel ?? false
        );
        item.bundle = d.bundle || [];
        item.dishName = d.dish_name ?? d.dishName ?? null;
        item.dishColor = d.dish_color ?? d.dishColor ?? null;
        return item;
    }

    // ========== STATION ==========
    class Station {
        constructor(name, x, y, w, h) {
            this.name = name; this.x = x; this.y = y; this.w = w; this.h = h;
            this.color = STATION_COLORS[name.includes("Crate") ? "Crate" : name];
            this.progress = 0; this.isHighlighted = false;
            this.heldItem = null; this.isCooking = false;
            this.vesselCount = 0; this.activeHolders = 0;
        }

        applyServerState(s) {
            this.heldItem = deserializeItem(s.held_item);
            if (s.vessel_count !== undefined) this.vesselCount = s.vessel_count;
            if (s.is_cooking !== undefined) this.isCooking = s.is_cooking;
            if (s.progress !== undefined) this.progress = s.progress;
            if (s.active_holders !== undefined) this.activeHolders = s.active_holders;
        }

        draw(ctx, frame) {
            const borderColor = this.isHighlighted ? TEAL : WHITE;
            drawRect(ctx, this.x+5, this.y+5, this.w, this.h, [25,20,45], 12);
            drawRect(ctx, this.x, this.y, this.w, this.h, this.color, 10);

            if (this.isHighlighted) {
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                roundRect(ctx, this.x, this.y, this.w, this.h, 10); ctx.fill();
            }
            ctx.strokeStyle = rgbToString(borderColor); ctx.lineWidth = 2;
            roundRect(ctx, this.x, this.y, this.w, this.h, 10); ctx.stroke();

            if (!this.name.includes("Crate")) {
                ctx.save();
                ctx.font = 'bold 12px Arial';
                ctx.fillStyle = rgbToString(["The Void","Vessel Return","Orb Processor"].includes(this.name) ? WHITE : [20,20,20]);
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const words = this.name.split(' ');
                const lh = 14, sy = this.y + this.h/2 - words.length*lh/2;
                words.forEach((w, i) => ctx.fillText(w, this.x+this.w/2, sy+i*lh, this.w-10));
                ctx.restore();
            }

            if (this.name === "Vessel Return") {
                for (let i = 0; i < this.vesselCount; i++) {
                    ctx.strokeStyle = rgbToString(WHITE); ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.ellipse(this.x+this.w/2, this.y+this.h/2+20-i*8, 22, 12, 0, 0, Math.PI*2); ctx.stroke();
                    ctx.strokeStyle = rgbToString([200,200,200]); ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.ellipse(this.x+this.w/2, this.y+this.h/2+20-i*8, 20, 10, 0, 0, Math.PI*2); ctx.stroke();
                }
            }

            if (this.name === "Dream Visualizer" && this.heldItem && !this.isCooking) {
                this.heldItem.draw(ctx, this.x+this.w/2, this.y-25 + Math.sin(frame*0.1)*8);
            } else if (this.heldItem) {
                this.heldItem.draw(ctx, this.x+this.w/2, this.y+this.h/2, this.heldItem.isVessel ? 1.5 : 1.0);
            }

            if (this.progress > 0 && this.progress <= 1.0 &&
                (this.name === "Orb Processor" || this.name === "Dream Visualizer")) {
                drawRect(ctx, this.x, this.y+this.h+8, this.w, 8, [50,50,50], 4);
                const barColor = (this.name === "Orb Processor" && this.activeHolders > 1) ? GOLD : TEAL;
                drawRect(ctx, this.x, this.y+this.h+8, this.w*this.progress, 8, barColor, 4);
            }

            if (this.isCooking && (this.name === "Orb Processor" || this.name === "Dream Visualizer")) {
                ctx.save();
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                if (this.name === "Orb Processor" && this.activeHolders > 1) {
                    ctx.fillStyle = 'rgba(255,215,0,0.95)';
                    ctx.fillText(`⚡ x${this.activeHolders}`, this.x+this.w/2, this.y-8);
                } else {
                    ctx.fillStyle = 'rgba(255,200,0,0.9)';
                    ctx.fillText('IN USE', this.x+this.w/2, this.y-8);
                }
                ctx.restore();
            }
        }
    }

    // ========== PLAYER ==========
    class Player {
        constructor(x, y, color) {
            this.x = x; this.y = y; this.w = 40; this.h = 40;
            this.speed = 6;
            this.color = color; this.heldItem = null;
            this.targetX = x; this.targetY = y;
        }

        move(dx, dy, stations) {
            this.x += dx * this.speed;
            for (let s of stations) {
                if (this.collidesWithStation(s)) this.x = dx > 0 ? s.x-this.w : s.x+s.w;
            }
            this.y += dy * this.speed;
            for (let s of stations) {
                if (this.collidesWithStation(s)) this.y = dy > 0 ? s.y-this.h : s.y+s.h;
            }
            this.x = Math.max(0, Math.min(WIDTH-this.w, this.x));
            this.y = Math.max(95, Math.min(HEIGHT-155, this.y));
        }

        collidesWithStation(s) {
            return this.x < s.x+s.w && this.x+this.w > s.x && this.y < s.y+s.h && this.y+this.h > s.y;
        }

        draw(ctx) {
            const cx = this.x + this.w / 2;
            const cy = this.y + this.h / 2;
            drawWizard(ctx, cx, cy, this.color);
            if (this.heldItem) this.heldItem.draw(ctx, cx + 20, cy - 18, 0.7);
        }
    }

    // ── Wizard sprite renderer ────────────────────────────────────────────────
    function drawStar(ctx, cx, cy, r, points) {
        const inner = r * 0.45;
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const rad   = i % 2 === 0 ? r : inner;
            i === 0
                ? ctx.moveTo(cx + Math.cos(angle)*rad, cy + Math.sin(angle)*rad)
                : ctx.lineTo(cx + Math.cos(angle)*rad, cy + Math.sin(angle)*rad);
        }
        ctx.closePath();
        ctx.fill();
    }

    function drawWizard(ctx, cx, cy, color) {
        const [r, g, b] = color;
        const isTeal   = r < 50  && g > 200 && b > 150;
        const isOrange = r > 200 && g < 180 && b < 50;
        const isGold   = r > 200 && g > 180 && b < 80;

        let robeColor, hatColor, hatBrim, accentColor, skinColor, hatDeco;
        if (isTeal) {
            robeColor = [42,90,200]; hatColor = [42,90,200]; hatBrim = [220,230,255];
            accentColor = [255,210,60]; skinColor = [210,170,120]; hatDeco = 'moon';
        } else if (isOrange) {
            robeColor = [220,60,130]; hatColor = [220,60,130]; hatBrim = [255,220,230];
            accentColor = [255,210,60]; skinColor = [210,170,120]; hatDeco = 'star';
        } else if (isGold) {
            robeColor = [40,160,60]; hatColor = [40,160,60]; hatBrim = [180,240,180];
            accentColor = [255,255,255]; skinColor = [210,170,120]; hatDeco = 'star';
        } else {
            // violet — purple wizard with top hat
            robeColor = [90,50,160]; hatColor = [70,35,130]; hatBrim = [90,50,160];
            accentColor = [255,210,60]; skinColor = [200,160,110]; hatDeco = 'tophat';
        }

        const rc = c => `rgb(${c[0]},${c[1]},${c[2]})`;
        const dk = (c,a) => [Math.max(0,c[0]-a),Math.max(0,c[1]-a),Math.max(0,c[2]-a)];
        const lt = (c,a) => [Math.min(255,c[0]+a),Math.min(255,c[1]+a),Math.min(255,c[2]+a)];

        ctx.save();

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.ellipse(cx, cy+17, 13, 5, 0, 0, Math.PI*2);
        ctx.fill();

        // Robe body
        ctx.fillStyle = rc(robeColor);
        ctx.beginPath(); ctx.ellipse(cx, cy+6, 14, 16, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rc(dk(robeColor,40));
        ctx.beginPath(); ctx.ellipse(cx-4, cy+10, 5, 8, -0.3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rc(lt(robeColor,40));
        ctx.beginPath(); ctx.ellipse(cx+3, cy+4, 4, 6, 0.2, 0, Math.PI*2); ctx.fill();

        // Robe star/accent
        ctx.fillStyle = hatDeco === 'tophat' ? rc([255,210,60]) : rc(accentColor);
        drawStar(ctx, cx, cy+7, 3.5, 5);

        // Head / face
        ctx.fillStyle = rc(skinColor);
        ctx.beginPath(); ctx.arc(cx, cy-4, 9, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rc(dk(skinColor,25));
        ctx.beginPath(); ctx.arc(cx-2, cy-3, 4, 0, Math.PI*2); ctx.fill();

        // Eyes
        ctx.fillStyle = '#1a0a2e';
        ctx.beginPath(); ctx.arc(cx-3, cy-5, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+3, cy-5, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(cx-2.5, cy-5.5, 0.6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+3.5, cy-5.5, 0.6, 0, Math.PI*2); ctx.fill();

        // Hair
        ctx.fillStyle = '#5c3a1e';
        ctx.beginPath(); ctx.arc(cx, cy-3, 9, Math.PI*0.6, Math.PI*2.4); ctx.fill();

        // Hat
        if (hatDeco === 'tophat') {
            ctx.fillStyle = rc(hatBrim);
            ctx.beginPath(); ctx.ellipse(cx, cy-10, 13, 4, 0, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = rc(hatColor);
            ctx.beginPath(); ctx.roundRect(cx-8, cy-26, 16, 17, 2); ctx.fill();
            ctx.fillStyle = rc(dk(hatColor,30));
            ctx.beginPath(); ctx.roundRect(cx-8, cy-26, 5, 17, 2); ctx.fill();
            ctx.fillStyle = rc(accentColor);
            ctx.fillRect(cx-8, cy-12, 16, 3);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.beginPath(); ctx.arc(cx+3, cy-21, 1, 0, Math.PI*2); ctx.fill();
        } else {
            // Pointy hat — brim
            ctx.fillStyle = rc(hatBrim);
            ctx.beginPath(); ctx.ellipse(cx, cy-10, 13, 4.5, 0, 0, Math.PI*2); ctx.fill();
            // Cone
            ctx.fillStyle = rc(hatColor);
            ctx.beginPath();
            ctx.moveTo(cx, cy-30); ctx.lineTo(cx-11, cy-10); ctx.lineTo(cx+11, cy-10);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = rc(dk(hatColor,50));
            ctx.beginPath();
            ctx.moveTo(cx, cy-30); ctx.lineTo(cx-11, cy-10); ctx.lineTo(cx-3, cy-10);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = rc(lt(hatColor,50));
            ctx.beginPath();
            ctx.moveTo(cx+1, cy-28); ctx.lineTo(cx+7, cy-13); ctx.lineTo(cx+2, cy-13);
            ctx.closePath(); ctx.fill();
            // Hat decoration
            if (hatDeco === 'moon') {
                ctx.fillStyle = 'rgba(240,230,255,0.95)';
                ctx.beginPath(); ctx.arc(cx-1, cy-22, 4, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = rc(hatColor);
                ctx.beginPath(); ctx.arc(cx+1.5, cy-22, 3, 0, Math.PI*2); ctx.fill();
            } else {
                ctx.fillStyle = rc(accentColor);
                drawStar(ctx, cx+1, cy-20, 3.5, 5);
            }
            // White pom-pom on tip
            if (isTeal || isOrange) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.beginPath(); ctx.arc(cx, cy-29, 2.5, 0, Math.PI*2); ctx.fill();
            }
        }

        ctx.restore();
    }

    // ========== GAME ==========
    class Game {
        constructor() {
            this.canvas = document.getElementById('gameCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.network = new Network();

            this.gameState = "MAIN_MENU";
            this.currentLevel = 1;
            this.playerName = "";
            this.roomCode = "";
            this.myId = null;
            this.isHost = false;
            this.connectedPlayers = [];
            this.playersDict = {};
            this.player = null;
            this.stations = [];
            this.orders = [];
            this.score = 0;
            this.gameTimer = 120;
            this.frame = 0;
            this.spawnTick = 0;
            this.redFlash = 0;
            this.greenFlash = 0;

            this.keys = {};
            this.mousePos = { x: 0, y: 0 };
            this.mouseClicked = false;
            this.spacebarPressed = false;

            this.lastSyncTime = 0;
            this.syncInterval = 16;
            this.lastDeliveryTime = 0;

            // Orb Processor state for this player
            this.lfRole = null;
            this.lfOrbInHand = null;

            // Tutorial state
            this.isTutorial   = false;
            this.tutStep      = 0;
            this.tutWaiting   = false;
            this.tutMoveLocked = false;

            // Leaderboard state
            this.leaderboardData    = [];
            this.leaderboardLevel   = 'total';
            this.leaderboardPlayers = 'all';   // 'all' | '1' | '2' | '3' | '4'
            this.levelScores        = {};       // { levelKey: score } accumulated this session
            this.levelStars         = {};       // { levelKey: stars } accumulated this session
            this.lbSubmittedId      = null;
            this.lbSubmittedParty   = null;

            this.setupEventListeners();
        }

        setupEventListeners() {
            document.addEventListener('keydown', (e) => {
                this.keys[e.key] = true;
                if (e.key === ' ' || ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))
                    e.preventDefault();
            });
            document.addEventListener('keyup', (e) => { this.keys[e.key] = false; });
            document.addEventListener('mousemove', (e) => {
                const r = this.canvas.getBoundingClientRect();
                this.mousePos = { x: e.clientX-r.left, y: e.clientY-r.top };
            });
            document.addEventListener('click', () => this.mouseClicked = true);

            document.getElementById('hostBtn').addEventListener('click', () => {
                document.getElementById('roomCode').style.display = 'none';
                this.hostGame();
            });
            document.getElementById('joinBtn').addEventListener('click', () => {
                const el = document.getElementById('roomCode');
                if (el.style.display === 'none') { el.style.display = 'block'; el.focus(); }
                else this.joinGame();
            });
            document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());
            document.getElementById('nextLevelBtn').addEventListener('click', () => this.nextLevel());
            document.getElementById('mainMenuBtn').addEventListener('click', () => this.goToMainMenu());
            document.getElementById('leaderboardBtn').addEventListener('click', () => this.openLeaderboard());
            document.getElementById('lbCloseBtn').addEventListener('click', () => this.closeLeaderboard());
            document.getElementById('lbSubmitBtn').addEventListener('click', () => this.submitLeaderboard());

            // Level tabs
            document.getElementById('lbTabTotal').addEventListener('click', () => this.setLbTab('total'));
            ['1','2','3','4'].forEach(l => {
                const btn = document.getElementById('lbTab' + l);
                if (btn) btn.addEventListener('click', () => this.setLbTab(l));
            });

            // Player-count filter tabs
            document.getElementById('lbPlayerAll').addEventListener('click', () => this.setLbPlayerFilter('all'));
            ['1','2','3','4'].forEach(n => {
                const btn = document.getElementById('lbPlayer' + n);
                if (btn) btn.addEventListener('click', () => this.setLbPlayerFilter(n));
            });

            document.getElementById('playerName').addEventListener('input', (e) => {
                this.playerName = e.target.value.substring(0, 12);
            });
            document.getElementById('roomCode').addEventListener('input', (e) => {
                this.roomCode = e.target.value.substring(0, 4).toUpperCase();
            });

            // Level select card clicks
            document.querySelectorAll('.level-card').forEach(card => {
                card.addEventListener('click', () => {
                    if (!this.isHost) return;
                    const lvl = card.dataset.level;
                    if (lvl === 'tutorial') {
                        this.selectLevel('tutorial');
                    } else {
                        this.selectLevel(parseInt(lvl));
                    }
                });
            });

            document.getElementById('tutOkBtn').addEventListener('click', () => {
                this.tutClickOk();
            });
        }

        async hostGame() {
            if (!this.playerName.trim()) return;
            this._clearSession();  // always start fresh when hosting
            try {
                const res = await this.network.send({ action: "CREATE", name: this.playerName });
                if (res?.status === "success") {
                    this.roomCode = res.code; this.isHost = true;
                    this.myId = res.player_id; this.gameState = "LOBBY";
                    this.showLobbyUI();
                }
            } catch(e) { console.error("Host error:", e); }
        }

        async joinGame() {
            if (!this.playerName.trim() || this.roomCode.length !== 4) return;
            this._clearSession();  // always start fresh when joining
            try {
                const res = await this.network.send({ action: "JOIN", code: this.roomCode, name: this.playerName });
                if (res?.status === "success") {
                    this.isHost = false; this.myId = res.player_id;
                    this.gameState = "LOBBY";
                    this.showLobbyUI();
                }
            } catch(e) { console.error("Join error:", e); }
        }

        async startGame() {
            if (!this.isHost || !this.network.connected) return;
            await this.network.send({ action: "START_GAME" });
            this.showLevelSelect();
        }

        async selectLevel(levelNum) {
            if (!this.isHost) return;
            if (this.network.connected) {
                await this.network.send({ action: "LOAD_LEVEL", level: levelNum });
            } else {
                this.loadLevel(levelNum);
            }
        }

        // ── Session persistence ───────────────────────────────────────────────

        _saveSession() {
            const myPlayer = this.playersDict[this.myId];
            sessionStorage.setItem('dw_session', JSON.stringify({
                roomCode:   this.roomCode,
                playerName: this.playerName,
                isHost:     this.isHost,
                color:      myPlayer ? myPlayer.color : null,
                level:      this.currentLevel,
            }));
        }

        _clearSession() {
            sessionStorage.removeItem('dw_session');
        }

        // On page load — if a crash session exists, ask the player if they want back in.
        async _tryResumeSession() {
            const raw = sessionStorage.getItem('dw_session');
            if (!raw) return false;
            let sess;
            try { sess = JSON.parse(raw); } catch { this._clearSession(); return false; }
            if (!sess.roomCode || !sess.playerName) { this._clearSession(); return false; }

            // Ask explicitly — avoids auto-loading stale state into a fresh game
            const resume = confirm(
                `You were disconnected from room ${sess.roomCode}.\nRejoin where you left off?`
            );
            if (!resume) { this._clearSession(); return false; }

            // Clear now so a failed rejoin never loops
            this._clearSession();

            this.playerName = sess.playerName;
            this.isHost     = sess.isHost;

            const res = await this.network.send({
                action: 'REJOIN',
                code:   sess.roomCode,
                name:   sess.playerName,
                color:  sess.color,
            });

            if (res && res.action === 'REJOINED') {
                return this._applyRejoin(res, sess.roomCode);
            }

            alert('That room is no longer active. Starting fresh.');
            return false;
        }

        // Shared rejoin logic — used by _tryResumeSession (page load)
        // and onReconnect (live mid-session drop).
        _applyRejoin(res, code) {
            this.myId     = res.player_id;
            this.roomCode = code;

            const gs  = res.game_state;
            const lvl = gs?.level ?? 1;

            // Wipe playersDict completely — no stale entries from old session
            this.playersDict = {};

            // Exclude ourselves so loadLevel doesn't create a duplicate slot
            this.connectedPlayers = (res.players || []).filter(p => p.id !== this.myId);

            // loadLevel resets stations, orders, score cleanly using connectedPlayers
            this.loadLevel(lvl);

            // Add exactly one entry for our own player
            const myMeta  = (res.players || []).find(p => p.id === this.myId);
            const myColor = myMeta ? myMeta.color : TEAL;
            this.playersDict[this.myId] = new Player(450, 350, myColor);
            this.player = this.playersDict[this.myId];

            // Apply full server state on top of the fresh layout
            if (gs) {
                if (gs.stations) {
                    for (const s of this.stations) {
                        const srv = gs.stations[s.name];
                        if (srv) s.applyServerState(srv);
                    }
                }
                this.score     = gs.score     ?? 0;
                this.orders    = gs.orders    ?? [];
                this.gameTimer = gs.game_timer ?? 120;
            }

            // Snap remote players to their last known positions
            for (const p of (res.players || [])) {
                if (p.id !== this.myId && this.playersDict[p.id]) {
                    this.playersDict[p.id].x       = p.x || 450;
                    this.playersDict[p.id].y       = p.y || 350;
                    this.playersDict[p.id].targetX = p.x || 450;
                    this.playersDict[p.id].targetY = p.y || 350;
                }
            }

            console.log('Rejoined room', code);
            return true;
        }

        async goToMainMenu() {
            if (!this.isHost) return;
            this._clearSession();   // intentional exit — don't resume this session
            if (this.network.connected) {
                await this.network.send({ action: "LOAD_LEVEL", level: 0 });
            } else {
                this.showLevelSelect();
            }
        }

        async nextLevel() {
            if (!this.isHost) return;
            if (this.isTutorial) { this.goToMainMenu(); return; }
            const stars = LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
            const passed = stars >= 1;
            let target;
            if (!passed) {
                target = this.currentLevel;
            } else if (this.currentLevel < 4) {
                target = this.currentLevel + 1;
            } else {
                this.goToMainMenu();
                return;
            }
            if (this.network.connected) {
                await this.network.send({ action: "LOAD_LEVEL", level: target });
            } else {
                this.loadLevel(target);
            }
        }

        // ── UI helpers ──────────────────────────────

        showLobbyUI() {
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('lobbyUI').style.display = 'flex';
            document.getElementById('roomCodeDisplay').textContent = this.roomCode;
            this.updateLobbyDisplay();
            this.lobbyUpdateInterval = setInterval(() => this.updateLobbyDisplay(), 500);
        }

        showLevelSelect() {
            refreshStarDisplays();
            document.getElementById('lobbyUI').style.display = 'none';
            document.getElementById('levelCompleteUI').style.display = 'none';

            const el = document.getElementById('levelSelectUI');
            el.style.display = 'flex';

            const hint = document.getElementById('levelSelectHint');
            const cards = document.querySelectorAll('.level-card');

            if (this.isHost) {
                hint.textContent = 'Choose a dream to weave.';
                cards.forEach(c => {
                    c.classList.add('host-active');
                    c.classList.remove('disabled');
                });
            } else {
                hint.textContent = 'Waiting for the host to choose…';
                cards.forEach(c => {
                    c.classList.remove('host-active');
                    c.classList.add('disabled');
                });
            }
        }

        async updateLobbyDisplay() {
            if (!this.network.connected) return;
            // Stop polling if we've moved past the lobby
            if (this.gameState !== 'LOBBY') {
                clearInterval(this.lobbyUpdateInterval);
                this.lobbyUpdateInterval = null;
                return;
            }
            const res = await this.network.send({ action: "GET_LOBBY" });
            if (res?.status === "success") {
                const prevCount = this.connectedPlayers.length;
                this.connectedPlayers = res.players;

                document.getElementById('playerCountDisplay').textContent =
                    `dreamers (${res.players.length}/4)`;

                if (res.players.length !== prevCount) {
                    const list = document.getElementById('playersList');
                    list.innerHTML = '';
                    for (let p of res.players) {
                        const item = document.createElement('div'); item.className = 'player-item';
                        const dot = document.createElement('div'); dot.className = 'player-color-dot';
                        dot.style.backgroundColor = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
                        item.appendChild(dot); item.appendChild(document.createTextNode(p.name));
                        list.appendChild(item);
                    }
                }

                if (this.isHost) {
                    document.getElementById('startGameBtn').style.display =
                        res.players.length > 0 ? 'block' : 'none';
                }

                if (!this.isHost && res.game_started && this.gameState === "LOBBY") {
                    clearInterval(this.lobbyUpdateInterval);
                    this.gameState = "LEVEL_SELECT";
                    this.showLevelSelect();
                }
            }
        }

        loadLevel(levelNum) {
            clearInterval(this.lobbyUpdateInterval);
            this.lobbyUpdateInterval = null;
            document.getElementById('lobbyUI').style.display = 'none';
            document.getElementById('levelSelectUI').style.display = 'none';
            document.getElementById('levelCompleteUI').style.display = 'none';
            document.getElementById('tutorialDialog').style.display = 'none';

            this.isTutorial = (levelNum === 'tutorial');
            this.currentLevel = levelNum;
            this.gameTimer = this.isTutorial ? Infinity : 120;
            this.gameState = "PLAYING";

            // Fixed starting positions per player slot for each level
            // Slots 0-3 correspond to join order (color index)
            const STARTS = {
                'tutorial': [[450,350],[350,350],[550,350],[400,400]],
                1:          [[450,350],[350,350],[550,350],[400,400]],
                2:          [[450,350],[350,350],[550,350],[400,400]],
                3:          [[450,350],[350,350],[550,350],[400,400]],
                4:          [[450,350],[350,350],[550,350],[400,400]],
            };
            const starts = STARTS[levelNum] || [[450,350],[350,350],[550,350],[400,400]];

            this.connectedPlayers.forEach((p, idx) => {
                const [sx, sy] = starts[idx] || starts[0];
                this.playersDict[p.id] = new Player(sx, sy, p.color);
            });
            if (!this.playersDict[this.myId]) {
                // Our slot is after all connectedPlayers
                const myIdx = this.connectedPlayers.length;
                const [sx, sy] = starts[myIdx] || starts[0];
                this.playersDict[this.myId] = new Player(sx, sy, TEAL);
            }
            this.player = this.playersDict[this.myId];

            this.orders = []; this.score = 0; this.frame = 0; this.spawnTick = 0;
            this.redFlash = 0; this.greenFlash = 0; this.lastDeliveryTime = 0;
            this.lfRole = null; this.lfOrbInHand = null;
            this.tutStep = 0; this.tutWaiting = false; this.tutMoveLocked = false;
            // Clear held items for all players — no carrying items between levels
            for (const p of Object.values(this.playersDict)) p.heldItem = null;
            if (this.player) this.player.heldItem = null;

            if (levelNum === 'tutorial' || levelNum === 1) {
                this.stations = [
                    new Station("Happy Orbs", 60, 110, 90, 90),
                    new Station("Calm Orbs", 160, 110, 90, 90),
                    new Station("Adventure Orbs", 260, 110, 90, 90),
                    new Station("Orb Processor", 740, 110, 100, 140),
                    new Station("Dream Visualizer", 400, 510, 140, 90),
                    new Station("Gateway", 60, 510, 110, 90),
                    new Station("Vessel Return", 200, 510, 110, 90),
                    new Station("The Void", 780, 510, 80, 90),
                    new Station("Crate 1", 380, 280, 60, 60),
                    new Station("Crate 2", 450, 280, 60, 60),
                    new Station("Crate 3", 520, 280, 60, 60),
                ];
            } else if (levelNum === 2) {
                this.stations = [
                    new Station("Happy Orbs", 740, 510, 90, 90),
                    new Station("Calm Orbs", 640, 510, 90, 90),
                    new Station("Adventure Orbs", 540, 510, 90, 90),
                    new Station("Orb Processor", 60, 110, 100, 140),
                    new Station("Dream Visualizer", 400, 110, 140, 90),
                    new Station("Gateway", 740, 110, 110, 90),
                    new Station("Vessel Return", 600, 110, 110, 90),
                    new Station("The Void", 60, 510, 80, 90),
                    new Station("Crate 1", 380, 320, 60, 60),
                    new Station("Crate 2", 450, 320, 60, 60),
                    new Station("Crate 3", 520, 320, 60, 60),
                ];
            } else if (levelNum === 3) {
                this.stations = [
                    new Station("Happy Orbs", 60, 300, 90, 90),
                    new Station("Calm Orbs", 60, 410, 90, 90),
                    new Station("Adventure Orbs", 60, 190, 90, 90),
                    new Station("Orb Processor", 400, 110, 140, 120),
                    new Station("Dream Visualizer", 750, 300, 110, 110),
                    new Station("Gateway", 400, 510, 140, 90),
                    new Station("Vessel Return", 750, 510, 110, 90),
                    new Station("The Void", 750, 110, 90, 90),
                    new Station("Crate 1", 220, 240, 60, 60),
                    new Station("Crate 2", 220, 340, 60, 60),
                    new Station("Crate 3", 220, 440, 60, 60),
                ];
            } else {
                this.stations = [
                    new Station("Happy Orbs", 160, 110, 90, 90),
                    new Station("Calm Orbs", 270, 110, 90, 90),
                    new Station("Adventure Orbs", 60, 110, 90, 90),
                    new Station("Orb Processor", 60, 430, 100, 140),
                    new Station("Dream Visualizer", 650, 430, 140, 110),
                    new Station("Gateway", 800, 110, 80, 90),
                    new Station("Vessel Return", 800, 230, 80, 90),
                    new Station("The Void", 800, 350, 80, 90),
                    new Station("Crate 1", 380, 270, 60, 60),
                    new Station("Crate 2", 460, 270, 60, 60),
                    new Station("Crate 3", 540, 270, 60, 60),
                ];
            }

            if (this.isTutorial) {
                this.orders = [
                    { name: "Deep Calm",    time: Infinity, max: Infinity, recipe: RECIPES["Deep Calm"] },
                    { name: "Joyful Slumber", time: Infinity, max: Infinity, recipe: RECIPES["Joyful Slumber"] },
                ];
                if (this.isHost) {
                    setTimeout(() => {
                        if (this.network.connected && this.network.ws) {
                            this.network.ws.send(JSON.stringify({ action: "TUTORIAL_START" }));
                        }
                    }, 400);
                }
            } else {
                for (let i = 0; i < 3; i++) this.addOrder();
            }
        }

        addOrder() {
            const twoOrb   = ["Joyful Slumber", "Action Flight", "Deep Calm"];
            const threeOrb = ["Vivid Odyssey", "Velvet Abyss", "Ember Vision"];
            let name, is_priority = false, is_three_orb = false;
            if (this.currentLevel === 4) {
                is_priority = Math.random() < 0.35;
                name = twoOrb[Math.floor(Math.random() * twoOrb.length)];
            } else if (this.currentLevel === 3) {
                name = Math.random() < 0.5
                    ? twoOrb[Math.floor(Math.random()   * twoOrb.length)]
                    : threeOrb[Math.floor(Math.random() * threeOrb.length)];
                is_three_orb = threeOrb.includes(name);
            } else {
                name = twoOrb[Math.floor(Math.random() * twoOrb.length)];
            }
            // 2-orb: 60s base; 3-orb: 90s base; priority (2-orb only): 40s
            let baseTime;
            if (is_priority) baseTime = 40;
            else if (is_three_orb) baseTime = THREE_ORB_BASE_TIME;
            else baseTime = TWO_ORB_BASE_TIME;

            this.orders.push({ name, time: baseTime, max: baseTime,
                recipe: RECIPES[name], is_priority, is_three_orb });
        }

        sendStationUpdate(payload) {
            if (!this.network.connected || !this.network.ws) return;
            try { this.network.ws.send(JSON.stringify({ action: "STATION_UPDATE", ...payload })); }
            catch(e) { console.error("STATION_UPDATE failed:", e); }
        }

        getStation(name) { return this.stations.find(s => s.name === name); }

        update(dt) {
            if (this.gameState !== "PLAYING") { this.frame++; this.mouseClicked = false; return; }

            if (!this.isTutorial) {
                this.gameTimer -= dt;
                if (this.gameTimer <= 0) { this.gameState = "LEVEL_COMPLETE"; this.showLevelComplete(); }
            }
            if (this.isTutorial && this.tutWaiting) this.tutCheckAction();

            if (this.redFlash > 0) this.redFlash -= dt;
            if (this.greenFlash > 0) this.greenFlash -= dt;

            this.spawnTick += dt;
            if (!this.isTutorial && this.spawnTick > 15 && this.orders.length < 5) { this.addOrder(); this.spawnTick = 0; }

            for (let s of this.stations) {
                s.isHighlighted = !!( this.player && this.collideRects(
                    this.player.x-2.5, this.player.y-2.5, this.player.w+5, this.player.h+5,
                    s.x, s.y, s.w, s.h
                ));
            }

            const lf = this.getStation("Orb Processor");
            if (lf) {
                if (this.lfRole === "owner" && !lf.isHighlighted && lf.isCooking) {
                    this.lfRole = null;
                    this.sendStationUpdate({ update_type: "logic_filter_cancel" });
                }
                if (this.lfRole === "helper" && !lf.isCooking) {
                    this.lfRole = null;
                }
                if (this.lfRole === "owner" && !lf.isCooking && !lf.heldItem) {
                    this.lfRole = null;
                    this.lfOrbInHand = null;
                }
            }

            const moveLocked = this.isTutorial && this.tutMoveLocked;
            const dx = moveLocked ? 0 : (this.keys['ArrowRight']?1:0) - (this.keys['ArrowLeft']?1:0);
            const dy = moveLocked ? 0 : (this.keys['ArrowDown']?1:0) - (this.keys['ArrowUp']?1:0);
            if (this.player) this.player.move(dx, dy, this.stations);

            for (const [id, pl] of Object.entries(this.playersDict)) {
                if (id != this.myId) {
                    pl.x = lerp(pl.x, pl.targetX, 0.35);
                    pl.y = lerp(pl.y, pl.targetY, 0.35);
                }
            }

            const now = Date.now();
            if (this.network.connected && this.player && now - this.lastSyncTime >= this.syncInterval) {
                this.lastSyncTime = now;
                const lfStation = this.getStation("Orb Processor");
                const nearLF = lfStation?.isHighlighted ?? false;
                const lfHolding = this.lfRole !== null && nearLF && !!this.keys[' '];
                this.network.sendRaw({
                    action: "SYNC",
                    x: Math.round(this.player.x), y: Math.round(this.player.y),
                    heldItem: this.player.heldItem ? this.player.heldItem.toServerFormat() : null,
                    lf_holding: lfHolding,
                });
            }

            const spaceDown = !!this.keys[' '];
            if (spaceDown && !this.spacebarPressed && !(this.isTutorial && this.tutMoveLocked)) {
                for (let s of this.stations) {
                    if (s.isHighlighted) this.handleStationInteraction(s);
                }
            }
            this.spacebarPressed = spaceDown;

            this.orders = this.orders.filter(o => {
                o.time -= dt;
                if (o.time <= 0) {
                    this.score -= MISSED_ORDER_PENALTY;
                    this.redFlash = 0.3; return false;
                }
                return true;
            });

            this.frame++; this.mouseClicked = false;
        }

        handleStationInteraction(s) {

            if (s.name === "The Void" && this.player.heldItem) {
                if (this.player.heldItem.isVessel) {
                    this.player.heldItem.bundle = [];
                    this.player.heldItem.dishName = null;
                    this.player.heldItem.dishColor = null;
                } else {
                    this.player.heldItem = null;
                }
                return;
            }

            if (s.name.includes("Crate")) {
                if (this.player.heldItem && s.heldItem) {
                    const pItem = this.player.heldItem, sItem = s.heldItem;
                    if (pItem.isVessel && !sItem.isVessel) {
                        if (sItem.isProcessed && (sItem.name in RECIPES || sItem.name === "Abstract Mush") && !pItem.dishName) {
                            // Finished dream orb — load onto vessel as a complete dish
                            pItem.dishName = sItem.name; pItem.dishColor = sItem.color;
                            s.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                        } else if (sItem.isProcessed && !pItem.dishName && !(sItem.name in RECIPES) && sItem.name !== "Abstract Mush") {
                            // Raw processed orb (single ingredient) — push its color onto bundle
                            pItem.bundle.push(sItem.color);
                            s.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                        }
                    } else if (!pItem.isVessel && sItem.isVessel && !sItem.dishName) {
                        if (pItem.isProcessed && (pItem.name in RECIPES || pItem.name === "Abstract Mush")) {
                            // Finished dream orb in hand — load as dish onto vessel in crate
                            sItem.dishName = pItem.name; sItem.dishColor = pItem.color; this.player.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: sItem.toServerFormat() });
                        } else if (pItem.isProcessed && !(pItem.name in RECIPES) && pItem.name !== "Abstract Mush") {
                            // Raw processed orb in hand — push color onto vessel bundle in crate
                            sItem.bundle.push(pItem.color); this.player.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: sItem.toServerFormat() });
                        }
                    }
                } else if (!this.player.heldItem && s.heldItem) {
                    this.player.heldItem = s.heldItem; s.heldItem = null;
                    this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                } else if (this.player.heldItem && !s.heldItem) {
                    s.heldItem = this.player.heldItem; this.player.heldItem = null;
                    this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: s.heldItem.toServerFormat() });
                }
                return;
            }

            if (s.name.includes("Orbs") && !this.player.heldItem) {
                this.player.heldItem = new Item(s.name.split(' ')[0], STATION_COLORS[s.name]);
                return;
            }

            if (s.name === "Vessel Return" && !this.player.heldItem && s.vesselCount > 0) {
                s.vesselCount--;
                this.player.heldItem = new Item("Vessel", WHITE, false, true);
                this.sendStationUpdate({ update_type: "vessel_take" });
                return;
            }

            if (s.name === "Orb Processor") {
                if (!s.isCooking && s.heldItem && s.heldItem.isProcessed && !this.player.heldItem) {
                    this.player.heldItem = deserializeItem(
                        s.heldItem.toServerFormat ? s.heldItem.toServerFormat() : s.heldItem);
                    this.lfRole = null;
                    this.lfOrbInHand = null;
                    this.sendStationUpdate({ update_type: "logic_filter_pickup" });
                    return;
                }
                if (s.isCooking && this.lfRole === null) {
                    this.lfRole = "helper";
                    return;
                }
                if (!s.isCooking && this.lfRole === null &&
                    this.player.heldItem && !this.player.heldItem.isVessel && !this.player.heldItem.isProcessed) {
                    this.lfOrbInHand = this.player.heldItem;
                    this.player.heldItem = null;
                    s.heldItem = this.lfOrbInHand;
                    s.isCooking = true;
                    s.progress = 0;
                    this.lfRole = "owner";
                    this.sendStationUpdate({
                        update_type: "logic_filter_place",
                        orb_item: this.lfOrbInHand.toServerFormat()
                    });
                    return;
                }
                return;
            }

            if (s.name === "Dream Visualizer") {
                if (s.isCooking) return;

                if (s.heldItem) {
                    if (!this.player.heldItem) {
                        this.player.heldItem = s.heldItem;
                        s.heldItem = null;
                        this.sendStationUpdate({ update_type: "dream_pickup" });
                    } else if (this.player.heldItem.isVessel && !this.player.heldItem.dishName && !this.player.heldItem.bundle.length) {
                        this.player.heldItem.dishName = s.heldItem.name;
                        this.player.heldItem.dishColor = s.heldItem.color;
                        s.heldItem = null;
                        this.sendStationUpdate({ update_type: "dream_pickup" });
                    }
                    return;
                }

                if (this.player.heldItem?.isVessel && this.player.heldItem.bundle.length > 0) {
                    const bundle = [...this.player.heldItem.bundle];
                    const dummy = new Item("Bundle", WHITE, true);
                    dummy.bundle = bundle;
                    s.heldItem = dummy;
                    s.isCooking = true;
                    s.progress = 0;
                    this.player.heldItem.bundle = [];
                    this.player.heldItem.dishName = null;
                    this.player.heldItem.dishColor = null;
                    this.sendStationUpdate({ update_type: "dream_cook_start", bundle });
                }
                return;
            }

            if (s.name === "Gateway" && this.player.heldItem) {
                const vesselWithDish = this.player.heldItem.isVessel && this.player.heldItem.dishName;

                // Only a vessel carrying a finished dream can be delivered.
                // Bare orbs (even finished ones) must be on a vessel first.
                if (vesselWithDish) {
                    const dishName = this.player.heldItem.dishName;
                    this.player.heldItem = null;
                    this.lastDeliveryTime = Date.now();

                    let delivered = false;
                    for (let i = 0; i < this.orders.length; i++) {
                        if (this.orders[i].name === dishName) {
                            const ord        = this.orders[i];
                            const isP        = !!ord.is_priority;
                            const is3        = !!ord.is_three_orb;
                            const base       = is3 ? 40 : 20;
                            const timeBonus  = Math.floor(ord.time / (is3 ? 1.5 : 2));
                            this.score      += (base + timeBonus) * (isP ? 2 : 1);
                            this.orders.splice(i, 1);
                            delivered = true; break;
                        }
                    }
                    if (delivered) {
                        this.greenFlash = 0.1;
                    } else {
                        // Wrong dream or order expired — small penalty, red flash
                        this.score -= 10;
                        this.redFlash = 0.3;
                    }

                    if (this.network.connected && this.network.ws) {
                        try {
                            this.network.ws.send(JSON.stringify({
                                action: "DELIVER", dish_name: dishName, is_vessel: true
                            }));
                        } catch(e) { console.error("DELIVER failed:", e); }
                    }
                }
            }
        }

        onLFCancelled(returnedOrb) {
            if (returnedOrb) this.player.heldItem = deserializeItem(returnedOrb);
            else if (this.lfOrbInHand) this.player.heldItem = this.lfOrbInHand;
            this.lfRole = null;
            this.lfOrbInHand = null;
        }

        onLFRejected() {
            if (this.lfOrbInHand) {
                this.player.heldItem = this.lfOrbInHand;
                this.lfOrbInHand = null;
            }
            this.lfRole = null;
            const lf = this.getStation("Orb Processor");
            if (lf && !lf.isCooking) { lf.heldItem = null; }
        }

        // ── TUTORIAL SYSTEM ──────────────────────────────────────────────────

        tutSteps() {
            return [
                { text: "Welcome to Dreamweaver! You weave dreams from coloured orbs. This tutorial walks you through making a Deep Calm dream — two blue orbs. Click OK to begin.", ok: true, target: null },
                { text: "Head to the Calm Orbs — the blue station in the top row.", ok: false, proximity: "Calm Orbs", target: "Calm Orbs" },
                { text: "Press SPACE to pick up a blue orb.", ok: false, target: "Calm Orbs" },
                { text: "Bring the orb to the Orb Processor on the right.", ok: false, proximity: "Orb Processor", target: "Orb Processor" },
                { text: "Press SPACE to place the orb inside the Orb Processor.", ok: false, target: "Orb Processor" },
                { text: "Hold SPACE to process the orb — keep holding until the bar is full!", ok: false, target: "Orb Processor" },
                { text: "Orb processed! Press SPACE near the Orb Processor to pick it up.", ok: false, target: "Orb Processor" },
                { text: "Head to one of the brown Crates in the middle.", ok: false, proximity: "Crate 1", target: "Crate 1" },
                { text: "Press SPACE near the crate to load the orb onto the vessel.", ok: false, target: "Crate 1" },
                { text: "One blue orb loaded! Now do the same for a second blue orb — pick it up from the Calm Orbs, process it, and load it onto the same vessel.", ok: true, target: null },
                { text: "Tip: when you deliver a vessel through the Gateway, it returns to the Vessel Return station after a few seconds. Pick it up there to reuse it!", ok: true, target: "Vessel Return" },
                { text: "Tip: if you ever mess up a vessel, bring it to The Void and press SPACE — it will clear everything on it so you can start fresh.", ok: true, target: "The Void" },
                { text: "Now process and load the second blue orb onto the same vessel.", ok: false, target: "Calm Orbs" },
                { text: "Both orbs loaded! Head to the Dream Visualizer at the bottom.", ok: false, proximity: "Dream Visualizer", target: "Dream Visualizer" },
                { text: "Press SPACE to start cooking the dream.", ok: false, target: "Dream Visualizer" },
                { text: "The Dream Visualizer is working — wait for the bar to fill completely.", ok: false, target: "Dream Visualizer" },
                { text: "Dream orb ready! Pick it up, grab a fresh Vessel from a crate, and load the dream orb onto it.", ok: false, target: "Dream Visualizer" },
                { text: "Bring the vessel to the Gateway on the bottom-left.", ok: false, proximity: "Gateway", target: "Gateway" },
                { text: "Press SPACE at the Gateway to deliver Deep Calm!", ok: false, target: "Gateway" },
                { text: "Well done! Now complete the second order on your own — Joyful Slumber needs a golden orb and a blue orb. You know what to do!", ok: true, target: null },
                { text: "Complete the Joyful Slumber order and deliver it through the Gateway.", ok: false, target: null },
                { text: "You did it! You are now a Dreamweaver. Go weave something wonderful. ✦", ok: true, target: null },
            ];
        }

        tutApplyState(state) {
            if (!this.isTutorial) return;
            const steps = this.tutSteps();
            const idx   = state.step;
            if (idx >= steps.length) return;

            this.tutStep       = idx;
            const step         = steps[idx];
            this.tutMoveLocked = !!step.ok;
            this.tutWaiting    = !step.ok;

            const dlg = document.getElementById('tutorialDialog');
            dlg.style.display = 'block';
            document.getElementById('tutStepLabel').textContent =
                `step ${idx + 1} of ${steps.length}`;
            document.getElementById('tutText').textContent = step.text;

            const okBtn = document.getElementById('tutOkBtn');
            if (!step.ok) {
                okBtn.style.display = 'none';
            } else {
                okBtn.style.display = 'block';
                const confirmed = state.confirmed || [];
                const mine      = confirmed.includes(this.myId);
                okBtn.textContent = mine ? 'Waiting for others…' : 'OK';
                okBtn.disabled    = mine;
            }

            this.tutShowArrow(step.target);

            if (state.complete) {
                document.getElementById('tutorialDialog').style.display = 'none';
                document.getElementById('tutArrow').style.display = 'none';
                this.gameState = "LEVEL_COMPLETE";
                this.showLevelComplete();
            }
        }

        tutShowArrow(stationName) {
            const arrow = document.getElementById('tutArrow');
            if (!stationName) { arrow.style.display = 'none'; return; }
            const station = this.getStation(stationName);
            if (!station)    { arrow.style.display = 'none'; return; }
            const rect   = this.canvas.getBoundingClientRect();
            const scaleX = rect.width  / WIDTH;
            const scaleY = rect.height / HEIGHT;
            const sx = rect.left + (station.x + station.w / 2) * scaleX;
            const sy = rect.top  +  station.y * scaleY - 72;
            arrow.style.display = 'block';
            arrow.style.left    = (sx - 20) + 'px';
            arrow.style.top     =  sy       + 'px';
        }

        tutClickOk() {
            if (!this.network.connected || !this.network.ws) return;
            const okBtn       = document.getElementById('tutOkBtn');
            okBtn.textContent = 'Waiting for others…';
            okBtn.disabled    = true;
            try { this.network.ws.send(JSON.stringify({ action: "TUTORIAL_OK" })); } catch(e) {}
        }

        tutSendAction(key) {
            if (!this.network.connected || !this.network.ws) return;
            try { this.network.ws.send(JSON.stringify({ action: "TUTORIAL_ACTION", key })); } catch(e) {}
        }

        tutCheckAction() {
            const steps = this.tutSteps();
            const step  = steps[this.tutStep];
            if (!step) return;

            const all = Object.values(this.playersDict);
            const lf  = this.getStation("Orb Processor");
            const dv  = this.getStation("Dream Visualizer");
            const c1  = this.getStation("Crate 1");
            const c2  = this.getStation("Crate 2");
            const c3  = this.getStation("Crate 3");

            if (step.proximity) {
                const target = this.getStation(step.proximity);
                if (target) {
                    const anyNear = all.some(pl => this.collideRects(
                        pl.x - 2.5, pl.y - 2.5, 40 + 5, 40 + 5,
                        target.x, target.y, target.w, target.h
                    ));
                    if (anyNear) { this.tutSendAction("proximity_" + this.tutStep); return; }
                }
            }

            const anyHolds      = pred => all.some(pl => pl.heldItem && pred(pl.heldItem));
            const anyVesselBund = n    => [c1,c2,c3].some(c => c?.heldItem?.isVessel && c.heldItem.bundle.length >= n)
                                       || all.some(pl => pl.heldItem?.isVessel && pl.heldItem.bundle.length >= n);
            const anyVesselDish = ()   => all.some(pl => pl.heldItem?.isVessel && pl.heldItem.dishName)
                                       || [c1,c2,c3].some(c => c?.heldItem?.isVessel && c.heldItem.dishName);

            switch (this.tutStep) {
                case 2:
                    if (anyHolds(h => !h.isVessel && !h.isProcessed && h.name === "Calm"))
                        this.tutSendAction("orb_picked"); break;
                case 4:
                    if (lf?.isCooking && lf.heldItem)
                        this.tutSendAction("lf_placed"); break;
                case 5:
                    if (lf && !lf.isCooking && lf.heldItem?.isProcessed)
                        this.tutSendAction("lf_done"); break;
                case 6:
                    if (anyHolds(h => h.isProcessed && !h.isVessel))
                        this.tutSendAction("lf_pickup"); break;
                case 8:
                    if (anyVesselBund(1))
                        this.tutSendAction("vessel_1"); break;
                case 12:
                    if (anyVesselBund(2))
                        this.tutSendAction("vessel_2"); break;
                case 14:
                    if (dv?.isCooking)
                        this.tutSendAction("dv_start"); break;
                case 15:
                    if (dv && !dv.isCooking && dv.heldItem?.isProcessed)
                        this.tutSendAction("dv_done"); break;
                case 16:
                    if (anyVesselDish())
                        this.tutSendAction("vessel_dish"); break;
                case 18:
                    if (this.score > 0 || this.orders.length < 2)
                        this.tutSendAction("delivery_1"); break;
                case 20:
                    if (this.orders.length === 0)
                        this.tutSendAction("delivery_2"); break;
            }
        }

        // ── LEADERBOARD ──────────────────────────────────────────────────────

        openLeaderboard() {
            document.getElementById('leaderboardOverlay').style.display = 'flex';
            const btn = document.getElementById('lbSubmitBtn');
            if (this.isHost) {
                document.getElementById('lbPartyNameRow').style.display = 'flex';
                btn.style.display = 'block';
                btn.disabled = false;
                if (this.lbSubmittedId !== null) {
                    btn.textContent = 'Update Score';
                    if (this.lbSubmittedParty)
                        document.getElementById('lbPartyName').value = this.lbSubmittedParty;
                } else {
                    btn.textContent = 'Add to Leaderboard';
                }
            } else {
                document.getElementById('lbPartyNameRow').style.display = 'none';
                btn.style.display = 'none';
            }
            this.fetchLeaderboard();
        }

        closeLeaderboard() {
            document.getElementById('leaderboardOverlay').style.display = 'none';
        }

        async fetchLeaderboard() {
            if (!this.network.connected) return;
            const res = await this.network.send({ action: "LEADERBOARD_GET" });
            if (res?.action === "LEADERBOARD_DATA") {
                this.leaderboardData = res.entries || [];
                this.renderLeaderboard();
            }
        }

        async submitLeaderboard() {
            if (!this.network.connected) return;
            const partyInput = document.getElementById('lbPartyName');
            const party = (partyInput.value || '').trim().substring(0, 24);
            if (!party) { partyInput.focus(); return; }

            const btn = document.getElementById('lbSubmitBtn');
            btn.disabled = true;
            btn.textContent = 'Saving…';

            // Build stars payload from session stars
            const starsPayload = {
                "1": getBestStars("1"),
                "2": getBestStars("2"),
                "3": getBestStars("3"),
                "4": getBestStars("4"),
            };
            const playerCount = this.connectedPlayers.length || 1;

            let res;
            if (this.lbSubmittedId !== null) {
                res = await this.network.send({
                    action: "LEADERBOARD_UPDATE",
                    id:     this.lbSubmittedId,
                    party,
                    scores:       this.levelScores,
                    stars:        starsPayload,
                    player_count: playerCount,
                });
            } else {
                res = await this.network.send({
                    action: "LEADERBOARD_SUBMIT",
                    party,
                    scores:       this.levelScores,
                    stars:        starsPayload,
                    player_count: playerCount,
                });
            }

            if (res?.action === "LEADERBOARD_DATA") {
                this.leaderboardData = res.entries || [];
                this.renderLeaderboard();
                this.lbSubmittedParty = party;
                if (res.submitted_id !== undefined) this.lbSubmittedId = res.submitted_id;
                btn.textContent = 'Submitted! ✦';
                btn.disabled = true;
            } else {
                btn.disabled = false;
                btn.textContent = this.lbSubmittedId !== null ? 'Update Score' : 'Add to Leaderboard';
            }
        }

        setLbTab(tab) {
            this.leaderboardLevel = tab;
            ['total','1','2','3','4'].forEach(t => {
                const btn = document.getElementById('lbTab' + (t === 'total' ? 'Total' : t));
                if (btn) btn.classList.toggle('lb-tab-active', t === tab);
            });
            this.renderLeaderboard();
        }

        setLbPlayerFilter(filter) {
            this.leaderboardPlayers = filter;
            // Update active state on player filter buttons
            ['all','1','2','3','4'].forEach(f => {
                const btn = document.getElementById('lbPlayer' + (f === 'all' ? 'All' : f));
                if (btn) btn.classList.toggle('lb-tab-active', f === filter);
            });
            this.renderLeaderboard();
        }

        renderLeaderboard() {
            const tbody = document.getElementById('lbTableBody');
            if (!tbody) return;
            const tab    = this.leaderboardLevel;
            const pcFilt = this.leaderboardPlayers;   // 'all' | '1'..'4'
            let data = this.leaderboardData;

            // Filter by player count
            if (pcFilt !== 'all') {
                data = data.filter(e => String(e.player_count || 1) === pcFilt);
            }

            // Sort by selected level tab
            const sorted = [...data].sort((a, b) => {
                const scoreA = tab === 'total' ? a.total : (a.scores[tab] || 0);
                const scoreB = tab === 'total' ? b.total : (b.scores[tab] || 0);
                return scoreB - scoreA;
            }).filter(e => tab === 'total' || (e.scores[tab] || 0) > 0);

            tbody.innerHTML = '';
            if (sorted.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:24px;">No scores yet for this filter.</td></tr>';
                return;
            }

            sorted.slice(0, 20).forEach((e, i) => {
                const score   = tab === 'total' ? e.total : (e.scores[tab] || 0);
                const medal   = i === 0 ? '✦' : i === 1 ? '◈' : i === 2 ? '◇' : (i + 1);
                const isMyRow = this.lbSubmittedId !== null && e.id === this.lbSubmittedId;

                let starsCell = '';
                if (tab !== 'total') {
                    const s = (e.stars || {})[tab] || 0;
                    starsCell = [0,1,2].map(j => j < s ? '★' : '☆').join('');
                } else {
                    const st = e.stars || {};
                    const total = (st['1']||0) + (st['2']||0) + (st['3']||0) + (st['4']||0);
                    starsCell = '★'.repeat(total) || '—';
                }

                const pcBadge = `<span class="lb-pc-badge">${e.player_count || 1}p</span>`;

                const row = document.createElement('tr');
                row.className = i < 3 ? 'lb-top-' + (i+1) : '';
                if (isMyRow) row.classList.add('lb-my-row');
                row.innerHTML = `
                    <td class="lb-rank">${medal}</td>
                    <td class="lb-party">${e.party} ${pcBadge}${isMyRow ? ' <span class="lb-you-badge">you</span>' : ''}</td>
                    <td class="lb-stars">${starsCell}</td>
                    <td class="lb-score">${score}</td>`;
                tbody.appendChild(row);
            });
        }

        showLevelComplete() {
            this._clearSession();  // level finished normally — don't resume this session
            document.getElementById('tutorialDialog').style.display = 'none';
            document.getElementById('levelCompleteUI').style.display = 'flex';

            if (this.isTutorial) {
                setBestStars('tutorial', 1);
                refreshStarDisplays();
                document.getElementById('levelResultText').textContent = 'The First Weave — Complete';
                document.getElementById('scoreDisplay').textContent = "You're ready to dream.";
                document.getElementById('starsDisplay').textContent = '★';
                document.getElementById('nextLevelBtn').style.display = 'none';
                document.getElementById('mainMenuBtn').textContent = 'Dream Atlas →';
                document.getElementById('mainMenuBtn').style.width = '100%';
                return;
            }

            const stars = LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
            const passed = stars >= 1;
            setBestStars(String(this.currentLevel), stars);
            setBestScore(String(this.currentLevel), this.score);

            // Accumulate for leaderboard (best per level this session)
            const lk = String(this.currentLevel);
            if (!this.levelScores[lk] || this.score > this.levelScores[lk])
                this.levelScores[lk] = this.score;
            // Also track best stars per level for leaderboard submission
            if (!this.levelStars[lk] || stars > this.levelStars[lk])
                this.levelStars[lk] = stars;

            refreshStarDisplays();

            document.getElementById('levelResultText').textContent =
                passed ? `Dream ${this.currentLevel} Woven` : `Dream ${this.currentLevel} Faded`;
            document.getElementById('scoreDisplay').textContent = `${this.score} dream points`;
            document.getElementById('starsDisplay').textContent =
                [0,1,2].map(i => i < stars ? '★' : '☆').join('');

            document.getElementById('mainMenuBtn').style.width = '';
            document.getElementById('nextLevelBtn').style.display = '';

            const nextBtn = document.getElementById('nextLevelBtn');
            document.getElementById('mainMenuBtn').textContent = 'Dream Atlas';
            if (passed && this.currentLevel < 4) {
                nextBtn.textContent = 'Next Dream →';
            } else if (passed) {
                nextBtn.textContent = 'All Dreams Woven ✦';
            } else {
                nextBtn.textContent = 'Retry Dream →';
            }
        }

        draw() {
            this.ctx.fillStyle = rgbToString(BLACK);
            this.ctx.fillRect(0, 0, WIDTH, HEIGHT);

            if (this.gameState === "PLAYING") {
                for (let s of this.stations) s.draw(this.ctx, this.frame);
                for (let p of Object.values(this.playersDict)) p.draw(this.ctx);

                drawRect(this.ctx, 0, 0, WIDTH, 95, [30,30,50]);

                for (let i = 0; i < this.orders.length; i++) {
                    const o = this.orders[i], tx = 10+i*175;
                    const isPriority   = !!o.is_priority;
                    const isThreeOrb   = !!o.is_three_orb;
                    const panelColor   = isPriority ? [80,20,20] : isThreeOrb ? [60,40,90] : [50,50,80];
                    const borderColor  = isPriority ? [255,80,30] : isThreeOrb ? [180,70,255] : null;

                    drawRect(this.ctx, tx, 10, 165, 75, panelColor, 8);

                    if (borderColor) {
                        this.ctx.strokeStyle = rgbToString(borderColor);
                        this.ctx.lineWidth = 2;
                        roundRect(this.ctx, tx, 10, 165, 75, 8);
                        this.ctx.stroke();
                    }

                    if (isPriority) {
                        this.ctx.font = 'bold 9px Arial';
                        this.ctx.fillStyle = rgbToString([255,80,30]);
                        this.ctx.textAlign = 'left';
                        this.ctx.fillText('⚡ PRIORITY', tx+8, 22);
                    }

                    this.ctx.font = 'bold 12px Arial';
                    this.ctx.fillStyle = rgbToString(WHITE);
                    this.ctx.textAlign = 'left';
                    this.ctx.fillText(o.name, tx+8, isPriority ? 34 : 28);

                    const dotY = isPriority ? 48 : 44;
                    for (let j = 0; j < o.recipe.length; j++)
                        drawCircle(this.ctx, tx+14+j*22, dotY, 7, o.recipe[j]);

                    const pct = Math.max(0, o.time/o.max);
                    const barColor = pct < 0.25 ? [255,80,80] : isPriority ? [255,100,40] : TEAL;
                    drawRect(this.ctx, tx+8, 65, 150*pct, 6, barColor, 3);
                }

                if (this.redFlash > 0) {
                    this.ctx.fillStyle = `rgba(255,0,0,${Math.min(1,this.redFlash/0.2)*0.5})`;
                    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
                }
                if (this.greenFlash > 0) {
                    this.ctx.fillStyle = `rgba(0,255,150,${Math.min(1,this.greenFlash/0.35)*0.4})`;
                    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
                }

                this.ctx.font = 'bold 28px Arial';
                this.ctx.textAlign = 'right';
                if (!this.isTutorial) {
                    this.ctx.fillStyle = rgbToString(GOLD);
                    this.ctx.fillText(`SCORE: ${this.score}`, WIDTH-40, HEIGHT-15);
                }
                this.ctx.textAlign = 'left';
                this.ctx.fillStyle = rgbToString(WHITE);
                if (this.isTutorial) {
                    this.ctx.fillText('TUTORIAL', 40, HEIGHT-15);
                } else {
                    this.ctx.fillText(`TIME: ${Math.max(0,Math.floor(this.gameTimer))}s`, 40, HEIGHT-15);
                }
            }
        }

        collideRects(x1,y1,w1,h1,x2,y2,w2,h2) {
            return x1<x2+w2 && x1+w1>x2 && y1<y2+h2 && y1+h1>y2;
        }

        LEVEL_STAR_THRESHOLDS = LEVEL_STAR_THRESHOLDS;
    }

    // ========== MAIN ==========
    let game;

    async function main() {
        game = new Game();

        try {
            await game.network.connect();
            console.log('Connected to server');

            // If the tab was refreshed mid-game, try to rejoin automatically
            const resumed = await game._tryResumeSession();
            if (resumed) {
                // loadLevel was called inside _tryResumeSession — game is running
                document.getElementById('mainMenu').style.display = 'none';
            }

            game.network.onDisconnect = () => {
                document.getElementById('reconnectBanner').style.display = 'flex';
                clearInterval(game.lobbyUpdateInterval);
                game.lobbyUpdateInterval = null;
                // Only save crash session if we were actively playing
                if (game.gameState === 'PLAYING') {
                    game._saveSession();
                }
            };

            game.network.onReconnect = async () => {
                document.getElementById('reconnectBanner').style.display = 'none';
                if (game.roomCode && game.myId !== null &&
                    (game.gameState === 'PLAYING' || game.gameState === 'LEVEL_SELECT' || game.gameState === 'LEVEL_COMPLETE')) {
                    const myPlayer = game.playersDict[game.myId];
                    const color = myPlayer ? myPlayer.color : null;
                    const res = await game.network.send({
                        action: 'REJOIN',
                        code: game.roomCode,
                        name: game.playerName || 'Player',
                        color,
                    });
                    if (res && res.action === 'REJOINED') {
                        game._clearSession();
                        game._applyRejoin(res, game.roomCode);
                    } else {
                        console.log('Room no longer exists, returning to menu');
                        game._clearSession();
                        game.gameState = 'MAIN_MENU';
                        document.getElementById('levelCompleteUI').style.display = 'none';
                        document.getElementById('levelSelectUI').style.display = 'none';
                        document.getElementById('tutorialDialog').style.display = 'none';
                        document.getElementById('mainMenu').style.display = 'flex';
                    }
                }
            };

            game.network.onLevelLoad = (level) => {
                if (level === 0) {
                    document.getElementById('levelCompleteUI').style.display = 'none';
                    document.getElementById('tutorialDialog').style.display = 'none';
                    game.gameState = "LEVEL_SELECT";
                    game.showLevelSelect();
                } else {
                    game.loadLevel(level);
                }
            };

            game.network.onLFCancelled = (data) => {
                game.onLFCancelled(data.returned_orb);
                if (data.game_state?.stations) {
                    for (let s of game.stations) {
                        const srv = data.game_state.stations[s.name];
                        if (srv) s.applyServerState(srv);
                    }
                }
            };

            game.network.onRejection = (data) => {
                if (data.reason === "logic_filter_busy") game.onLFRejected();
                if (data.reason === "dream_visualizer_busy") {
                    const dv = game.getStation("Dream Visualizer");
                    if (dv) { dv.heldItem = null; dv.isCooking = false; dv.progress = 0; }
                }
                if (data.game_state?.stations) {
                    for (let s of game.stations) {
                        const srv = data.game_state.stations[s.name];
                        if (srv) s.applyServerState(srv);
                    }
                }
            };

            game.network.onBroadcast = (data) => {
                if (game.gameState !== "PLAYING") return;
                if (!data.players || !data.game_state) return;

                for (let p of data.players) {
                    if (p.id !== game.myId && game.playersDict[p.id]) {
                        game.playersDict[p.id].targetX = p.x;
                        game.playersDict[p.id].targetY = p.y;
                        game.playersDict[p.id].heldItem = p.heldItem ? deserializeItem(p.heldItem) : null;
                    }
                }

                const ss = data.game_state;
                if (ss.game_timer > 0 && Math.abs(ss.game_timer - game.gameTimer) < 5)
                    game.gameTimer = ss.game_timer;
                if (Date.now() - game.lastDeliveryTime > 500) {
                    game.score = ss.score;
                    game.orders = ss.orders;
                }
                if (ss.stations) {
                    for (let station of game.stations) {
                        const srv = ss.stations[station.name];
                        if (srv) station.applyServerState(srv);
                    }
                }
                if (ss.tutorial) {
                    game.tutApplyState(ss.tutorial);
                }

                if (ss.state === "LEVEL_COMPLETE" && game.gameState === "PLAYING" && !game.isTutorial) {
                    game.gameState = "LEVEL_COMPLETE";
                    game.showLevelComplete();
                }
            };

        } catch(e) {
            console.log('Server connection failed - local mode only:', e);
        }

        let lastTime = Date.now();
        function gameLoop() {
            const now = Date.now();
            game.update((now - lastTime) / 1000);
            game.draw();
            lastTime = now;
            requestAnimationFrame(gameLoop);
        }
        gameLoop();
    }

    main();