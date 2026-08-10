/**
 * Prozedurales Audio über die Web Audio API — keine Sounddateien.
 *
 * Der wichtigste Belohnungsreiz ist die Tonleiter: jeder aufeinanderfolgende
 * Treffer steigt eine Stufe in der pentatonischen Leiter (C D E G A). Nach
 * 1,5 Sekunden Pause fällt sie auf den Grundton zurück. Eine Gruppe von fünf
 * Steinen klingt dadurch wie ein aufsteigendes Arpeggio, eine lange Kette wie
 * ein Lauf über mehrere Oktaven.
 *
 * Der Kontext entsteht erst bei der ersten Berührung (Autoplay-Regeln der
 * Browser). Vorher sind alle Methoden stille No-Ops.
 */
import {
  PENTATONIC, LADDER_BASE_HZ, LADDER_MAX_STEP, LADDER_RESET_MS,
  MUSIC_BPM, POP_STAGGER_S,
} from '../game/config.js';

const STORAGE_KEY = 'drachenfunke.stumm';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuffer = null;

    this.ladder = 0;
    this.lastPopAt = -Infinity;

    this.biome = null;
    this.comboLayer = false;
    this._timer = null;
    this._nextStepAt = 0;
    this._step = 0;

    this.muted = readMuted();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Beim ersten Zeigerkontakt aufrufen. Mehrfachaufrufe sind harmlos. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.0001;
    this.musicBus.connect(this.master);

    // Weißes Rauschen einmal erzeugen und für alle Impulse wiederverwenden.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    if (ctx.state === 'suspended') ctx.resume();
    this._startMusic();
  }

  setMuted(muted) {
    this.muted = muted;
    writeMuted(muted);
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0.0001 : 0.9, t, 0.05);
    }
  }

  toggleMuted() { this.setMuted(!this.muted); return this.muted; }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // --- Bausteine ------------------------------------------------------------

  _osc(type, freq, at, dur, peak, { detune = 0, to = null, curve = 'exp' } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (detune) o.detune.setValueAtTime(detune, at);
    if (to && to !== freq) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
      else o.frequency.linearRampToValueAtTime(to, at + dur);
    }
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.02);
    return g;
  }

  _noise(at, dur, peak, { type = 'bandpass', freq = 1200, q = 1, to = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, at);
    flt.Q.value = q;
    if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt).connect(g);
    src.start(at);
    src.stop(at + dur + 0.02);
    return g;
  }

  // --- Effekte --------------------------------------------------------------

  /** Frequenz der n-ten Stufe der pentatonischen Leiter. */
  ladderHz(step) {
    const s = Math.min(step, LADDER_MAX_STEP);
    const oct = Math.floor(s / PENTATONIC.length);
    const semi = PENTATONIC[s % PENTATONIC.length] + 12 * oct;
    return LADDER_BASE_HZ * Math.pow(2, semi / 12);
  }

  /**
   * Ein geplatzter Stein. `index` staffelt die Blips innerhalb einer Gruppe,
   * damit fünf Steine als Arpeggio und nicht als Cluster klingen.
   */
  pop(index = 0) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastPopAt > LADDER_RESET_MS) this.ladder = 0;
    this.lastPopAt = now;

    const step = this.ladder++;
    const hz = this.ladderHz(step);
    const at = this.ctx.currentTime + index * POP_STAGGER_S;

    this._osc('triangle', hz, at, 0.17, 0.24).connect(this.sfxBus);
    this._osc('sine', hz * 2, at, 0.1, 0.09).connect(this.sfxBus);
    this._noise(at, 0.05, 0.05, { freq: hz * 3, q: 6 }).connect(this.sfxBus);
  }

  /** Absturz: abfallendes Glissando plus Rauschimpuls. */
  drop(count) {
    if (!this.ready || count <= 0) return;
    const at = this.ctx.currentTime + 0.02;
    const dur = Math.min(0.35 + count * 0.045, 1.1);
    const from = this.ladderHz(Math.min(this.ladder, LADDER_MAX_STEP));

    this._osc('triangle', from, at, dur, 0.2, { to: from / 6, curve: 'exp' }).connect(this.sfxBus);
    this._osc('sine', from / 2, at, dur * 0.9, 0.14, { to: from / 10 }).connect(this.sfxBus);
    this._noise(at, dur * 0.7, 0.16, { freq: 2600, to: 220, q: 0.8 }).connect(this.sfxBus);

    // Aufschlag im Hort
    const thud = at + dur * 0.62;
    this._osc('sine', 96, thud, 0.28, 0.26, { to: 42 }).connect(this.sfxBus);
  }

  /** Schuss: kurzer Luftstoß. */
  shoot() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    this._noise(at, 0.09, 0.07, { freq: 900, to: 2400, q: 0.7 }).connect(this.sfxBus);
    this._osc('sine', 300, at, 0.07, 0.07, { to: 520 }).connect(this.sfxBus);
  }

  /** Nachschubreihe: Rumpeln. */
  rumble() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    this._osc('sine', 70, at, 0.34, 0.3, { to: 38 }).connect(this.sfxBus);
    this._noise(at, 0.3, 0.14, { type: 'lowpass', freq: 420, to: 120 }).connect(this.sfxBus);
  }

  /** Anhaften ohne Treffer: trockenes Klacken. */
  stick() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    this._osc('sine', 220, at, 0.06, 0.09, { to: 150 }).connect(this.sfxBus);
    this._noise(at, 0.035, 0.05, { freq: 2200, q: 3 }).connect(this.sfxBus);
  }

  /** Fail-Linie überschritten. */
  fail() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    this._osc('sawtooth', 190, at, 0.5, 0.16, { to: 48 }).connect(this.sfxBus);
    this._noise(at, 0.4, 0.12, { type: 'lowpass', freq: 700, to: 90 }).connect(this.sfxBus);
  }

  /** Level geräumt. */
  win() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      this._osc('triangle', this.ladderHz(i + 5), at + i * 0.075, 0.32, 0.2).connect(this.sfxBus);
    }
  }

  // --- Musik ----------------------------------------------------------------

  setBiome(biome) {
    this.biome = biome;
    this._step = 0;
  }

  /** Ab Kombo 3 kommt eine zusätzliche Instrumentenspur dazu. */
  setComboLayer(on) { this.comboLayer = !!on; }

  _startMusic() {
    if (this._timer) return;
    this._nextStepAt = this.ctx.currentTime + 0.1;
    this.musicBus.gain.setTargetAtTime(0.17, this.ctx.currentTime, 1.2);
    // Lookahead-Scheduler: Web-Audio-Zeit ist genau, setInterval ist es nicht.
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
  }

  get stepDuration() { return 60 / MUSIC_BPM / 2; }   // Achtel

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + 0.15;
    let guard = 0;
    while (this._nextStepAt < horizon && guard++ < 64) {
      this._playStep(this._step, this._nextStepAt);
      this._nextStepAt += this.stepDuration;
      this._step = (this._step + 1) % 16;
    }
  }

  _playStep(step, at) {
    const b = this.biome;
    if (!b) return;
    const root = b.root;
    const wave = b.wave || 'triangle';
    const bus = this.musicBus;

    // Bass auf der Eins und auf der Fünf des Taktes
    if (step === 0 || step === 8) {
      const f = step === 0 ? root : root * Math.pow(2, 3 / 12);   // Grundton, kleine Terz
      this._osc('sine', f, at, 1.15, 0.36).connect(bus);
    }

    // Flächenklang: zwei leicht verstimmte Stimmen, alle zwei Takte
    if (step === 0) {
      this._osc(wave, root * 2, at, 2.4, 0.09, { detune: -6 }).connect(bus);
      this._osc(wave, root * 3, at, 2.4, 0.06, { detune: 7 }).connect(bus);
    }

    // Tropfen: sparsame Einzeltöne, geben der Höhle ihren Puls
    const drops = [2, 6, 11, 14];
    if (drops.includes(step)) {
      const idx = (step * 3) % PENTATONIC.length;
      const semi = PENTATONIC[idx] + 24;
      this._osc('sine', root * Math.pow(2, semi / 12), at, 0.5, 0.1).connect(bus);
    }

    // Zusatzspur ab Kombo 3: durchlaufende Achtel über die Pentatonik
    if (this.comboLayer && step % 2 === 0) {
      const idx = (step / 2) % PENTATONIC.length;
      const semi = PENTATONIC[idx] + 36;
      this._osc('triangle', root * Math.pow(2, semi / 12), at, 0.22, 0.085).connect(bus);
    }
  }
}

function readMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function writeMuted(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* egal */ }
}
