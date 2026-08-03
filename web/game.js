// ========== CONSTANTS ==========
    const WIDTH = 900, HEIGHT = 700;

    // Fixed rendering palette (view-only; not gameplay logic)
    const BLACK = [15, 10, 25];
    const WHITE = [240, 240, 255];
    const GOLD = [255, 215, 0];
    const SKY_BLUE = [0, 191, 255];
    const ORANGE = [255, 140, 0];
    const TEAL = [0, 255, 200];

    // ── Shared gameplay config ────────────────────────────────────────────────
    // Populated by applyConfig() from web/config.json — the SAME file the Python
    // server reads (src/server.py). Never hardcode these values here; edit
    // config.json so client and server can never drift.
    let STATION_COLORS          = {};
    let RECIPES                 = {};
    let TWO_ORB_RECIPES         = [];
    let THREE_ORB_RECIPES       = [];
    let LEVELS                  = {};
    let LEVEL_STAR_THRESHOLDS   = [60, 120, 180];
    let STAR_THRESHOLDS_BY_PLAYERS = null;
    let MISSED_ORDER_PENALTY    = 20;
    let WRONG_DELIVERY_PENALTY  = 10;
    let TWO_ORB_BASE_TIME       = 60.0;
    let THREE_ORB_BASE_TIME     = 90.0;
    let PRIORITY_BASE_TIME      = 40.0;
    let GAME_DURATION           = 120.0;
    let ORDER_SPAWN_INTERVAL    = 15.0;
    let MAX_ORDERS              = 5;
    let TWO_ORB_BASE_POINTS     = 20;
    let THREE_ORB_BASE_POINTS   = 40;
    let TWO_ORB_TIME_DIVISOR    = 2;
    let THREE_ORB_TIME_DIVISOR  = 1.5;
    let PRIORITY_MULTIPLIER     = 2;
    let LEVEL3_THREE_ORB_CHANCE = 0.5;
    let LEVEL4_PRIORITY_CHANCE  = 0.4;
    let PRIORITY_LEVELS         = [4];
    let PRIORITY_THREE_ORB_BASE_TIME = 54.0;
    let DIFFICULTY_SCALING      = null;

    // Difficulty arrays are indexed by (player_count - 1), clamped to 1..4.
    function scaledByPlayers(key, playerCount) {
        const arr = DIFFICULTY_SCALING[key];
        return arr[Math.min(Math.max(playerCount, 1), 4) - 1];
    }

    async function loadConfig() {
        const res = await fetch('config.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('config.json HTTP ' + res.status);
        applyConfig(await res.json());
    }

    function applyConfig(cfg) {
        STATION_COLORS        = cfg.station_colors;
        RECIPES               = cfg.recipes;
        TWO_ORB_RECIPES       = cfg.two_orb_recipes;
        THREE_ORB_RECIPES     = cfg.three_orb_recipes;
        LEVELS                = cfg.levels;
        const t = cfg.timings, s = cfg.scoring, og = cfg.order_generation;
        LEVEL_STAR_THRESHOLDS   = s.star_thresholds;
        STAR_THRESHOLDS_BY_PLAYERS = s.star_thresholds_by_players || null;
        MISSED_ORDER_PENALTY    = s.missed_order_penalty;
        WRONG_DELIVERY_PENALTY  = s.wrong_delivery_penalty;
        TWO_ORB_BASE_POINTS     = s.two_orb_base_points;
        THREE_ORB_BASE_POINTS   = s.three_orb_base_points;
        TWO_ORB_TIME_DIVISOR    = s.two_orb_time_bonus_divisor;
        THREE_ORB_TIME_DIVISOR  = s.three_orb_time_bonus_divisor;
        PRIORITY_MULTIPLIER     = s.priority_multiplier;
        TWO_ORB_BASE_TIME       = t.two_orb_base_time;
        THREE_ORB_BASE_TIME     = t.three_orb_base_time;
        PRIORITY_BASE_TIME      = t.priority_base_time;
        GAME_DURATION           = t.game_duration;
        ORDER_SPAWN_INTERVAL    = t.order_spawn_interval;
        MAX_ORDERS              = og.max_orders;
        LEVEL3_THREE_ORB_CHANCE = og.level3_three_orb_chance;
        LEVEL4_PRIORITY_CHANCE  = og.level4_priority_chance;
        PRIORITY_LEVELS         = og.priority_levels || [4];
        PRIORITY_THREE_ORB_BASE_TIME = t.priority_three_orb_base_time;
        DIFFICULTY_SCALING      = cfg.difficulty_scaling;
    }

    // ── Star + Score progress (persisted to localStorage, survives reloads) ───
    // Best stars/score per level, shown on the level-select cards. This is the
    // player's all-time progress on this device. (Leaderboard submissions stay
    // scoped to the current session's party — see submitLeaderboard.)
    const PROGRESS_KEY = 'dw_progress_v1';
    let _savedStars  = {};
    let _savedScores = {};

    function _num(v) {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    (function loadProgress() {
        try {
            const raw = localStorage.getItem(PROGRESS_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                _savedStars  = (data.stars  && typeof data.stars  === 'object') ? data.stars  : {};
                _savedScores = (data.scores && typeof data.scores === 'object') ? data.scores : {};
            }
        } catch (e) {
            // Corrupt or unreadable save — start fresh rather than breaking the game
            console.warn('Could not read saved progress:', e);
            _savedStars = {}; _savedScores = {};
        }
    })();

    function _saveProgress() {
        try {
            localStorage.setItem(PROGRESS_KEY,
                JSON.stringify({ stars: _savedStars, scores: _savedScores }));
        } catch (e) {
            // localStorage can be unavailable (private browsing, quota, file://).
            // Progress then just lives in memory for this session — never fatal.
        }
    }

    function getBestStars(levelKey) {
        return _num(_savedStars[levelKey]);
    }
    function setBestStars(levelKey, stars) {
        if (_num(stars) > getBestStars(levelKey)) {
            _savedStars[levelKey] = _num(stars);
            _saveProgress();
        }
    }
    function getBestScore(levelKey) {
        return _num(_savedScores[levelKey]);
    }
    function setBestScore(levelKey, score) {
        if (_num(score) > getBestScore(levelKey)) {
            _savedScores[levelKey] = _num(score);
            _saveProgress();
        }
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
            const pulse = Math.sin(Date.now() * 0.006) * 1.5;
            const r = (12 + pulse) * scale;

            if (this.isVessel) {
                // A glowing dream-bubble that carries orbs or a finished dream
                const br = 22 * scale;
                radialGlow(ctx, x, y, br*1.6, DREAM.foam, 0.28, 0);
                const g = ctx.createRadialGradient(x-br*0.3, y-br*0.3, 0, x, y, br);
                g.addColorStop(0, rgbaHex(DREAM.cream, 0.55));
                g.addColorStop(0.7, rgbaHex(DREAM.foam, 0.22));
                g.addColorStop(1, rgbaHex(DREAM.foam, 0.12));
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = rgbaHex(DREAM.cream, 0.7); ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI*2); ctx.stroke();
                ctx.fillStyle = rgbaHex(DREAM.cream, 0.9);
                ctx.beginPath(); ctx.arc(x-br*0.36, y-br*0.38, br*0.16, 0, Math.PI*2); ctx.fill();
                if (this.dishName) {
                    dreamOrb(ctx, x, y, br*0.5, this.dishColor);
                } else if (this.bundle.length > 0) {
                    for (let i = 0; i < this.bundle.length; i++) {
                        const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.004;
                        const or = br*0.48;
                        dreamOrb(ctx, x+Math.cos(a)*or, y+Math.sin(a)*or, br*0.24, this.bundle[i]);
                    }
                }
            } else if (this.isProcessed && this.bundle.length > 0) {
                // Finished dream — luminous woven body with orbiting ingredient motes
                dreamOrb(ctx, x, y, r, this.color);
                const orbitR = r + 9;
                for (let i = 0; i < this.bundle.length; i++) {
                    const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.004;
                    dreamOrb(ctx, x+Math.cos(a)*orbitR, y+Math.sin(a)*orbitR, 5*scale, this.bundle[i]);
                }
                dreamSparkle(ctx, x+r*0.6, y-r*0.6, 3*scale, rgbaHex(DREAM.cream, 0.85));
            } else {
                // A single luminous orb (raw or processed)
                dreamOrb(ctx, x, y, r, this.color);
                for (let i = 0; i < this.bundle.length; i++) {
                    const a = (2*Math.PI/this.bundle.length)*i + Date.now()*0.005;
                    dreamOrb(ctx, x+Math.cos(a)*24*scale, y+Math.sin(a)*24*scale, 7*scale, this.bundle[i]);
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
            this.isJammed = false; this.jamProgress = 0;
        }

        applyServerState(s) {
            this.heldItem = deserializeItem(s.held_item);
            if (s.vessel_count !== undefined) this.vesselCount = s.vessel_count;
            if (s.is_cooking !== undefined) this.isCooking = s.is_cooking;
            if (s.progress !== undefined) this.progress = s.progress;
            if (s.active_holders !== undefined) this.activeHolders = s.active_holders;
            if (s.is_jammed !== undefined) this.isJammed = s.is_jammed;
            if (s.jam_progress !== undefined) this.jamProgress = s.jam_progress;
        }

        draw(ctx, frame) {
            const x = this.x, y = this.y, w = this.w, h = this.h;
            const cx = x + w/2, cy = y + h/2;
            const hl = this.isHighlighted;

            if (this.name.includes("Crate")) {
                drawStationCrate(ctx, x, y, w, h, hl, this.heldItem, frame);
            } else if (this.name === "Happy Orbs") {
                drawStationDispenser(ctx, x, y, w, h, hl, GOLD, this.heldItem);
            } else if (this.name === "Calm Orbs") {
                drawStationDispenser(ctx, x, y, w, h, hl, SKY_BLUE, this.heldItem);
            } else if (this.name === "Adventure Orbs") {
                drawStationDispenser(ctx, x, y, w, h, hl, ORANGE, this.heldItem);
            } else if (this.name === "Orb Processor") {
                drawStationOrbProcessor(ctx, x, y, w, h, hl, frame,
                    this.isCooking, this.progress, this.activeHolders, this.heldItem);
            } else if (this.name === "Dream Visualizer") {
                drawStationDreamVisualizer(ctx, x, y, w, h, hl, frame,
                    this.isCooking, this.progress, this.heldItem);
            } else if (this.name === "The Void") {
                drawStationTheVoid(ctx, x, y, w, h, hl, frame, this.heldItem);
            } else if (this.name === "Gateway") {
                drawStationGateway(ctx, x, y, w, h, hl, frame);
            } else if (this.name === "Vessel Return") {
                drawStationVesselReturn(ctx, x, y, w, h, hl, this.vesselCount);
            } else {
                // Fallback
                drawRect(ctx, x+4, y+4, w, h, [25,20,45], 10);
                drawRect(ctx, x, y, w, h, this.color, 10);
                if (hl) { ctx.fillStyle='rgba(255,255,255,0.12)'; roundRect(ctx,x,y,w,h,10); ctx.fill(); }
                ctx.strokeStyle = hl ? rgbToString(TEAL) : rgbToString(WHITE);
                ctx.lineWidth = 2; roundRect(ctx,x,y,w,h,10); ctx.stroke();
                if (this.heldItem) this.heldItem.draw(ctx, cx, cy);
            }

            // Progress bar (Orb Processor + Dream Visualizer)
            if (this.progress > 0 && this.progress <= 1.0 &&
                (this.name === "Orb Processor" || this.name === "Dream Visualizer")) {
                drawRect(ctx, x, y+h+6, w, 7, [40,35,60], 3);
                const barColor = (this.name === "Orb Processor" && this.activeHolders > 1) ? GOLD : TEAL;
                drawRect(ctx, x, y+h+6, w*this.progress, 7, barColor, 3);
            }

            // IN USE / boost label
            if (this.isCooking && (this.name === "Orb Processor" || this.name === "Dream Visualizer")) {
                ctx.save(); ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
                if (this.name === "Orb Processor" && this.activeHolders > 1) {
                    ctx.fillStyle = 'rgba(255,215,0,0.95)';
                    ctx.fillText(`⚡ x${this.activeHolders}`, cx, y-8);
                } else {
                    ctx.fillStyle = 'rgba(255,200,0,0.9)';
                    ctx.fillText('IN USE', cx, y-8);
                }
                ctx.restore();
            }

            // Highlight — a soft glowing outline when a dreamer is near
            if (hl) {
                ctx.save();
                ctx.strokeStyle = rgbaArr(TEAL, 0.85);
                ctx.lineWidth = 2;
                ctx.shadowColor = rgbaArr(TEAL, 0.9);
                ctx.shadowBlur = 12;
                roundRect(ctx, x-1, y-1, w+2, h+2, 14);
                ctx.stroke();
                ctx.restore();
            }

            // Jammed overlay — machine is temporarily locked (levels 5-6)
            if (this.isJammed) {
                const shake = Math.sin(frame * 0.6) * 1.5;
                ctx.save();
                ctx.translate(shake, 0);
                // red wash
                ctx.fillStyle = 'rgba(220,40,40,0.32)';
                roundRect(ctx, x, y, w, h, 10); ctx.fill();
                ctx.strokeStyle = 'rgba(255,80,60,0.95)';
                ctx.lineWidth = 3;
                roundRect(ctx, x, y, w, h, 10); ctx.stroke();
                // warning label + cooldown bar
                ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,220,210,0.95)';
                ctx.fillText('⚠ JAMMED', cx, cy - 2);
                const bw = w * 0.7;
                drawRect(ctx, cx - bw/2, cy + 8, bw, 5, [60,20,20], 2);
                drawRect(ctx, cx - bw/2, cy + 8, bw * this.jamProgress, 5, [255,90,70], 2);
                ctx.restore();
            }
        }
    }

    // ── Dream art helpers ─────────────────────────────────────────────────────
    // Stations are drawn as luminous dream-objects on the dark playfield rather
    // than as machines. These primitives are shared by the station renderers and
    // by Item.draw so orbs, moons and glows read consistently across the game.
    const DREAM = {
        lav:'#c3b3f0', foam:'#8fe8d4', moon:'#ffe9b0',
        violet:'#b98cff', cream:'#fff6e0', indigo:'#241a52'
    };
    function rgbaHex(hex, a){ const n = parseInt(hex.slice(1),16);
        return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
    function rgbaArr(c, a){ return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
    function radialGlow(ctx, x, y, r, color, a0, a1){
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
        const s = typeof color === 'string';
        g.addColorStop(0, s ? rgbaHex(color, a0) : rgbaArr(color, a0));
        g.addColorStop(1, s ? rgbaHex(color, a1) : rgbaArr(color, a1));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    function dreamSparkle(ctx, x, y, s, color){
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x-s,y); ctx.lineTo(x+s,y); ctx.moveTo(x,y-s); ctx.lineTo(x,y+s);
        ctx.stroke(); ctx.restore();
    }
    // A luminous orb — soft halo, cream-cored body, highlight. c is an [r,g,b] array.
    function dreamOrb(ctx, x, y, r, c){
        radialGlow(ctx, x, y, r*2.4, c, 0.4, 0);
        const g = ctx.createRadialGradient(x-r*0.3, y-r*0.3, 0, x, y, r);
        g.addColorStop(0, rgbaHex(DREAM.cream, 0.95));
        g.addColorStop(0.45, rgbaArr(c, 0.98));
        g.addColorStop(1, rgbaArr(c, 0.55));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rgbaHex(DREAM.cream, 0.85);
        ctx.beginPath(); ctx.arc(x-r*0.32, y-r*0.34, r*0.2, 0, Math.PI*2); ctx.fill();
    }
    // A glowing full moon — halo, luminous disc, soft craters, rim.
    function dreamMoon(ctx, cx, cy, r){
        radialGlow(ctx, cx, cy, r*1.9, DREAM.moon, 0.28, 0);
        const g = ctx.createRadialGradient(cx-r*0.3, cy-r*0.35, 0, cx, cy, r);
        g.addColorStop(0, rgbaHex(DREAM.cream, 1));
        g.addColorStop(0.6, rgbaHex(DREAM.moon, 1));
        g.addColorStop(1, '#e9c878');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rgbaHex('#e6c070', 0.5);
        [[cx-r*0.3,cy-r*0.1,r*0.22],[cx+r*0.28,cy+r*0.22,r*0.16],[cx+r*0.05,cy-r*0.4,r*0.12]]
            .forEach(([px,py,pr]) => { ctx.beginPath(); ctx.arc(px,py,pr,0,Math.PI*2); ctx.fill(); });
        ctx.strokeStyle = rgbaHex(DREAM.moon, 0.7); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
    }

    // Dispenser → a Well of starlight: a cupped basin of glowing light with a
    // floating orb rising above it.
    function drawStationDispenser(ctx, x, y, w, h, hl, orbColor) {
        const cx = x+w/2;
        const poolY = y+h*0.66, poolRx = w*0.42, poolRy = h*0.11;
        const orbY = y+h*0.34, orbR = Math.min(w,h)*0.2;
        // basin
        ctx.beginPath();
        ctx.moveTo(cx-poolRx*1.06, poolY);
        ctx.quadraticCurveTo(cx, poolY+h*0.26, cx+poolRx*1.06, poolY);
        ctx.quadraticCurveTo(cx+poolRx*0.8, poolY+h*0.05, cx, poolY+h*0.06);
        ctx.quadraticCurveTo(cx-poolRx*0.8, poolY+h*0.05, cx-poolRx*1.06, poolY);
        ctx.closePath();
        ctx.fillStyle = DREAM.indigo; ctx.fill();
        ctx.strokeStyle = rgbaHex(DREAM.lav, 0.5); ctx.lineWidth = 1.5; ctx.stroke();
        // pool of light
        ctx.save(); ctx.beginPath(); ctx.ellipse(cx, poolY, poolRx, poolRy, 0, 0, Math.PI*2); ctx.clip();
        radialGlow(ctx, cx, poolY, poolRx*1.1, orbColor, 0.9, 0.05); ctx.restore();
        ctx.beginPath(); ctx.ellipse(cx, poolY, poolRx, poolRy, 0, 0, Math.PI*2);
        ctx.strokeStyle = rgbaArr(orbColor, 0.8); ctx.lineWidth = 2; ctx.stroke();
        // rising orb + motes
        radialGlow(ctx, cx, orbY, orbR*2.2, orbColor, 0.28, 0);
        dreamOrb(ctx, cx, orbY, orbR, orbColor);
        for (let i=0;i<3;i++){ const mx=cx-w*0.2+i*w*0.2, my=orbY-orbR-6-((i*7)%12);
            ctx.fillStyle=rgbaArr(orbColor,0.6); ctx.beginPath(); ctx.arc(mx,my,1.6,0,Math.PI*2); ctx.fill(); }
    }

    // Orb Processor → a Moon-Forge: a glowing moon with raw orbs caught orbiting
    // in its pull. Orbits speed up while it's refining.
    function drawStationOrbProcessor(ctx, x, y, w, h, hl, frame, isCooking, progress, activeHolders, heldItem) {
        const cx = x+w/2, cy = y+h*0.46, R = Math.min(w,h)*0.26;
        const rx = w*0.34, ry = h*0.26;
        if (isCooking) radialGlow(ctx, cx, cy, R*1.9, DREAM.moon, 0.12+0.08*Math.sin(frame*0.1), 0);
        dreamMoon(ctx, cx, cy, R);
        // faint orbit track
        ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
        ctx.strokeStyle = rgbaHex(DREAM.lav, 0.26); ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
        // orbiting orbs
        const spd = isCooking ? 0.05 : 0.018;
        [GOLD, SKY_BLUE, ORANGE].forEach((col, i) => {
            const a = i*2.094 + frame*spd;
            dreamOrb(ctx, cx+Math.cos(a)*rx, cy+Math.sin(a)*ry, Math.min(w,h)*0.08, col);
        });
        if (heldItem && !isCooking) heldItem.draw(ctx, cx, y-16 + Math.sin(frame*0.08)*4);
    }

    // Dream Visualizer → a Scrying Pool: a still, dark pool that reflects the
    // dream forming — a moon, stars and ripples. Ripples ride outward while cooking.
    function drawStationDreamVisualizer(ctx, x, y, w, h, hl, frame, isCooking, progress, heldItem) {
        const cx = x+w/2, cy = y+h*0.52, rx = w*0.42, ry = h*0.30;
        radialGlow(ctx, cx, cy, Math.max(rx,ry)*1.5, DREAM.lav, 0.14, 0);
        // pool surface
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
        const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
        g.addColorStop(0, '#2a2170'); g.addColorStop(1, '#0f0a2e');
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = rgbaHex(DREAM.foam, 0.55); ctx.lineWidth = 2; ctx.stroke();
        // reflected scene (clipped to pool)
        ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, rx*0.96, ry*0.94, 0, 0, Math.PI*2); ctx.clip();
        radialGlow(ctx, cx+rx*0.18, cy-ry*0.15, ry*0.7, DREAM.moon, 0.5, 0);
        ctx.fillStyle = rgbaHex(DREAM.moon, 0.85);
        ctx.beginPath(); ctx.arc(cx+rx*0.18, cy-ry*0.15, ry*0.36, 0, Math.PI*2); ctx.fill();
        [[-0.4,-0.2],[-0.12,0.28],[0.5,0.2],[-0.5,0.34]].forEach(([fx,fy]) => {
            ctx.fillStyle = rgbaHex(DREAM.cream, 0.8);
            ctx.beginPath(); ctx.arc(cx+fx*rx, cy+fy*ry, 1.4, 0, Math.PI*2); ctx.fill();
        });
        ctx.strokeStyle = rgbaHex(DREAM.foam, 0.22); ctx.lineWidth = 1;
        const rp = isCooking ? (frame*0.02)%1 : 0.35;
        [0.4,0.7,1.0].forEach(base => { const rr=(base+rp)%1;
            ctx.beginPath(); ctx.ellipse(cx, cy, rx*rr, ry*rr, 0, 0, Math.PI*2); ctx.stroke(); });
        ctx.restore();
        dreamSparkle(ctx, cx-rx*0.7, cy-ry*0.7, 3, rgbaHex(DREAM.foam, 0.8));
        if (heldItem && !isCooking) heldItem.draw(ctx, cx, y-16 + Math.sin(frame*0.08)*4);
    }

    // The Void → a soft inky whirlpool that spirals inward, swallowing mistakes.
    function drawStationTheVoid(ctx, x, y, w, h, hl, frame, heldItem) {
        const cx = x+w/2, cy = y+h/2, R = Math.min(w,h)*0.38;
        radialGlow(ctx, cx, cy, R+14, DREAM.violet, 0.3, 0);
        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
        g.addColorStop(0, '#050310'); g.addColorStop(0.7, '#120a2c');
        g.addColorStop(1, rgbaHex(DREAM.violet, 0.35));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.fill();
        // spiral arcs, rotating
        ctx.save(); ctx.strokeStyle = rgbaHex(DREAM.violet, 0.5); ctx.lineWidth = 1.6;
        const rot = frame*0.03;
        for (let i=0;i<3;i++){ ctx.beginPath();
            for (let t=0;t<Math.PI*2*1.4;t+=0.2){ const rr=R*(1-t/(Math.PI*2*1.6));
                const a=t+i*2.09+rot, px=cx+Math.cos(a)*rr, py=cy+Math.sin(a)*rr;
                t===0?ctx.moveTo(px,py):ctx.lineTo(px,py); } ctx.stroke(); }
        ctx.restore();
        radialGlow(ctx, cx, cy, 7, '#e6c4ff', 0.95, 0);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
        ctx.strokeStyle = rgbaHex(DREAM.violet, 0.55); ctx.lineWidth = 2; ctx.stroke();
        if (heldItem) heldItem.draw(ctx, cx, cy);
    }

    // Gateway → a Moongate: a luminous ring of light the finished dream passes through.
    function drawStationGateway(ctx, x, y, w, h, hl, frame) {
        const cx = x+w/2, cy = y+h*0.48, R = Math.min(w,h)*0.36;
        radialGlow(ctx, cx, cy, R+22, DREAM.moon, 0.22, 0);
        ctx.save();
        for (let i=3;i>=0;i--){ ctx.beginPath(); ctx.ellipse(cx, cy, R, R, 0, 0, Math.PI*2);
            ctx.strokeStyle = rgbaHex(DREAM.moon, 0.12+i*0.03); ctx.lineWidth = 8+i*5; ctx.stroke(); }
        ctx.restore();
        ctx.beginPath(); ctx.ellipse(cx, cy, R, R, 0, 0, Math.PI*2);
        ctx.strokeStyle = rgbaHex(DREAM.cream, 0.95); ctx.lineWidth = 2.4; ctx.stroke();
        radialGlow(ctx, cx, cy, R, DREAM.foam, 0.1, 0);
        dreamMoon(ctx, cx, cy-R, Math.min(w,h)*0.09);
        for (let i=0;i<5;i++){ const a=i/5*Math.PI*2+0.4+frame*0.01;
            dreamSparkle(ctx, cx+Math.cos(a)*(R+10), cy+Math.sin(a)*(R+10), 2.4, rgbaHex(DREAM.cream, 0.6)); }
    }

    // Vessel Return → Dream-Jars: floating glass bubbles cradling little clouds.
    // Present ones are solid; missing ones are faint outlines.
    function drawStationVesselReturn(ctx, x, y, w, h, hl, vesselCount) {
        const cx = x+w/2;
        const spots = [[cx-w*0.24, y+h*0.34], [cx+w*0.24, y+h*0.30], [cx, y+h*0.64]];
        const r = Math.min(w,h)*0.18;
        for (let i=0;i<3;i++){
            const present = i < vesselCount;
            const [jx, jy] = spots[i];
            ctx.globalAlpha = present ? 1 : 0.22;
            radialGlow(ctx, jx, jy, r*1.6, DREAM.foam, 0.22, 0);
            const g = ctx.createRadialGradient(jx-r*0.3, jy-r*0.3, 0, jx, jy, r);
            g.addColorStop(0, rgbaHex(DREAM.cream, 0.5));
            g.addColorStop(0.7, rgbaHex(DREAM.foam, 0.28));
            g.addColorStop(1, rgbaHex(DREAM.foam, 0.14));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(jx, jy, r, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = rgbaHex(DREAM.cream, 0.6); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(jx, jy, r, 0, Math.PI*2); ctx.stroke();
            ctx.fillStyle = rgbaHex(DREAM.cream, 0.7);
            [[jx-r*0.3,jy+r*0.15,r*0.32],[jx+r*0.25,jy+r*0.2,r*0.28],[jx,jy,r*0.36]]
                .forEach(([a,b,cr]) => { ctx.beginPath(); ctx.arc(a,b,cr,0,Math.PI*2); ctx.fill(); });
            ctx.fillStyle = rgbaHex(DREAM.cream, 0.9);
            ctx.beginPath(); ctx.arc(jx-r*0.34, jy-r*0.36, r*0.16, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // Crate → a Cloud Cradle: a soft cloud that holds a vessel above it.
    function drawStationCrate(ctx, x, y, w, h, hl, heldItem, frame) {
        const cx = x+w/2, cy = y+h*0.64, s = Math.min(w,h);
        radialGlow(ctx, cx, cy, Math.max(w,h)*0.6, DREAM.lav, 0.14, 0);
        const puffs = [[cx-s*0.30,cy,s*0.22],[cx+s*0.30,cy,s*0.22],
                       [cx-s*0.10,cy-s*0.14,s*0.24],[cx+s*0.14,cy-s*0.12,s*0.22],[cx,cy+s*0.06,s*0.28]];
        ctx.fillStyle = rgbaHex('#d9cef2', 0.96);
        puffs.forEach(([px,py,pr]) => { ctx.beginPath(); ctx.arc(px,py,pr,0,Math.PI*2); ctx.fill(); });
        ctx.fillStyle = rgbaHex(DREAM.cream, 0.4);
        puffs.forEach(([px,py,pr]) => { ctx.beginPath(); ctx.arc(px-pr*0.3,py-pr*0.4,pr*0.4,0,Math.PI*2); ctx.fill(); });
        if (heldItem) heldItem.draw(ctx, cx, cy - s*0.3, heldItem.isVessel ? 1.05 : 0.8);
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

        // Dreamy starlit aura — keeps the wizard design but grounds it in the new
        // dream world (soft glow behind the figure + a couple of twinkles).
        radialGlow(ctx, cx, cy - 2, 26, accentColor, 0.2, 0);
        dreamSparkle(ctx, cx - 18, cy - 22, 2.6, rgbaHex(DREAM.cream, 0.6));
        dreamSparkle(ctx, cx + 19, cy - 4, 2.2, rgbaArr(accentColor, 0.7));

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
            this.gameTimer = GAME_DURATION;
            this.maxOrders = MAX_ORDERS;
            this.spawnIntervalSec = ORDER_SPAWN_INTERVAL;
            this.timerSynced = false;   // snap gameTimer to server on first broadcast of a level
            this.surgeFlash = 0;        // brief "SURGE" banner timer
            this.frame = 0;
            this.spawnTick = 0;
            this.redFlash = 0;
            this.greenFlash = 0;

            this.keys = {};
            this.mousePos = { x: 0, y: 0 };
            this.mouseClicked = false;
            this.spacebarPressed = false;

            this.lastSyncTime = 0;
            // Minimum gap between position syncs, in ms. At 16 this fired once per
            // frame (~60/s per client), and since every SYNC makes the server tick
            // AND broadcast to everyone, a 4-player room pushed ~960 msgs/sec.
            // 33ms (~30/s) halves that. Remote players still look smooth because
            // they're interpolated toward their target every frame regardless, and
            // the sim stays accurate because it advances on real elapsed dt.
            this.syncInterval = 33;
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
            ['1','2','3','4','5','6'].forEach(l => {
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

            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                if (window.gameAudio && window.gameAudio.muted) {
                    muteBtn.textContent = '🔇'; muteBtn.classList.add('muted');
                }
                muteBtn.addEventListener('click', () => {
                    const muted = window.gameAudio ? window.gameAudio.toggleMute() : false;
                    muteBtn.textContent = muted ? '🔇' : '🔊';
                    muteBtn.classList.toggle('muted', muted);
                });
            }
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
            const thresholds = this.starThresholds || LEVEL_STAR_THRESHOLDS;
            const stars = thresholds.filter(t => this.score >= t).length;
            const passed = stars >= 1;
            let target;
            if (!passed) {
                target = this.currentLevel;
            } else if (this.currentLevel < 6) {
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
            if (window.gameAudio) window.gameAudio.startMenuMusic();
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('lobbyUI').style.display = 'flex';
            document.getElementById('roomCodeDisplay').textContent = this.roomCode;
            this.updateLobbyDisplay();
            this.lobbyUpdateInterval = setInterval(() => this.updateLobbyDisplay(), 500);
        }

        showLevelSelect() {
            if (window.gameAudio) window.gameAudio.startMenuMusic();
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
            this.gameState = "PLAYING";

            // Difficulty scales with party size. The server is authoritative for the
            // clock (we snap to its timer on the first broadcast), but we compute a
            // best-effort estimate here so the HUD is right before that arrives.
            const _ids = new Set(this.connectedPlayers.map(p => p.id));
            _ids.add(this.myId);
            const playerCount = Math.max(1, _ids.size);
            this.gameTimer        = this.isTutorial ? Infinity : scaledByPlayers('duration_by_players', playerCount);
            this.maxOrders        = this.isTutorial ? MAX_ORDERS : scaledByPlayers('max_orders_by_players', playerCount);
            this.spawnIntervalSec = this.isTutorial ? ORDER_SPAWN_INTERVAL : scaledByPlayers('spawn_interval_by_players', playerCount);
            this.timerSynced      = false;
            this.surgeFlash       = 0;
            this._playerCount     = playerCount;
            // Star targets scale with party size (more hands = higher bar)
            this.starThresholds   = (STAR_THRESHOLDS_BY_PLAYERS &&
                STAR_THRESHOLDS_BY_PLAYERS[Math.min(Math.max(playerCount,1),4) - 1]) || LEVEL_STAR_THRESHOLDS;

            // Switch to the faster level soundtrack (no-op if muted/unsupported)
            if (window.gameAudio) window.gameAudio.startLevelMusic();

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

            // Station layouts come from web/config.json (shared with the server).
            // Tutorial reuses the level 1 layout, matching the server.
            const layoutKey = this.isTutorial ? '1' : String(levelNum);
            const layout = LEVELS[layoutKey] || LEVELS['1'];
            this.stations = layout.map(([name, x, y, w, h]) => new Station(name, x, y, w, h));

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
                const n = scaledByPlayers('initial_orders_by_players', this._playerCount || 1);
                if (PRIORITY_LEVELS.includes(this.currentLevel)) {
                    for (let i = 0; i < Math.max(0, n - 1); i++) this.addOrder();
                    this.addOrder(true);   // priority levels open with one guaranteed priority order
                } else {
                    for (let i = 0; i < n; i++) this.addOrder();
                }
            }
        }

        // Mirrors the server's _add_order so the brief pre-broadcast state matches.
        addOrder(forcePriority = false, timeMult = 1) {
            const twoOrb = TWO_ORB_RECIPES, threeOrb = THREE_ORB_RECIPES, all = Object.keys(RECIPES);
            const is_priority = forcePriority ||
                (PRIORITY_LEVELS.includes(this.currentLevel) && Math.random() < LEVEL4_PRIORITY_CHANCE);
            let name;
            if (this.currentLevel === 4)       name = twoOrb[Math.floor(Math.random() * twoOrb.length)];
            else if (this.currentLevel <= 2)   name = twoOrb[Math.floor(Math.random() * twoOrb.length)];
            else                               name = all[Math.floor(Math.random() * all.length)];
            const is_three_orb = threeOrb.includes(name);

            let baseTime;
            if (is_priority && is_three_orb) baseTime = PRIORITY_THREE_ORB_BASE_TIME;
            else if (is_priority)            baseTime = PRIORITY_BASE_TIME;
            else if (is_three_orb)           baseTime = THREE_ORB_BASE_TIME;
            else                             baseTime = TWO_ORB_BASE_TIME;
            baseTime *= timeMult;

            this.orders.push({ name, time: baseTime, max: baseTime,
                recipe: RECIPES[name], is_priority, is_three_orb });
        }

        sendStationUpdate(payload) {
            if (!this.network.connected || !this.network.ws) return;
            try { this.network.ws.send(JSON.stringify({ action: "STATION_UPDATE", ...payload })); }
            catch(e) { console.error("STATION_UPDATE failed:", e); }
        }

        // Per-action sound effects are intentionally disabled — music only.
        // Kept as a no-op hook so the call sites stay in place if we want cues back.
        _sfx(_name) { /* no-op */ }

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
            if (this.surgeFlash > 0) this.surgeFlash -= dt;

            this.spawnTick += dt;
            if (!this.isTutorial && this.spawnTick > this.spawnIntervalSec && this.orders.length < this.maxOrders) { this.addOrder(); this.spawnTick = 0; }

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
                    this.redFlash = 0.3;
                    return false;
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
                            this._sfx('place');
                        } else if (sItem.isProcessed && !pItem.dishName && !(sItem.name in RECIPES) && sItem.name !== "Abstract Mush") {
                            // Raw processed orb (single ingredient) — push its color onto bundle
                            pItem.bundle.push(sItem.color);
                            s.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                            this._sfx('place');
                        }
                    } else if (!pItem.isVessel && sItem.isVessel && !sItem.dishName) {
                        if (pItem.isProcessed && (pItem.name in RECIPES || pItem.name === "Abstract Mush")) {
                            // Finished dream orb in hand — load as dish onto vessel in crate
                            sItem.dishName = pItem.name; sItem.dishColor = pItem.color; this.player.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: sItem.toServerFormat() });
                            this._sfx('place');
                        } else if (pItem.isProcessed && !(pItem.name in RECIPES) && pItem.name !== "Abstract Mush") {
                            // Raw processed orb in hand — push color onto vessel bundle in crate
                            sItem.bundle.push(pItem.color); this.player.heldItem = null;
                            this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: sItem.toServerFormat() });
                            this._sfx('place');
                        }
                    }
                } else if (!this.player.heldItem && s.heldItem) {
                    this.player.heldItem = s.heldItem; s.heldItem = null;
                    this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: null });
                    this._sfx('pickup');
                } else if (this.player.heldItem && !s.heldItem) {
                    s.heldItem = this.player.heldItem; this.player.heldItem = null;
                    this.sendStationUpdate({ update_type: "item", station_name: s.name, held_item: s.heldItem.toServerFormat() });
                    this._sfx('place');
                }
                return;
            }

            if (s.name.includes("Orbs") && !this.player.heldItem) {
                this.player.heldItem = new Item(s.name.split(' ')[0], STATION_COLORS[s.name]);
                this._sfx('pickup');
                return;
            }

            if (s.name === "Vessel Return" && !this.player.heldItem && s.vesselCount > 0) {
                s.vesselCount--;
                this.player.heldItem = new Item("Vessel", WHITE, false, true);
                this.sendStationUpdate({ update_type: "vessel_take" });
                this._sfx('pickup');
                return;
            }

            if (s.name === "Orb Processor") {
                // Jammed machine — placing is blocked until it cools down
                if (s.isJammed && this.player.heldItem &&
                    !this.player.heldItem.isVessel && !this.player.heldItem.isProcessed) {
                    this._sfx('jam');
                    return;
                }
                if (!s.isCooking && s.heldItem && s.heldItem.isProcessed && !this.player.heldItem) {
                    this.player.heldItem = deserializeItem(
                        s.heldItem.toServerFormat ? s.heldItem.toServerFormat() : s.heldItem);
                    this.lfRole = null;
                    this.lfOrbInHand = null;
                    this.sendStationUpdate({ update_type: "logic_filter_pickup" });
                    this._sfx('pickup');
                    return;
                }
                if (s.isCooking && this.lfRole === null) {
                    this.lfRole = "helper";
                    return;
                }
                if (!s.isCooking && !s.isJammed && this.lfRole === null &&
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
                    this._sfx('place');
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
                        this._sfx('pickup');
                    } else if (this.player.heldItem.isVessel && !this.player.heldItem.dishName && !this.player.heldItem.bundle.length) {
                        this.player.heldItem.dishName = s.heldItem.name;
                        this.player.heldItem.dishColor = s.heldItem.color;
                        s.heldItem = null;
                        this.sendStationUpdate({ update_type: "dream_pickup" });
                        this._sfx('pickup');
                    }
                    return;
                }

                if (this.player.heldItem?.isVessel && this.player.heldItem.bundle.length > 0) {
                    // Jammed visualizer — can't start a cook until it cools down
                    if (s.isJammed) { this._sfx('jam'); return; }
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
                    this._sfx('process');
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
                            const base       = is3 ? THREE_ORB_BASE_POINTS : TWO_ORB_BASE_POINTS;
                            const divisor    = is3 ? THREE_ORB_TIME_DIVISOR : TWO_ORB_TIME_DIVISOR;
                            const timeBonus  = Math.floor(ord.time / divisor);
                            this.score      += (base + timeBonus) * (isP ? PRIORITY_MULTIPLIER : 1);
                            this.orders.splice(i, 1);
                            delivered = true; break;
                        }
                    }
                    if (delivered) {
                        this.greenFlash = 0.1;
                        this._sfx('success');
                    } else {
                        // Wrong dream or order expired — small penalty, red flash
                        this.score -= WRONG_DELIVERY_PENALTY;
                        this.redFlash = 0.3;
                        this._sfx('fail');
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

            // Only the party name is sent. Scores, stars and player count come from
            // the server's own record of the levels this room finished — it ignores
            // anything we'd claim here, so a tampered client can't post a fake score.
            const res = await this.network.send({
                action: this.lbSubmittedId !== null ? "LEADERBOARD_UPDATE" : "LEADERBOARD_SUBMIT",
                party,
            });

            const resetBtn = () => {
                btn.disabled = false;
                btn.textContent = this.lbSubmittedId !== null ? 'Update Score' : 'Add to Leaderboard';
            };

            if (res?.action === "LEADERBOARD_DATA") {
                this.leaderboardData = res.entries || [];
                this.renderLeaderboard();
                this.lbSubmittedParty = party;
                if (res.submitted_id !== undefined) this.lbSubmittedId = res.submitted_id;
                btn.textContent = 'Submitted! ✦';
                btn.disabled = true;
            } else if (res?.status === "error") {
                // e.g. "Finish a level before submitting a score."
                this.showLbMessage(res.message || 'Could not submit that score.');
                resetBtn();
            } else {
                this.showLbMessage('Could not reach the server. Try again.');
                resetBtn();
            }
        }

        // Inline, non-blocking notice inside the leaderboard panel
        showLbMessage(text) {
            let el = document.getElementById('lbMessage');
            if (!el) {
                el = document.createElement('div');
                el.id = 'lbMessage';
                el.className = 'lb-message';
                const row = document.getElementById('lbPartyNameRow');
                row.parentNode.insertBefore(el, row.nextSibling);
            }
            el.textContent = text;
            el.style.display = 'block';
            clearTimeout(this._lbMsgTimer);
            this._lbMsgTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
        }

        setLbTab(tab) {
            this.leaderboardLevel = tab;
            ['total','1','2','3','4','5','6'].forEach(t => {
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
                    const total = (st['1']||0) + (st['2']||0) + (st['3']||0) + (st['4']||0) + (st['5']||0) + (st['6']||0);
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
            if (window.gameAudio) window.gameAudio.startMenuMusic();

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

            const thresholds = this.starThresholds || LEVEL_STAR_THRESHOLDS;
            const stars = thresholds.filter(t => this.score >= t).length;
            const passed = stars >= 1;
            setBestStars(String(this.currentLevel), stars);
            setBestScore(String(this.currentLevel), this.score);
            // Note: what reaches the leaderboard is the server's own record of this
            // level (see record_level_result in server.py) — nothing tracked here.

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
            if (passed && this.currentLevel < 6) {
                nextBtn.textContent = 'Next Dream →';
            } else if (passed) {
                nextBtn.textContent = 'All Dreams Woven ✦';
            } else {
                nextBtn.textContent = 'Retry Dream →';
            }
        }

        draw() {
            // Dreamy playfield — deep indigo wash + a soft static starfield
            const bg = this.ctx.createRadialGradient(WIDTH/2, HEIGHT*0.42, 40, WIDTH/2, HEIGHT*0.55, WIDTH*0.78);
            bg.addColorStop(0, '#191238');
            bg.addColorStop(1, '#0a0818');
            this.ctx.fillStyle = bg;
            this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
            if (!this._stars) {
                this._stars = [];
                for (let i = 0; i < 70; i++) this._stars.push([Math.random()*WIDTH, Math.random()*HEIGHT, Math.random()]);
            }
            for (const [sx, sy, sr] of this._stars) {
                this.ctx.fillStyle = `rgba(255,246,224,${0.18 + sr*0.42})`;
                this.ctx.beginPath(); this.ctx.arc(sx, sy, 0.5 + sr*1.3, 0, Math.PI*2); this.ctx.fill();
            }

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

                // Surge wave banner (levels with surge enabled)
                if (this.surgeFlash > 0) {
                    const a = Math.min(1, this.surgeFlash / 1.6);
                    this.ctx.save();
                    this.ctx.globalAlpha = a;
                    this.ctx.fillStyle = 'rgba(255,80,30,0.16)';
                    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
                    this.ctx.globalAlpha = a * (0.7 + 0.3*Math.sin(this.frame*0.4));
                    this.ctx.font = 'bold 46px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillStyle = rgbToString([255,120,50]);
                    this.ctx.fillText('⚡ SURGE ⚡', WIDTH/2, 150);
                    this.ctx.restore();
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
        // Load shared gameplay config (recipes, layouts, timings, scoring) before
        // anything else — the SAME web/config.json the server reads. Retry a couple
        // of times so a transient hiccup on the static host doesn't blank the game.
        for (let attempt = 1; ; attempt++) {
            try { await loadConfig(); break; }
            catch (e) {
                console.error('Failed to load config.json (attempt ' + attempt + '):', e);
                if (attempt >= 3) {
                    alert('Could not load game data. Please refresh the page.');
                    return;
                }
                await new Promise(r => setTimeout(r, 600));
            }
        }

        game = new Game();

        // Wire network callbacks BEFORE connecting. If the first connection fails
        // (e.g. a cold / just-restarted server) and only succeeds on a later automatic
        // reconnect, these must already be attached — otherwise level-load and state
        // broadcasts arrive with no handler and the host can't enter any level until a
        // manual page reload. (This was the "only works on the second try" bug.)
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
                // Server owns the clock (its duration scales with party size). Snap to it
                // on the first broadcast of a level, then smooth small drifts thereafter.
                if (ss.game_timer > 0) {
                    if (!game.timerSynced) { game.gameTimer = ss.game_timer; game.timerSynced = true; }
                    else if (Math.abs(ss.game_timer - game.gameTimer) < 5) game.gameTimer = ss.game_timer;
                }
                // Surge wave just fired — flash a banner + alert cue
                if (ss.surge && !game.isTutorial) {
                    game.surgeFlash = 1.6;
                    game._sfx('surge');
                }
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

        try {
            await game.network.connect();
            console.log('Connected to server');

            // If the tab was refreshed mid-game, try to rejoin automatically
            const resumed = await game._tryResumeSession();
            if (resumed) {
                // loadLevel was called inside _tryResumeSession — game is running
                document.getElementById('mainMenu').style.display = 'none';
            }
        } catch(e) {
            // Initial connect failed (likely a cold server) — the reconnect logic in
            // network.js keeps retrying, and the callbacks above are already attached,
            // so the game recovers on its own without a manual reload.
            console.log('Initial connect failed; auto-reconnect will retry:', e);
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