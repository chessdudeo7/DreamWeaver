import asyncio
import websockets
import json
import random
import string
import os

PLAYER_COLORS = [(0, 255, 200), (255, 140, 0), (255, 215, 0), (180, 70, 255)]
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", 5555))

rooms = {}

def generate_code():
    return ''.join(random.choices(string.ascii_uppercase, k=4))

async def handle_client(websocket):
    client_id = id(websocket)
    current_room = None
    
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
                    "players": [{"id": client_id, "name": name, "color": color, "x": 450, "y": 350}], 
                    "state": "LOBBY"
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
                        rooms[code]["players"].append({"id": client_id, "name": name, "color": color, "x": 450, "y": 350})
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
                    response = {"status": "success", "action": "GAME_STARTED"}
                    
            elif action == "SYNC":
                if current_room and current_room in rooms:
                    for p in rooms[current_room]["players"]:
                        if p["id"] == client_id:
                            p["x"] = request.get("x", p["x"])
                            p["y"] = request.get("y", p["y"])
                            break
                    response = {"status": "success", "players": rooms[current_room]["players"]}

            await websocket.send(json.dumps(response))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if current_room and current_room in rooms:
            rooms[current_room]["players"] = [p for p in rooms[current_room]["players"] if p["id"] != client_id]
        print(f"Connection closed: {client_id}")

async def main():
    print(f"WebSocket server starting on {HOST}:{PORT}")
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())