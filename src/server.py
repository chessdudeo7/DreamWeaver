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

# Game constants
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

rooms = {}
client_to_room = {}
room_connections = {}

def generate_code():
    return ''.join(random.choices(string.ascii_uppercase, k=4))

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
        self.players = {}
        self.station_locks = {}
        self.vessel_respawn_timers = {}
        self.last_update_time = time()

        self._create_stations(level)
        self._spawn_initial_orders()

    def _create_stations(self, level):
        station_configs = []
        if level == 1:
            station_configs = [
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
                ("Crate 3", 520, 280, 60, 60)
            ]
        else:
            station_configs = [
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
                ("Crate 3", 520, 320, 60, 60)
            ]

        for name, x, y, w, h in station_configs:
            self.stations[name] = {
                "name": name,
                "x": x, "y": y, "w": w, "h": h,
                "color": STATION_COLORS.get(name if "Crate" not in name else "Crate"),
                "held_item": None,
                "progress": 0.0,
                "is_cooking": False,
                "vessel_count": 0
            }
            self.station_locks[name] = None

        for i in range(3):
            crate_name = f"Crate {i+1}"
            self.stations[crate_name]["held_item"] = {
                "name": "Vessel",
                "color": [240, 240, 255],
                "is_processed": False,
                "is_vessel": True,
                "bundle": [],
                "dish_name": None,
                "dish_color": None
            }

    def _spawn_initial_orders(self):
        for _ in range(3):
            self._add_order()

    def _add_order(self):
        if len(self.orders) >= 5:
            return
        names = list(RECIPES.keys())
        name = names[random.randint(0, len(names) - 1)]
        self.orders.append({
            "name": name,
            "time": 60.0,
            "max": 60.0,
            "recipe": RECIPES[name]
        })

    def update(self, dt, players_dict=None):
        self.game_timer -= dt
        if self.game_timer <= 0:
            self.state = "LEVEL_COMPLETE"

        # Handle vessel respawn timers
        expired = []
        for pid, t in self.vessel_respawn_timers.items():
            self.vessel_respawn_timers[pid] = t - dt
            if self.vessel_respawn_timers[pid] <= 0:
                expired.append(pid)
                # Count vessels currently in play
                vessels_in_stations = sum(
                    1 for s in self.stations.values()
                    if s.get("held_item") and s["held_item"].get("is_vessel")
                )
                vessels_at_return = self.stations.get("Vessel Return", {}).get("vessel_count", 0)
                if vessels_in_stations + vessels_at_return < 3:
                    if "Vessel Return" in self.stations:
                        self.stations["Vessel Return"]["vessel_count"] = \
                            self.stations["Vessel Return"].get("vessel_count", 0) + 1
        for pid in expired:
            del self.vessel_respawn_timers[pid]

        self.frame += 1
        self.spawn_tick += dt
        if self.spawn_tick > 15 and len(self.orders) < 5:
            self._add_order()
            self.spawn_tick = 0

        # Update orders - expire timed-out ones
        remaining = []
        for o in self.orders:
            o["time"] -= dt
            if o["time"] <= 0:
                self.score -= 20
            else:
                remaining.append(o)
        self.orders = remaining

        # Update stations
        for station_name, station in self.stations.items():
            if station["name"] == "Dream Visualizer" and station["is_cooking"]:
                station["progress"] += 0.006
                if station["progress"] >= 1.0:
                    res_name = "Abstract Mush"
                    res_color = [150, 0, 0]
                    if station["held_item"] and len(station["held_item"].get("bundle", [])) == 2:
                        for recipe_name, recipe_colors in RECIPES.items():
                            if sorted([str(c) for c in station["held_item"]["bundle"]]) == sorted([str(c) for c in recipe_colors]):
                                res_name = recipe_name
                                res_color = [180, 70, 255]
                                break
                    station["held_item"] = {
                        "name": res_name,
                        "color": res_color,
                        "is_processed": True,
                        "is_vessel": False,
                        "bundle": [],
                        "dish_name": None
                    }
                    station["is_cooking"] = False
                    station["progress"] = 0

    def to_dict(self):
        return {
            "state": self.state,
            "score": self.score,
            "game_timer": max(0, self.game_timer),
            "frame": self.frame,
            "orders": self.orders,
            "stations": self.stations,
            "station_locks": self.station_locks
        }


async def broadcast_room(current_room, rooms, room_connections):
    """Broadcast current game state to all clients in a room."""
    if current_room not in room_connections:
        return
    game_state = rooms[current_room].get("game_state")
    if not game_state:
        return
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


async def handle_client(websocket):
    client_id = id(websocket)
    current_room = None
    game_state = None

    try:
        async for message in websocket:
            request = json.loads(message)
            action = request.get("action")
            response = {"status": "error", "message": "Unknown action"}

            if action == "CREATE":
                name = request.get("name", "Unknown Host")
                code = generate_code()
                color = PLAYER_COLORS[0]
                rooms[code] = {
                    "players": [{"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}],
                    "state": "LOBBY",
                    "game_state": None,
                    "players_dict": {client_id: {"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}}
                }
                room_connections[code] = [websocket]
                client_to_room[client_id] = code
                current_room = code
                response = {"status": "success", "action": "JOINED", "code": code, "is_host": True, "player_id": client_id}

            elif action == "JOIN":
                code = request.get("code").upper()
                name = request.get("name", "Guest")
                if code in rooms and rooms[code]["state"] == "LOBBY":
                    if len(rooms[code]["players"]) < 4:
                        color_idx = len(rooms[code]["players"])
                        color = PLAYER_COLORS[color_idx]
                        rooms[code]["players"].append({"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None})
                        rooms[code]["players_dict"][client_id] = {"id": client_id, "name": name, "color": color, "x": 450, "y": 350, "heldItem": None}
                        if code not in room_connections:
                            room_connections[code] = []
                        room_connections[code].append(websocket)
                        client_to_room[client_id] = code
                        current_room = code
                        response = {"status": "success", "action": "JOINED", "code": code, "is_host": False, "player_id": client_id}
                    else:
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

            elif action == "SYNC":
                if current_room and current_room in rooms:
                    game_state = rooms[current_room]["game_state"]
                    if game_state:
                        # Update player position and held item
                        for p in rooms[current_room]["players_dict"].values():
                            if p["id"] == client_id:
                                p["x"] = request.get("x", p["x"])
                                p["y"] = request.get("y", p["y"])
                                p["heldItem"] = request.get("heldItem")
                                break

                        # Handle processor station locking
                        processor_stations = ["Logic Filter", "Dream Visualizer"]
                        player_station = request.get("interact_station")

                        for station_name in processor_stations:
                            if game_state.station_locks.get(station_name) == client_id and station_name != player_station:
                                game_state.station_locks[station_name] = None

                        if player_station and player_station in processor_stations:
                            current_user = game_state.station_locks.get(player_station)
                            if current_user is None:
                                game_state.station_locks[player_station] = client_id
                            elif current_user == client_id:
                                pass
                            # else: another player has it, ignore

                        dt = time() - game_state.last_update_time
                        game_state.update(dt, rooms[current_room]["players_dict"])
                        game_state.last_update_time = time()

                        response = {
                            "status": "success",
                            "players": list(rooms[current_room]["players_dict"].values()),
                            "game_state": game_state.to_dict()
                        }

                        # Broadcast to all players in room
                        if current_room in room_connections:
                            broadcast_msg = json.dumps(response)
                            disconnected = []
                            for conn in room_connections[current_room]:
                                try:
                                    await conn.send(broadcast_msg)
                                except websockets.exceptions.ConnectionClosed:
                                    disconnected.append(conn)
                            for conn in disconnected:
                                room_connections[current_room].remove(conn)

                        continue  # Already broadcasted, skip individual send
                    else:
                        response = {"status": "success", "players": list(rooms[current_room]["players_dict"].values())}

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

                        # Schedule vessel respawn if a plate was used
                        if is_vessel:
                            game_state.vessel_respawn_timers[client_id] = 5.0

                        response = {
                            "status": "success",
                            "delivered": delivered,
                            "score": game_state.score,
                            "orders": game_state.orders
                        }
                        
                        # Broadcast updated state to all players so everyone sees the delivery
                        if current_room in room_connections:
                            broadcast_msg = json.dumps({
                                "status": "success",
                                "players": list(rooms[current_room]["players_dict"].values()),
                                "game_state": game_state.to_dict()
                            })
                            disconnected = []
                            for conn in room_connections[current_room]:
                                try:
                                    await conn.send(broadcast_msg)
                                except websockets.exceptions.ConnectionClosed:
                                    disconnected.append(conn)
                            for conn in disconnected:
                                room_connections[current_room].remove(conn)

            await websocket.send(json.dumps(response))

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
                for station_name in list(gs.station_locks.keys()):
                    if gs.station_locks[station_name] == client_id:
                        gs.station_locks[station_name] = None

        print(f"Connection closed: {client_id}")


async def main():
    print(f"WebSocket server starting on {HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
