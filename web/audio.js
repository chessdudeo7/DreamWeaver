// ========== AUDIO ==========
// Music-only. Everything is synthesised at runtime with the Web Audio API
// (oscillators + envelopes) — nothing sampled, so zero copyright exposure and
// no assets to ship. Two generative loops: a mellow one for menus and a
// faster, more driving one for levels. No per-action sound effects.

class GameAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.musicGain = null;
        this.muted = (localStorage.getItem('dw_muted') === '1');

        this._seqTimer = null;
        this._mode = null;      // 'menu' | 'level' | null
        this._step = 0;
        this._chordIdx = 0;

        // A → F → C → G loop. Each chord: a bass root + tones for the arpeggio.
        this._progression = [
            { bass: 110.00, tones: [220.00, 261.63, 329.63, 440.00] }, // Am
            { bass:  87.31, tones: [174.61, 220.00, 261.63, 349.23] }, // F
            { bass: 130.81, tones: [261.63, 329.63, 392.00, 523.25] }, // C
            { bass:  98.00, tones: [196.00, 246.94, 293.66, 392.00] }, // G
        ];

        // Start music on the first user gesture (browser autoplay policy).
        const unlock = () => { this.resume(); if (!this._mode) this.startMenuMusic(); };
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
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.45;
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

    // One synth note into the music bus
    _voice(freq, dur, type, gain, when) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(gain, when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g); g.connect(this.musicGain);
        osc.start(when);
        osc.stop(when + dur + 0.03);
    }

    startMenuMusic()  { this._start('menu'); }
    startLevelMusic() { this._start('level'); }

    _start(mode) {
        this._ensure();
        if (!this.ctx || this._mode === mode) return;
        this.stopMusic();
        this._mode = mode;
        this._step = 0;
        this._chordIdx = 0;
        this.resume();
        const bpm = (mode === 'level') ? 116 : 90;   // levels feel driving; menu stays mellow
        const sixteenth = 60 / bpm / 4;
        this._seqTimer = setInterval(() => this._tick(mode), sixteenth * 1000);
    }

    stopMusic() {
        if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; }
        this._mode = null;
    }

    _tick(mode) {
        if (this.muted || !this.ctx) return;
        const t = this.ctx.currentTime + 0.02;
        const chord = this._progression[this._chordIdx % this._progression.length];
        const s = this._step % 16;

        if (mode === 'level') {
            // Driving: bass on every quarter, arp on every eighth, sparkles on the offbeat
            if (s % 4 === 0) this._voice(chord.bass, 0.20, 'sine', 0.11, t);
            if (s % 2 === 0) {
                const tone = chord.tones[(s / 2) % chord.tones.length];
                this._voice(tone, 0.13, 'triangle', 0.055, t);
            }
            if (s === 6 || s === 14) this._voice(chord.tones[3] * 2, 0.16, 'square', 0.022, t);
        } else {
            // Menu: soft pad + gentle sparse arp
            if (s === 0 || s === 8) this._voice(chord.bass, 0.7, 'sine', 0.08, t);
            if (s % 4 === 0) {
                const tone = chord.tones[(s / 4) % chord.tones.length];
                this._voice(tone, 0.6, 'sine', 0.045, t);
            }
            if (s === 10 && Math.random() < 0.5) this._voice(chord.tones[2] * 2, 0.6, 'triangle', 0.025, t);
        }

        this._step++;
        if (this._step % 16 === 0) this._chordIdx++;   // change chord each bar
    }
}

window.gameAudio = new GameAudio();
