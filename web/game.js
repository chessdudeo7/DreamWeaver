// ========== CONSTANTS ==========
const WIDTH = 900, HEIGHT = 700;
const MISSED_ORDER_PENALTY = 20;
const FPS = 60;

// Colors
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

// ========== UTILITY FUNCTIONS ==========
function rgbToString(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function drawRect(ctx, x, y, w, h, color, borderRadius = 0) {
    ctx.fillStyle = rgbToString(color);
    if (borderRadius > 0) {
        roundRect(ctx, x, y, w, h, borderRadius);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, h);
    }
}

function drawCircle(ctx, x, y, r, color) {
    ctx.fillStyle = rgbToString(color);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ========== GAME CLASSES ==========
class Item {
    constructor(name, color, isProcessed = false, isVessel = false) {
        this.name = name;
        this.color = color;
        this.isProcessed = isProcessed;
        this.isVessel = isVessel;
        this.bundle = [];
        this.dishName = null;
        this.dishColor = null;
        this.rotationAngle = 0;  // For spinning animation when on plate
    }

    draw(ctx, x, y, scale = 1.0, onPlate = false) {
        const pulse = Math.sin(Date.now() * 0.01) * 2;
        const r = (12 + pulse) * scale;

        if (this.isVessel) {
            ctx.strokeStyle = rgbToString([120, 100, 200]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(x, y, 24, 14, 0, 0, Math.PI * 2);
            ctx.stroke();

            if (this.dishName) {
                // Draw dish on plate (stays centered, smaller for visibility)
                const dishRadius = Math.max(3, r * 0.6);
                drawCircle(ctx, x, y - 8, dishRadius, this.dishColor);
                drawCircle(ctx, x, y - 8, Math.max(1, dishRadius - 3), WHITE);
            } else if (this.bundle.length > 0) {
                // Draw items orbiting on the plate
                for (let i = 0; i < this.bundle.length; i++) {
                    const angleStep = (2 * Math.PI) / this.bundle.length;
                    const speed = Date.now() * 0.005;
                    const ox = Math.cos(i * angleStep + speed) * 14;
                    const oy = Math.sin(i * angleStep + speed) * 14;
                    drawCircle(ctx, x + ox, y - 8 + oy, 7, this.bundle[i]);
                    drawCircle(ctx, x + ox, y - 8 + oy, 3, WHITE);
                }
            }
        } else {
            // Regular orb
            ctx.strokeStyle = rgbToString(this.color);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, r + 4, 0, Math.PI * 2);
            ctx.stroke();

            drawCircle(ctx, x, y, r, this.color);
            
            if (this.isProcessed) {
                // Processed - no white hue, just solid color
            } else {
                // Unprocessed - white hue
                drawCircle(ctx, x, y, r / 2, WHITE);
            }

            // Bundle items orbit the orb
            if (this.bundle.length > 0) {
                for (let i = 0; i < this.bundle.length; i++) {
                    const angleStep = (2 * Math.PI) / this.bundle.length;
                    const speed = Date.now() * 0.005;
                    const ox = Math.cos(i * angleStep + speed) * 25;
                    const oy = Math.sin(i * angleStep + speed) * 25;
                    drawCircle(ctx, x + ox, y + oy, 8, this.bundle[i]);
                    drawCircle(ctx, x + ox, y + oy, 4, WHITE);
                }
            }
        }
    }
}

class Station {
    constructor(name, x, y, w, h) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.color = STATION_COLORS[name.includes("Crate") ? "Crate" : name];
        this.progress = 0;
        this.isHighlighted = false;
        this.heldItem = null;
        this.isCooking = false;
        this.vesselCount = 0;
    }

    draw(ctx, frame) {
        const borderColor = this.isHighlighted ? TEAL : WHITE;
        
        // Draw shadow
        drawRect(ctx, this.x + 5, this.y + 5, this.w, this.h, [25, 20, 45], 12);
        
        // Draw main rect
        drawRect(ctx, this.x, this.y, this.w, this.h, this.color, 10);

        // Draw highlight tint
        if (this.isHighlighted) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            roundRect(ctx, this.x, this.y, this.w, this.h, 10);
            ctx.fill();
        }

        // Draw border
        ctx.strokeStyle = rgbToString(borderColor);
        ctx.lineWidth = 2;
        roundRect(ctx, this.x, this.y, this.w, this.h, 10);
        ctx.stroke();

        // Draw text
        if (!this.name.includes("Crate")) {
            ctx.save(); // Save canvas state
            ctx.font = 'bold 12px Arial';
            ctx.fillStyle = rgbToString(this.name === "Void Siphon" || this.name === "Vessel Return" ? WHITE : [20, 20, 20]);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const words = this.name.split(' ');
            const lineHeight = 14;
            const totalHeight = words.length * lineHeight;
            const startY = this.y + this.h / 2 - totalHeight / 2;
            
            for (let i = 0; i < words.length; i++) {
                ctx.fillText(words[i], this.x + this.w / 2, startY + i * lineHeight, this.w - 10);
            }
            ctx.restore(); // Restore canvas state
        }

        // Draw vessel count
        if (this.name === "Vessel Return") {
            for (let i = 0; i < this.vesselCount; i++) {
                // Draw empty plate outline in white, positioned lower
                ctx.strokeStyle = rgbToString(WHITE);
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(this.x + this.w / 2, this.y + this.h / 2 + 20 - i * 8, 22, 12, 0, 0, Math.PI * 2);
                ctx.stroke();
                
                // Add a subtle inner line to show it's a plate
                ctx.strokeStyle = rgbToString([200, 200, 200]);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.ellipse(this.x + this.w / 2, this.y + this.h / 2 + 20 - i * 8, 20, 10, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Draw held item - show clearly if on plate
        if (this.name === "Dream Visualizer" && this.heldItem && !this.isCooking) {
            const bounce = Math.sin(frame * 0.1) * 8;
            this.heldItem.draw(ctx, this.x + this.w / 2, this.y - 25 + bounce);
        } else if (this.heldItem) {
            // Draw items in crates/stations
            const scale = this.heldItem.isVessel ? 1.5 : 1.0;  // Make vessels larger when holding items
            this.heldItem.draw(ctx, this.x + this.w / 2, this.y + this.h / 2, scale);
        }

        // Draw progress bar - only for Logic Filter (during processing) or Dream Visualizer (while cooking)
        if (this.progress > 0 && this.progress <= 1.0) {
            if (this.name === "Logic Filter" || (this.name === "Dream Visualizer" && this.isCooking)) {
                drawRect(ctx, this.x, this.y + this.h + 8, this.w, 8, [50, 50, 50], 4);
                drawRect(ctx, this.x, this.y + this.h + 8, this.w * this.progress, 8, TEAL, 4);
            }
        }
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.w && y >= this.y && y <= this.y + this.h;
    }
}

class Player {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.w = 40;
        this.h = 40;
        this.baseSpeed = 6;
        this.dashSpeed = 12;
        this.dashEnergy = 100;
        this.isDashing = false;
        this.color = color;
        this.heldItem = null;
    }

    move(dx, dy, stations, keys) {
        const isShiftPressed = keys['Shift'];

        if (isShiftPressed && this.dashEnergy > 0 && (dx !== 0 || dy !== 0)) {
            this.isDashing = true;
            this.dashEnergy -= 1.8;
        } else {
            this.isDashing = false;
            this.dashEnergy = Math.min(100, this.dashEnergy + 0.6);
        }

        const speed = this.isDashing ? this.dashSpeed : this.baseSpeed;

        // Move X
        this.x += dx * speed;
        for (let s of stations) {
            if (this.collidesWithStation(s)) {
                if (dx > 0) this.x = s.x - this.w;
                else this.x = s.x + s.w;
            }
        }

        // Move Y
        this.y += dy * speed;
        for (let s of stations) {
            if (this.collidesWithStation(s)) {
                if (dy > 0) this.y = s.y - this.h;
                else this.y = s.y + s.h;
            }
        }

        // Clamp to bounds
        this.x = Math.max(0, Math.min(WIDTH - this.w, this.x));
        this.y = Math.max(95, Math.min(HEIGHT - 155, this.y));
    }

    collidesWithStation(station) {
        return this.x < station.x + station.w &&
               this.x + this.w > station.x &&
               this.y < station.y + station.h &&
               this.y + this.h > station.y;
    }

    draw(ctx) {
        const color = this.isDashing ? WHITE : this.color;
        drawRect(ctx, this.x, this.y, this.w, this.h, color, 8);

        if (this.dashEnergy < 100) {
            drawRect(ctx, this.x, this.y - 12, 40, 5, [50, 50, 50]);
            drawRect(ctx, this.x, this.y - 12, 40 * (this.dashEnergy / 100), 5, SKY_BLUE);
        }

        if (this.heldItem) {
            this.heldItem.draw(ctx, this.x + this.w / 2, this.y + this.h / 2);
        }
    }
}

// ========== GAME MANAGER ==========
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
        this.vesselRespawnTimers = [];

        this.keys = {};
        this.mousePos = { x: 0, y: 0 };
        this.mouseClicked = false;
        this.spacebarPressed = false; // Track spacebar state to prevent double-triggers
        
        this.lastSyncTime = 0;
        this.syncInterval = 16; // ms between syncs (16ms ≈ 62 Hz) - faster sync for responsive gameplay
        
        this.logicFilterActive = false; // Track if player is currently processing at Logic Filter
        this.lastInteractionTime = 0; // Track when we last interacted with a station
        this.modifiedStations = new Set(); // Track which stations were modified locally to avoid overwriting
        this.modifiedStationsTimeout = null; // Track timeout for clearing modified stations

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key] = true;
            // Prevent default behavior for space and arrow keys
            if (e.key === ' ' || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
            }
        });
        document.addEventListener('keyup', (e) => this.keys[e.key] = false);
        document.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePos.x = e.clientX - rect.left;
            this.mousePos.y = e.clientY - rect.top;
        });
        document.addEventListener('click', () => this.mouseClicked = true);

        // UI Button listeners
        document.getElementById('hostBtn').addEventListener('click', () => {
            // Hide room code when hosting
            document.getElementById('roomCode').style.display = 'none';
            this.hostGame();
        });
        document.getElementById('joinBtn').addEventListener('click', () => {
            // Show room code input when joining
            const roomCodeInput = document.getElementById('roomCode');
            if (roomCodeInput.style.display === 'none') {
                roomCodeInput.style.display = 'block';
                roomCodeInput.focus();
            } else {
                this.joinGame();
            }
        });
        document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());
        document.getElementById('nextLevelBtn').addEventListener('click', () => this.nextLevel());

        // Input field listeners
        document.getElementById('playerName').addEventListener('input', (e) => {
            this.playerName = e.target.value.substring(0, 12);
        });
        document.getElementById('roomCode').addEventListener('input', (e) => {
            this.roomCode = e.target.value.substring(0, 4).toUpperCase();
        });
    }

    async hostGame() {
        if (!this.playerName.trim()) return;
        try {
            const res = await this.network.send({ action: "CREATE", name: this.playerName });
            if (res && res.status === "success") {
                this.roomCode = res.code;
                this.isHost = true;
                this.myId = res.player_id;
                this.gameState = "LOBBY";
                this.showLobbyUI();
            }
        } catch (e) {
            console.error("Host error:", e);
        }
    }

    async joinGame() {
        if (!this.playerName.trim() || this.roomCode.length !== 4) return;
        try {
            const res = await this.network.send({ action: "JOIN", code: this.roomCode, name: this.playerName });
            if (res && res.status === "success") {
                this.isHost = false;
                this.myId = res.player_id;
                this.gameState = "LOBBY";
                this.showLobbyUI();
            }
        } catch (e) {
            console.error("Join error:", e);
        }
    }

    async startGame() {
        if (this.isHost && this.network.connected) {
            await this.network.send({ action: "START_GAME" });
            this.loadLevel(1);
        }
    }

    async nextLevel() {
        const stars = this.LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
        if (stars >= 1 && this.currentLevel < 2) {
            this.loadLevel(2);
        } else {
            this.loadLevel(this.currentLevel);
        }
    }

    showLobbyUI() {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('lobbyUI').style.display = 'flex';
        document.getElementById('roomCodeDisplay').textContent = `ROOM CODE: ${this.roomCode}`;
        this.updateLobbyDisplay();
        this.lobbyUpdateInterval = setInterval(() => this.updateLobbyDisplay(), 500);
    }

    async updateLobbyDisplay() {
        if (this.network.connected) {
            const res = await this.network.send({ action: "GET_LOBBY" });
            if (res && res.status === "success") {
                this.connectedPlayers = res.players;
                document.getElementById('playerCountDisplay').textContent = `Players (${this.connectedPlayers.length}/4):`;
                
                const playersList = document.getElementById('playersList');
                playersList.innerHTML = '';
                for (let p of this.connectedPlayers) {
                    const item = document.createElement('div');
                    item.className = 'player-item';
                    const dot = document.createElement('div');
                    dot.className = 'player-color-dot';
                    const [r, g, b] = p.color;
                    dot.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
                    item.appendChild(dot);
                    item.appendChild(document.createTextNode(p.name));
                    playersList.appendChild(item);
                }

                if (this.isHost) {
                    document.getElementById('startGameBtn').style.display = this.connectedPlayers.length > 0 ? 'block' : 'none';
                }

                if (!this.isHost && res.game_started) {
                    clearInterval(this.lobbyUpdateInterval);
                    this.loadLevel(1);
                }
            }
        }
    }

    loadLevel(levelNum) {
        clearInterval(this.lobbyUpdateInterval);
        document.getElementById('lobbyUI').style.display = 'none';
        
        this.currentLevel = levelNum;
        this.gameState = "PLAYING";

        // Setup players dict
        this.playersDict = {};
        for (let p of this.connectedPlayers) {
            this.playersDict[p.id] = new Player(WIDTH / 2, HEIGHT / 2, p.color);
        }
        if (!this.playersDict[this.myId]) {
            this.playersDict[this.myId] = new Player(WIDTH / 2, HEIGHT / 2, TEAL);
        }
        this.player = this.playersDict[this.myId];

        this.orders = [];
        this.score = 0;
        this.gameTimer = 120;
        this.frame = 0;
        this.spawnTick = 0;

        // Create stations
        this.stations = [];
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
                new Station("Crate 3", 520, 280, 60, 60)
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
                new Station("Crate 3", 520, 320, 60, 60)
            ];
        }

        // Setup crates with vessels
        const crateStations = this.stations.filter(s => s.name.includes("Crate"));
        for (let i = 0; i < 3; i++) {
            crateStations[i].heldItem = new Item("Vessel", WHITE, false, true);
        }

        for (let i = 0; i < 3; i++) {
            this.addOrder();
        }
    }

    addOrder() {
        const names = Object.keys(RECIPES);
        const name = names[Math.floor(Math.random() * names.length)];
        this.orders.push({
            name: name,
            time: 60,
            max: 60,
            recipe: RECIPES[name]
        });
    }

    update(dt) {
        if (this.gameState === "PLAYING") {
            this.gameTimer -= dt;
            if (this.gameTimer <= 0) {
                this.gameState = "LEVEL_COMPLETE";
                this.showLevelComplete();
            }

            if (this.redFlash > 0) this.redFlash -= dt;

            // Update vessel timers
            this.vesselRespawnTimers = this.vesselRespawnTimers.map(t => t - dt).filter(t => {
                if (t <= 0) {
                    for (let s of this.stations) {
                        if (s.name === "Vessel Return" && s.vesselCount < 3) s.vesselCount++;
                    }
                    return false;
                }
                return true;
            });

            this.spawnTick += dt;
            if (this.spawnTick > 15 && this.orders.length < 5) {
                this.addOrder();
                this.spawnTick = 0;
            }

            // Update stations
            for (let s of this.stations) {
                if (this.player && this.collideRects(
                    this.player.x - 2.5, this.player.y - 2.5, this.player.w + 5, this.player.h + 5,
                    s.x, s.y, s.w, s.h
                )) {
                    s.isHighlighted = true;
                    // Logic Filter - requires continuous spacebar hold to process
                    if (s.name === "Logic Filter" && this.player.heldItem && !this.player.heldItem.isVessel && !this.player.heldItem.isProcessed) {
                        if (this.keys[' ']) {
                            // Spacebar is held - continue processing
                            if (!this.logicFilterActive) {
                                this.logicFilterActive = true;
                                this.network.send({
                                    action: "USE_STATION",
                                    station: "Logic Filter"
                                }).catch(() => {});
                            }
                        } else {
                            // Spacebar not held - stop processing
                            if (this.logicFilterActive) {
                                this.logicFilterActive = false;
                                this.network.send({
                                    action: "STOP_USE_STATION",
                                    station: "Logic Filter"
                                }).catch(() => {});
                            }
                        }
                    } else if (this.logicFilterActive) {
                        // Stop processing if not in Logic Filter anymore, item already processed, or spacebar released
                        if (!this.keys[' '] || !this.player.heldItem || this.player.heldItem.isProcessed) {
                            this.logicFilterActive = false;
                            this.network.send({
                                action: "STOP_USE_STATION",
                                station: "Logic Filter"
                            }).catch(() => {});
                        }
                    }
                } else {
                    s.isHighlighted = false;
                }

                if (s.name === "Dream Visualizer" && s.isCooking) {
                    s.progress += 0.006;
                    if (s.progress >= 1) {
                        let res = "Abstract Mush";
                        let resColor = [150, 0, 0];
                        if (s.heldItem.bundle.length === 2) {
                            for (let name in RECIPES) {
                                const recipe = RECIPES[name];
                                if (this.arraysEqual(s.heldItem.bundle.sort(), recipe.slice().sort())) {
                                    res = name;
                                    resColor = WHITE;
                                }
                            }
                        }
                        s.heldItem = new Item(res, resColor);
                        s.isCooking = false;
                        s.progress = 0;
                    }
                }
            }

            // Player movement
            const dx = (this.keys['ArrowRight'] ? 1 : 0) - (this.keys['ArrowLeft'] ? 1 : 0);
            const dy = (this.keys['ArrowDown'] ? 1 : 0) - (this.keys['ArrowUp'] ? 1 : 0);
            if (this.player) this.player.move(dx, dy, this.stations, this.keys);

            // Network sync - get authoritative game state from server
            // Higher frequency sync (16ms) for responsive multiplayer
            const now = Date.now();
            if (this.network.connected && this.player && (now - this.lastSyncTime) >= this.syncInterval) {
                this.lastSyncTime = now;
                
                const heldItemData = this.player.heldItem ? {
                    name: this.player.heldItem.name,
                    color: this.player.heldItem.color,
                    isProcessed: this.player.heldItem.isProcessed,
                    isVessel: this.player.heldItem.isVessel,
                    bundle: this.player.heldItem.bundle,
                    dishName: this.player.heldItem.dishName
                } : null;
                
                this.network.send({
                    action: "SYNC",
                    x: Math.round(this.player.x),
                    y: Math.round(this.player.y),
                    heldItem: heldItemData
                }).then(res => {
                    if (res && res.status === "success") {
                        const timeSinceInteraction = Date.now() - this.lastInteractionTime;
                        
                        // Update players
                        for (let p of res.players) {
                            if (p.id === this.myId && this.player) {
                                // Update own player's held item from server
                                // But be conservative if we just interacted - only update if server has different item
                                if (timeSinceInteraction < 100) {
                                    // Recent interaction - only sync if processed state changes
                                    if (p.heldItem && this.player.heldItem && p.heldItem.name === this.player.heldItem.name) {
                                        this.player.heldItem.isProcessed = p.heldItem.isProcessed;
                                    }
                                    // Don't overwrite our item if we just picked something up
                                } else {
                                    // Normal sync - trust server state
                                    if (p.heldItem) {
                                        if (this.player.heldItem && p.heldItem.name === this.player.heldItem.name) {
                                            // Same item - preserve server's processed state
                                            this.player.heldItem.isProcessed = p.heldItem.isProcessed;
                                        } else {
                                            // New item picked up
                                            const item = new Item(p.heldItem.name, p.heldItem.color, p.heldItem.isProcessed, p.heldItem.isVessel);
                                            item.bundle = p.heldItem.bundle || [];
                                            item.dishName = p.heldItem.dishName;
                                            this.player.heldItem = item;
                                        }
                                    } else {
                                        this.player.heldItem = null;
                                    }
                                }
                            } else if (p.id !== this.myId && this.playersDict[p.id]) {
                                this.playersDict[p.id].x = p.x;
                                this.playersDict[p.id].y = p.y;
                                
                                // Sync held items
                                if (p.heldItem) {
                                    const item = new Item(p.heldItem.name, p.heldItem.color, p.heldItem.isProcessed, p.heldItem.isVessel);
                                    item.bundle = p.heldItem.bundle || [];
                                    item.dishName = p.heldItem.dishName;
                                    this.playersDict[p.id].heldItem = item;
                                } else {
                                    this.playersDict[p.id].heldItem = null;
                                }
                            }
                        }
                        
                        // UPDATE: Use server's authoritative game state
                        if (res.game_state) {
                            const serverState = res.game_state;
                            this.score = serverState.score;  // Allow negative scores
                            this.gameTimer = serverState.game_timer;
                            this.orders = serverState.orders;
                            this.frame = serverState.frame;
                            
                            // Sync stations from server - only update if changed to reduce flashing
                            if (serverState.stations) {
                                for (let stationName in serverState.stations) {
                                    const serverStation = serverState.stations[stationName];
                                    const clientStation = this.stations.find(s => s.name === stationName);
                                    if (clientStation) {
                                        // Skip syncing recently modified stations to prevent overwriting local changes
                                        if (this.modifiedStations.has(stationName)) {
                                            continue;
                                        }
                                        // Preserve local vessel state (dishes on plates) when syncing
                                        const localDishName = clientStation.heldItem?.dishName;
                                        const localDishColor = clientStation.heldItem?.dishColor;
                                        const localBundle = clientStation.heldItem?.bundle ? [...clientStation.heldItem.bundle] : [];
                                        
                                        // Update station state from server
                                        clientStation.heldItem = serverStation.held_item ? 
                                            this.deserializeItem(serverStation.held_item) : null;
                                        
                                        // Restore local vessel state if it was preserved
                                        if (clientStation.heldItem && clientStation.heldItem.isVessel) {
                                            if (localDishName) clientStation.heldItem.dishName = localDishName;
                                            if (localDishColor) clientStation.heldItem.dishColor = localDishColor;
                                            if (localBundle.length > 0) clientStation.heldItem.bundle = localBundle;
                                        }
                                        
                                        clientStation.progress = serverStation.progress;
                                        clientStation.isCooking = serverStation.is_cooking;
                                        // Cap vessel count at 3 (only 3 vessels available per level)
                                        clientStation.vesselCount = Math.min(3, serverStation.vessel_count);
                                    }
                                }
                            }
                            
                            if (serverState.state === "LEVEL_COMPLETE") {
                                this.gameState = "LEVEL_COMPLETE";
                                this.showLevelComplete();
                            }
                        }
                    }
                });
            }

            // Handle space bar interactions - only trigger on key press (not while held)
            const spacebarDown = this.keys[' '];
            if (spacebarDown && !this.spacebarPressed) {
                // Spacebar just pressed (transitioned from false to true)
                for (let s of this.stations) {
                    if (s.isHighlighted) {
                        this.handleStationInteraction(s);
                    }
                }
            }
            this.spacebarPressed = spacebarDown; // Update state for next frame

            // Update orders
            this.orders = this.orders.filter(o => {
                o.time -= dt;
                if (o.time <= 0) {
                    this.score = Math.max(0, this.score - MISSED_ORDER_PENALTY);
                    this.redFlash = 0.3;
                    return false;
                }
                return true;
            });
        }

        this.frame++;
        this.mouseClicked = false;
    }

    handleStationInteraction(s) {
        // Track when we interact to avoid server overwriting our state immediately
        this.lastInteractionTime = Date.now();
        
        // Mark this station as modified locally
        this.modifiedStations.add(s.name);
        
        // Clear any existing timeout and set a new one
        if (this.modifiedStationsTimeout) {
            clearTimeout(this.modifiedStationsTimeout);
        }
        this.modifiedStationsTimeout = setTimeout(() => {
            this.modifiedStations.clear();
            this.modifiedStationsTimeout = null;
        }, 200);
        
        if (s.name === "Void Siphon" && this.player.heldItem) {
            if (this.player.heldItem.isVessel) {
                this.player.heldItem.bundle = [];
                this.player.heldItem.dishName = null;
                this.player.heldItem.dishColor = null;
            } else {
                this.player.heldItem = null;
            }
        } else if (s.name.includes("Crate")) {
            if (this.player.heldItem && s.heldItem) {
                const pItem = this.player.heldItem;
                const sItem = s.heldItem;

                if (pItem.isVessel && !sItem.isVessel) {
                    if (sItem.isProcessed && !pItem.dishName) {
                        if (sItem.bundle.length > 0) pItem.bundle.push(...sItem.bundle);
                        else pItem.bundle.push(sItem.color);
                        s.heldItem = null;
                    } else if ((sItem.name in RECIPES || sItem.name === "Abstract Mush") && !pItem.bundle.length) {
                        pItem.dishName = sItem.name;
                        pItem.dishColor = sItem.color;
                        s.heldItem = null;
                    }
                } else if (!pItem.isVessel && sItem.isVessel && !sItem.dishName && !sItem.bundle.length) {
                    if (pItem.isProcessed || pItem.name in RECIPES || pItem.name === "Abstract Mush") {
                        // Processed item or recipe - put on plate as a dish
                        sItem.dishName = pItem.name;
                        sItem.dishColor = pItem.color;
                        this.player.heldItem = null;
                    }
                }
            } else if (!this.player.heldItem && s.heldItem) {
                this.player.heldItem = s.heldItem;
                s.heldItem = null;
            } else if (this.player.heldItem && !s.heldItem) {
                s.heldItem = this.player.heldItem;
                this.player.heldItem = null;
            }
        } else if (s.name.includes("Dispenser") && !this.player.heldItem) {
            const color = STATION_COLORS[s.name];
            this.player.heldItem = new Item(s.name.split(' ')[0], color);
        } else if (s.name === "Vessel Return" && !this.player.heldItem && s.vesselCount > 0) {
            s.vesselCount--;
            this.player.heldItem = new Item("Vessel", WHITE, false, true);
        } else if (s.name === "Dream Visualizer") {
            if (s.heldItem && !s.isCooking) {
                if (this.player.heldItem && this.player.heldItem.isVessel && !this.player.heldItem.bundle.length && !this.player.heldItem.dishName) {
                    this.player.heldItem.dishName = s.heldItem.name;
                    this.player.heldItem.dishColor = s.heldItem.color;
                    s.heldItem = null;
                } else if (!this.player.heldItem) {
                    this.player.heldItem = s.heldItem;
                    s.heldItem = null;
                }
            } else if (this.player.heldItem && !s.isCooking) {
                if (!this.player.heldItem.isVessel && this.player.heldItem.bundle.length > 0) {
                    s.heldItem = this.player.heldItem;
                    this.player.heldItem = null;
                    s.isCooking = true;
                } else if (this.player.heldItem.isVessel && this.player.heldItem.bundle.length > 0) {
                    const dummy = new Item("Bundle", WHITE, true);
                    dummy.bundle = [...this.player.heldItem.bundle];
                    s.heldItem = dummy;
                    this.player.heldItem.bundle = [];
                    s.isCooking = true;
                }
            }
        } else if (s.name === "Gateway" && this.player.heldItem) {
            if (this.player.heldItem.isVessel && this.player.heldItem.dishName) {
                let delivered = false;
                for (let i = 0; i < this.orders.length; i++) {
                    if (this.orders[i].name === this.player.heldItem.dishName) {
                        this.score += (20 + Math.floor(this.orders[i].time / 2));
                        this.orders.splice(i, 1);
                        delivered = true;
                        break;
                    }
                }
                if (!delivered) {
                    this.score = Math.max(0, this.score - 15);
                    this.redFlash = 0.2;
                }
                this.vesselRespawnTimers.push(5);
                this.player.heldItem = null;
            }
        }
    }

    showLevelComplete() {
        document.getElementById('levelCompleteUI').style.display = 'flex';
        const stars = LEVEL_STAR_THRESHOLDS.filter(t => this.score >= t).length;
        const msg = stars >= 1 ? `LEVEL ${this.currentLevel} COMPLETE` : `LEVEL ${this.currentLevel} FAILED`;
        document.getElementById('levelResultText').textContent = msg;
        document.getElementById('scoreDisplay').textContent = `Final Score: ${this.score}`;
        
        let starsDisplay = '';
        for (let i = 0; i < 3; i++) {
            starsDisplay += stars > i ? '★' : '☆';
        }
        document.getElementById('starsDisplay').textContent = starsDisplay;

        const canProgress = stars >= 1 && this.currentLevel < 2;
        document.getElementById('nextLevelBtn').textContent = canProgress ? "NEXT LEVEL" : (stars < 1 ? "RESTART" : "GAME CLEAR!");
    }

    draw() {
        // Clear canvas
        this.ctx.fillStyle = rgbToString(BLACK);
        this.ctx.fillRect(0, 0, WIDTH, HEIGHT);

        if (this.gameState === "PLAYING") {
            // Draw stations
            for (let s of this.stations) {
                s.draw(this.ctx, this.frame);
            }

            // Draw players
            for (let p of Object.values(this.playersDict)) {
                p.draw(this.ctx);
            }

            // Draw HUD background
            drawRect(this.ctx, 0, 0, WIDTH, 95, [30, 30, 50]);

            // Draw orders
            for (let i = 0; i < this.orders.length; i++) {
                const o = this.orders[i];
                const tx = 10 + i * 175;
                drawRect(this.ctx, tx, 10, 165, 75, [50, 50, 80], 8);

                this.ctx.font = 'bold 14px Arial';
                this.ctx.fillStyle = rgbToString(WHITE);
                this.ctx.fillText(o.name, tx + 8, 30);

                for (let j = 0; j < o.recipe.length; j++) {
                    drawCircle(this.ctx, tx + 18 + j * 25, 42, 8, o.recipe[j]);
                }

                const pct = Math.max(0, o.time / o.max);
                const barColor = pct < 0.25 ? [255, 80, 80] : TEAL;
                drawRect(this.ctx, tx + 8, 62, 150 * pct, 6, barColor, 3);
            }

            // Draw red flash
            if (this.redFlash > 0) {
                this.ctx.fillStyle = `rgba(255, 0, 0, ${(this.redFlash / 0.2) * 0.6})`;
                this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
            }

            // Draw HUD text
            this.ctx.font = 'bold 28px Arial';
            this.ctx.fillStyle = rgbToString(GOLD);
            this.ctx.textAlign = 'right';
            this.ctx.fillText(`SCORE: ${this.score}`, WIDTH - 40, HEIGHT - 15);
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = rgbToString(WHITE);
            this.ctx.fillText(`TIME: ${Math.max(0, Math.floor(this.gameTimer))}s`, 40, HEIGHT - 15);
        }
    }

    collideRects(x1, y1, w1, h1, x2, y2, w2, h2) {
        return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
    }

    arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
        }
        return true;
    }

    itemsEqual(item1, item2) {
        if (item1 === null && item2 === null) return true;
        if (item1 === null || item2 === null) return false;
        return item1.name === item2.name && 
               item1.isProcessed === item2.isProcessed && 
               item1.isVessel === item2.isVessel &&
               this.arraysEqual(item1.bundle || [], item2.bundle || []);
    }

    deserializeItem(itemData) {
        if (!itemData) return null;
        const item = new Item(itemData.name, itemData.color, itemData.is_processed, itemData.is_vessel);
        item.bundle = itemData.bundle || [];
        item.dishName = itemData.dish_name;
        item.dishColor = itemData.dish_color;
        return item;
    }

    LEVEL_STAR_THRESHOLDS = LEVEL_STAR_THRESHOLDS;
}

// ========== MAIN LOOP ==========
let game;

async function main() {
    game = new Game();
    
    try {
        await game.network.connect();
        console.log('Connected to server');
    } catch (e) {
        console.log('Server connection failed - local mode only:', e);
    }

    let lastTime = Date.now();

    function gameLoop() {
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        game.update(dt);
        game.draw();
        requestAnimationFrame(gameLoop);
    }

    gameLoop();
}

main();
