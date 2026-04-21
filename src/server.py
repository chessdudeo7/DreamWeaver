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

async def schedule_vessel_respawn(room_code, delay=5.0):
    await asyncio.sleep(delay)
    if room_code not in rooms or room_code not in room_connections:
        return
    # Just tell all clients a respawn is available — they decide if they need it
    msg = json.dumps({"status": "vessel_respawn"})
    disconnected = []
    for conn in room_connections[room_code]:
        try:
            await conn.send(msg)
        except websockets.exceptions.ConnectionClosed:
            disconnected.append(conn)
    for conn in disconnected:
        room_connections[room_code].remove(conn)

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

        # NOTE: Stations items are now managed entirely by the client.
        # Server only tracks vessel_count at Vessel Return for respawning.
        # This prevents state desync where client picks up items but server still has them.

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

        # NOTE: Vessel respawning is now handled directly in DELIVER handler.
        # Serves are only responsible for tracking the total count, never going above 3.
        # This prevents the server from creating items that diverge from client view.

    def to_dict(self):
        # Sanitize stations: remove held_item state that's managed by clients
        # Only keep vessel_count for Vessel Return respawn tracking
        sanitized_stations = {}
        for name, station in self.stations.items():
            sanitized_stations[name] = {
                "name": station["name"],
                "x": station["x"],
                "y": station["y"],
                "w": station["w"],
                "h": station["h"],
                "color": station["color"],
                "progress": 0.0,  # Client manages progress for cooking stations
                "is_cooking": False,  # Client manages cooking state
                "vessel_count": 0,
                "held_item": None  # Client manages all held items now
            }
        
        return {
            "state": self.state,
            "score": self.score,
            "game_timer": max(0, self.game_timer),
            "frame": self.frame,
            "orders": self.orders,
            "stations": sanitized_stations,
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

                        # If a vessel was delivered, return it to Vessel Return (capped at 3 total)
                        if is_vessel and delivered:
                            asyncio.create_task(schedule_vessel_respawn(current_room, delay=5.0))

                        # Broadcast updated state to all players
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
                        
                        continue  # Skip individual response, broadcast handles it

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
