/**
 * Juice-Regie.
 *
 * Bündelt, was beim Platzen und beim Absturz gleichzeitig passieren muss:
 * Squash-Stretch, Partikel, Screenshake, Weißblitz und Hitstop. Das Spiel ruft
 * hier zwei Methoden auf — `pop` und `drop` — und bekommt die komplette
 * Rückmeldung. Die Zahlenwerte stehen alle in config.js.
 */
import {
  POP_MS, POP_PARTICLES_MIN, POP_PARTICLES_MAX,
  HITSTOP_MS, HITSTOP_MIN_DROPS, HITSTOP_SCALE,
  FLASH_ALPHA, FLASH_MS,
} from '../game/config.js';
import { Particles } from './particles.js';
import { Shake } from './shake.js';

export class Juice {
  /**
   * @param {()=>number} rng
   * @param {(seconds:number,scale:number)=>void} hitstop Zeitlupe anfordern
   */
  constructor(rng = Math.random, hitstop = null) {
    this.rng = rng;
    this.hitstopFn = hitstop;
    this.particles = new Particles();
    this.shake = new Shake(rng);

    /** Platzende Steine: fester Pool, wächst nie im Spielbetrieb. */
    this.pops = [];
    this.popCount = 0;

    this.flash = 0;
    this.reducedMotion = this.shake.scale < 1;
  }

  /**
   * Ein Stein platzt: Squash-Stretch über 120 ms plus 8–14 Partikel in
   * Steinfarbe, radial mit Reibung.
   */
  pop(x, y, color) {
    let p = this.pops[this.popCount];
    if (!p) { p = { x: 0, y: 0, color: 0, t: 0 }; this.pops.push(p); }
    this.popCount++;
    p.x = x; p.y = y; p.color = color; p.t = 0;

    const n = POP_PARTICLES_MIN
      + Math.floor(this.rng() * (POP_PARTICLES_MAX - POP_PARTICLES_MIN + 1));
    this.particles.burst(x, y, color, n, this.rng);
  }

  /**
   * Ein Absturz beginnt: Weißblitz, Erschütterung und — ab sechs Steinen —
   * 70 ms Zeitlupe, damit der Einsturz körperlich wird.
   */
  drop(count) {
    if (count <= 0) return;
    if (!this.reducedMotion) this.flash = 1;
    if (count >= HITSTOP_MIN_DROPS && this.hitstopFn) {
      this.hitstopFn(HITSTOP_MS / 1000, HITSTOP_SCALE);
    }
  }

  /** Ein abgestürzter Stein versinkt im Hort. */
  hoardSplash(x, y, color) {
    this.particles.hoardSplash(x, y, color, this.rng);
  }

  /** Erschütterung aus der Zahl entfernter Steine. */
  impact(stones) { this.shake.fromStones(stones); }

  update(dt) {
    this.particles.update(dt);
    this.shake.update(dt);

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / (FLASH_MS / 1000));

    // Abgelaufene Pops aus dem vorderen Bereich heraustauschen.
    const dur = POP_MS / 1000;
    let i = 0;
    while (i < this.popCount) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t >= dur) {
        const last = --this.popCount;
        this.pops[i] = this.pops[last];
        this.pops[last] = p;
        continue;
      }
      i++;
    }
  }

  get flashAlpha() { return this.flash * FLASH_ALPHA; }

  reset() {
    this.particles.clear();
    this.shake.reset();
    this.popCount = 0;
    this.flash = 0;
  }
}
