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
        self.station_locks = {}  # Track which player is using each station
        self.vessel_respawn_timers = {}  # Track vessel respawn timers per player
        self.logic_filter_user = None  # Track who is currently processing at Logic Filter
        self.last_update_time = time()
        
        self._create_stations(level)
        self._spawn_initial_orders()
    
    def _create_stations(self, level):
        """Create stations for the level"""
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
        
        # Setup crates with vessels
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
        name = names[random.randint(0, len(names)-1)]
        self.orders.append({
            "name": name,
            "time": 60.0,
            "max": 60.0,
            "recipe": RECIPES[name]
        })
    
    def update(self, dt, players_dict=None):
        """Update game state"""
        self.game_timer -= dt
        if self.game_timer <= 0:
            self.state = "LEVEL_COMPLETE"
        
        self.frame += 1
        self.spawn_tick += dt
        if self.spawn_tick > 15 and len(self.orders) < 5:
            self._add_order()
            self.spawn_tick = 0
        
        # Update orders
        self.orders = [o for o in self.orders if o["time"] > 0]
        for o in self.orders:
            o["time"] -= dt
            if o["time"] <= 0:
                self.score -= 20  # Can go negative!
        
        # Update stations
        for station_name, station in self.stations.items():
            # Logic Filter - continuous progress for whoever is using it
            if station["name"] == "Logic Filter":
                if self.logic_filter_user and players_dict:
                    if self.logic_filter_user in players_dict:
                        player = players_dict[self.logic_filter_user]
                        # Only process if player has item AND item is not already processed
                        if player.get("heldItem") and not player["heldItem"].get("isProcessed") and not player["heldItem"].get("isVessel"):
                            # Reset progress if starting fresh
                            if station["progress"] >= 1.0:
                                station["progress"] = 0.0
                            station["progress"] += dt * 10.0  # ~0.1 seconds to complete
                            # Cap progress at 1.0 to ensure completion frame is visible
                            if station["progress"] >= 1.0:
                                station["progress"] = 1.0
                                # Mark item as processed (camelCase to match client format)
                                player["heldItem"]["isProcessed"] = True
                                self.logic_filter_user = None
                        else:
                            # Player no longer has a valid item, stop processing
                            station["progress"] = 0.0
                            self.logic_filter_user = None
                elif station["progress"] >= 1.0:
                    # Reset progress only when no one is using it and it's at completion
                    station["progress"] = 0.0
            
            if station["name"] == "Dream Visualizer" and station["is_cooking"]:
                station["progress"] += 0.006
                if station["progress"] >= 1.0:
                    # Finalize recipe
                    res_name = "Abstract Mush"
                    res_color = [150, 0, 0]
                    if station["held_item"] and len(station["held_item"].get("bundle", [])) == 2:
                        for recipe_name, recipe_colors in RECIPES.items():
                            if sorted([str(c) for c in station["held_item"]["bundle"]]) == sorted([str(c) for c in recipe_colors]):
                                res_name = recipe_name
                                res_color = [255, 255, 255]
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
        """Serialize state to send to clients"""
        return {
            "state": self.state,
            "score": self.score,
            "game_timer": max(0, self.game_timer),
            "frame": self.frame,
            "orders": self.orders,
            "stations": self.stations,
            "station_locks": self.station_locks
        }

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
                    # Update player position and item
                    for p in rooms[current_room]["players_dict"].values():
                        if p["id"] == client_id:
                            p["x"] = request.get("x", p["x"])
                            p["y"] = request.get("y", p["y"])
                            p["heldItem"] = request.get("heldItem")
                            break
                    
                    # Update game state and send back
                    if rooms[current_room]["game_state"]:
                        dt = time() - rooms[current_room]["game_state"].last_update_time
                        rooms[current_room]["game_state"].update(dt, rooms[current_room]["players_dict"])
                        rooms[current_room]["game_state"].last_update_time = time()
                        
                        response = {
                            "status": "success",
                            "players": list(rooms[current_room]["players_dict"].values()),
                            "game_state": rooms[current_room]["game_state"].to_dict()
                        }
                    else:
                        response = {"status": "success", "players": list(rooms[current_room]["players_dict"].values())}
            
            elif action == "INTERACT":
                if current_room and current_room in rooms and rooms[current_room]["game_state"]:
                    game_state = rooms[current_room]["game_state"]
                    station_name = request.get("station")
                    player_id = client_id
                    
                    # Simple interaction handling - the client will handle most logic
                    # Server just syncs state
                    response = {"status": "success"}
            
            elif action == "USE_STATION":
                if current_room and current_room in rooms and rooms[current_room]["game_state"]:
                    game_state = rooms[current_room]["game_state"]
                    station_name = request.get("station")
                    
                    if station_name == "Logic Filter":
                        # Mark this player as using the Logic Filter (only if not already processing)
                        if game_state.logic_filter_user != client_id:
                            game_state.logic_filter_user = client_id
                    
                    # Return updated game state
                    response = {
                        "status": "success",
                        "game_state": game_state.to_dict()
                    }
            
            elif action == "STOP_USE_STATION":
                if current_room and current_room in rooms and rooms[current_room]["game_state"]:
                    game_state = rooms[current_room]["game_state"]
                    # Stop processing if this player is the one using it
                    if game_state.logic_filter_user == client_id:
                        game_state.logic_filter_user = None
                        game_state.stations["Logic Filter"]["progress"] = 0.0
                    
                    response = {"status": "success"}

            await websocket.send(json.dumps(response))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"Connection closed: {client_id}")

async def main():
    print(f"WebSocket server starting on {HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
