/**
 * Schleuder: Zielwinkel, Warteschlange und Nachschubfarbe.
 *
 * Steuerungsregel (kritisch fürs Spielgefühl): beim Aufsetzen wird der aktuelle
 * Winkel eingefroren, danach gilt
 *     Winkel = eingefrorener Winkel + (dx seit Aufsetzen) * 0,18°/px
 * Dadurch zielt man an *beliebiger* Stelle des Bildschirms, feiner als 1:1,
 * und der Finger verdeckt nie das Ziel.
 */
import {
  SHOOTER_X, SHOOTER_Y, MAX_ANGLE, AIM_SENSITIVITY, COLORS,
} from './config.js';
import { makeStone } from './grid.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Shooter {
  constructor(rng = Math.random) {
    this.x = SHOOTER_X;
    this.y = SHOOTER_Y;
    this.rng = rng;

    this.angle = 0;          // Grad von der Senkrechten, positiv = rechts
    this.frozenAngle = 0;
    this.aiming = false;

    /** @type {{color:number,kind:string}|null} */
    this.current = null;
    /** @type {{color:number,kind:string}|null} */
    this.next = null;

    this.swapFlash = 0;      // kleine Rückmeldung beim Tauschen
  }

  // --- Zielen ---------------------------------------------------------------

  beginAim() {
    this.aiming = true;
    this.frozenAngle = this.angle;
  }

  /** @param {number} dx Verschiebung seit dem Aufsetzen, in virtuellen px */
  dragTo(dx) {
    this.angle = clamp(this.frozenAngle + dx * AIM_SENSITIVITY, -MAX_ANGLE, MAX_ANGLE);
  }

  /** Direkt auf einen Punkt zielen (kurzer Tipp in die obere Bildschirmhälfte). */
  aimAt(x, y) {
    const dx = x - this.x;
    const dy = this.y - y;                 // nach oben positiv
    const deg = Math.atan2(dx, Math.max(dy, 1e-3)) * 180 / Math.PI;
    this.angle = clamp(deg, -MAX_ANGLE, MAX_ANGLE);
  }

  endAim() { this.aiming = false; }

  // --- Warteschlange --------------------------------------------------------

  /** Aktuellen und nächsten Stein tauschen. */
  swap() {
    if (!this.current || !this.next) return false;
    const t = this.current;
    this.current = this.next;
    this.next = t;
    this.swapFlash = 1;
    return true;
  }

  /** Aktuellen Stein herausnehmen und die Warteschlange nachrücken lassen. */
  take(grid) {
    const stone = this.current;
    this.current = this.next;
    this.next = makeStone(this.pickColor(grid));
    return stone;
  }

  /** Warteschlange komplett neu befüllen (Levelstart / Neustart). */
  reset(grid) {
    this.angle = 0;
    this.frozenAngle = 0;
    this.aiming = false;
    this.swapFlash = 0;
    this.current = makeStone(this.pickColor(grid));
    this.next = makeStone(this.pickColor(grid));
  }

  /**
   * Nachschub-Farbe ausschließlich aus den auf dem Feld vorhandenen Farben,
   * mit invertierter Häufigkeitsgewichtung: seltene Farben kommen häufiger.
   */
  pickColor(grid) {
    const counts = grid.colorCounts();
    const pool = [];
    let total = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 0) continue;
      const w = 1 / counts[i];
      pool.push([i, w]);
      total += w;
    }
    if (!pool.length) return 0;
    let t = this.rng() * total;
    for (const [i, w] of pool) {
      t -= w;
      if (t <= 0) return i;
    }
    return pool[pool.length - 1][0];
  }

  /**
   * Steine, deren Farbe vom Feld verschwunden ist, auf eine noch vorhandene
   * Farbe umstellen — sonst hält der Spieler unspielbare Munition in der Hand.
   */
  harmonize(grid) {
    const present = grid.presentColors();
    if (!present.length) return;
    for (const slot of ['current', 'next']) {
      const s = this[slot];
      if (s && s.kind === 'gem' && !present.includes(s.color)) {
        s.color = this.pickColor(grid);
      }
    }
  }

  update(dt) {
    if (this.swapFlash > 0) this.swapFlash = Math.max(0, this.swapFlash - dt * 4);
  }

  get colorInfo() {
    return this.current ? COLORS[this.current.color] : COLORS[0];
  }
}
