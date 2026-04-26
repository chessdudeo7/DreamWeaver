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
        "Happy Dispenser": GOLD,
        "Calm Dispenser": SKY_BLUE,
        "Adventure Dispenser": ORANGE,
        "Logic Filter": [100, 110, 130],
        "Dream Visualizer": [180, 70, 255],
        "Gateway": [50, 255, 150],
        "Crate": [110, 70, 40],
        "Void Siphon": [20, 20, 20],
        "Vessel Return": [80, 60, 120]
    };

    const RECIPES = {
        "Joyful Slumber": [GOLD, SKY_BLUE],
        "Action Flight": [ORANGE, GOLD],
        "Deep Calm": [SKY_BLUE, SKY_BLUE]
    };

    const LEVEL_STAR_THRESHOLDS = [60, 120, 180];

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
                ctx.fillStyle = rgbToString(["Void Siphon","Vessel Return","Logic Filter"].includes(this.name) ? WHITE : [20,20,20]);
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
                (this.name === "Logic Filter" || this.name === "Dream Visualizer")) {
                drawRect(ctx, this.x, this.y+this.h+8, this.w, 8, [50,50,50], 4);
                const barColor = (this.name === "Logic Filter" && this.activeHolders > 1) ? GOLD : TEAL;
                drawRect(ctx, this.x, this.y+this.h+8, this.w*this.progress, 8, barColor, 4);
            }

            if (this.isCooking && (this.name === "Logic Filter" || this.name === "Dream Visualizer")) {
                ctx.save();
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                if (this.name === "Logic Filter" && this.activeHolders > 1) {
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
            drawRect(ctx, this.x, this.y, this.w, this.h, this.color, 8);
            if (this.heldItem) this.heldItem.draw(ctx, this.x+this.w/2, this.y+this.h/2);
        }
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

            // Logic Filter state for this player
            this.lfRole = null;       // null | "owner" | "helper"
            this.lfOrbInHand = null;  // saved orb to return if cancelled/rejected

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
                    const level = parseInt(card.dataset.level);
                    this.selectLevel(level);
                });
            });
        }

        async hostGame() {
            if (!this.playerName.trim()) return;
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
            try {
                const res = await this.network.send({ action: "JOIN", code: this.roomCode, name: this.playerName });
                if (res?.status === "success") {
                    this.isHost = false; this.myId = res.player_id;
                    this.gameState = "LOBBY"; this.showLobbyUI();
                }
            } catch(e) { console.error("Join error:", e); }
        }

        // Host clicks "Choose a Dream →" in lobby — opens the level select screen
        async startGame() {
            if (!this.isHost || !this.network.connected) return;
            // Tell server game has started so non-host lobby polls see game_started=true
            await this.network.send({ action: "START_GAME" });
            this.showLevelSelect();
        }

        // Host clicked a level card
        async selectLevel(levelNum) {
            if (!this.isHost) return;
            if (this.network.connected) {
                await this.network.send({ action: "LOAD_LEVEL", level: levelNum });
                // Host loads locally via the broadcast (onLevelLoad), just like other players
            } else {
                this.loadLevel(levelNum);
            }
        }

        // "Main menu" button — returns everyone to the dream atlas (level select)
        async goToMainMenu() {
            if (!this.isHost) return;
            // Tell server game is still in "PLAYING" state so we just show level select locally.
            // Broadcast a level_select signal so all players return to the atlas screen.
            if (this.network.connected) {
                await this.network.send({ action: "LOAD_LEVEL", level: 0 });
            } else {
                this.showLevelSelect();
            }
        }

        // "Next level" / "Retry" button on the level-complete screen
        async nextLevel() {
            if (!this.isHost) return;
            const stars = LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
            const passed = stars >= 1;
            let target;
            if (!passed) {
                target = this.currentLevel;           // retry same level
            } else if (this.currentLevel < 2) {
                target = this.currentLevel + 1;       // advance to next
            } else {
                // Last level cleared — go back to atlas
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
            const res = await this.network.send({ action: "GET_LOBBY" });
            if (res?.status === "success") {
                const prevCount = this.connectedPlayers.length;
                this.connectedPlayers = res.players;

                document.getElementById('playerCountDisplay').textContent =
                    `dreamers (${res.players.length}/4)`;

                // Only rebuild the list when the player count actually changes,
                // preventing the fade-in animation from re-triggering every 500ms.
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

                // Non-host: once game started, show the level select (waiting for host pick)
                if (!this.isHost && res.game_started && this.gameState === "LOBBY") {
                    clearInterval(this.lobbyUpdateInterval);
                    this.gameState = "LEVEL_SELECT";
                    this.showLevelSelect();
                }
            }
        }

        loadLevel(levelNum) {
            clearInterval(this.lobbyUpdateInterval);
            document.getElementById('lobbyUI').style.display = 'none';
            document.getElementById('levelSelectUI').style.display = 'none';
            document.getElementById('levelCompleteUI').style.display = 'none';

            this.currentLevel = levelNum;
            this.gameTimer = 120;
            this.gameState = "PLAYING";

            this.playersDict = {};
            for (let p of this.connectedPlayers)
                this.playersDict[p.id] = new Player(WIDTH/2, HEIGHT/2, p.color);
            if (!this.playersDict[this.myId])
                this.playersDict[this.myId] = new Player(WIDTH/2, HEIGHT/2, TEAL);
            this.player = this.playersDict[this.myId];

            this.orders = []; this.score = 0; this.frame = 0; this.spawnTick = 0;
            this.redFlash = 0; this.greenFlash = 0; this.lastDeliveryTime = 0;
            this.lfRole = null; this.lfOrbInHand = null;

            if (levelNum === 1) {
                this.stations = [
                    new Station("Happy Dispenser", 60, 110, 90, 90),
                    new Station("Calm Dispenser", 160, 110, 90, 90),
                    new Station("Adventure Dispenser", 260, 110, 90, 90),
                    new Station("Logic Filter", 740, 110, 100, 140),
                    new Station("Dream Visualizer", 400, 510, 140, 90),
                    new Station("Gateway", 60, 510, 110, 90),
                    new Station("Vessel Return", 200, 510, 110, 90),
                    new Station("Void Siphon", 780, 510, 80, 90),
                    new Station("Crate 1", 380, 280, 60, 60),
                    new Station("Crate 2", 450, 280, 60, 60),
                    new Station("Crate 3", 520, 280, 60, 60),
                ];
            } else {
                this.stations = [
                    new Station("Happy Dispenser", 740, 510, 90, 90),
                    new Station("Calm Dispenser", 640, 510, 90, 90),
                    new Station("Adventure Dispenser", 540, 510, 90, 90),
                    new Station("Logic Filter", 60, 110, 100, 140),
                    new Station("Dream Visualizer", 400, 110, 140, 90),
                    new Station("Gateway", 740, 110, 110, 90),
                    new Station("Vessel Return", 600, 110, 110, 90),
                    new Station("Void Siphon", 60, 510, 80, 90),
                    new Station("Crate 1", 380, 320, 60, 60),
                    new Station("Crate 2", 450, 320, 60, 60),
                    new Station("Crate 3", 520, 320, 60, 60),
                ];
            }

            for (let i = 0; i < 3; i++) this.addOrder();
        }

        addOrder() {
            const names = Object.keys(RECIPES);
            const name = names[Math.floor(Math.random() * names.length)];
            this.orders.push({ name, time: 60, max: 60, recipe: RECIPES[name] });
        }

        sendStationUpdate(payload) {
            if (!this.network.connected || !this.network.ws) return;
            try { this.network.ws.send(JSON.stringify({ action: "STATION_UPDATE", ...payload })); }
            catch(e) { console.error("STATION_UPDATE failed:", e); }
        }

        getStation(name) { return this.stations.find(s => s.name === name); }

        update(dt) {
            if (this.gameState !== "PLAYING") { this.frame++; this.mouseClicked = false; return; }

            this.gameTimer -= dt;
            if (this.gameTimer <= 0) { this.gameState = "LEVEL_COMPLETE"; this.showLevelComplete(); }

            if (this.redFlash > 0) this.redFlash -= dt;
            if (this.greenFlash > 0) this.greenFlash -= dt;

            this.spawnTick += dt;
            if (this.spawnTick > 15 && this.orders.length < 5) { this.addOrder(); this.spawnTick = 0; }

            // Highlight stations near player
            for (let s of this.stations) {
                s.isHighlighted = !!( this.player && this.collideRects(
                    this.player.x-2.5, this.player.y-2.5, this.player.w+5, this.player.h+5,
                    s.x, s.y, s.w, s.h
                ));
            }

            // Logic Filter role cleanup
            const lf = this.getStation("Logic Filter");
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

            // Player movement
            const dx = (this.keys['ArrowRight']?1:0) - (this.keys['ArrowLeft']?1:0);
            const dy = (this.keys['ArrowDown']?1:0) - (this.keys['ArrowUp']?1:0);
            if (this.player) this.player.move(dx, dy, this.stations);

            // Network sync — lf_holding piggybacked every 16ms
            const now = Date.now();
            if (this.network.connected && this.player && now - this.lastSyncTime >= this.syncInterval) {
                this.lastSyncTime = now;
                const lfStation = this.getStation("Logic Filter");
                const nearLF = lfStation?.isHighlighted ?? false;
                const lfHolding = this.lfRole !== null && nearLF && !!this.keys[' '];
                this.network.sendRaw({
                    action: "SYNC",
                    x: Math.round(this.player.x), y: Math.round(this.player.y),
                    heldItem: this.player.heldItem ? this.player.heldItem.toServerFormat() : null,
                    lf_holding: lfHolding,
                });
            }

            // Spacebar one-shot interactions
            const spaceDown = !!this.keys[' '];
            if (spaceDown && !this.spacebarPressed) {
                for (let s of this.stations) {
                    if (s.isHighlighted) this.handleStationInteraction(s);
                }
            }
            this.spacebarPressed = spaceDown;

            // Expire orders locally
            this.orders = this.orders.filter(o => {
                o.time -= dt;
                if (o.time <= 0) {
                    this.score = Math.max(0, this.score - MISSED_ORDER_PENALTY);
                    this.redFlash = 0.3; return false;
                }
                return true;
            });

            this.frame++; this.mouseClicked = false;
        }

        handleStationInteraction(s) {

            if (s.name === "Void Siphon" && this.player.heldItem) {
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
                        if (sItem.isProcessed && !pItem.dishName) {
                            pItem.bundle.push(...(sItem.bundle.length > 0 ? sItem.bundle : [sItem.color]));
                            s.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                        } else if ((sItem.name in RECIPES || sItem.name === "Abstract Mush") && !pItem.bundle.length) {
                            pItem.dishName = sItem.name; pItem.dishColor = sItem.color;
                            s.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                        }
                    } else if (!pItem.isVessel && sItem.isVessel && !sItem.dishName) {
                        if (pItem.isProcessed && !(pItem.name in RECIPES) && pItem.name !== "Abstract Mush") {
                            sItem.bundle.push(pItem.color); this.player.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: sItem.toServerFormat() });
                        } else if (pItem.isProcessed && (pItem.name in RECIPES || pItem.name === "Abstract Mush")) {
                            sItem.dishName = pItem.name; sItem.dishColor = pItem.color; this.player.heldItem = null;
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

            if (s.name.includes("Dispenser") && !this.player.heldItem) {
                this.player.heldItem = new Item(s.name.split(' ')[0], STATION_COLORS[s.name]);
                return;
            }

            if (s.name === "Vessel Return" && !this.player.heldItem && s.vesselCount > 0) {
                s.vesselCount--;
                this.player.heldItem = new Item("Vessel", WHITE, false, true);
                this.sendStationUpdate({ update_type: "vessel_take" });
                return;
            }

            if (s.name === "Logic Filter") {
                // Case A: done — anyone with empty hands picks up
                if (!s.isCooking && s.heldItem && s.heldItem.isProcessed && !this.player.heldItem) {
                    this.player.heldItem = deserializeItem(
                        s.heldItem.toServerFormat ? s.heldItem.toServerFormat() : s.heldItem);
                    this.lfRole = null;
                    this.lfOrbInHand = null;
                    this.sendStationUpdate({ update_type: "logic_filter_pickup" });
                    return;
                }
                // Case B: cooking, no role — become a helper (space held next tick contributes)
                if (s.isCooking && this.lfRole === null) {
                    this.lfRole = "helper";
                    return;
                }
                // Case C: idle, I have an unprocessed orb — place it
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
                const rawOrb = !this.player.heldItem.isVessel &&
                               this.player.heldItem.isProcessed &&
                               this.player.heldItem.name in RECIPES;

                if (vesselWithDish || rawOrb) {
                    const dishName = vesselWithDish ? this.player.heldItem.dishName : this.player.heldItem.name;
                    this.player.heldItem = null;
                    this.lastDeliveryTime = Date.now();

                    let delivered = false;
                    for (let i = 0; i < this.orders.length; i++) {
                        if (this.orders[i].name === dishName) {
                            this.score += 20 + Math.floor(this.orders[i].time / 2);
                            this.orders.splice(i, 1);
                            delivered = true; break;
                        }
                    }
                    if (delivered) this.greenFlash = 0.1;
                    else { this.score = Math.max(0, this.score-15); this.redFlash = 0.2; }

                    if (this.network.connected && this.network.ws) {
                        try {
                            this.network.ws.send(JSON.stringify({
                                action: "DELIVER", dish_name: dishName, is_vessel: vesselWithDish
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
            const lf = this.getStation("Logic Filter");
            if (lf && !lf.isCooking) { lf.heldItem = null; }
        }

        showLevelComplete() {
            document.getElementById('levelCompleteUI').style.display = 'flex';
            const stars = LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
            const passed = stars >= 1;

            document.getElementById('levelResultText').textContent =
                passed ? `Dream ${this.currentLevel} Woven` : `Dream ${this.currentLevel} Faded`;
            document.getElementById('scoreDisplay').textContent = `${this.score} dream points`;
            document.getElementById('starsDisplay').textContent =
                [0,1,2].map(i => stars > i ? '★' : '☆').join('');

            // Right button: next level (if passed and more levels exist) or retry
            const nextBtn = document.getElementById('nextLevelBtn');
            if (passed && this.currentLevel < 2) {
                nextBtn.textContent = 'Next Dream →';
                nextBtn.style.display = '';
            } else if (passed) {
                // Completed the last level
                nextBtn.textContent = 'All Dreams Woven ✦';
                nextBtn.style.display = '';
            } else {
                // Failed — show retry
                nextBtn.textContent = 'Retry Dream →';
                nextBtn.style.display = '';
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
                    drawRect(this.ctx, tx, 10, 165, 75, [50,50,80], 8);
                    this.ctx.font = 'bold 14px Arial';
                    this.ctx.fillStyle = rgbToString(WHITE);
                    this.ctx.fillText(o.name, tx+8, 30);
                    for (let j = 0; j < o.recipe.length; j++)
                        drawCircle(this.ctx, tx+18+j*25, 42, 8, o.recipe[j]);
                    const pct = Math.max(0, o.time/o.max);
                    drawRect(this.ctx, tx+8, 62, 150*pct, 6, pct<0.25?[255,80,80]:TEAL, 3);
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
                this.ctx.fillStyle = rgbToString(GOLD);
                this.ctx.textAlign = 'right';
                this.ctx.fillText(`SCORE: ${this.score}`, WIDTH-40, HEIGHT-15);
                this.ctx.textAlign = 'left';
                this.ctx.fillStyle = rgbToString(WHITE);
                this.ctx.fillText(`TIME: ${Math.max(0,Math.floor(this.gameTimer))}s`, 40, HEIGHT-15);
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

            game.network.onLevelLoad = (level) => {
                if (level === 0) {
                    // Return to dream atlas (level select) for all players
                    document.getElementById('levelCompleteUI').style.display = 'none';
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
                        game.playersDict[p.id].x = p.x;
                        game.playersDict[p.id].y = p.y;
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
                if (ss.state === "LEVEL_COMPLETE" && game.gameState === "PLAYING") {
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
