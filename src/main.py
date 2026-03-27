import pygame
import sys
import random
import math
from network import Network

# --- Initialization ---
pygame.init()
WIDTH, HEIGHT = 900, 700
MISSED_ORDER_PENALTY = 20
SCREEN = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Dreamweaver: Level Progression")
CLOCK = pygame.time.Clock()
FPS = 60

# --- Palette ---
BLACK, WHITE, GOLD = (15, 10, 25), (240, 240, 255), (255, 215, 0)
SKY_BLUE, ORANGE, TEAL = (0, 191, 255), (255, 140, 0), (0, 255, 200)

STATION_COLORS = {
    "Happy Dispenser": GOLD, "Calm Dispenser": SKY_BLUE, "Adventure Dispenser": ORANGE,
    "Logic Filter": (100, 110, 130), "Dream Visualizer": (180, 70, 255),
    "Gateway": (50, 255, 150), "Crate": (110, 70, 40), "Void Siphon": (20, 20, 20),
    "Vessel Return": (80, 60, 120)
}

# --- Classes ---
class Item:
    def __init__(self, name, color, is_processed=False, is_vessel=False):
        self.name, self.color = name, color
        self.is_processed, self.is_vessel = is_processed, is_vessel
        self.bundle = []
        self.dish_name = None
        self.dish_color = None

    def draw(self, surface, x, y, scale=1.0):
        pulse = math.sin(pygame.time.get_ticks() * 0.01) * 2
        r = int((12 + pulse) * scale)

        if self.is_vessel:
            pygame.draw.ellipse(surface, (120, 100, 200), (x - 24, y - 14, 48, 28), 2)
            pygame.draw.ellipse(surface, (180, 150, 255), (x - 22, y - 12, 44, 24), 1)
            
            if self.dish_name:
                pygame.draw.circle(surface, self.dish_color, (x, y - 8), r)
                pygame.draw.circle(surface, WHITE, (x, y - 8), r - 4)
            elif self.bundle:
                for i, col in enumerate(self.bundle):
                    angle_step = (2 * math.pi) / max(1, len(self.bundle))
                    speed = pygame.time.get_ticks() * 0.005
                    ox = math.cos(i * angle_step + speed) * 14
                    oy = math.sin(i * angle_step + speed) * 14
                    pygame.draw.circle(surface, col, (int(x + ox), int(y - 8 + oy)), 7)
                    pygame.draw.circle(surface, WHITE, (int(x + ox), int(y - 8 + oy)), 3)
        else:
            glow_col = list(self.color)
            pygame.draw.circle(surface, self.color, (x, y), r + 4, 2) 
            pygame.draw.circle(surface, self.color, (x, y), r)
            pygame.draw.circle(surface, WHITE, (x, y), r // 2)

            if self.is_processed: 
                pygame.draw.circle(surface, TEAL, (x, y), r + 6, 2)
            
            if self.bundle:
                for i, col in enumerate(self.bundle):
                    angle_step = (2 * math.pi) / len(self.bundle)
                    speed = pygame.time.get_ticks() * 0.005
                    ox = math.cos(i * angle_step + speed) * (25)
                    oy = math.sin(i * angle_step + speed) * (25)
                    pygame.draw.circle(surface, col, (int(x + ox), int(y + oy)), 8)
                    pygame.draw.circle(surface, WHITE, (int(x + ox), int(y + oy)), 4)

class Station:
    def __init__(self, name, x, y, w, h):
        self.name, self.rect = name, pygame.Rect(x, y, w, h)
        self.color = STATION_COLORS.get(name if "Crate" not in name else "Crate")
        self.progress, self.is_highlighted, self.held_item = 0.0, False, None
        self.is_cooking = False
        self.vessel_count = 0

    def draw(self, surface, frame):
        b_col = TEAL if self.is_highlighted else WHITE
        pygame.draw.rect(surface, (25, 20, 45), (self.rect.x+5, self.rect.y+5, self.rect.w, self.rect.h), border_radius=12)
        pygame.draw.rect(surface, self.color, self.rect, border_radius=10)
        
        if self.is_highlighted:
            tint = pygame.Surface((self.rect.w, self.rect.h), pygame.SRCALPHA); tint.fill((255, 255, 255, 40))
            surface.blit(tint, self.rect.topleft)
        pygame.draw.rect(surface, b_col, self.rect, width=2, border_radius=10)
        
        f = pygame.font.SysFont("Arial", 14, bold=True)
        if "Crate" not in self.name:
            for i, word in enumerate(self.name.split()):
                txt = f.render(word, True, WHITE if self.name in ["Void Siphon", "Vessel Return"] else (20, 20, 20))
                surface.blit(txt, (self.rect.centerx - txt.get_width()//2, self.rect.y + 10 + (i*16)))

        if self.name == "Vessel Return":
            for i in range(self.vessel_count):
                pygame.draw.ellipse(surface, (120, 100, 200), (self.rect.centerx - 22, self.rect.centery - 10 - (i*8), 44, 24), 2)
        elif self.name == "Dream Visualizer" and self.held_item and not self.is_cooking:
            bounce = int(math.sin(frame*0.1)*8)
            self.held_item.draw(surface, self.rect.centerx, self.rect.y - 25 + bounce)
        elif self.held_item:
            self.held_item.draw(surface, self.rect.centerx, self.rect.centery)

        if self.progress > 0:
            pygame.draw.rect(surface, (50, 50, 50), (self.rect.x, self.rect.bottom+8, self.rect.w, 8), border_radius=4)
            pygame.draw.rect(surface, TEAL, (self.rect.x, self.rect.bottom+8, self.rect.w * self.progress, 8), border_radius=4)

class Player:
    def __init__(self, x, y, color):
        self.rect, self.held_item = pygame.Rect(x, y, 40, 40), None
        self.base_speed, self.dash_speed, self.dash_energy = 6, 12, 100.0
        self.is_dashing = False
        self.color = color

    def move(self, dx, dy, stations, keys):
        if keys[pygame.K_LSHIFT] and self.dash_energy > 0 and (dx != 0 or dy != 0):
            speed, self.is_dashing = self.dash_speed, True
            self.dash_energy -= 1.8
        else:
            speed, self.is_dashing = self.base_speed, False
            self.dash_energy = min(100, self.dash_energy + 0.6)

        self.rect.x += dx * speed
        for s in stations:
            if self.rect.colliderect(s.rect):
                if dx > 0: self.rect.right = s.rect.left
                else: self.rect.left = s.rect.right
        self.rect.y += dy * speed
        for s in stations:
            if self.rect.colliderect(s.rect):
                if dy > 0: self.rect.bottom = s.rect.top
                else: self.rect.top = s.rect.bottom
        self.rect.clamp_ip(pygame.Rect(0, 95, WIDTH, HEIGHT-155))

    def draw(self, surface):
        p_color = self.color if not self.is_dashing else WHITE
        pygame.draw.rect(surface, p_color, self.rect, border_radius=8)
        if self.dash_energy < 100:
            pygame.draw.rect(surface, (50, 50, 50), (self.rect.x, self.rect.y - 12, 40, 5))
            pygame.draw.rect(surface, SKY_BLUE, (self.rect.x, self.rect.y - 12, 40 * (self.dash_energy/100), 5))
        if self.held_item: self.held_item.draw(surface, self.rect.centerx, self.rect.centery)

# --- Level System Setup ---
RECIPES = {"Joyful Slumber": [GOLD, SKY_BLUE], "Action Flight": [ORANGE, GOLD], "Deep Calm": [SKY_BLUE, SKY_BLUE]}
LEVEL_STAR_THRESHOLDS = [60, 120, 180]

def add_order():
    n = random.choice(list(RECIPES.keys()))
    orders.append({"name": n, "time": 60.0, "max": 60.0, "recipe": RECIPES[n]})

def load_level(level_num):
    global player, orders, score, game_timer, frame, spawn_tick
    global red_flash, vessel_respawn_timers, stations, game_state, current_level
    global players_dict, my_id, connected_players
    
    current_level = level_num
    game_state = "PLAYING"
    
    # Safely build player dictionary to avoid Type/Key errors
    players_dict.clear()
    for i, p_data in enumerate(connected_players):
        if isinstance(p_data, dict):
            p_id = p_data.get("id", str(i))
            p_col = tuple(p_data.get("color", TEAL))
        else:
            p_id = p_data if isinstance(p_data, str) else str(i)
            p_col = TEAL
        players_dict[p_id] = Player(WIDTH//2, HEIGHT//2, p_col)
    
    # Fallback to prevent crash if my_id isn't registered by network yet
    if my_id not in players_dict:
        players_dict[my_id] = Player(WIDTH//2, HEIGHT//2, TEAL)
    
    player = players_dict[my_id] 
    orders, score, game_timer, frame, spawn_tick = [], 0, 120.0, 0, 0

    if level_num == 1:
        stations = [
            Station("Happy Dispenser", 60, 110, 90, 90), Station("Calm Dispenser", 160, 110, 90, 90),
            Station("Adventure Dispenser", 260, 110, 90, 90), Station("Logic Filter", 740, 110, 100, 140),
            Station("Dream Visualizer", 400, 510, 140, 90), Station("Gateway", 60, 510, 110, 90),
            Station("Vessel Return", 200, 510, 110, 90), Station("Void Siphon", 780, 510, 80, 90),
            Station("Crate 1", 380, 280, 60, 60), Station("Crate 2", 450, 280, 60, 60), Station("Crate 3", 520, 280, 60, 60)
        ]
    else: 
        stations = [
            Station("Happy Dispenser", 740, 510, 90, 90), Station("Calm Dispenser", 640, 510, 90, 90),
            Station("Adventure Dispenser", 540, 510, 90, 90), Station("Logic Filter", 60, 110, 100, 140),
            Station("Dream Visualizer", 400, 110, 140, 90), Station("Gateway", 740, 110, 110, 90),
            Station("Vessel Return", 600, 110, 110, 90), Station("Void Siphon", 60, 510, 80, 90),
            Station("Crate 1", 380, 320, 60, 60), Station("Crate 2", 450, 320, 60, 60), Station("Crate 3", 520, 320, 60, 60)
        ]

    crate_stations = [s for s in stations if "Crate" in s.name]
    for i in range(3): crate_stations[i].held_item = Item("Vessel", WHITE, is_vessel=True)
    for _ in range(3): add_order()

# --- GLOBALS INITIALIZATION (Fixed Variable Scope Issues) ---
current_level = 1
red_flash = 0
vessel_respawn_timers = []
score = 0
game_active = True
game_state = "MAIN_MENU"
net = None
room_code = ""
my_id = "local_test" # Default assigned so local bypass doesn't crash
players_dict = {}
is_host = False
player_name = ""
typing_name = True
typing_code = False
connected_players = []

# Game mechanics globals guaranteed to exist before execution
orders = []
frame = 0
spawn_tick = 0
game_timer = 120.0
player = None
stations = []

# --- Main Game Loop ---
while True:
    dt = CLOCK.tick(FPS) / 1000.0
    mouse_pos = pygame.mouse.get_pos()
    mouse_clicked = False
    events = pygame.event.get()

    for event in events:
        if event.type == pygame.QUIT: pygame.quit(); sys.exit()
        if event.type == pygame.MOUSEBUTTONDOWN: mouse_clicked = True
        
        # Handling text input
        if game_state == "MAIN_MENU" and event.type == pygame.KEYDOWN:
            if typing_name:
                if event.key == pygame.K_BACKSPACE: player_name = player_name[:-1]
                elif len(player_name) < 12: player_name += event.unicode
            elif typing_code:
                if event.key == pygame.K_BACKSPACE: room_code = room_code[:-1]
                elif len(room_code) < 4 and event.unicode.isalpha():
                    room_code += event.unicode.upper()
        
        if game_state == "PLAYING" and event.type == pygame.KEYDOWN and event.key == pygame.K_SPACE:
            for s in stations:
                if s.is_highlighted:
                    if s.name == "Void Siphon" and player.held_item:
                        if getattr(player.held_item, 'is_vessel', False):
                            player.held_item.bundle = []
                            player.held_item.dish_name = None
                            player.held_item.dish_color = None
                        else:
                            player.held_item = None
                    elif "Crate" in s.name:
                        if player.held_item and s.held_item:
                            p_item, s_item = player.held_item, s.held_item
                            
                            if getattr(p_item, 'is_vessel', False) and not getattr(s_item, 'is_vessel', False):
                                if s_item.is_processed and not p_item.dish_name:
                                    if s_item.bundle: p_item.bundle.extend(s_item.bundle)
                                    else: p_item.bundle.append(s_item.color)
                                    s.held_item = None 
                                elif (s_item.name in RECIPES or s_item.name == "Abstract Mush") and not p_item.bundle:
                                    p_item.dish_name, p_item.dish_color = s_item.name, s_item.color
                                    s.held_item = None 

                            elif not getattr(p_item, 'is_vessel', False) and getattr(s_item, 'is_vessel', False):
                                if p_item.is_processed and not s_item.dish_name:
                                    if p_item.bundle: s_item.bundle.extend(p_item.bundle)
                                    else: s_item.bundle.append(p_item.color)
                                    player.held_item = None
                                elif (p_item.name in RECIPES or p_item.name == "Abstract Mush") and not s_item.bundle:
                                    s_item.dish_name, s_item.dish_color = p_item.name, p_item.color
                                    player.held_item = None
                        
                        elif not player.held_item and s.held_item:
                            player.held_item, s.held_item = s.held_item, None
                        elif player.held_item and not s.held_item:
                            s.held_item, player.held_item = player.held_item, None

                    elif "Dispenser" in s.name and not player.held_item:
                        player.held_item = Item(s.name.split()[0], STATION_COLORS[s.name])
                    
                    elif s.name == "Vessel Return":
                        if not player.held_item and s.vessel_count > 0:
                            s.vessel_count -= 1; player.held_item = Item("Vessel", WHITE, is_vessel=True)

                    elif s.name == "Dream Visualizer":
                        if s.held_item and not s.is_cooking:
                            if player.held_item and getattr(player.held_item, 'is_vessel', False):
                                if not player.held_item.bundle and not player.held_item.dish_name:
                                    player.held_item.dish_name = s.held_item.name
                                    player.held_item.dish_color = s.held_item.color
                                    s.held_item = None
                            elif not player.held_item:
                                player.held_item, s.held_item = s.held_item, None
                                
                        elif player.held_item and not s.is_cooking:
                            if not getattr(player.held_item, 'is_vessel', False) and player.held_item.bundle:
                                s.held_item, player.held_item = player.held_item, None; s.is_cooking = True
                            elif getattr(player.held_item, 'is_vessel', False) and player.held_item.bundle:
                                dummy = Item("Bundle", WHITE, is_processed=True)
                                dummy.bundle = player.held_item.bundle.copy()
                                s.held_item = dummy; player.held_item.bundle = []; s.is_cooking = True
                                
                    elif s.name == "Gateway" and player.held_item:
                        if getattr(player.held_item, 'is_vessel', False) and player.held_item.dish_name:
                            delivered = False
                            for o in orders:
                                if o['name'] == player.held_item.dish_name:
                                    score += (20 + int(o['time']/2)); orders.remove(o); delivered = True; break
                            if not delivered: score = max(0, score - 15); red_flash = 0.2
                            vessel_respawn_timers.append(5.0); player.held_item = None
    
    # --- MAIN MENU STATE ---
    if game_state == "MAIN_MENU":
        SCREEN.fill((10, 5, 20))
        f_title = pygame.font.SysFont("Arial", 60, bold=True)
        f_btn = pygame.font.SysFont("Arial", 28, bold=True)
        
        SCREEN.blit(f_title.render("DREAMWEAVER", True, TEAL), (WIDTH//2 - 200, 60))

        name_rect = pygame.Rect(WIDTH//2 - 150, 180, 300, 50)
        col_name = TEAL if typing_name else (60, 60, 90)
        pygame.draw.rect(SCREEN, col_name, name_rect, border_radius=8, width=2)
        name_surf = f_btn.render(f"NAME: {player_name}", True, WHITE)
        SCREEN.blit(name_surf, (name_rect.x + 10, name_rect.y + 10))

        code_rect = pygame.Rect(WIDTH//2 - 150, 250, 300, 50)
        col_code = ORANGE if typing_code else (60, 60, 90)
        pygame.draw.rect(SCREEN, col_code, code_rect, border_radius=8, width=2)
        code_surf = f_btn.render(f"CODE: {room_code}", True, WHITE)
        SCREEN.blit(code_surf, (code_rect.x + 10, code_rect.y + 10))

        btn_host = pygame.Rect(WIDTH//2 - 150, 350, 140, 60)
        btn_join = pygame.Rect(WIDTH//2 + 10, 350, 140, 60)
        
        can_proceed = len(player_name.strip()) > 0
        h_col = (SKY_BLUE if btn_host.collidepoint(mouse_pos) else (40, 40, 80)) if can_proceed else (30, 30, 30)
        j_col = (ORANGE if btn_join.collidepoint(mouse_pos) else (80, 40, 40)) if (can_proceed and len(room_code) == 4) else (30, 30, 30)

        pygame.draw.rect(SCREEN, h_col, btn_host, border_radius=10)
        pygame.draw.rect(SCREEN, j_col, btn_join, border_radius=10)
        SCREEN.blit(f_btn.render("HOST", True, WHITE), (btn_host.centerx - 35, btn_host.centery - 15))
        SCREEN.blit(f_btn.render("JOIN", True, WHITE), (btn_join.centerx - 30, btn_join.centery - 15))

        if mouse_clicked:
            if name_rect.collidepoint(mouse_pos): typing_name, typing_code = True, False
            elif code_rect.collidepoint(mouse_pos): typing_name, typing_code = False, True
            
            if can_proceed and btn_host.collidepoint(mouse_pos):
                try:
                    net = Network()
                    res = net.send({"action": "CREATE", "name": player_name})
                    if res and res.get("status") == "success":
                        room_code, is_host, game_state = res["code"], True, "LOBBY"
                        my_id = res["player_id"]
                except Exception as e: print("Network Host Error:", e)
            
            if can_proceed and len(room_code) == 4 and btn_join.collidepoint(mouse_pos):
                try:
                    net = Network()
                    res = net.send({"action": "JOIN", "code": room_code, "name": player_name})
                    if res and res.get("status") == "success":
                        is_host, game_state = False, "LOBBY"
                        my_id = res["player_id"]
                except Exception as e: print("Network Join Error:", e)

    # --- LOBBY STATE ---
    elif game_state == "LOBBY":
        SCREEN.fill((15, 10, 25))
        f_large = pygame.font.SysFont("Arial", 40, bold=True)
        f_name = pygame.font.SysFont("Arial", 24)
        
        SCREEN.blit(f_large.render(f"ROOM CODE: {room_code}", True, GOLD), (WIDTH//2 - 150, 50))
        
        if net:
            res = net.send({"action": "GET_LOBBY"})
            if res and res.get("status") == "success":
                connected_players = res.get("players", [])
                if not is_host and res.get("game_started"): load_level(1)

        SCREEN.blit(f_large.render(f"PLAYERS ({len(connected_players)}/4):", True, WHITE), (WIDTH//2 - 150, 130))
        
        for i, p_data in enumerate(connected_players):
            p_name = p_data.get("name", "Unknown") if isinstance(p_data, dict) else p_data
            p_color = tuple(p_data.get("color", TEAL)) if isinstance(p_data, dict) else TEAL
            pygame.draw.circle(SCREEN, p_color, (WIDTH//2 - 130, 200 + i*40), 10)
            SCREEN.blit(f_name.render(p_name, True, WHITE), (WIDTH//2 - 110, 185 + i*40))

        if is_host and len(connected_players) > 0:
            btn_start = pygame.Rect(WIDTH//2 - 100, 500, 200, 60)
            pygame.draw.rect(SCREEN, TEAL if btn_start.collidepoint(mouse_pos) else (20, 80, 50), btn_start, border_radius=10)
            SCREEN.blit(f_large.render("START", True, WHITE), (btn_start.centerx - 55, btn_start.centery - 25))
            if mouse_clicked and btn_start.collidepoint(mouse_pos):
                if net: net.send({"action": "START_GAME"})
                load_level(1)

    elif game_state == "PLAYING":
        game_timer -= dt
        frame += 1
        if game_timer <= 0: game_state = "LEVEL_COMPLETE"
        
        if red_flash > 0: red_flash -= dt
        v_timers = []
        for t in vessel_respawn_timers:
            if t - dt <= 0:
                for s in stations: 
                    if s.name == "Vessel Return": s.vessel_count += 1
            else: v_timers.append(t - dt)
        vessel_respawn_timers = v_timers

        spawn_tick += dt
        if spawn_tick > 15 and len(orders) < 5: add_order(); spawn_tick = 0

        keys = pygame.key.get_pressed()
        is_filtering = False
        for s in stations:
            if player and player.rect.inflate(5, 5).colliderect(s.rect):
                s.is_highlighted = True
                if s.name == "Logic Filter" and keys[pygame.K_SPACE] and player.held_item and not getattr(player.held_item, 'is_vessel', False) and not player.held_item.is_processed:
                    is_filtering, s.progress = True, s.progress + 0.015
                    if s.progress >= 1.0: player.held_item.is_processed, s.progress = True, 0
            else: s.is_highlighted = False
            
            if s.name == "Dream Visualizer" and s.is_cooking:
                s.progress += 0.006
                if s.progress >= 1.0:
                    res, res_c = "Abstract Mush", (150, 0, 0)
                    if len(s.held_item.bundle) == 2:
                        for r_n, r_c in RECIPES.items():
                            if sorted(s.held_item.bundle) == sorted(r_c): res, res_c = r_n, WHITE
                    s.held_item, s.is_cooking, s.progress = Item(res, res_c), False, 0

        dx, dy = (keys[pygame.K_RIGHT]-keys[pygame.K_LEFT]), (keys[pygame.K_DOWN]-keys[pygame.K_UP])
        if not is_filtering and player: player.move(dx, dy, stations, keys)

        # Network Sync Fallback
        if net and player:
            try:
                sync_res = net.send({"action": "SYNC", "x": player.rect.x, "y": player.rect.y})
                if sync_res and sync_res.get("status") == "success":
                    for server_p in sync_res.get("players", []):
                        p_id = server_p["id"]
                        if p_id != my_id and p_id in players_dict:
                            players_dict[p_id].rect.x = server_p["x"]
                            players_dict[p_id].rect.y = server_p["y"]
            except Exception: pass

        # --- Draw Playing ---
        SCREEN.fill(BLACK)
        for s in stations: s.draw(SCREEN, frame)
        for p in players_dict.values(): 
            p.draw(SCREEN) 
        
        pygame.draw.rect(SCREEN, (30, 30, 50), (0, 0, WIDTH, 95))
        for i, o in enumerate(orders[:]): 
            o['time'] -= dt
            tx = 10 + (i * 175)
            
            pygame.draw.rect(SCREEN, (50, 50, 80), (tx, 10, 165, 75), border_radius=8)
            f_ui = pygame.font.SysFont("Arial", 14, bold=True)
            SCREEN.blit(f_ui.render(o['name'], True, WHITE), (tx+8, 15))
            for j, c in enumerate(o['recipe']): 
                pygame.draw.circle(SCREEN, c, (tx+18+(j*25), 42), 8)
            
            pct = max(0, o['time']/o['max'])
            pygame.draw.rect(SCREEN, (255, 80, 80) if pct < 0.25 else TEAL, (tx+8, 62, 150*pct, 6), border_radius=3)
            
            if o['time'] <= 0:
                score = max(0, score - MISSED_ORDER_PENALTY) 
                red_flash = 0.3 
                orders.remove(o)

        if red_flash > 0:
            flash = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
            flash.fill((255, 0, 0, int((red_flash/0.2)*150))); SCREEN.blit(flash, (0, 0))

        f_hud = pygame.font.SysFont("Arial", 28, bold=True)
        SCREEN.blit(f_hud.render(f"SCORE: {score}", True, GOLD), (WIDTH-200, HEIGHT-45))
        SCREEN.blit(f_hud.render(f"TIME: {int(max(0, game_timer))}s", True, WHITE), (40, HEIGHT-45))

    elif game_state == "LEVEL_COMPLETE":
        SCREEN.fill((10, 5, 20))
        stars = sum(1 for t in LEVEL_STAR_THRESHOLDS if score >= t)
        
        f_big = pygame.font.SysFont("Arial", 60, bold=True)
        f_med = pygame.font.SysFont("Arial", 32, bold=True)
        
        msg = f"LEVEL {current_level} COMPLETE" if stars >= 1 else f"LEVEL {current_level} FAILED"
        txt_msg = f_big.render(msg, True, TEAL if stars >= 1 else (255, 50, 50))
        SCREEN.blit(txt_msg, (WIDTH//2 - txt_msg.get_width()//2, 150))
        
        for i in range(3):
            col = GOLD if stars > i else (50, 50, 50)
            pygame.draw.polygon(SCREEN, col, [(WIDTH//2 - 110 + i*100 + 40*math.cos(a), 300 + 40*math.sin(a)) for a in [j*144*math.pi/180 for j in range(5)]])

        txt_score = f_med.render(f"Final Score: {score}", True, WHITE)
        SCREEN.blit(txt_score, (WIDTH//2 - txt_score.get_width()//2, 380))

        btn_rect = pygame.Rect(WIDTH//2 - 100, 480, 200, 60)
        can_progress = stars >= 1 and current_level < 2
        btn_label = "NEXT LEVEL" if can_progress else ("RESTART" if stars < 1 else "GAME CLEAR!")
        
        if btn_label != "GAME CLEAR!":
            pygame.draw.rect(SCREEN, SKY_BLUE if btn_rect.collidepoint(mouse_pos) else (40, 40, 80), btn_rect, border_radius=10)
            txt_btn = f_med.render(btn_label, True, WHITE)
            SCREEN.blit(txt_btn, (btn_rect.centerx - txt_btn.get_width()//2, btn_rect.centery - txt_btn.get_height()//2))

            if mouse_clicked and btn_rect.collidepoint(mouse_pos):
                load_level(2) if can_progress else load_level(current_level)

    pygame.display.flip()