// Procedural sound: wind rises with airspeed, a scrape rises with skid power.
// Both are filtered noise, so there are no audio files to load.
export class SkiAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { // brown-ish noise
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(0, Math.random() * 2);
      return { f, g };
    };
    this.wind = mk('lowpass', 400, 0.7);
    // white-ish noise for snow scrape: high-pass the same buffer hard
    this.scrape = mk('bandpass', 2500, 0.8);
  }

  update(speed, scrubPower, airborne) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    const w = Math.min(0.5, (speed / 35) ** 2 * 0.5) * m;
    this.wind.g.gain.setTargetAtTime(w, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + speed * 25, t, 0.1);
    const s = airborne ? 0 : Math.min(0.6, scrubPower / 25000) * m;
    this.scrape.g.gain.setTargetAtTime(s, t, 0.05);
  }
}
