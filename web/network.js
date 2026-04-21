class Network {
    constructor() {
        // Get server URL from environment or hardcode for production
        // For local testing: ws://localhost:5555
        // For production: wss://your-render-domain.onrender.com
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://dreamweaver-271s.onrender.com';
        // this.serverUrl = isDev ? 'ws://localhost:5555' : 'wss://your-render-domain.com';
        this.ws = null;
        this.connected = false;
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

                this.ws.addEventListener('message', (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.status === 'vessel_respawn' && this.onVesselRespawn) {
                            this.onVesselRespawn();
                        }
                    } catch (e) {}
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    send(data) {
        return new Promise((resolve) => {
            if (!this.connected) {
                console.error('Not connected to server');
                resolve(null);
                return;
            }

            const messageHandler = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    // Ignore server-pushed events — they're handled by the general listener
                    if (response.status === 'vessel_respawn') return;
                    this.ws.removeEventListener('message', messageHandler);
                    resolve(response);
                } catch (error) {
                    console.error('Failed to parse response:', error);
                    resolve(null);
                }
            };

            this.ws.addEventListener('message', messageHandler);
            this.ws.send(JSON.stringify(data));
        });
    }
}
