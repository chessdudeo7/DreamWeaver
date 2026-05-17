import asyncio
import asyncpg
import websockets
import json
import random
import string
import os
import ssl
from time import time

PLAYER_COLORS = [(0, 255, 200), (255, 140, 0), (255, 215, 0), (180, 70, 255)]
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", 5555))

RECIPES = {
    # 2-orb recipes
    "Joyful Slumber": [[255, 215, 0], [0, 191, 255]],
    "Action Flight":  [[255, 140, 0], [255, 215, 0]],
    "Deep Calm":      [[0, 191, 255], [0, 191, 255]],
    # 3-orb recipes (level 3)
    "Vivid Odyssey":  [[255, 140, 0], [255, 215, 0], [0, 191, 255]],
    "Velvet Abyss":   [[0, 191, 255], [0, 191, 255], [255, 215, 0]],
    "Ember Vision":   [[255, 140, 0], [255, 140, 0], [255, 215, 0]],
}
STATION_COLORS = {
    "Happy Dispenser": [255, 215, 0],
    "Calm Dispenser": [0, 191, 255],
    "Adventure Dispenser": [255, 140, 0],
    "Logic Filter": [100, 110, 130],
    "Dream Visualizer": [180, 70, 255],
    "Gateway": [50, 255, 150],
    "Crate": [110, 70, 40],
    "Void Siphon": [20, 20, 20],
    "Vessel Return": [80, 60, 120]
}

DREAM_VISUALIZER_COOK_TIME = 5.0
LOGIC_FILTER_PROCESS_TIME = 2.5

# Order timers
TWO_ORB_BASE_TIME   = 60.0
THREE_ORB_BASE_TIME = 90.0   # was sharing 60s with 2-orb; now gets extra 30s

rooms = {}
client_to_room = {}
room_connections = {}

DATABASE_URL = os.getenv("DATABASE_URL", "")

db_pool = None

async def init_db():
    global db_pool
    if not DATABASE_URL:
        print("No DATABASE_URL set — leaderboard will be in-memory only.")
        return
    try:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        db_pool = await asyncio.wait_for(
            asyncpg.create_pool(
                DATABASE_URL,
                min_size=1,
                max_size=5,
                ssl=ssl_ctx,
                statement_cache_size=0,
                # Supabase pooler closes idle connections after ~5min.
                # Retire our end after 4min so asyncpg replaces them cleanly
                # before the pooler kills them. Works for both session and
                # transaction pooler modes.
                max_inactive_connection_lifetime=240,
            ),
            timeout=10.0
        )
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS leaderboard (
                    id           SERIAL PRIMARY KEY,
                    party        TEXT NOT NULL,
                    player_count INTEGER DEFAULT 1,
                    score_1      INTEGER DEFAULT 0,
                    score_2      INTEGER DEFAULT 0,
                    score_3      INTEGER DEFAULT 0,
                    score_4      INTEGER DEFAULT 0,
                    total        INTEGER DEFAULT 0,
                    stars_1      INTEGER DEFAULT 0,
                    stars_2      INTEGER DEFAULT 0,
                    stars_3      INTEGER DEFAULT 0,
                    stars_4      INTEGER DEFAULT 0,
                    created_at   TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS room_snapshots (
                    code       TEXT PRIMARY KEY,
                    snapshot   JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            # Auto-delete snapshots older than 2 hours (stale rooms)
            await conn.execute("""
                DELETE FROM room_snapshots
                WHERE updated_at < NOW() - INTERVAL '2 hours'
            """)
            # Migrate existing tables that lack the new columns (safe no-ops if already present)
            for col, defval in [
                ("player_count", "INTEGER DEFAULT 1"),
                ("stars_1", "INTEGER DEFAULT 0"),
                ("stars_2", "INTEGER DEFAULT 0"),
                ("stars_3", "INTEGER DEFAULT 0"),
                ("stars_4", "INTEGER DEFAULT 0"),
            ]:
                try:
                    await conn.execute(
                        f"ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS {col} {defval}"
                    )
                except Exception:
                    pass
        print("Database connected and leaderboard table ready.")
    except asyncio.TimeoutError:
        print("Database connection timed out — falling back to in-memory.")
        db_pool = None
    except Exception as e:
        print(f"Database init failed: {e} — falling back to in-memory.")
        db_pool = None


async def db_get_leaderboard():
    """Fetch top 50 entries sorted by total desc."""
    if db_pool is None:
        return _mem_leaderboard_sorted()
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, party, player_count, score_1, score_2, score_3, score_4, total, "
                "stars_1, stars_2, stars_3, stars_4 "
                "FROM leaderboard ORDER BY total DESC LIMIT 50"
            )
            return [_row_to_entry(r) for r in rows]
    except Exception as e:
        print(f"DB read error: {e}")
        return _mem_leaderboard_sorted()


async def db_submit_leaderboard(party, scores, player_count=1, stars=None):
    """Insert a new leaderboard entry. Returns (entries, new_id)."""
    s1 = int(scores.get("1", 0) or scores.get(1, 0))
    s2 = int(scores.get("2", 0) or scores.get(2, 0))
    s3 = int(scores.get("3", 0) or scores.get(3, 0))
    s4 = int(scores.get("4", 0) or scores.get(4, 0))
    total = s1 + s2 + s3 + s4
    st1 = int((stars or {}).get("1", 0))
    st2 = int((stars or {}).get("2", 0))
    st3 = int((stars or {}).get("3", 0))
    st4 = int((stars or {}).get("4", 0))
    pc  = max(1, min(4, int(player_count or 1)))
    if db_pool is None:
        fake_id = random.randint(100000, 999999)
        _mem_leaderboard.append({
            "id": fake_id, "party": party, "player_count": pc,
            "scores": {"1": s1, "2": s2, "3": s3, "4": s4},
            "stars":  {"1": st1, "2": st2, "3": st3, "4": st4},
            "total": total,
        })
        _mem_leaderboard.sort(key=lambda e: e["total"], reverse=True)
        if len(_mem_leaderboard) > 100:
            del _mem_leaderboard[100:]
        return _mem_leaderboard_sorted(), fake_id
    try:
        async with db_pool.acquire() as conn:
            new_id = await conn.fetchval(
                "INSERT INTO leaderboard "
                "(party, player_count, score_1, score_2, score_3, score_4, total, "
                " stars_1, stars_2, stars_3, stars_4) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
                party, pc, s1, s2, s3, s4, total, st1, st2, st3, st4
            )
        return await db_get_leaderboard(), new_id
    except Exception as e:
        print(f"DB write error: {e}")
        return _mem_leaderboard_sorted(), None


async def db_update_leaderboard(row_id, party, scores, player_count=1, stars=None):
    """Update an existing leaderboard entry by id. Returns (entries, row_id)."""
    s1 = int(scores.get("1", 0) or scores.get(1, 0))
    s2 = int(scores.get("2", 0) or scores.get(2, 0))
    s3 = int(scores.get("3", 0) or scores.get(3, 0))
    s4 = int(scores.get("4", 0) or scores.get(4, 0))
    total = s1 + s2 + s3 + s4
    st1 = int((stars or {}).get("1", 0))
    st2 = int((stars or {}).get("2", 0))
    st3 = int((stars or {}).get("3", 0))
    st4 = int((stars or {}).get("4", 0))
    pc  = max(1, min(4, int(player_count or 1)))
    if db_pool is None:
        for e in _mem_leaderboard:
            if e.get("id") == row_id:
                e["party"] = party
                e["player_count"] = pc
                e["scores"] = {"1": s1, "2": s2, "3": s3, "4": s4}
                e["stars"]  = {"1": st1, "2": st2, "3": st3, "4": st4}
                e["total"] = total
                break
        _mem_leaderboard.sort(key=lambda e: e["total"], reverse=True)
        return _mem_leaderboard_sorted(), row_id
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE leaderboard SET party=$1, player_count=$2, "
                "score_1=$3, score_2=$4, score_3=$5, score_4=$6, total=$7, "
                "stars_1=$8, stars_2=$9, stars_3=$10, stars_4=$11 WHERE id=$12",
                party, pc, s1, s2, s3, s4, total, st1, st2, st3, st4, row_id
            )
        return await db_get_leaderboard(), row_id
    except Exception as e:
        print(f"DB update error: {e}")
        return _mem_leaderboard_sorted(), row_id


def _row_to_entry(row):
    return {
        "id":           row["id"],
        "party":        row["party"],
        "player_count": row.get("player_count", 1) or 1,
        "scores": {
            "1": row["score_1"],
            "2": row["score_2"],
            "3": row["score_3"],
            "4": row["score_4"],
        },
        "stars": {
            "1": row.get("stars_1", 0) or 0,
            "2": row.get("stars_2", 0) or 0,
            "3": row.get("stars_3", 0) or 0,
            "4": row.get("stars_4", 0) or 0,
        },
        "total": row["total"],
    }


# In-memory fallback
_mem_leaderboard = []

def _mem_leaderboard_sorted():
    return sorted(_mem_leaderboard, key=lambda e: e["total"], reverse=True)[:50]


# ── Room Snapshot Persistence ────────────────────────────────────────────────

def _room_to_snapshot(room):
    """Serialise a room dict to a plain JSON-safe dict for storage."""
    gs = room.get("game_state")
    ts = room.get("tutorial_state")
    return {
        "state":        room["state"],
        "game_state":   gs.to_dict(ts) if gs else None,
        "level":        gs.level if gs else None,
        "is_tutorial":  gs.is_tutorial if gs else False,
        # Store player names + colors so they can be displayed on rejoin
        "players_meta": [
            {"name": p["name"], "color": p["color"]}
            for p in room["players_dict"].values()
        ],
    }


async def db_save_room(code, room):
    """Upsert the room snapshot. Fire-and-forget safe (errors are logged, not raised)."""
    if db_pool is None:
        return
    try:
        snapshot = json.dumps(_room_to_snapshot(room))
        async with db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO room_snapshots (code, snapshot, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (code) DO UPDATE
                    SET snapshot = EXCLUDED.snapshot,
                        updated_at = NOW()
            """, code, snapshot)
    except Exception as e:
        print(f"db_save_room error: {e}")


async def db_load_room(code):
    """Return the snapshot dict for a room code, or None if not found / too old."""
    if db_pool is None:
        return None
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT snapshot FROM room_snapshots
                WHERE code = $1
                  AND updated_at > NOW() - INTERVAL '2 hours'
            """, code)
        if row:
            return json.loads(row["snapshot"])
    except Exception as e:
        print(f"db_load_room error: {e}")
    return None


async def db_delete_room(code):
    """Remove a room snapshot (call when the room is intentionally closed)."""
    if db_pool is None:
        return
    try:
        async with db_pool.acquire() as conn:
            await conn.execute("DELETE FROM room_snapshots WHERE code = $1", code)
    except Exception as e:
        print(f"db_delete_room error: {e}")


# ── Tutorial State ───────────────────────────────────────────────────────────

class TutorialState:
    """Tracks synced tutorial progress for a room (22 steps, indices 0-21)."""
    TOTAL_STEPS = 22

    OK_STEPS = {0, 9, 10, 11, 19, 21}
    PROXIMITY_STEPS = {1, 3, 7, 13, 17}
    ACTION_MAP = {
        "orb_picked":  2,
        "lf_placed":   4,
        "lf_done":     5,
        "lf_pickup":   6,
        "vessel_1":    8,
        "vessel_2":    12,
        "dv_start":    14,
        "dv_done":     15,
        "vessel_dish": 16,
        "delivery_1":  18,
        "delivery_2":  20,
    }

    def __init__(self, player_ids):
        self.step       = 0
        self.confirmed  = set()
        self.player_ids = set(player_ids)
        self.complete   = False

    def to_dict(self):
        return {
            "step":      self.step,
            "confirmed": list(self.confirmed),
            "complete":  self.complete,
        }

    def all_confirmed(self):
        return self.player_ids <= self.confirmed

    def try_ok(self, client_id):
        if self.step not in self.OK_STEPS:
            return False
        self.confirmed.add(client_id)
        if self.all_confirmed():
            self._advance()
            return True
        return False

    def try_action(self, key):
        if key.startswith("proximity_"):
            try:
                idx = int(key.split("_")[1])
            except ValueError:
                return False
            if idx == self.step and idx in self.PROXIMITY_STEPS:
                self._advance()
                return True
            return False
        expected = self.ACTION_MAP.get(key)
        if expected is None or expected != self.step:
            return False
        self._advance()
        return True

    def _advance(self):
        self.confirmed = set()
        self.step += 1
        if self.step >= self.TOTAL_STEPS:
            self.complete = True
            self.step     = self.TOTAL_STEPS - 1


# ── Helpers ──────────────────────────────────────────────────────────────────

def generate_code():
    return ''.join(random.choices(string.ascii_uppercase, k=4))


def make_response(data, rid=None):
    if rid is not None:
        data = {**data, '_rid': rid}   # copy — never mutate the caller's dict
    return json.dumps(data)


def match_recipe(bundle):
    for recipe_name, recipe_colors in RECIPES.items():
        if sorted(json.dumps(c) for c in bundle) == sorted(json.dumps(c) for c in recipe_colors):
            return recipe_name, [180, 70, 255]
    return "Abstract Mush", [150, 0, 0]


async def schedule_vessel_respawn(room_code, delay=5.0, generation=None):
    await asyncio.sleep(delay)
    if room_code not in rooms or room_code not in room_connections:
        return
    gs = rooms[room_code].get("game_state")
    if not gs:
        return
    # If the room has loaded a new level since this task was created, bail out
    if generation is not None and gs.generation != generation:
        return
    total = gs.count_total_vessels(rooms[room_code]["players_dict"])
    if total < 3:
        vr = gs.stations.get("Vessel Return")
        if vr:
            vr["vessel_count"] = min(3, vr["vessel_count"] + 1)
    await broadcast_room(room_code, rooms, room_connections)


# ── Game State ───────────────────────────────────────────────────────────────

class GameState:
    def __init__(self, level=1, is_tutorial=False):
        self.level = level
        self.is_tutorial = is_tutorial
        self.state = "PLAYING"
        self.score = 0
        self.game_timer = 120.0
        self.frame = 0
        self.spawn_tick = 0
        self.orders = []
        self.stations = {}
        self.station_locks = {}
        self.logic_filter_holders = set()
        self.last_update_time = None   # set on first SYNC to avoid dt spike
        self.generation = random.randint(0, 2**31)  # unique id; stale tasks check this
        self.last_snapshot_time = 0.0  # throttle DB saves to every 30s during SYNC
        self._create_stations(level)
        self._spawn_initial_orders()

    def _create_stations(self, level):
        if level == 1:
            configs = [
                ("Happy Dispenser", 60, 110, 90, 90),
                ("Calm Dispenser", 160, 110, 90, 90),
                ("Adventure Dispenser", 260, 110, 90, 90),
                ("Logic Filter", 740, 110, 100, 140),
                ("Dream Visualizer", 400, 510, 140, 90),
                ("Gateway", 60, 510, 110, 90),
                ("Vessel Return", 200, 510, 110, 90),
                ("Void Siphon", 780, 510, 80, 90),
                ("Crate 1", 380, 280, 60, 60),
                ("Crate 2", 450, 280, 60, 60),
                ("Crate 3", 520, 280, 60, 60),
            ]
        elif level == 2:
            configs = [
                ("Happy Dispenser", 740, 510, 90, 90),
                ("Calm Dispenser", 640, 510, 90, 90),
                ("Adventure Dispenser", 540, 510, 90, 90),
                ("Logic Filter", 60, 110, 100, 140),
                ("Dream Visualizer", 400, 110, 140, 90),
                ("Gateway", 740, 110, 110, 90),
                ("Vessel Return", 600, 110, 110, 90),
                ("Void Siphon", 60, 510, 80, 90),
                ("Crate 1", 380, 320, 60, 60),
                ("Crate 2", 450, 320, 60, 60),
                ("Crate 3", 520, 320, 60, 60),
            ]
        elif level == 3:
            configs = [
                ("Happy Dispenser", 60, 300, 90, 90),
                ("Calm Dispenser", 60, 410, 90, 90),
                ("Adventure Dispenser", 60, 190, 90, 90),
                ("Logic Filter", 400, 110, 140, 120),
                ("Dream Visualizer", 750, 300, 110, 110),
                ("Gateway", 400, 510, 140, 90),
                ("Vessel Return", 750, 510, 110, 90),
                ("Void Siphon", 750, 110, 90, 90),
                ("Crate 1", 220, 240, 60, 60),
                ("Crate 2", 220, 340, 60, 60),
                ("Crate 3", 220, 440, 60, 60),
            ]
        else:  # level 4
            configs = [
                ("Happy Dispenser", 160, 110, 90, 90),
                ("Calm Dispenser", 270, 110, 90, 90),
                ("Adventure Dispenser", 60, 110, 90, 90),
                ("Logic Filter", 60, 430, 100, 140),
                ("Dream Visualizer", 650, 430, 140, 110),
                ("Gateway", 800, 110, 80, 90),
                ("Vessel Return", 800, 230, 80, 90),
                ("Void Siphon", 800, 350, 80, 90),
                ("Crate 1", 380, 270, 60, 60),
                ("Crate 2", 460, 270, 60, 60),
                ("Crate 3", 540, 270, 60, 60),
            ]

        for name, x, y, w, h in configs:
            self.stations[name] = {
                "name": name,
                "x": x, "y": y, "w": w, "h": h,
                "color": STATION_COLORS.get(name if "Crate" not in name else "Crate"),
                "held_item": None,
                "progress": 0.0,
                "is_cooking": False,
                "vessel_count": 0,
                "active_holders": 0,
            }
            self.station_locks[name] = None

        for i in range(1, 4):
            self.stations[f"Crate {i}"]["held_item"] = {
                "name": "Vessel", "color": [240, 240, 255],
                "is_processed": False, "is_vessel": True,
                "bundle": [], "dish_name": None, "dish_color": None,
            }

    def _spawn_initial_orders(self):
        if self.is_tutorial:
            self.orders = [
                {"name": "Deep Calm",      "time": 9999.0, "max": 9999.0, "recipe": RECIPES["Deep Calm"],
                 "is_priority": False, "is_three_orb": False},
                {"name": "Joyful Slumber", "time": 9999.0, "max": 9999.0, "recipe": RECIPES["Joyful Slumber"],
                 "is_priority": False, "is_three_orb": False},
            ]
        elif self.level == 4:
            self._add_order(force_priority=False)
            self._add_order(force_priority=False)
            self._add_order(force_priority=True)
        else:
            for _ in range(3):
                self._add_order()

    TWO_ORB_RECIPES   = {"Joyful Slumber", "Action Flight", "Deep Calm"}
    THREE_ORB_RECIPES = {"Vivid Odyssey", "Velvet Abyss", "Ember Vision"}

    def _add_order(self, force_priority=False):
        if len(self.orders) >= 5:
            return
        if self.level == 4:
            is_priority = force_priority or (random.random() < 0.4)
            name = random.choice(list(self.TWO_ORB_RECIPES))
        else:
            is_priority = False
            if self.level <= 2:
                name = random.choice(list(self.TWO_ORB_RECIPES))
            else:
                name = random.choice(list(RECIPES.keys()))

        is_three_orb = name in self.THREE_ORB_RECIPES

        # 2-orb orders: 60s base; 3-orb orders: 90s base (extra time for extra complexity)
        if is_priority:
            base_time = 40.0   # priority is always 2-orb (level 4 only)
        elif is_three_orb:
            base_time = THREE_ORB_BASE_TIME
        else:
            base_time = TWO_ORB_BASE_TIME

        self.orders.append({
            "name": name,
            "time": base_time,
            "max": base_time,
            "recipe": RECIPES[name],
            "is_priority": is_priority,
            "is_three_orb": is_three_orb,
        })

    def count_total_vessels(self, players_dict):
        count = 0
        for s in self.stations.values():
            if s.get("held_item") and s["held_item"].get("is_vessel"):
                count += 1
            if s["name"] == "Vessel Return":
                count += s["vessel_count"]
        for p in players_dict.values():
            h = p.get("heldItem")
            if h and h.get("isVessel"):
                count += 1
        return count

    def try_lock(self, station_name, client_id):
        cur = self.station_locks.get(station_name)
        if cur is None or cur == client_id:
            self.station_locks[station_name] = client_id
            return True
        return False

    def release_lock(self, station_name, client_id):
        if self.station_locks.get(station_name) == client_id:
            self.station_locks[station_name] = None

    def release_all_locks(self, client_id):
        for name in list(self.station_locks):
            if self.station_locks[name] == client_id:
                self.station_locks[name] = None
        self.logic_filter_holders.discard(client_id)

    def update(self, dt, players_dict=None):
        # Guard against absurdly large dt (e.g. first tick after level load)
        dt = min(dt, 0.5)
        self.game_timer -= dt
        if self.game_timer <= 0:
            self.state = "LEVEL_COMPLETE"

        self.frame += 1
        if not self.is_tutorial:
            self.spawn_tick += dt
            if self.spawn_tick > 15 and len(self.orders) < 5:
                force_p = (self.level == 4 and random.random() < 0.35)
                self._add_order(force_priority=force_p)
                self.spawn_tick = 0

        remaining = []
        for o in self.orders:
            if not self.is_tutorial:
                o["time"] -= dt
            if not self.is_tutorial and o["time"] <= 0:
                self.score -= 20
            else:
                remaining.append(o)
        self.orders = remaining

        # Dream Visualizer — server owns timer
        dv = self.stations.get("Dream Visualizer")
        if dv and dv["is_cooking"]:
            dv["progress"] = min(1.0, dv["progress"] + dt / DREAM_VISUALIZER_COOK_TIME)
            if dv["progress"] >= 1.0:
                bundle = (dv["held_item"] or {}).get("bundle", [])
                res_name, res_color = match_recipe(bundle)
                dv["held_item"] = {
                    "name": res_name, "color": res_color,
                    "is_processed": True, "is_vessel": False,
                    "bundle": bundle,   # keep ingredients so client can display them
                    "dish_name": None, "dish_color": None,
                }
                dv["is_cooking"] = False
                dv["progress"] = 0.0
                self.station_locks["Dream Visualizer"] = None

        # Logic Filter — speed scales with holders
        lf = self.stations.get("Logic Filter")
        if lf and lf["is_cooking"]:
            n = len(self.logic_filter_holders)
            lf["active_holders"] = n
            if n > 0:
                lf["progress"] = min(1.0, lf["progress"] + dt * n / LOGIC_FILTER_PROCESS_TIME)
                if lf["progress"] >= 1.0:
                    if lf["held_item"]:
                        lf["held_item"]["is_processed"] = True
                    lf["is_cooking"] = False
                    lf["progress"] = 0.0
                    lf["active_holders"] = 0
                    self.logic_filter_holders.clear()
                    self.station_locks["Logic Filter"] = None
        else:
            if lf:
                lf["active_holders"] = 0

    def to_dict(self, tutorial_state=None):
        d = {
            "state": self.state,
            "score": self.score,
            "game_timer": max(0, self.game_timer),
            "frame": self.frame,
            "level": self.level,
            "orders": self.orders,
            "stations": self.stations,
            "station_locks": self.station_locks,
            "logic_filter_holders": len(self.logic_filter_holders),
        }
        if tutorial_state is not None:
            d["tutorial"] = tutorial_state.to_dict()
        return d


# ── Broadcast ────────────────────────────────────────────────────────────────

async def broadcast_room(current_room, rooms, room_connections):
    if current_room not in room_connections:
        return
    gs = rooms[current_room].get("game_state")
    if not gs:
        return
    ts = rooms[current_room].get("tutorial_state")
    msg = json.dumps({
        "status": "success",
        "players": list(rooms[current_room]["players_dict"].values()),
        "game_state": gs.to_dict(ts)
    })
    disconnected = []
    for conn in room_connections[current_room]:
        try:
            await conn.send(msg)
        except websockets.exceptions.ConnectionClosed:
            disconnected.append(conn)
    for conn in disconnected:
        room_connections[current_room].remove(conn)



# ── Client Handler ───────────────────────────────────────────────────────────

async def handle_client(websocket):
    client_id = id(websocket)
    current_room = None
    game_state = None

    try:
        async for message in websocket:
            # Bug 2 fix: bad JSON must never crash the connection
            try:
                request = json.loads(message)
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                print(f"Bad message from {client_id}: {e}")
                continue

            # Bug 1 fix: any unhandled exception inside a message must not
            # kill the WebSocket — log it and keep going.
            action = None
            rid = None
            try:
                action = request.get("action")
                rid = request.get("_rid")
                response = {"status": "error", "message": "Unknown action"}

                if action == "PING":
                    await websocket.send(json.dumps({"status": "pong"}))
                    continue

                elif action == "REJOIN":
                    # Client reconnected and wants to re-enter an existing room.
                    # Sent automatically by game.js after a successful reconnect.
                    code = request.get("code", "").upper()
                    name = request.get("name", "Unknown")
                    prev_color = request.get("color")

                    # If the room isn't in memory (server restarted), try loading
                    # its last snapshot from Supabase before giving up
                    if code not in rooms:
                        snapshot = await db_load_room(code)
                        if snapshot:
                            snap_gs = snapshot.get("game_state")
                            level   = snapshot.get("level", 1)
                            is_tut  = snapshot.get("is_tutorial", False)
                            gs = GameState(level, is_tutorial=is_tut)
                            if snap_gs:
                                gs.score      = snap_gs.get("score", 0)
                                gs.game_timer = max(10.0, snap_gs.get("game_timer", 120.0))
                                gs.orders     = snap_gs.get("orders", [])
                                gs.state      = snap_gs.get("state", "PLAYING")
                                # Restore full station state — items, cooking progress, vessel counts
                                snap_stations = snap_gs.get("stations", {})
                                for sname, sdata in snap_stations.items():
                                    if sname in gs.stations:
                                        gs.stations[sname]["held_item"]    = sdata.get("held_item")
                                        gs.stations[sname]["is_cooking"]   = sdata.get("is_cooking", False)
                                        gs.stations[sname]["progress"]     = sdata.get("progress", 0.0)
                                        gs.stations[sname]["vessel_count"] = sdata.get("vessel_count", 0)
                                        # Don't restore active_holders — no one is holding yet
                                        gs.stations[sname]["active_holders"] = 0
                                # Clear any station locks — no clients are connected yet
                                for sname in gs.station_locks:
                                    gs.station_locks[sname] = None
                            rooms[code] = {
                                "players": [],
                                "state": snapshot.get("state", "PLAYING"),
                                "game_state": gs,
                                "tutorial_state": None,
                                "players_dict": {},
                            }
                            room_connections[code] = []
                            print(f"Room {code} restored from snapshot")

                    if code in rooms:
                        room = rooms[code]
                        existing_colors = [p["color"] for p in room["players_dict"].values()]
                        if prev_color and prev_color not in existing_colors:
                            color = prev_color
                        else:
                            taken = len(room["players_dict"])
                            color = PLAYER_COLORS[min(taken, 3)]
                        player_entry = {"id": client_id, "name": name, "color": color,
                                        "x": 450, "y": 350, "heldItem": None}
                        room["players_dict"][client_id] = player_entry
                        room["players"] = list(room["players_dict"].values())
                        room_connections.setdefault(code, [])
                        if websocket not in room_connections[code]:
                            room_connections[code].append(websocket)
                        client_to_room[client_id] = code
                        current_room = code
                        gs = room.get("game_state")
                        response = {
                            "status": "success", "action": "REJOINED",
                            "code": code, "player_id": client_id,
                            "game_state": gs.to_dict(room.get("tutorial_state")) if gs else None,
                            "players": list(room["players_dict"].values()),
                            "room_state": room["state"],
                        }
                    else:
                        response = {"status": "error", "message": "Room not found"}

                elif action == "CREATE":
                    name = request.get("name", "Unknown Host")
                    code = generate_code()
                    color = PLAYER_COLORS[0]
                    rooms[code] = {
                        "players": [{"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}],
                        "state": "LOBBY",
                        "game_state": None,
                        "tutorial_state": None,
                        "players_dict": {client_id: {"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}}
                    }
                    room_connections[code] = [websocket]
                    client_to_room[client_id] = code
                    current_room = code
                    response = {"status": "success", "action": "JOINED", "code": code, "is_host": True, "player_id": client_id}

                elif action == "JOIN":
                    code = request.get("code", "").upper()
                    name = request.get("name", "Guest")
                    if code in rooms and rooms[code]["state"] == "LOBBY" and len(rooms[code]["players"]) < 4:
                        color_idx = len(rooms[code]["players"])
                        color = PLAYER_COLORS[color_idx]
                        rooms[code]["players"].append({"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None})
                        rooms[code]["players_dict"][client_id] = {"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}
                        room_connections.setdefault(code, []).append(websocket)
                        client_to_room[client_id] = code
                        current_room = code
                        response = {"status": "success", "action": "JOINED", "code": code, "is_host": False, "player_id": client_id}
                    elif code in rooms and len(rooms[code]["players"]) >= 4:
                        response = {"status": "error", "message": "Room is full"}
                    else:
                        response = {"status": "error", "message": "Invalid code"}

                elif action == "GET_LOBBY":
                    if current_room and current_room in rooms:
                        response = {"status": "success", "action": "LOBBY_UPDATE",
                                    "players": rooms[current_room]["players"],
                                    "game_started": rooms[current_room]["state"] == "PLAYING"}

                elif action == "START_GAME":
                    if current_room and current_room in rooms:
                        rooms[current_room]["state"] = "PLAYING"
                        response = {"status": "success", "action": "GAME_STARTED"}

                elif action == "LOAD_LEVEL":
                    if current_room and current_room in rooms:
                        level = request.get("level", 1)
                        if level == 0:
                            # Intentional return to menu — clear the snapshot
                            asyncio.create_task(db_delete_room(current_room))
                            if current_room in room_connections:
                                msg = json.dumps({"status": "level_load", "level": 0})
                                disconnected = []
                                for conn in room_connections[current_room]:
                                    try:
                                        await conn.send(msg)
                                    except websockets.exceptions.ConnectionClosed:
                                        disconnected.append(conn)
                                for conn in disconnected:
                                    room_connections[current_room].remove(conn)
                            continue
                        is_tut = (level == "tutorial")
                        server_level = 1 if is_tut else level
                        new_gs = GameState(server_level, is_tutorial=is_tut)
                        rooms[current_room]["game_state"] = new_gs
                        # Bug 6 fix: always clear tutorial_state when loading any level
                        rooms[current_room]["tutorial_state"] = None
                        # Persist so rejoin after restart works
                        asyncio.create_task(db_save_room(current_room, rooms[current_room]))
                        if current_room in room_connections:
                            msg = json.dumps({"status": "level_load", "level": level})
                            disconnected = []
                            for conn in room_connections[current_room]:
                                try:
                                    await conn.send(msg)
                                except websockets.exceptions.ConnectionClosed:
                                    disconnected.append(conn)
                            for conn in disconnected:
                                room_connections[current_room].remove(conn)
                        continue

                elif action == "SYNC":
                    if current_room and current_room in rooms:
                        game_state = rooms[current_room]["game_state"]
                        if game_state:
                            for p in rooms[current_room]["players_dict"].values():
                                if p["id"] == client_id:
                                    p["x"] = request.get("x", p["x"])
                                    p["y"] = request.get("y", p["y"])
                                    p["heldItem"] = request.get("heldItem")
                                    break

                            lf_holding = request.get("lf_holding", False)
                            lf = game_state.stations.get("Logic Filter")
                            if lf and lf["is_cooking"]:
                                if lf_holding:
                                    game_state.logic_filter_holders.add(client_id)
                                else:
                                    game_state.logic_filter_holders.discard(client_id)
                            else:
                                game_state.logic_filter_holders.discard(client_id)

                            # Bug 3 fix: use None sentinel to avoid dt spike on first tick
                            now_t = time()
                            dt = (now_t - game_state.last_update_time) if game_state.last_update_time is not None else 0.0
                            game_state.update(dt, rooms[current_room]["players_dict"])
                            game_state.last_update_time = now_t

                            # Throttled snapshot save — captures full station state every 30s
                            # so reconnect after crash restores DV/LF/crate state too
                            if now_t - game_state.last_snapshot_time >= 30.0:
                                game_state.last_snapshot_time = now_t
                                asyncio.create_task(db_save_room(current_room, rooms[current_room]))

                            if current_room in room_connections:
                                msg = json.dumps({
                                    "status": "success",
                                    "players": list(rooms[current_room]["players_dict"].values()),
                                    "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state"))
                                })
                                disconnected = []
                                for conn in room_connections[current_room]:
                                    try:
                                        await conn.send(msg)
                                    except websockets.exceptions.ConnectionClosed:
                                        disconnected.append(conn)
                                for conn in disconnected:
                                    room_connections[current_room].remove(conn)
                            continue
                        else:
                            response = {"status": "success", "players": list(rooms[current_room]["players_dict"].values())}

                elif action == "STATION_UPDATE":
                    if current_room and current_room in rooms:
                        game_state = rooms[current_room]["game_state"]
                        if game_state:
                            update_type = request.get("update_type", "item")
                            accepted = False
                            ts_ref = rooms[current_room].get("tutorial_state")

                            if update_type == "vessel_take":
                                vr = game_state.stations.get("Vessel Return")
                                if vr and vr["vessel_count"] > 0:
                                    vr["vessel_count"] -= 1
                                    accepted = True

                            elif update_type == "logic_filter_place":
                                lf = game_state.stations.get("Logic Filter")
                                if lf and not lf["is_cooking"] and not lf["held_item"]:
                                    if game_state.try_lock("Logic Filter", client_id):
                                        lf["held_item"] = request.get("orb_item")
                                        lf["is_cooking"] = True
                                        lf["progress"] = 0.0
                                        accepted = True
                                    else:
                                        await websocket.send(make_response({
                                            "status": "rejected", "reason": "logic_filter_busy",
                                            "game_state": game_state.to_dict(ts_ref),
                                            "players": list(rooms[current_room]["players_dict"].values())
                                        }, rid))
                                        continue
                                else:
                                    await websocket.send(make_response({
                                        "status": "rejected", "reason": "logic_filter_busy",
                                        "game_state": game_state.to_dict(ts_ref),
                                        "players": list(rooms[current_room]["players_dict"].values())
                                    }, rid))
                                    continue

                            elif update_type == "logic_filter_cancel":
                                lf = game_state.stations.get("Logic Filter")
                                if lf and game_state.station_locks.get("Logic Filter") == client_id:
                                    orb = lf["held_item"]
                                    lf["held_item"] = None
                                    lf["is_cooking"] = False
                                    lf["progress"] = 0.0
                                    lf["active_holders"] = 0
                                    game_state.logic_filter_holders.discard(client_id)
                                    game_state.release_lock("Logic Filter", client_id)
                                    await websocket.send(make_response({
                                        "status": "logic_filter_cancelled",
                                        "returned_orb": orb,
                                        "game_state": game_state.to_dict(ts_ref),
                                        "players": list(rooms[current_room]["players_dict"].values())
                                    }, rid))
                                    await broadcast_room(current_room, rooms, room_connections)
                                    continue
                                else:
                                    game_state.logic_filter_holders.discard(client_id)
                                    accepted = True

                            elif update_type == "logic_filter_pickup":
                                lf = game_state.stations.get("Logic Filter")
                                if lf and not lf["is_cooking"] and lf["held_item"]:
                                    lf["held_item"] = None
                                    game_state.station_locks["Logic Filter"] = None
                                    accepted = True

                            elif update_type == "dream_cook_start":
                                dv = game_state.stations.get("Dream Visualizer")
                                if dv and not dv["is_cooking"] and not dv["held_item"]:
                                    if game_state.try_lock("Dream Visualizer", client_id):
                                        bundle = request.get("bundle", [])
                                        dv["held_item"] = {
                                            "name": "Bundle", "color": [240, 240, 255],
                                            "is_processed": True, "is_vessel": False,
                                            "bundle": bundle, "dish_name": None, "dish_color": None,
                                        }
                                        dv["is_cooking"] = True
                                        dv["progress"] = 0.0
                                        accepted = True
                                    else:
                                        await websocket.send(make_response({
                                            "status": "rejected", "reason": "dream_visualizer_busy",
                                            "game_state": game_state.to_dict(ts_ref),
                                            "players": list(rooms[current_room]["players_dict"].values())
                                        }, rid))
                                        continue

                            elif update_type == "dream_pickup":
                                dv = game_state.stations.get("Dream Visualizer")
                                if dv and not dv["is_cooking"] and dv["held_item"]:
                                    dv["held_item"] = None
                                    game_state.release_lock("Dream Visualizer", client_id)
                                    accepted = True

                            elif update_type == "item":
                                sname = request.get("station_name")
                                new_item = request.get("held_item")
                                if sname and sname in game_state.stations:
                                    if sname not in ("Logic Filter", "Dream Visualizer", "Vessel Return"):
                                        game_state.stations[sname]["held_item"] = new_item
                                        accepted = True

                            if accepted:
                                if current_room in room_connections:
                                    msg = json.dumps({
                                        "status": "success",
                                        "players": list(rooms[current_room]["players_dict"].values()),
                                        "game_state": game_state.to_dict(ts_ref)
                                    })
                                    disconnected = []
                                    for conn in room_connections[current_room]:
                                        try:
                                            await conn.send(msg)
                                        except websockets.exceptions.ConnectionClosed:
                                            disconnected.append(conn)
                                    for conn in disconnected:
                                        room_connections[current_room].remove(conn)
                            # Always consume — never fall through to generic "Unknown action"
                            continue

                elif action == "TUTORIAL_START":
                    if current_room and current_room in rooms:
                        player_ids = list(rooms[current_room]["players_dict"].keys())
                        rooms[current_room]["tutorial_state"] = TutorialState(player_ids)
                        await broadcast_room(current_room, rooms, room_connections)
                    continue

                elif action == "TUTORIAL_OK":
                    if current_room and current_room in rooms:
                        ts = rooms[current_room].get("tutorial_state")
                        gs = rooms[current_room].get("game_state")
                        if ts and gs:
                            ts.try_ok(client_id)
                            await broadcast_room(current_room, rooms, room_connections)
                    continue

                elif action == "TUTORIAL_ACTION":
                    if current_room and current_room in rooms:
                        ts = rooms[current_room].get("tutorial_state")
                        gs = rooms[current_room].get("game_state")
                        if ts and gs:
                            key = request.get("key", "")
                            ts.try_action(key)
                            await broadcast_room(current_room, rooms, room_connections)
                    continue

                elif action == "DELIVER":
                    if current_room and current_room in rooms:
                        game_state = rooms[current_room]["game_state"]
                        if game_state:
                            dish_name = request.get("dish_name")
                            is_vessel = request.get("is_vessel", False)
                            delivered = False
                            for i, order in enumerate(game_state.orders):
                                if order["name"] == dish_name:
                                    is_priority  = order.get("is_priority", False)
                                    is_three_orb = order.get("is_three_orb", False)
                                    base         = 40 if is_three_orb else 20
                                    time_bonus   = int(order["time"] / (1.5 if is_three_orb else 2))
                                    points       = (base + time_bonus) * (2 if is_priority else 1)
                                    game_state.score += points
                                    game_state.orders.pop(i)
                                    delivered = True
                                    break
                            # No penalty for delivering a valid dream late (order expired).
                            # Only penalize if the dish_name is completely unrecognised
                            # (i.e. "Abstract Mush" — a bad orb combination).
                            if not delivered and dish_name == "Abstract Mush":
                                game_state.score -= 15
                            # Return vessel regardless of whether delivery matched an order
                            if is_vessel:
                                asyncio.create_task(schedule_vessel_respawn(
                                    current_room, delay=5.0, generation=game_state.generation))
                            # Persist score progress
                            asyncio.create_task(db_save_room(current_room, rooms[current_room]))
                            if current_room in room_connections:
                                msg = json.dumps({
                                    "status": "success",
                                    "players": list(rooms[current_room]["players_dict"].values()),
                                    "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state"))
                                })
                                disconnected = []
                                for conn in room_connections[current_room]:
                                    try:
                                        await conn.send(msg)
                                    except websockets.exceptions.ConnectionClosed:
                                        disconnected.append(conn)
                                for conn in disconnected:
                                    room_connections[current_room].remove(conn)
                            continue

                elif action == "LEADERBOARD_GET":
                    entries = await db_get_leaderboard()
                    response = {"status": "success", "action": "LEADERBOARD_DATA", "entries": entries}

                elif action == "LEADERBOARD_SUBMIT":
                    party_name   = request.get("party", "Unknown")[:24]
                    scores       = request.get("scores", {})
                    player_count = request.get("player_count", 1)
                    stars        = request.get("stars", {})
                    entries, new_id = await db_submit_leaderboard(party_name, scores, player_count, stars)
                    response = {"status": "success", "action": "LEADERBOARD_DATA",
                                "entries": entries, "submitted_id": new_id}

                elif action == "LEADERBOARD_UPDATE":
                    row_id       = request.get("id")
                    party_name   = request.get("party", "Unknown")[:24]
                    scores       = request.get("scores", {})
                    player_count = request.get("player_count", 1)
                    stars        = request.get("stars", {})
                    entries, upd_id = await db_update_leaderboard(row_id, party_name, scores, player_count, stars)
                    response = {"status": "success", "action": "LEADERBOARD_DATA",
                                "entries": entries, "submitted_id": upd_id}

                await websocket.send(make_response(response, rid))

            except websockets.exceptions.ConnectionClosed:
                raise   # bubble up to the outer handler to trigger cleanup
            except Exception as e:
                print(f"Error handling action '{action}' from {client_id}: {type(e).__name__}: {e}")
                try:
                    await websocket.send(make_response(
                        {"status": "error", "message": "Internal server error"}, rid))
                except Exception:
                    pass

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if client_id in client_to_room:
            room_code = client_to_room[client_id]
            del client_to_room[client_id]
            if room_code in room_connections:
                room_connections[room_code] = [c for c in room_connections[room_code] if id(c) != client_id]
            if room_code in rooms:
                # Remove player from room player lists
                rooms[room_code]["players"] = [
                    p for p in rooms[room_code]["players"] if p["id"] != client_id]
                rooms[room_code]["players_dict"].pop(client_id, None)
                gs = rooms[room_code].get("game_state")
                if gs:
                    gs.release_all_locks(client_id)
                    lf = gs.stations.get("Logic Filter")
                    if lf and lf["is_cooking"] and gs.station_locks.get("Logic Filter") is None:
                        lf["is_cooking"] = False
                        lf["progress"] = 0.0
                        lf["held_item"] = None
                # Keep room alive for 5 minutes after last player leaves so
                # reconnecting clients can rejoin (code 1006 + reconnect can take ~30s)
                if not rooms[room_code]["players_dict"]:
                    async def _delayed_cleanup(rc):
                        await asyncio.sleep(300)
                        if rc in rooms and not rooms[rc]["players_dict"]:
                            rooms.pop(rc, None)
                            room_connections.pop(rc, None)
                            print(f"Room {rc} cleaned up after grace period")
                    asyncio.create_task(_delayed_cleanup(room_code))
        print(f"Connection closed: {client_id}")

async def health_check(websocket):
    """
    Render sends periodic HTTP HEAD/GET requests to keep the service alive.
    websockets rejects these because they aren't valid WebSocket upgrades.
    This handler intercepts them and sends a plain HTTP 200 response instead,
    silencing the flood of InvalidMessage errors in the logs.
    """
    try:
        # Read the raw HTTP request line
        request_line = await asyncio.wait_for(websocket.reader.readline(), timeout=2.0)
        if request_line.upper().startswith((b"HEAD", b"GET")):
            # Drain the rest of the headers
            while True:
                line = await asyncio.wait_for(websocket.reader.readline(), timeout=1.0)
                if line in (b"\r\n", b"\n", b""):
                    break
            # Send a minimal HTTP 200
            websocket.writer.write(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Length: 2\r\n"
                b"Connection: close\r\n"
                b"\r\n"
                b"OK"
            )
            await websocket.writer.drain()
    except Exception:
        pass


async def handle_connection(websocket):
    """Route: WebSocket upgrade goes to game handler, plain HTTP goes to health check."""
    # websockets >= 12 passes the HTTP request in websocket.request
    # If it's already been upgraded, handle it as a game client.
    # The HEAD/GET health checks never complete the upgrade, so we never reach here
    # for them — websockets raises InvalidMessage before calling this handler.
    await handle_client(websocket)


async def main():
    print(f"DATABASE_URL set: {bool(DATABASE_URL)}")
    await init_db()
    print(f"WebSocket server starting on {HOST}:{PORT}")

    async def process_request(connection, request):
        # Render's health checker sends GET / and HEAD / looking for an HTTP port.
        # Return a plain 200 so it stops scanning and doesn't restart the process.
        try:
            from websockets.http11 import Response
            from websockets.datastructures import Headers
            if request.method in ("GET", "HEAD"):
                # If this looks like a real WebSocket upgrade, let it through
                if request.headers.get("Upgrade", "").lower() == "websocket":
                    return None  # proceed to WebSocket handshake
                # Otherwise it's a health check — reply with HTTP 200
                body = b"OK"
                headers = Headers([
                    ("Content-Type", "text/plain"),
                    ("Content-Length", str(len(body))),
                ])
                return Response(200, "OK", headers, body)
        except Exception:
            pass
        return None

    import logging
    logging.getLogger("websockets").setLevel(logging.CRITICAL)

    async with websockets.serve(
        handle_client,
        HOST, PORT,
        process_request=process_request,
        ping_interval=20,   # send WS ping frame every 20s — resets Render's TCP idle timer
        ping_timeout=60,    # wait up to 60s for pong before treating as dead
    ):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
