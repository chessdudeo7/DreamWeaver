class Network {
    constructor() {
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://dreamweaver-271s.onrender.com';
        this.ws = null;
        this.connected = false;
        this._pendingRequests = new Map();
        this._requestId = 0;

        // Reconnection state
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 10;
        this._reconnectDelay = 1000;    // ms, doubles each attempt up to 16s
        this._reconnecting = false;
        this._intentionallyClosed = false;

        // Keepalive ping — Render drops idle WS after ~55s
        this._pingInterval = null;
        this._pingIntervalMs = 30000;   // ping every 30s

        // Callbacks set by game.js
        this.onLevelLoad      = null;
        this.onLFCancelled    = null;
        this.onRejection      = null;
        this.onBroadcast      = null;
        this.onDisconnect     = null;   // called when connection is lost
        this.onReconnect      = null;   // called when connection is restored
    }

    connect() {
        return new Promise((resolve, reject) => {
            this._intentionallyClosed = false;
            this._doConnect(resolve, reject);
        });
    }

    _doConnect(resolveInitial, rejectInitial) {
        try {
            this.ws = new WebSocket(this.serverUrl);
        } catch (e) {
            if (rejectInitial) rejectInitial(e);
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this._reconnectAttempts = 0;
            this._reconnectDelay = 1000;
            this._reconnecting = false;
            this._startPing();
            console.log('Connected to server!');
            if (resolveInitial) { resolveInitial(); resolveInitial = null; rejectInitial = null; }
            if (this.onReconnect) this.onReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            // onerror is always followed by onclose — let onclose drive reconnection
            if (rejectInitial) { rejectInitial(error); resolveInitial = null; rejectInitial = null; }
        };

        this.ws.onclose = (evt) => {
            this.connected = false;
            this._stopPing();
            this._flushPending();   // Bug 9 fix: reject all pending awaits immediately
            console.log(`Disconnected from server (code ${evt.code})`);
            if (this.onDisconnect) this.onDisconnect();

            if (!this._intentionallyClosed) {
                this._scheduleReconnect();
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Pong reply from our keepalive ping — ignore
                if (data.status === 'pong') return;

                // Server pushed a level load — triggers loadLevel() on all clients
                if (data.status === 'level_load') {
                    if (this.onLevelLoad) this.onLevelLoad(data.level);
                    return;
                }

                // Server confirmed logic_filter_cancel and is returning the orb
                if (data.status === 'logic_filter_cancelled') {
                    if (this.onLFCancelled) this.onLFCancelled(data);
                    // Also resolve the pending request if there is one
                    if (data._rid !== undefined && this._pendingRequests.has(data._rid)) {
                        this._pendingRequests.get(data._rid)(data);
                        this._pendingRequests.delete(data._rid);
                    }
                    return;
                }

                // Server rejected a station action (machine busy)
                if (data.status === 'rejected') {
                    if (this.onRejection) this.onRejection(data);
                    if (data._rid !== undefined && this._pendingRequests.has(data._rid)) {
                        this._pendingRequests.get(data._rid)(data);
                        this._pendingRequests.delete(data._rid);
                    }
                    return;
                }

                // Broadcast game state (no _rid — sent to all clients in room)
                if (!data.hasOwnProperty('_rid')) {
                    if (this.onBroadcast) this.onBroadcast(data);
                    return;
                }

                // Response to a specific awaited request
                const rid = data._rid;
                if (this._pendingRequests.has(rid)) {
                    this._pendingRequests.get(rid)(data);
                    this._pendingRequests.delete(rid);
                }
            } catch (e) {
                console.error('Message parse error:', e);
            }
        };
    }

    _scheduleReconnect() {
        if (this._reconnecting) return;
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            console.error('Max reconnect attempts reached.');
            return;
        }
        this._reconnecting = true;
        this._reconnectAttempts++;
        const delay = Math.min(this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1), 16000);
        console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})…`);
        setTimeout(() => {
            this._reconnecting = false;
            this._doConnect(null, null);
        }, delay);
    }

    // resolve all pending requests with null so awaiting callers unblock
    _flushPending() {
        for (const [rid, resolve] of this._pendingRequests) {
            resolve(null);
        }
        this._pendingRequests.clear();
    }

    // keepalive ping so Render doesn't drop the idle connection
    _startPing() {
        this._stopPing();
        this._pingInterval = setInterval(() => {
            if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                try { this.ws.send(JSON.stringify({ action: 'PING' })); } catch(e) {}
            }
        }, this._pingIntervalMs);
    }

    _stopPing() {
        if (this._pingInterval !== null) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    disconnect() {
        this._intentionallyClosed = true;
        this._stopPing();
        this._flushPending();
        if (this.ws) this.ws.close();
    }

    // For requests that need a response (CREATE, JOIN, GET_LOBBY, START_GAME, LOAD_LEVEL)
    send(data) {
        return new Promise((resolve) => {
            if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                resolve(null);
                return;
            }
            const rid = ++this._requestId;
            this._pendingRequests.set(rid, resolve);
            try {
                this.ws.send(JSON.stringify({ ...data, _rid: rid }));
            } catch(e) {
                // if send throws (socket closing), unblock the caller immediately
                this._pendingRequests.delete(rid);
                resolve(null);
                return;
            }
            // Timeout safety net — 8s (was 5s; level loads can be slightly slow)
            setTimeout(() => {
                if (this._pendingRequests.has(rid)) {
                    this._pendingRequests.delete(rid);
                    resolve(null);
                }
            }, 8000);
        });
    }

    // Fire-and-forget — for SYNC, DELIVER, STATION_UPDATE
    sendRaw(data) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try { this.ws.send(JSON.stringify(data)); } catch(e) {}
    }
}
