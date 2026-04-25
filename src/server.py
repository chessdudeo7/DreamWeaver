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
    "Joyful Slumber": [[255, 215, 0], [0, 191, 255]],
    "Action Flight": [[255, 140, 0], [255, 215, 0]],
    "Deep Calm": [[0, 191, 255], [0, 191, 255]]
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

# Server-authoritative cook times (seconds, at 1 player)
DREAM_VISUALIZER_COOK_TIME = 5.0
LOGIC_FILTER_PROCESS_TIME = 2.5

rooms = {}
client_to_room = {}
room_connections = {}

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
    def __init__(self, level=1):
        self.level = level
        self.state = "PLAYING"
        self.score = 0
        self.game_timer = 120.0
        self.frame = 0
        self.spawn_tick = 0
        self.orders = []
        self.stations = {}
        # station_locks: who owns the station (placed their orb in)
        self.station_locks = {}
        # logic_filter_holders: set of client_ids actively holding space at Logic Filter
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
        else:
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

        for name, x, y, w, h in configs:
            self.stations[name] = {
                "name": name,
                "x": x, "y": y, "w": w, "h": h,
                "color": STATION_COLORS.get(name if "Crate" not in name else "Crate"),
                "held_item": None,
                "progress": 0.0,
                "is_cooking": False,
                "vessel_count": 0,
                # Extra field broadcast to clients so they can render the boost indicator
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
        for _ in range(3):
            self._add_order()

    def _add_order(self):
        if len(self.orders) >= 5:
            return
        name = random.choice(list(RECIPES.keys()))
        self.orders.append({"name": name, "time": 60.0, "max": 60.0, "recipe": RECIPES[name]})

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
        self.spawn_tick += dt
        if self.spawn_tick > 15 and len(self.orders) < 5:
            self._add_order()
            self.spawn_tick = 0

        remaining = []
        for o in self.orders:
            o["time"] -= dt
            if o["time"] <= 0:
                self.score -= 20
            else:
                remaining.append(o)
        self.orders = remaining

        # Dream Visualizer: server timer, single result, no player input needed
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

        # Logic Filter: progresses only while at least one player holds space,
        # and speed scales with number of holders (multiplayer boost).
        lf = self.stations.get("Logic Filter")
        if lf and lf["is_cooking"]:
            n_holders = len(self.logic_filter_holders)
            lf["active_holders"] = n_holders
            if n_holders > 0:
                # Each additional player adds a full speed multiplier
                speed_mult = n_holders
                lf["progress"] = min(1.0, lf["progress"] + dt * speed_mult / LOGIC_FILTER_PROCESS_TIME)
                if lf["progress"] >= 1.0:
                    if lf["held_item"]:
                        lf["held_item"]["is_processed"] = True
                    lf["is_cooking"] = False
                    lf["progress"] = 0.0
                    lf["active_holders"] = 0
                    self.logic_filter_holders.clear()
                    # Release lock so any player can pick up the finished orb
                    self.station_locks["Logic Filter"] = None
        else:
            if lf:
                lf["active_holders"] = 0

    def to_dict(self):
        return {
            "state": self.state,
            "score": self.score,
            "game_timer": max(0, self.game_timer),
            "frame": self.frame,
            "orders": self.orders,
            "stations": self.stations,
            "station_locks": self.station_locks,
            "logic_filter_holders": len(self.logic_filter_holders),
        }


async def broadcast_room(current_room, rooms, room_connections):
    if current_room not in room_connections:
        return
    gs = rooms[current_room].get("game_state")
    if not gs:
        return
    msg = json.dumps({
        "status": "success",
        "players": list(rooms[current_room]["players_dict"].values()),
        "game_state": gs.to_dict()
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
                    "state": "LOBBY", "game_state": None,
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
                    rooms[current_room]["game_state"] = GameState(1)
                    response = {"status": "success", "action": "GAME_STARTED"}

            elif action == "LOAD_LEVEL":
                if current_room and current_room in rooms:
                    level = request.get("level", 1)
                    rooms[current_room]["game_state"] = GameState(level)
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

                        dt = time() - game_state.last_update_time
                        game_state.update(dt, rooms[current_room]["players_dict"])
                        game_state.last_update_time = time()

                        if current_room in room_connections:
                            msg = json.dumps({
                                "status": "success",
                                "players": list(rooms[current_room]["players_dict"].values()),
                                "game_state": game_state.to_dict()
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
                            # Player places their orb into the machine.
                            # Does NOT add to holders — client sends hold_start separately
                            # only while space is genuinely held, preventing auto-processing.
                            lf = game_state.stations.get("Logic Filter")
                            if lf and not lf["is_cooking"] and not lf["held_item"]:
                                if game_state.try_lock("Logic Filter", client_id):
                                    lf["held_item"] = request.get("orb_item")
                                    lf["is_cooking"] = True
                                    lf["progress"] = 0.0
                                    # Do NOT add to logic_filter_holders here.
                                    # Progress only advances when hold_start arrives.
                                    accepted = True
                                else:
                                    # Busy — reject so client keeps the orb
                                    await websocket.send(make_response({
                                        "status": "rejected",
                                        "reason": "logic_filter_busy",
                                        "game_state": game_state.to_dict(),
                                        "players": list(rooms[current_room]["players_dict"].values())
                                    }, rid))
                                    continue
                            else:
                                # Machine already occupied — reject silently so client keeps orb
                                await websocket.send(make_response({
                                    "status": "rejected",
                                    "reason": "logic_filter_busy",
                                    "game_state": game_state.to_dict(),
                                    "players": list(rooms[current_room]["players_dict"].values())
                                }, rid))
                                continue

                        elif update_type == "logic_filter_hold_start":
                            # A second (or third) player joins the boost — they are near the
                            # machine and holding space but don't own the orb.
                            lf = game_state.stations.get("Logic Filter")
                            if lf and lf["is_cooking"]:
                                game_state.logic_filter_holders.add(client_id)
                                accepted = True

                        elif update_type == "logic_filter_hold_stop":
                            # Player released space or walked away
                            game_state.logic_filter_holders.discard(client_id)
                            accepted = True

                        elif update_type == "logic_filter_cancel":
                            # Owner walked away while orb is still processing — orb returns to them
                            lf = game_state.stations.get("Logic Filter")
                            if lf and game_state.station_locks.get("Logic Filter") == client_id:
                                orb = lf["held_item"]
                                lf["held_item"] = None
                                lf["is_cooking"] = False
                                lf["progress"] = 0.0
                                lf["active_holders"] = 0
                                game_state.logic_filter_holders.discard(client_id)
                                game_state.release_lock("Logic Filter", client_id)
                                # Send the orb back to the client directly
                                await websocket.send(make_response({
                                    "status": "logic_filter_cancelled",
                                    "returned_orb": orb,
                                    "game_state": game_state.to_dict(),
                                    "players": list(rooms[current_room]["players_dict"].values())
                                }, rid))
                                # Also broadcast so others see the reset
                                await broadcast_room(current_room, rooms, room_connections)
                                continue
                            else:
                                # Non-owner walked away — just remove from holders
                                game_state.logic_filter_holders.discard(client_id)
                                accepted = True

                        elif update_type == "logic_filter_pickup":
                            lf = game_state.stations.get("Logic Filter")
                            # Any player can pick up a finished orb — lock is released on completion
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
                                        "game_state": game_state.to_dict(),
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
                                    "game_state": game_state.to_dict()
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

            elif action == "DELIVER":
                if current_room and current_room in rooms:
                    game_state = rooms[current_room]["game_state"]
                    if game_state:
                        dish_name = request.get("dish_name")
                        is_vessel = request.get("is_vessel", False)
                        delivered = False
                        for i, order in enumerate(game_state.orders):
                            if order["name"] == dish_name:
                                game_state.score += (20 + int(order["time"] / 2))
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
                                "game_state": game_state.to_dict()
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
                # If this client owned the Logic Filter and it was still processing, cancel it
                lf = gs.stations.get("Logic Filter")
                if lf and lf["is_cooking"] and gs.station_locks.get("Logic Filter") is None:
                    lf["is_cooking"] = False
                    lf["progress"] = 0.0
                    lf["held_item"] = None
        print(f"Connection closed: {client_id}")


async def main():
    print(f"WebSocket server starting on {HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
