/**
 * Prozedurales Audio über die Web Audio API — keine Sounddateien.
 *
 * Der wichtigste Belohnungsreiz ist die Tonleiter: jeder aufeinanderfolgende
 * Treffer steigt eine Stufe in der pentatonischen Leiter (C D E G A). Nach
 * 1,5 Sekunden Pause fällt sie auf den Grundton zurück. Eine Gruppe von fünf
 * Steinen klingt dadurch wie ein aufsteigendes Arpeggio, eine lange Kette wie
 * ein Lauf über mehrere Oktaven.
 *
 * Signalweg (alles einmal beim unlock() aufgebaut, danach nur noch Stimmen):
 *
 *   Musikstimmen --> panL/panR/musicBus -> musicLP -> musicDuck ---------.
 *          `-------> msends[0..2] -> musicFxLvl -> musicFxDuck --.        |
 *   Effektstimmen -> sfxBus -----------------------------------. |        |
 *          `-------> sends[0..2] --------------------------.   | |        |
 *                                                          v   v v        v
 *                                              fxIn -> Hall + Echo -> master -> limiter -> out
 *
 * Der gemeinsame Raum (ConvolverNode mit prozedural erzeugter Impulsantwort
 * plus eine Feedback-Verzögerung) trägt Musik und Effekte, damit beides im
 * selben Höhlenraum steht. `musicDuck` senkt die Musik kurz ab, sobald ein
 * Effekt spielt — Trefferblips stehen dadurch immer klar obenauf.
 *
 * Wichtig dabei: die Hallabzweige der Musik (`msends`) laufen über eigene
 * Pegel- und Absenkknoten, die den trockenen Weg spiegeln. Hingen sie direkt
 * am Hall, liefe der halbe Musikpegel am Regler und am Ducking vorbei.
 *
 * Der Kontext entsteht erst bei der ersten Berührung (Autoplay-Regeln der
 * Browser). Vorher sind alle Methoden stille No-Ops.
 */
import {
  PENTATONIC, LADDER_BASE_HZ, LADDER_MAX_STEP, LADDER_RESET_MS,
  MUSIC_BPM, POP_STAGGER_S,
} from '../game/config.js';

const STORAGE_KEY = 'drachenfunke.stumm';

// --- Pegel und Zeiten (linear, 1,0 = Vollausschlag) --------------------------
const EPS = 0.0001;            // exponentialRamp verträgt keine echte Null
const MASTER_LEVEL = 0.9;
const SFX_LEVEL = 0.85;
const SFX_SEND = 0.20;         // Effekte in den gemeinsamen Raum
const SFX_LEAD = 0.004;        // Vorlauf, damit Hüllkurven nie im Block starten
const POP_LEVEL = 0.30;        // Trefferblip — der lauteste wiederkehrende Klang
const POP_TAPER = 0.028;       // späte Blips einer langen Kette etwas zurück
const SCHED_LOOKAHEAD = 0.18;  // Vorausplanung des Musikschedulers
const SCHED_TICK_MS = 25;
const STEPS_PER_BAR = 16;      // Sechzehntelraster
const DUCK_POP = 0.66;         // Musikabsenkung während eines Treffers
const DUCK_HEAVY = 0.42;       // ... während Absturz, Rumpeln, Scheitern

// --- Raum --------------------------------------------------------------------
const IR_SECONDS = 2.4;
const IR_DECAY = 2.6;
const IR_TILT = 0.36;          // Einpol-Tiefpass in der Fahne: kleiner = dunkler

// --- Wellenformen ------------------------------------------------------------
// Spektral definiert und als PeriodicWave zwischengespeichert: ein Oszillator
// klingt damit so reich wie sonst vier, ohne vier Knoten zu kosten.
const WAVES = {
  glocke: [0, 1, 0.45, 0.20, 0.30, 0.06, 0.15, 0.03, 0.09],
  glas:   [0, 1, 0.16, 0.52, 0.09, 0.28, 0.05, 0.14, 0.04],
  orgel:  [0, 1, 0.34, 0.11, 0.17, 0.03, 0.07],
  metall: [0, 1, 0.72, 0.55, 0.63, 0.34, 0.41, 0.22, 0.29],
  holz:   [0, 1, 0.30, 0.55, 0.14, 0.09, 0.05],
  weich:  [0, 1, 0.13, 0.04, 0.02],
  schilf: [0, 1, 0.55, 0.30, 0.22, 0.12, 0.09, 0.05],
};

/**
 * Ein Stück je Biom. `bars` Takte bilden die Form, `cycles` Durchläufe die
 * Großform — erst danach wiederholt sich alles exakt. Muster sind Takte im
 * Sechzehntelraster; Ziffern sind Stufen der Tonleiter, '.' ist Pause.
 */
const PIECES = {
  // Klar und hallig: weite Glockentropfen über einem ruhigen Pendelbass.
  kristallhoehle: {
    bpm: 88, root: 110.00, scale: [0, 3, 5, 7, 10], bars: 8, cycles: 3,
    prog: [0, 0, -4, -4, 3, 3, -2, -2],          // Am – F – C – G
    level: 0.34, lowpass: 5400,
    room: { send: 0.44, tone: 5200, high: 200, predelay: 0.030, beats: 0.75, fb: 0.34, echo: 0.20 },
    bass: { wave: 'sine', gain: 0.30, dur: 1.05, oct: 0, attack: 0.014,
            pats: ['x......o...x....', 'x.......x..o....', 'x......o...x..o.', 'x...........x...'] },
    pad: { wave: 'orgel', gain: 0.050, every: 2, dur: 4.6, oct: 1, voices: [0, 7, 12],
           detune: 6, attack: 0.9, quiet: 2 },
    motif: { wave: 'glocke', gain: 0.105, dur: 1.4, oct: 2, attack: 0.003, partial: 2.76,
             click: 0.25, send: 3, orn: 0.06, shift: true,
             pats: ['..2...4...1.....', '....3.....2...0.', '..2...4...5...4.', '......1...2.....'] },
    perc: { gain: 0.030, tick: 5400, pats: ['....t.......t...', '....t.....t.t...'] },
    combo: { wave: 'triangle', gain: 0.190, dur: 0.34, oct: 2, attack: 0.004, send: 2, click: 0.2,
             pats: ['0.2.4.5.4.2.0.2.', '4.2.0.2.4.5.4.2.', '0.2.4.5.7.5.4.2.'] },
  },

  // Weich und schwebend: lange Flächen, Holzplöckchen, kein Schlagwerk.
  pilzwald: {
    bpm: 72, root: 98.00, scale: [0, 2, 4, 7, 9], bars: 8, cycles: 3,
    prog: [0, 0, 5, 5, -3, -3, -5, -5],          // G – C – Em – D
    level: 0.30, lowpass: 3400,
    room: { send: 0.40, tone: 3200, high: 160, predelay: 0.042, beats: 1.0, fb: 0.30, echo: 0.16 },
    bass: { wave: 'weich', gain: 0.30, dur: 2.1, oct: 0, attack: 0.10,
            pats: ['x...............', 'x.......o.......', 'x...............', 'x.....o.........'] },
    pad: { wave: 'weich', gain: 0.075, every: 4, dur: 8.0, oct: 1, voices: [0, 7, 12, 19],
           detune: 9, attack: 1.7, quiet: -1 },
    motif: { wave: 'holz', gain: 0.085, dur: 0.7, oct: 2, attack: 0.005, click: 0.3, send: 3,
             orn: 0.05, shift: true,
             pats: ['....1.......3...', '..0...2.....1...', '......4...3.....', '....2...1.......'] },
    perc: { gain: 0.022, tick: 2600, pats: ['................', '..........t.....'] },
    combo: { wave: 'schilf', gain: 0.165, dur: 0.9, oct: 2, attack: 0.06, send: 3,
             pats: ['..4.....2.......', '....5.....4...2.', '..2...4.....5...'] },
  },

  // Rhythmisch und schwer: laufender Bass, Amboss auf zwei und vier.
  lavaschmiede: {
    bpm: 104, root: 82.41, scale: [0, 3, 5, 7, 10], bars: 8, cycles: 4,
    prog: [0, 0, 0, 0, 3, 3, -2, -2],            // Em – G – D
    level: 0.52, lowpass: 4200,
    room: { send: 0.24, tone: 1800, high: 240, predelay: 0.014, beats: 0.5, fb: 0.22, echo: 0.10 },
    bass: { wave: 'schilf', gain: 0.30, dur: 0.32, oct: 0, attack: 0.006,
            pats: ['x..x..x.x..x..x.', 'x..x..x.x..xx.x.', 'x..x.x..x..x..x.', 'x.x.x..xx..x.xx.'] },
    pad: { wave: 'orgel', gain: 0.055, every: 2, dur: 3.2, oct: 1, voices: [0, 7, 12],
           detune: 11, attack: 0.35, quiet: 3 },
    motif: { wave: 'metall', gain: 0.070, dur: 0.5, oct: 2, attack: 0.004, click: 0.2, send: 1,
             orn: 0.04,
             pats: ['0.......3...2...', '0...0...3.......', '0.......5...3...', '0...2...3.4.....'] },
    perc: { gain: 0.055, tick: 4200, anvil: 430,
            pats: ['k...a...k...a...', 'k...a..kk...a.a.', 'k..ka...k...a...', 'k...a...k..ka.a.'] },
    combo: { wave: 'metall', gain: 0.170, dur: 0.26, oct: 3, attack: 0.003, send: 1,
             pats: ['0.0.3.0.2.0.3.5.', '0.3.0.2.0.5.3.2.', '0.0.5.0.3.0.2.0.'] },
  },

  // Hoch und gläsern: dünner Bass, Schimmerfläche, sparsame Glasglocken.
  eisdom: {
    bpm: 84, root: 130.81, scale: [0, 2, 4, 7, 11], bars: 8, cycles: 3,
    prog: [0, 0, -3, -3, -5, -5, 2, 2],          // C – Am – G – Dm
    level: 0.46, lowpass: 8000,
    room: { send: 0.52, tone: 7000, high: 320, predelay: 0.024, beats: 0.75, fb: 0.38, echo: 0.22 },
    bass: { wave: 'sine', gain: 0.24, dur: 1.6, oct: -1, attack: 0.03,
            pats: ['x...............', '................', 'x.......o.......', '................'] },
    pad: { wave: 'glas', gain: 0.038, every: 2, dur: 4.0, oct: 1, voices: [0, 7, 12, 24],
           detune: 5, attack: 0.7, quiet: 1 },
    motif: { wave: 'glas', gain: 0.090, dur: 1.7, oct: 2, attack: 0.002, partial: 3.02,
             click: 0.3, send: 3, orn: 0.07, shift: true,
             pats: ['....2.......4...', '..3.....1.......', '....4.....2...3.', '......1.....0...'] },
    perc: { gain: 0.026, tick: 7400, pats: ['..t...t...t.t...', '..t...t.....t...'] },
    combo: { wave: 'glas', gain: 0.150, dur: 0.30, oct: 3, attack: 0.002, send: 3, click: 0.25,
             pats: ['0.2.4.2.0.2.4.2.', '4.2.0.2.4.2.0.2.', '0.4.2.4.0.4.2.4.'] },
  },

  // Luftig und weit: sehr langsam, Harfenläufe, atmende Fläche.
  wolkenzitadelle: {
    bpm: 66, root: 146.83, scale: [0, 2, 4, 7, 9], bars: 8, cycles: 3,
    prog: [0, 0, 5, 5, -3, -3, -5, -5],          // D – G – Bm – A
    level: 0.31, lowpass: 6200,
    room: { send: 0.50, tone: 6000, high: 150, predelay: 0.048, beats: 1.5, fb: 0.36, echo: 0.24 },
    bass: { wave: 'sine', gain: 0.26, dur: 2.6, oct: -1, attack: 0.06, sub: true,
            pats: ['x...............', '................', 'x.......o.......', '................'] },
    pad: { wave: 'weich', gain: 0.062, every: 2, dur: 6.4, oct: 1, voices: [0, 7, 12, 16],
           detune: 8, attack: 1.4, breath: true, quiet: 2 },
    motif: { wave: 'glocke', gain: 0.078, dur: 1.1, oct: 2, attack: 0.004, partial: 2.4,
             click: 0.2, send: 3, orn: 0.08, shift: true,
             pats: ['0.1.2.3.4.......', '....2.3.4.5.....', '0...2...4...5...', '........4.3.2.1.'] },
    perc: { gain: 0.018, tick: 6800, pats: ['................', '..........t.....'] },
    combo: { wave: 'orgel', gain: 0.160, dur: 1.6, oct: 2, attack: 0.35, send: 3,
             pats: ['4.......2.......', '5.......4.......', '2.......5.......'] },
  },
};

/** Deterministischer Hash -> [0,1). Gleiche Eingabe, gleiche Variation. */
function rnd(seed) {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Stück zum Biom. Unbekannte Biome bekommen die Kristallhöhle in ihrer Tonart. */
function pieceFor(biome) {
  if (!biome) return null;
  const p = PIECES[biome.key];
  if (p) return p;
  return { ...PIECES.kristallhoehle, root: biome.root || 110 };
}

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
    this.piece = null;
    this.comboLayer = false;
    this._timer = null;
    this._nextStepAt = 0;
    this._step = 0;
    this._cycle = 0;
    this._comboUntil = 0;
    this._waves = null;
    this.sends = [];

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
    this._waves = new Map();

    // Summe: Gain für den Stummschalter, dahinter ein Begrenzer als Netz.
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? EPS : MASTER_LEVEL;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 3;
    lim.ratio.value = 12;
    lim.attack.value = 0.0015;
    lim.release.value = 0.20;
    this.limiter = lim;
    this.master.connect(lim).connect(ctx.destination);

    // Weißes Rauschen einmal erzeugen und für alle Impulse wiederverwenden.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = rnd(i * 2654435761) * 2 - 1;
    this.noiseBuffer = buf;

    this._buildRoom();
    this._buildBuses();

    if (ctx.state === 'suspended') ctx.resume();
    this._applyRoom(0);
    this._startMusic();
  }

  /** Gemeinsamer Raum: Faltungshall plus rückgekoppelte Verzögerung. */
  _buildRoom() {
    const ctx = this.ctx;

    this.fxIn = ctx.createGain();
    this.fxIn.gain.value = 1;

    this.preDelay = ctx.createDelay(0.2);
    this.preDelay.delayTime.value = 0.03;

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    this.convolver.buffer = this._makeIR(IR_SECONDS, IR_DECAY, IR_TILT);

    this.revTone = ctx.createBiquadFilter();
    this.revTone.type = 'lowpass';
    this.revTone.frequency.value = 5000;
    this.revTone.Q.value = 0.7;

    this.revHigh = ctx.createBiquadFilter();
    this.revHigh.type = 'highpass';
    this.revHigh.frequency.value = 200;

    this.revReturn = ctx.createGain();
    this.revReturn.gain.value = 0.9;

    this.fxIn.connect(this.preDelay).connect(this.convolver)
      .connect(this.revTone).connect(this.revHigh).connect(this.revReturn)
      .connect(this.master);

    // Rückgekoppelte Verzögerung: gibt Weite, kostet drei Knoten.
    this.delay = ctx.createDelay(2.0);
    this.delay.delayTime.value = 0.5;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.3;
    this.delayLP = ctx.createBiquadFilter();
    this.delayLP.type = 'lowpass';
    this.delayLP.frequency.value = 2600;
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.18;

    this.fxIn.connect(this.delay);
    this.delay.connect(this.delayLP).connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayOut);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = -0.3;
      this.delayOut.connect(p).connect(this.master);
    } else {
      this.delayOut.connect(this.master);
    }
  }

  /** Musik- und Effektwege samt gemeinsamer Hallabzweige. */
  _buildBuses() {
    const ctx = this.ctx;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_LEVEL;
    this.sfxBus.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = SFX_SEND;
    this.sfxBus.connect(this.sfxSend).connect(this.fxIn);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = EPS;

    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 5000;
    this.musicLP.Q.value = 0.5;

    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;

    this.musicBus.connect(this.musicLP).connect(this.musicDuck).connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.4;
    this.musicDuck.connect(this.musicSend).connect(this.fxIn);

    // Nasser Musikweg. Die Hallabzweige einzelner Musikstimmen dürfen nicht
    // direkt in den Raum laufen — sonst liefen sie am Musikregler und am
    // Ducking vorbei und die Musik ließe sich nicht mehr zurücknehmen.
    // Deshalb spiegeln zwei Knoten Pegel und Absenkung des trockenen Wegs.
    this.musicFxLvl = ctx.createGain();
    this.musicFxLvl.gain.value = EPS;
    this.musicFxDuck = ctx.createGain();
    this.musicFxDuck.gain.value = 1;
    this.musicFxLvl.connect(this.musicFxDuck).connect(this.fxIn);
    this.msends = [0.20, 0.46, 0.88].map((v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.musicFxLvl);
      return g;
    });

    // Zusatzspur ab Kombo 3 mit eigenem Blendregler. Ihr Hallweg hängt hinter
    // der Blende, sonst bliebe beim Ausblenden die Fahne stehen.
    this.comboGain = ctx.createGain();
    // Falls die Spur schon vor dem unlock() eingeschaltet wurde, steht sie hier
    // gleich offen — sonst bliebe sie bis zum nächsten Wechsel stumm.
    this.comboGain.gain.value = this.comboLayer ? 1 : EPS;
    this.comboGain.connect(this.musicBus);
    this.comboSend = ctx.createGain();
    this.comboSend.gain.value = 0.5;
    this.comboGain.connect(this.comboSend).connect(this.musicFxLvl);

    // Zwei feste Panoramaplätze statt eines Panners je Stimme.
    if (ctx.createStereoPanner) {
      this.panL = ctx.createStereoPanner();
      this.panL.pan.value = -0.42;
      this.panR = ctx.createStereoPanner();
      this.panR.pan.value = 0.42;
      this.panL.connect(this.musicBus);
      this.panR.connect(this.musicBus);
    } else {
      this.panL = this.musicBus;
      this.panR = this.musicBus;
    }

    // Drei gestaffelte Hallabzweige für einzelne Effektstimmen.
    this.sends = [0.22, 0.5, 0.92].map((v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.fxIn);
      return g;
    });
  }

  /**
   * Impulsantwort: gefiltertes Rauschen unter einer Abklingkurve, dazu ein paar
   * frühe Reflexionen. Zwei entkoppelte Kanäle ergeben die Breite.
   */
  _makeIR(seconds, decay, tilt) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, decay);
        const s = (rnd(i * 40503 + c * 7919 + 13) * 2 - 1) * env;
        lp += tilt * (s - lp);
        d[i] = lp;
        sum += lp * lp;
      }
      // Frühe Reflexionen: wenige Einzelimpulse in den ersten 70 ms.
      for (let k = 0; k < 7; k++) {
        const idx = Math.floor((0.004 + rnd(k * 991 + c * 31) * 0.066) * ctx.sampleRate);
        if (idx < n) {
          const v = (rnd(k * 7717 + c * 57) * 2 - 1) * 0.5 * Math.pow(1 - idx / n, decay);
          d[idx] += v;
          sum += v * v;
        }
      }
      // Auf gleiche Energie normieren, damit der Hallweg nie übersteuert.
      const norm = 1 / Math.sqrt(Math.max(sum, 1e-9));
      for (let i = 0; i < n; i++) d[i] *= norm;
    }
    return buf;
  }

  setMuted(muted) {
    this.muted = muted;
    writeMuted(muted);
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? EPS : MASTER_LEVEL, t, 0.05);
    }
  }

  toggleMuted() { this.setMuted(!this.muted); return this.muted; }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // --- Bausteine ------------------------------------------------------------

  _periodic(name) {
    let w = this._waves.get(name);
    if (!w) {
      const imag = Float32Array.from(WAVES[name]);
      const real = new Float32Array(imag.length);
      w = this.ctx.createPeriodicWave(real, imag);
      this._waves.set(name, w);
    }
    return w;
  }

  /**
   * Eine Stimme: Oszillator mit Hüllkurve. Anstieg immer linear ab echter Null
   * (kein Knacken), Ausklang exponentiell auf EPS statt auf 0.
   */
  _osc(type, freq, at, dur, peak, { detune = 0, to = null, curve = 'exp', attack = 0.006, hold = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    if (WAVES[type]) o.setPeriodicWave(this._periodic(type));
    else o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (detune) o.detune.setValueAtTime(detune, at);
    if (to && to !== freq) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
      else o.frequency.linearRampToValueAtTime(to, at + dur);
    }
    const a = Math.min(Math.max(attack, 0.0015), dur * 0.6);
    const h = Math.min(hold, Math.max(dur - a - 0.02, 0));
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    if (h > 0) g.gain.setValueAtTime(peak, at + a + h);
    g.gain.exponentialRampToValueAtTime(EPS, at + dur);
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.02);
    return g;
  }

  _noise(at, dur, peak, { type = 'bandpass', freq = 1200, q = 1, to = null, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.loopEnd = this.noiseBuffer.duration;
    // Versetzter Einstieg: zwei Impulse kurz nacheinander klingen nie gleich.
    const off = rnd(Math.floor(at * 44100) + 17) * (this.noiseBuffer.duration - 0.3);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(freq, at);
    flt.Q.value = q;
    if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
    const g = ctx.createGain();
    const a = Math.min(Math.max(attack, 0.0012), dur * 0.5);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    g.gain.exponentialRampToValueAtTime(EPS, at + dur);
    src.connect(flt).connect(g);
    src.start(at, off);
    src.stop(at + dur + 0.02);
    return g;
  }

  /**
   * Musik kurz absenken, damit ein Effekt freie Bahn hat. Trockener und nasser
   * Musikweg werden gemeinsam geführt, nie auf 0.
   */
  _duck(depth, hold) {
    if (!this.musicDuck) return;
    const t = this.ctx.currentTime;
    for (const node of [this.musicDuck, this.musicFxDuck]) {
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(depth, t, 0.012);
      g.setTargetAtTime(1, t + Math.max(hold, 0.02), 0.14);
    }
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
   * Klang: kristalline Glocke — harter Anschlag, langer Ausklang, viel Raum.
   */
  pop(index = 0) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastPopAt > LADDER_RESET_MS) this.ladder = 0;
    this.lastPopAt = now;

    const step = this.ladder++;
    const hz = this.ladderHz(step);
    const at = this.ctx.currentTime + SFX_LEAD + index * POP_STAGGER_S;

    // Hohe Stufen wirken von sich aus lauter — Pegel leicht zurücknehmen. Und
    // eine lange Kette darf sich nicht zu einem Klumpen auftürmen.
    const lvl = POP_LEVEL / (1 + Math.min(step, LADDER_MAX_STEP) * 0.035)
      * (1 - Math.min(index, 12) * POP_TAPER);
    const dur = 0.52 - Math.min(step, LADDER_MAX_STEP) * 0.008;

    this._duck(DUCK_POP, 0.10);

    // Grundton mit glockigem Teiltonspektrum
    const g1 = this._osc('glocke', hz, at, dur, lvl, { attack: 0.0025 });
    g1.connect(this.sfxBus);
    g1.connect(this.sends[2]);
    // Inharmonischer Schimmer — davon lebt der Glockeneindruck
    const g2 = this._osc('sine', hz * 2.76, at, dur * 0.34, lvl * 0.22, { attack: 0.002 });
    g2.connect(this.sfxBus);
    g2.connect(this.sends[2]);
    // Anschlag
    this._noise(at, 0.03, lvl * 0.34, {
      freq: Math.min(hz * 3.2, 9000), q: 3, attack: 0.0015,
    }).connect(this.sfxBus);
  }

  /** Absturz: abfallendes Glissando plus Rauschimpuls und Aufschlag im Hort. */
  drop(count) {
    if (!this.ready || count <= 0) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    const dur = Math.min(0.35 + count * 0.045, 1.1);
    const from = this.ladderHz(Math.min(this.ladder, LADDER_MAX_STEP));

    this._duck(DUCK_HEAVY, dur * 0.7);

    const a = this._osc('triangle', from, at, dur, 0.24, { to: from / 6, curve: 'exp', attack: 0.008 });
    a.connect(this.sfxBus);
    a.connect(this.sends[1]);
    this._osc('sine', from / 2, at, dur * 0.9, 0.15, { to: from / 10, attack: 0.01 }).connect(this.sfxBus);
    this._noise(at, dur * 0.7, 0.15, { freq: 2600, to: 220, q: 0.8, attack: 0.02 }).connect(this.sfxBus);

    // Aufschlag im Hort
    const thud = at + dur * 0.62;
    const t1 = this._osc('sine', 96, thud, 0.30, 0.28, { to: 42, attack: 0.005 });
    t1.connect(this.sfxBus);
    t1.connect(this.sends[0]);
    this._noise(thud, 0.20, 0.09, { type: 'lowpass', freq: 800, to: 130, attack: 0.004 }).connect(this.sfxBus);
  }

  /** Schuss: kurzer Luftstoß. */
  shoot() {
    if (!this.ready) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    this._noise(at, 0.10, 0.075, { freq: 900, to: 2600, q: 0.7, attack: 0.004 }).connect(this.sfxBus);
    this._osc('sine', 300, at, 0.08, 0.07, { to: 560, attack: 0.004 }).connect(this.sfxBus);
  }

  /** Nachschubreihe: Rumpeln. */
  rumble() {
    if (!this.ready) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    this._duck(DUCK_HEAVY, 0.30);
    this._osc('sine', 70, at, 0.36, 0.32, { to: 38, attack: 0.010 }).connect(this.sfxBus);
    this._osc('triangle', 104, at, 0.24, 0.10, { to: 52, attack: 0.008 }).connect(this.sfxBus);
    const n = this._noise(at, 0.32, 0.14, { type: 'lowpass', freq: 460, to: 120, attack: 0.012 });
    n.connect(this.sfxBus);
    n.connect(this.sends[0]);
  }

  /** Anhaften ohne Treffer: trockenes Klacken. */
  stick() {
    if (!this.ready) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    this._osc('holz', 240, at, 0.08, 0.13, { to: 155, attack: 0.002 }).connect(this.sfxBus);
    this._noise(at, 0.035, 0.06, { freq: 2200, q: 3, attack: 0.0015 }).connect(this.sfxBus);
  }

  /** Fail-Linie überschritten. */
  fail() {
    if (!this.ready) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    this._duck(0.30, 0.55);
    const a = this._osc('sawtooth', 190, at, 0.55, 0.17, { to: 46, attack: 0.010 });
    a.connect(this.sfxBus);
    a.connect(this.sends[1]);
    this._osc('sawtooth', 189, at, 0.55, 0.10, { to: 47, attack: 0.012, detune: -14 }).connect(this.sfxBus);
    this._noise(at, 0.45, 0.11, { type: 'lowpass', freq: 700, to: 90, attack: 0.014 }).connect(this.sfxBus);
  }

  /** Level geräumt: aufsteigender Glockenlauf über einem Akkord. */
  win() {
    if (!this.ready) return;
    const at = this.ctx.currentTime + SFX_LEAD;
    this._duck(0.5, 0.9);
    for (let i = 0; i < 5; i++) {
      const t = at + i * 0.075;
      const g = this._osc('glocke', this.ladderHz(i + 5), t, 0.7, 0.19, { attack: 0.003 });
      g.connect(this.sfxBus);
      g.connect(this.sends[2]);
    }
    // Tragender Akkord darunter
    const base = this.ladderHz(2) / 2;
    [0, 7, 12].forEach((semi, i) => {
      const g = this._osc('orgel', base * Math.pow(2, semi / 12), at, 1.5, 0.055 - i * 0.008,
        { attack: 0.05, hold: 0.4 });
      g.connect(this.sfxBus);
      g.connect(this.sends[1]);
    });
  }

  // --- Musik ----------------------------------------------------------------

  setBiome(biome) {
    this.biome = biome;
    this.piece = pieceFor(biome);
    this._step = 0;
    this._cycle = 0;
    if (this.ctx) this._applyRoom(0.7);
  }

  /** Ab Kombo 3 kommt eine zusätzliche Instrumentenspur dazu. */
  setComboLayer(on) {
    on = !!on;
    const changed = on !== this.comboLayer;
    this.comboLayer = on;
    if (!changed || !this.ctx || !this.comboGain) return;
    const t = this.ctx.currentTime;
    const g = this.comboGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(on ? 1 : EPS, t, on ? 0.10 : 0.26);
    // Beim Ausblenden noch etwas Material planen, sonst bricht die Spur ab.
    this._comboUntil = on ? Infinity : t + 1.1;
    if (on) this._comboSparkle(t + SFX_LEAD);
  }

  /** Kurzes Glitzern als hörbare Quittung für die dritte Kombo. */
  _comboSparkle(at) {
    for (let i = 0; i < 4; i++) {
      const g = this._osc('glas', this.ladderHz(6 + i * 2), at + i * 0.045, 0.5, 0.075,
        { attack: 0.002 });
      g.connect(this.sfxBus);
      g.connect(this.sends[2]);
    }
  }

  /** Raumfarbe, Musikpegel und Echozeit an das aktuelle Stück angleichen. */
  _applyRoom(glide = 0.6) {
    const P = this.piece;
    if (!P || !this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const R = P.room;
    const ramp = (param, v) => {
      param.cancelScheduledValues(t);
      if (glide <= 0) param.setValueAtTime(v, t);
      else param.setTargetAtTime(v, t, glide / 3);
    };
    ramp(this.musicBus.gain, P.level);
    ramp(this.musicFxLvl.gain, P.level);
    ramp(this.musicLP.frequency, P.lowpass);
    ramp(this.musicSend.gain, R.send);
    ramp(this.revTone.frequency, R.tone);
    ramp(this.revHigh.frequency, R.high);
    ramp(this.preDelay.delayTime, R.predelay);
    ramp(this.delay.delayTime, 60 / P.bpm * R.beats);
    ramp(this.delayFb.gain, R.fb);
    ramp(this.delayOut.gain, R.echo);
  }

  _startMusic() {
    if (this._timer) return;
    const t = this.ctx.currentTime;
    this._nextStepAt = t + 0.12;
    // Weich einblenden statt hart einsetzen.
    if (this.piece) {
      for (const node of [this.musicBus, this.musicFxLvl]) {
        node.gain.cancelScheduledValues(t);
        node.gain.setValueAtTime(EPS, t);
        node.gain.setTargetAtTime(this.piece.level, t, 0.8);
      }
    }
    // Lookahead-Scheduler: Web-Audio-Zeit ist genau, setInterval ist es nicht.
    this._timer = setInterval(() => this._schedule(), SCHED_TICK_MS);
  }

  stopMusic() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this.musicBus || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(EPS, t, 0.2);
    this.musicFxLvl.gain.setTargetAtTime(EPS, t, 0.2);
  }

  get stepDuration() { return 60 / (this.piece ? this.piece.bpm : MUSIC_BPM) / 4; }

  get formSteps() { return (this.piece ? this.piece.bars : 8) * STEPS_PER_BAR; }

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Nach einer Pause (Tabwechsel) nicht die verpasste Zeit nachholen.
    if (this._nextStepAt < now - 0.5) this._nextStepAt = now + 0.02;
    this._scheduleUntil(now + SCHED_LOOKAHEAD, 64);
  }

  /**
   * Plant alle Schritte bis `until`. Getrennt vom Zeitgeber, damit ein
   * Prüfskript die Musik auch in einem OfflineAudioContext rendern kann.
   */
  _scheduleUntil(until, maxSteps = 4096) {
    let guard = 0;
    while (this._nextStepAt < until && guard++ < maxSteps) {
      this._playStep(this._step, this._nextStepAt);
      this._nextStepAt += this.stepDuration;
      this._step++;
      if (this._step >= this.formSteps) { this._step = 0; this._cycle++; }
    }
  }

  /** Frequenz einer Tonleiterstufe über dem aktuellen Akkord. */
  _degHz(P, chord, deg, oct) {
    const n = P.scale.length;
    const o = Math.floor(deg / n);
    const semi = P.scale[((deg % n) + n) % n] + 12 * o + chord + oct * 12;
    return P.root * Math.pow(2, semi / 12);
  }

  /** Eine Musikstimme nach Beschreibung aus der Stücktabelle. */
  _voice(spec, f, at, peak, { dest = null, dur = 0, detune = 0, bare = false } = {}) {
    const out = dest || this.musicBus;
    const d = dur || spec.dur;
    const g = this._osc(spec.wave, f, at, d, peak, { attack: spec.attack, detune });
    g.connect(out);
    const send = (spec.send && !bare) ? this.msends[spec.send - 1] : null;
    if (send) g.connect(send);
    if (spec.partial) {
      const p = this._osc('sine', f * spec.partial, at, d * 0.4, peak * 0.26, { attack: 0.002 });
      p.connect(out);
      if (send) p.connect(send);
    }
    if (spec.click) {
      this._noise(at, 0.026, peak * spec.click, {
        freq: Math.min(f * 3, 9000), q: 2.5, attack: 0.0015,
      }).connect(out);
    }
  }

  _playStep(step, at) {
    const P = this.piece;
    if (!P || !this.musicBus) return;
    const bar = (step / STEPS_PER_BAR) | 0;
    const s = step % STEPS_PER_BAR;
    const sec = this._cycle % P.cycles;      // Abschnitt der Großform
    const chord = P.prog[bar % P.prog.length];
    const last = bar === P.bars - 1;         // Schlusstakt bekommt eine Füllung

    this._bass(P, chord, bar, s, at, sec);
    this._pad(P, chord, bar, s, at, sec);
    this._motif(P, chord, bar, s, at, sec, last);
    this._perc(P, bar, s, at, sec, last);
    this._combo(P, chord, bar, s, at, sec);
  }

  _bass(P, chord, bar, s, at, sec) {
    const B = P.bass;
    if (!B) return;
    const pat = B.pats[(bar + (sec === 2 ? 1 : 0)) % B.pats.length];
    const ch = pat[s];
    if (!ch || ch === '.') return;
    const semi = chord + (ch === 'o' ? 7 : 0) + B.oct * 12;
    const f = P.root * Math.pow(2, semi / 12);
    this._osc(B.wave, f, at, B.dur, B.gain * (ch === 'o' ? 0.7 : 1), { attack: B.attack })
      .connect(this.musicBus);
    if (B.sub) {
      this._osc('sine', f / 2, at, B.dur * 0.8, B.gain * 0.45, { attack: B.attack * 1.5 })
        .connect(this.musicBus);
    }
  }

  _pad(P, chord, bar, s, at, sec) {
    const A = P.pad;
    if (!A || s !== 0 || bar % A.every !== 0) return;
    // Ein Abschnitt der Großform bleibt ohne Fläche — das lüftet die Form.
    const quiet = sec === A.quiet;
    A.voices.forEach((v, i) => {
      if (quiet && i > 0) return;
      const f = P.root * Math.pow(2, (chord + v + A.oct * 12) / 12);
      const det = (i % 2 ? A.detune : -A.detune) + (sec - 1) * 3;
      const dest = i % 2 ? this.panR : this.panL;
      const g = this._osc(A.wave, f, at, A.dur, A.gain * (i === 0 ? 1 : 0.72) * (quiet ? 0.6 : 1),
        { attack: A.attack, detune: det, hold: A.dur * 0.3 });
      g.connect(dest);
      g.connect(this.msends[1]);
    });
    if (A.breath) {
      const n = this._noise(at, A.dur * 0.7, A.gain * 0.5, {
        type: 'bandpass', freq: 700, to: 1900, q: 0.8, attack: A.dur * 0.25,
      });
      n.connect(this.musicBus);
      n.connect(this.msends[1]);
    }
  }

  _motif(P, chord, bar, s, at, sec, last) {
    const M = P.motif;
    if (!M) return;
    const pat = M.pats[(bar + sec) % M.pats.length];
    let ch = pat[s];
    let scale = 1;
    if (!ch || ch === '.') {
      // Sparsame Verzierung, deterministisch aus Durchlauf, Takt und Schritt.
      if (!M.orn) return;
      const r = rnd(this._cycle * 9176 + bar * 131 + s * 7 + 5);
      if (r > (last ? M.orn * 2.2 : M.orn)) return;
      ch = String((s * 3 + bar * 2) % 5);
      scale = 0.55;
    }
    const shift = M.shift ? [0, 2, 1][sec % 3] : 0;
    const deg = (ch.charCodeAt(0) - 48) + shift;
    const f = this._degHz(P, chord, deg, M.oct);
    const dest = (s % 8 < 4) ? this.panL : this.panR;
    this._voice(M, f, at, M.gain * scale, { dest });
  }

  _perc(P, bar, s, at, sec, last) {
    const R = P.perc;
    if (!R) return;
    const pat = R.pats[(bar + (last ? 1 : 0) + sec) % R.pats.length];
    const ch = pat[s];
    if (!ch || ch === '.') return;
    const g = R.gain;
    if (ch === 't') {
      const n = this._noise(at, 0.05, g, {
        freq: R.tick, to: R.tick * 0.65, q: 7, attack: 0.0012,
      });
      n.connect(s % 4 === 2 ? this.panR : this.panL);
      n.connect(this.msends[2]);
    } else if (ch === 'h') {
      this._noise(at, 0.035, g * 0.55, { type: 'highpass', freq: 6800, attack: 0.0012 })
        .connect(this.musicBus);
    } else if (ch === 'a') {
      const hz = R.anvil || 430;
      const m = this._osc('metall', hz, at, 0.32, g * 1.15, { to: hz * 0.93, attack: 0.002 });
      m.connect(this.musicBus);
      m.connect(this.msends[1]);
      this._noise(at, 0.08, g * 0.7, { freq: 3400, q: 1.2, attack: 0.0012 }).connect(this.musicBus);
    } else if (ch === 'k') {
      this._osc('sine', 118, at, 0.22, g * 1.9, { to: 46, attack: 0.004 }).connect(this.musicBus);
    }
  }

  _combo(P, chord, bar, s, at, sec) {
    const C = P.combo;
    if (!C || !this.comboGain) return;
    if (!this.comboLayer && at > this._comboUntil) return;
    const pat = C.pats[(bar + sec) % C.pats.length];
    const ch = pat[s];
    if (!ch || ch === '.') return;
    const f = this._degHz(P, chord, ch.charCodeAt(0) - 48, C.oct);
    this._voice(C, f, at, C.gain, { dest: this.comboGain, bare: true });
  }
}

function readMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function writeMuted(v) {
  try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* egal */ }
}
