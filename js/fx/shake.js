/**
 * Screenshake.
 *
 * Amplitude = min(2 + Kombogröße * 1,2 ; 14) px, Abklingen über 250 ms.
 * Statt reinem Zufallsflackern laufen zwei Sinus mit unterschiedlicher
 * Frequenz und zufälliger Phase — das liest sich als Erschütterung und nicht
 * als Bildfehler, und es bleibt bei jeder Bildrate gleich stark.
 */
import { SHAKE_BASE, SHAKE_PER_STONE, SHAKE_MAX, SHAKE_MS } from '../game/config.js';

export class Shake {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.amp = 0;
    this.t = 0;
    this.duration = SHAKE_MS / 1000;
    this.phaseX = 0;
    this.phaseY = 0;
    this.x = 0;
    this.y = 0;
    // Wer weniger Bewegung möchte, bekommt weniger Bewegung.
    this.scale = (typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 0.25 : 1;
  }

  /** Erschütterung aus der Zahl entfernter Steine. */
  fromStones(count) {
    this.add(Math.min(SHAKE_BASE + count * SHAKE_PER_STONE, SHAKE_MAX));
  }

  /** @param {number} amplitude in virtuellen px */
  add(amplitude) {
    const a = amplitude * this.scale;
    if (a <= this.amp && this.t > 0) return;   // ein stärkerer Stoß gewinnt
    this.amp = a;
    this.t = this.duration;
    this.phaseX = this.rng() * Math.PI * 2;
    this.phaseY = this.rng() * Math.PI * 2;
  }

  update(dt) {
    if (this.t <= 0) { this.x = 0; this.y = 0; return; }
    this.t = Math.max(0, this.t - dt);
    const k = this.t / this.duration;          // 1 -> 0
    const decay = k * k;                       // weiches Ausklingen
    const u = (1 - k) * this.duration;
    this.x = Math.sin(u * 74 + this.phaseX) * this.amp * decay;
    this.y = Math.sin(u * 61 + this.phaseY) * this.amp * decay * 0.8;
  }

  reset() { this.amp = 0; this.t = 0; this.x = 0; this.y = 0; }
}
