/**
 * Partikelsystem mit Object-Pooling.
 *
 * Der Pool wird einmal fest vorbelegt und danach nie wieder vergrößert oder
 * neu alloziert: die Daten liegen in typisierten Arrays (struct of arrays),
 * die aktiven Partikel stehen lückenlos vorn. Beim Sterben wird der letzte
 * aktive Partikel an die frei gewordene Stelle getauscht — kein splice, kein
 * Garbage, keine Ruckler bei 300+ gleichzeitigen Partikeln.
 */
import { PARTICLE_CAPACITY } from '../game/config.js';

export const FUNKE = 0;    // runder Glutpunkt, additiv gezeichnet
export const SPLITTER = 1; // Kristallscherbe, rotiert

export class Particles {
  constructor(capacity = PARTICLE_CAPACITY) {
    this.cap = capacity;
    this.count = 0;

    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.ttl = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.color = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);

    /** Wie viele Partikel mangels Platz verworfen wurden (Diagnose). */
    this.dropped = 0;
  }

  /** @returns {number} Index oder -1, wenn der Pool voll ist */
  _take() {
    if (this.count >= this.cap) { this.dropped++; return -1; }
    return this.count++;
  }

  spawn(x, y, vx, vy, {
    ttl = 0.5, size = 8, color = 0, kind = FUNKE,
    drag = 2.4, grav = 0, spin = 0, rot = 0,
  } = {}) {
    const i = this._take();
    if (i < 0) return;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = ttl; this.ttl[i] = ttl;
    this.size[i] = size;
    this.rot[i] = rot; this.spin[i] = spin;
    this.drag[i] = drag; this.grav[i] = grav;
    this.color[i] = color; this.kind[i] = kind;
  }

  /**
   * Radiale Explosion in Steinfarbe — das Platzen eines Steins.
   * @param {()=>number} rng
   */
  burst(x, y, color, count, rng, speed = 260) {
    const base = rng() * Math.PI * 2;
    for (let n = 0; n < count; n++) {
      // Gleichmäßig verteilte Richtungen mit etwas Streuung: sieht voller aus
      // als reiner Zufall und vermeidet Löcher im Kranz.
      const ang = base + (n / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const sp = speed * (0.45 + rng() * 0.75);
      const shard = n % 3 === 0;
      this.spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, {
        ttl: 0.34 + rng() * 0.4,
        size: shard ? 13 + rng() * 8 : 7 + rng() * 9,
        color,
        kind: shard ? SPLITTER : FUNKE,
        drag: 3.1 + rng() * 1.6,
        grav: shard ? 900 : 260,
        rot: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 14,
      });
    }
  }

  /** Funkenregen, wenn ein abgestürzter Stein im Hort versinkt. */
  hoardSplash(x, y, color, rng, count = 7) {
    for (let n = 0; n < count; n++) {
      const ang = -Math.PI / 2 + (rng() - 0.5) * 1.9;
      const sp = 150 + rng() * 300;
      this.spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, {
        ttl: 0.42 + rng() * 0.5,
        size: 6 + rng() * 7,
        color,
        kind: FUNKE,
        drag: 1.1,
        grav: 1250,
      });
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      const l = this.life[i] - dt;
      if (l <= 0) { this._kill(i); continue; }
      this.life[i] = l;

      this.vy[i] += this.grav[i] * dt;
      const f = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= f;
      this.vy[i] *= f;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
  }

  /** Letzten aktiven Partikel auf den frei gewordenen Platz tauschen. */
  _kill(i) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.life[i] = this.life[last]; this.ttl[i] = this.ttl[last];
      this.size[i] = this.size[last];
      this.rot[i] = this.rot[last]; this.spin[i] = this.spin[last];
      this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last];
      this.color[i] = this.color[last]; this.kind[i] = this.kind[last];
    }
  }

  clear() { this.count = 0; }
}
