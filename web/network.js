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

                        if (data.status === 'level_load') {
                            if (this.onLevelLoad) this.onLevelLoad(data.level);
                            return;
                        }

                        // Rejection from a station update attempt
                        if (data.status === 'rejected') {
                            if (this._rid && this._pendingRequests.has(data._rid)) {
                                this._pendingRequests.get(data._rid)(data);
                                this._pendingRequests.delete(data._rid);
                            }
                            if (this.onRejection) this.onRejection(data);
                            return;
                        }

                        // Broadcast game state (no _rid)
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

    sendRaw(data) {
        if (!this.connected || !this.ws) return;
        try { this.ws.send(JSON.stringify(data)); } catch(e) {}
    }
}
