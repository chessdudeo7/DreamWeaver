import asyncio
import websockets
import json
import random
import string
import os
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

rooms = {}
client_to_room = {}
room_connections = {}

import asyncpg

# ── Database ────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:NB7Ve5qA6eDUFZ1V@db.cpudxfisekjxneuzdclp.supabase.co:5432/postgres")

db_pool = None  # asyncpg connection pool, initialised on startup

async def init_db():
    """Create the leaderboard table if it doesn't exist."""
    global db_pool
    if not DATABASE_URL:
        print("No DATABASE_URL set — leaderboard will be in-memory only.")
        return
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS leaderboard (
                    id         SERIAL PRIMARY KEY,
                    party      TEXT NOT NULL,
                    score_1    INTEGER DEFAULT 0,
                    score_2    INTEGER DEFAULT 0,
                    score_3    INTEGER DEFAULT 0,
                    score_4    INTEGER DEFAULT 0,
                    total      INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
        print("Database connected and leaderboard table ready.")
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
                "SELECT party, score_1, score_2, score_3, score_4, total "
                "FROM leaderboard ORDER BY total DESC LIMIT 50"
            )
            return [_row_to_entry(r) for r in rows]
    except Exception as e:
        print(f"DB read error: {e}")
        return _mem_leaderboard_sorted()

async def db_submit_leaderboard(party, scores):
    """Insert a new leaderboard entry."""
    s1 = scores.get("1", 0) or scores.get(1, 0)
    s2 = scores.get("2", 0) or scores.get(2, 0)
    s3 = scores.get("3", 0) or scores.get(3, 0)
    s4 = scores.get("4", 0) or scores.get(4, 0)
    total = s1 + s2 + s3 + s4
    if db_pool is None:
        # In-memory fallback
        _mem_leaderboard.append({
            "party": party,
            "scores": {"1": s1, "2": s2, "3": s3, "4": s4},
            "total": total,
        })
        _mem_leaderboard.sort(key=lambda e: e["total"], reverse=True)
        if len(_mem_leaderboard) > 100:
            del _mem_leaderboard[100:]
        return _mem_leaderboard_sorted()
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO leaderboard (party, score_1, score_2, score_3, score_4, total) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                party, s1, s2, s3, s4, total
            )
        return await db_get_leaderboard()
    except Exception as e:
        print(f"DB write error: {e}")
        return _mem_leaderboard_sorted()

def _row_to_entry(row):
    return {
        "party": row["party"],
        "scores": {
            "1": row["score_1"],
            "2": row["score_2"],
            "3": row["score_3"],
            "4": row["score_4"],
        },
        "total": row["total"],
    }

# In-memory fallback (used when DATABASE_URL not set)
_mem_leaderboard = []

def _mem_leaderboard_sorted():
    return sorted(_mem_leaderboard, key=lambda e: e["total"], reverse=True)[:50]


class TutorialState:
    """Tracks synced tutorial progress for a room (20 steps, indices 0-19)."""
    TOTAL_STEPS = 22

    # Steps where ok=True — ALL players must click OK before advancing
    # 0=intro, 9=checkpoint, 10=vessel return tip, 11=void siphon tip, 19=solo order, 21=final
    OK_STEPS = {0, 9, 10, 11, 19, 21}

    # Proximity steps — advance when any player enters the target station radius.
    # Key sent by client is "proximity_<step_index>"
    PROXIMITY_STEPS = {1, 3, 7, 13, 17}

    # Action steps — advance when any player sends the matching key
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
        return False  # partial — rebroadcast so others see "Waiting..."

    def try_action(self, key):
        # Proximity action: key = "proximity_<idx>"
        if key.startswith("proximity_"):
            try:
                idx = int(key.split("_")[1])
            except ValueError:
                return False
            if idx == self.step and idx in self.PROXIMITY_STEPS:
                self._advance()
                return True
            return False
        # Named action
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


def generate_code():
    return ''.join(random.choices(string.ascii_uppercase, k=4))


def make_response(data, rid=None):
    if rid is not None:
        data['_rid'] = rid
    return json.dumps(data)


def match_recipe(bundle):
    for recipe_name, recipe_colors in RECIPES.items():
        if sorted(json.dumps(c) for c in bundle) == sorted(json.dumps(c) for c in recipe_colors):
            return recipe_name, [180, 70, 255]
    return "Abstract Mush", [150, 0, 0]


async def schedule_vessel_respawn(room_code, delay=5.0):
    await asyncio.sleep(delay)
    if room_code not in rooms or room_code not in room_connections:
        return
    gs = rooms[room_code].get("game_state")
    if not gs:
        return
    total = gs.count_total_vessels(rooms[room_code]["players_dict"])
    if total < 3:
        vr = gs.stations.get("Vessel Return")
        if vr:
            vr["vessel_count"] = min(3, vr["vessel_count"] + 1)
    await broadcast_room(room_code, rooms, room_connections)


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
        self.last_update_time = time()
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
            # Start level 4 with 2 regular + 1 priority
            self._add_order(force_priority=False)
            self._add_order(force_priority=False)
            self._add_order(force_priority=True)
        else:
            for _ in range(3):
                self._add_order()

    # 2-orb recipe names
    TWO_ORB_RECIPES = {"Joyful Slumber", "Action Flight", "Deep Calm"}
    # 3-orb recipe names
    THREE_ORB_RECIPES = {"Vivid Odyssey", "Velvet Abyss", "Ember Vision"}

    def _add_order(self, force_priority=False):
        if len(self.orders) >= 5:
            return

        if self.level == 4:
            # Level 4: mix regular + priority, but priority must be 2-orb only
            is_priority = force_priority or (random.random() < 0.4)
            if is_priority:
                name = random.choice(list(self.TWO_ORB_RECIPES))
            else:
                name = random.choice(list(self.TWO_ORB_RECIPES))  # level 4 keeps 2-orb only for now
        else:
            is_priority = False
            # Levels 1-2: only 2-orb recipes
            if self.level <= 2:
                name = random.choice(list(self.TWO_ORB_RECIPES))
            else:
                # Level 3: mix 2 and 3 orb
                name = random.choice(list(RECIPES.keys()))

        is_three_orb = name in self.THREE_ORB_RECIPES

        if is_priority:
            # Priority orders: 2/3 of normal time, flagged
            base_time = 40.0
        elif is_three_orb:
            base_time = 60.0  # 3-orb orders get more time
        else:
            base_time = 60.0  # standard

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
        self.game_timer -= dt
        if self.game_timer <= 0:
            self.state = "LEVEL_COMPLETE"

        self.frame += 1
        if not self.is_tutorial:
            self.spawn_tick += dt
            if self.spawn_tick > 15 and len(self.orders) < 5:
                # Level 4: occasionally force a priority order on spawn
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

        # Dream Visualizer — server owns the timer, fires once
        dv = self.stations.get("Dream Visualizer")
        if dv and dv["is_cooking"]:
            dv["progress"] = min(1.0, dv["progress"] + dt / DREAM_VISUALIZER_COOK_TIME)
            if dv["progress"] >= 1.0:
                bundle = (dv["held_item"] or {}).get("bundle", [])
                res_name, res_color = match_recipe(bundle)
                dv["held_item"] = {
                    "name": res_name, "color": res_color,
                    "is_processed": True, "is_vessel": False,
                    "bundle": [], "dish_name": None, "dish_color": None,
                }
                dv["is_cooking"] = False
                dv["progress"] = 0.0
                self.station_locks["Dream Visualizer"] = None

        # Logic Filter — progresses only while players hold space (lf_holding via SYNC)
        # Speed scales with number of holders: 2 players = 2x, 3 = 3x, etc.
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
                    # Release lock so any player can pick up
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
            "orders": self.orders,
            "stations": self.stations,
            "station_locks": self.station_locks,
            "logic_filter_holders": len(self.logic_filter_holders),
        }
        if tutorial_state is not None:
            d["tutorial"] = tutorial_state.to_dict()
        return d


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


async def handle_client(websocket):
    client_id = id(websocket)
    current_room = None
    game_state = None

    try:
        async for message in websocket:
            request = json.loads(message)
            action = request.get("action")
            rid = request.get("_rid")
            response = {"status": "error", "message": "Unknown action"}

            if action == "CREATE":
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
                # Marks the room as started so non-host lobby polls know to show level select
                if current_room and current_room in rooms:
                    rooms[current_room]["state"] = "PLAYING"
                    response = {"status": "success", "action": "GAME_STARTED"}

            elif action == "LOAD_LEVEL":
                if current_room and current_room in rooms:
                    level = request.get("level", 1)
                    if level == 0:
                        # level 0 = return to dream atlas (level select screen)
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
                    # "tutorial" uses level 1 layout; is_tutorial flag changes order/timer behaviour
                    is_tut = (level == "tutorial")
                    server_level = 1 if is_tut else level
                    rooms[current_room]["game_state"] = GameState(server_level, is_tutorial=is_tut)
                    # Broadcast level_load to ALL players so everyone enters the game together
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

                        # lf_holding piggybacked on every SYNC — updates holders set instantly
                        lf_holding = request.get("lf_holding", False)
                        lf = game_state.stations.get("Logic Filter")
                        if lf and lf["is_cooking"]:
                            if lf_holding:
                                game_state.logic_filter_holders.add(client_id)
                            else:
                                game_state.logic_filter_holders.discard(client_id)
                        else:
                            game_state.logic_filter_holders.discard(client_id)

                        dt = time() - game_state.last_update_time
                        game_state.update(dt, rooms[current_room]["players_dict"])
                        game_state.last_update_time = time()

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
                                    # Do NOT add to holders — progress starts only when
                                    # lf_holding=true arrives via SYNC
                                    accepted = True
                                else:
                                    await websocket.send(make_response({
                                        "status": "rejected",
                                        "reason": "logic_filter_busy",
                                        "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state")),
                                        "players": list(rooms[current_room]["players_dict"].values())
                                    }, rid))
                                    continue
                            else:
                                await websocket.send(make_response({
                                    "status": "rejected",
                                    "reason": "logic_filter_busy",
                                    "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state")),
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
                                    "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state")),
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
                                        "status": "rejected",
                                        "reason": "dream_visualizer_busy",
                                        "game_state": game_state.to_dict(rooms[current_room].get("tutorial_state")),
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

            elif action == "TUTORIAL_START":
                # Host starts the tutorial — initialise TutorialState for the room
                if current_room and current_room in rooms:
                    player_ids = list(rooms[current_room]["players_dict"].keys())
                    rooms[current_room]["tutorial_state"] = TutorialState(player_ids)
                    await broadcast_room(current_room, rooms, room_connections)
                continue

            elif action == "TUTORIAL_OK":
                # A player confirmed the current OK step
                if current_room and current_room in rooms:
                    ts = rooms[current_room].get("tutorial_state")
                    gs = rooms[current_room].get("game_state")
                    if ts and gs:
                        ts.try_ok(client_id)   # advances internally when all confirmed
                        await broadcast_room(current_room, rooms, room_connections)
                continue

            elif action == "TUTORIAL_ACTION":
                # Any player completed a tutorial action
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
                                is_priority   = order.get("is_priority", False)
                                is_three_orb  = order.get("is_three_orb", False)
                                # Base points: 3-orb = 40, 2-orb = 20
                                base = 40 if is_three_orb else 20
                                # Time bonus: scaled to order max so both feel proportional
                                time_bonus = int(order["time"] / (1.5 if is_three_orb else 2))
                                points = (base + time_bonus) * (2 if is_priority else 1)
                                game_state.score += points
                                game_state.orders.pop(i)
                                delivered = True
                                break
                        if not delivered:
                            game_state.score = max(0, game_state.score - 15)
                        if is_vessel and delivered:
                            asyncio.create_task(schedule_vessel_respawn(current_room, delay=5.0))
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
                party_name = request.get("party", "Unknown")[:24]
                scores     = request.get("scores", {})
                entries    = await db_submit_leaderboard(party_name, scores)
                response   = {"status": "success", "action": "LEADERBOARD_DATA", "entries": entries}

            await websocket.send(make_response(response, rid))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if client_id in client_to_room:
            room_code = client_to_room[client_id]
            del client_to_room[client_id]
            if room_code in room_connections:
                room_connections[room_code] = [c for c in room_connections[room_code] if id(c) != client_id]
            if room_code in rooms and rooms[room_code]["game_state"]:
                gs = rooms[room_code]["game_state"]
                gs.release_all_locks(client_id)
                lf = gs.stations.get("Logic Filter")
                if lf and lf["is_cooking"] and gs.station_locks.get("Logic Filter") is None:
                    lf["is_cooking"] = False
                    lf["progress"] = 0.0
                    lf["held_item"] = None
        print(f"Connection closed: {client_id}")


async def main():
    await init_db()
    print(f"WebSocket server starting on {HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
