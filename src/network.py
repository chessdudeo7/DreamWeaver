import websocket
import json
import os

class Network:
    def __init__(self):
        # Use environment variable for server, fallback to local for testing
        self.server = os.getenv("GAME_SERVER", "ws://127.0.0.1:5555")
        self.websocket = None
        self.connect()

    def connect(self):
        try:
            self.websocket = websocket.create_connection(self.server)
            print(f"Connected to server at {self.server}!")
        except Exception as e:
            print(f"Connection failed: {e}")

    def send(self, data):
        try:
            # Send JSON-encoded data to server
            self.websocket.send(json.dumps(data))
            # Receive and decode response
            response = self.websocket.recv()
            return json.loads(response) if response else None
        except Exception as e:
            print(f"Network error: {e}")
            return None