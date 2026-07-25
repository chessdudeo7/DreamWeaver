// ========== AUDIO ==========
// All sound is synthesised at runtime with the Web Audio API — oscillators,
// envelopes, and filtered noise. Nothing is sampled or recorded, so there is
// zero copyright exposure and no binary assets to ship. A gentle ambient pad
// plays during levels; short cues fire on pickups, deliveries, jams, etc.

class GameAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.sfxGain = null;
        this.musicGain = null;
        this.muted = (localStorage.getItem('dw_muted') === '1');
        this._musicOn = false;
        this._musicTimer = null;
        this._step = 0;

        // Resume/unlock the context on the first user gesture (autoplay policy).
        const unlock = () => { this.resume(); };
        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
    }

    _ensure() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.master);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.35;
        this.musicGain.connect(this.master);
    }

    resume() {
        this._ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        localStorage.setItem('dw_muted', this.muted ? '1' : '0');
        this._ensure();
        if (this.master) {
            const t = this.ctx.currentTime;
            this.master.gain.cancelScheduledValues(t);
            this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, t, 0.05);
        }
        return this.muted;
    }

    // ── Core synth helpers ────────────────────────────────────────────────────
    _tone({ freq = 440, to = null, type = 'sine', dur = 0.15, gain = 0.3,
            attack = 0.005, release = 0.08, delay = 0, dest = null }) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
        osc.connect(g); g.connect(dest || this.sfxGain);
        osc.start(t0);
        osc.stop(t0 + dur + release + 0.02);
    }

    _noise({ dur = 0.2, gain = 0.3, freq = 800, q = 1, type = 'bandpass', delay = 0 }) {
        if (!this.ctx || this.muted) return;
        const t0 = this.ctx.currentTime + delay;
        const frames = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
        src.start(t0); src.stop(t0 + dur);
    }

    _arp(freqs, step = 0.07, opts = {}) {
        freqs.forEach((f, i) => this._tone({ freq: f, delay: i * step, dur: 0.14,
            gain: 0.28, type: 'triangle', ...opts }));
    }

    // ── Named cues ────────────────────────────────────────────────────────────
    pickup()  { this.resume(); this._tone({ freq: 620, to: 880, type: 'sine',     dur: 0.09, gain: 0.22, release: 0.05 }); }
    place()   { this.resume(); this._tone({ freq: 340, to: 240, type: 'triangle', dur: 0.10, gain: 0.24, release: 0.06 }); }
    process() { this.resume(); this._arp([440, 660], 0.06, { type: 'sine', gain: 0.2 }); }
    success() { this.resume(); this._arp([523.25, 659.25, 783.99], 0.075); }               // C-E-G
    levelComplete() { this.resume(); this._arp([523.25, 659.25, 783.99, 1046.5], 0.12, { dur: 0.22, release: 0.18 }); }
    fail()    { this.resume(); this._tone({ freq: 220, to: 120, type: 'sawtooth', dur: 0.22, gain: 0.22, release: 0.1 }); }
    expire()  { this.resume(); this._tone({ freq: 150, to: 90,  type: 'sine',     dur: 0.28, gain: 0.25, release: 0.12 }); }
    jam()     { this.resume(); this._noise({ dur: 0.3, gain: 0.3, freq: 320, q: 0.7 });
                this._tone({ freq: 160, to: 70, type: 'sawtooth', dur: 0.3, gain: 0.18, release: 0.1 }); }
    surge()   { this.resume(); this._arp([392, 523.25, 392, 523.25], 0.11, { type: 'square', gain: 0.16, dur: 0.12 }); }

    // ── Ambient music ─────────────────────────────────────────────────────────
    // A slow, dreamy loop: a soft pad chord that shifts through a short
    // progression, with occasional twinkles on a pentatonic scale.
    startMusic() {
        this._ensure();
        if (!this.ctx || this._musicOn) return;
        this._musicOn = true;
        this._step = 0;
        // Chord roots (A minor-ish, gentle): Am, F, C, G — as frequency triads
        this._chords = [
            [220.0, 261.63, 329.63],   // Am
            [174.61, 220.0, 261.63],   // F
            [261.63, 329.63, 392.0],   // C
            [196.0, 246.94, 293.66],   // G
        ];
        this._penta = [523.25, 587.33, 659.25, 783.99, 880.0];   // C D E G A (high twinkles)
        const stepDur = 2.8;
        const tick = () => {
            if (!this._musicOn || this.muted) { return; }
            const chord = this._chords[this._step % this._chords.length];
            chord.forEach((f, i) => this._tone({
                freq: f, type: 'sine', dur: stepDur * 0.95, gain: 0.05,
                attack: 0.4, release: 0.6, dest: this.musicGain
            }));
            // sparse twinkle
            if (Math.random() < 0.7) {
                const f = this._penta[Math.floor(Math.random() * this._penta.length)];
                this._tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.04,
                    attack: 0.02, release: 0.4, delay: Math.random() * 1.5, dest: this.musicGain });
            }
            this._step++;
        };
        tick();
        this._musicTimer = setInterval(tick, stepDur * 1000);
    }

    stopMusic() {
        this._musicOn = false;
        if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    }
}

window.gameAudio = new GameAudio();
