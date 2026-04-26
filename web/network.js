class Network {
    constructor() {
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://dreamweaver-271s.onrender.com';
        this.ws = null;
        this.connected = false;
        this._pendingRequests = new Map();
        this._requestId = 0;
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.onopen = () => {
                    this.connected = true;
                    console.log('Connected to server!');
                    resolve();
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    this.connected = false;
                    console.log('Disconnected from server');
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        // Server pushed a level load — triggers loadLevel() on all clients
                        if (data.status === 'level_load') {
                            if (this.onLevelLoad) this.onLevelLoad(data.level);
                            return;
                        }

                        // Server confirmed logic_filter_cancel and is returning the orb
                        if (data.status === 'logic_filter_cancelled') {
                            if (this.onLFCancelled) this.onLFCancelled(data);
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
            } catch (error) {
                reject(error);
            }
        });
    }

    // For requests that need a response (CREATE, JOIN, GET_LOBBY, START_GAME, LOAD_LEVEL)
    send(data) {
        return new Promise((resolve) => {
            if (!this.connected) { resolve(null); return; }
            const rid = ++this._requestId;
            this._pendingRequests.set(rid, resolve);
            this.ws.send(JSON.stringify({ ...data, _rid: rid }));
            setTimeout(() => {
                if (this._pendingRequests.has(rid)) {
                    this._pendingRequests.delete(rid);
                    resolve(null);
                }
            }, 5000);
        });
    }

    // Fire-and-forget — for SYNC, DELIVER, STATION_UPDATE
    sendRaw(data) {
        if (!this.connected || !this.ws) return;
        try { this.ws.send(JSON.stringify(data)); } catch(e) {}
    }
}
