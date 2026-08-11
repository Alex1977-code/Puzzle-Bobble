/**
 * Schleuder: Zielwinkel, Warteschlange und Nachschubfarbe.
 *
 * Steuerungsregel (kritisch fürs Spielgefühl): beim Aufsetzen wird der aktuelle
 * Winkel eingefroren, danach zieht man an *beliebiger* Stelle des Bildschirms,
 * und der Finger verdeckt nie das Ziel.
 *
 * Die reine Form `Winkel = eingefroren + dx * 0,18°/px` ist auf einem schmalen
 * Handy zu scharf: dort entspricht ein Bildschirmpixel rund 1,7 virtuellen px,
 * also etwa 0,3° — zwei Millimeter Fingerzittern beim Loslassen verschieben das
 * Ziel um eine ganze Zelle. Drei Zusätze nehmen das heraus, ohne die Reichweite
 * zu verlieren:
 *
 *   1. Totzone: unterhalb der Tipp-Schwelle bewegt sich gar nichts.
 *   2. Feinzielen: die Empfindlichkeit hängt von der Fingergeschwindigkeit ab.
 *      Langsam ziehen untersetzt auf AIM_FINE_GAIN, zügig ziehen behält die
 *      vollen 0,18°/px der Spezifikation. Große Schwenks bleiben also schnell,
 *      das letzte Grad wird ruhig.
 *   3. Glättung: der ausgegebene Winkel läuft dem Zielwinkel mit einer kurzen
 *      Zeitkonstante nach. Vorschau und Schuss benutzen beide diesen geglätteten
 *      Winkel — was auf dem Bildschirm steht, wird auch geschossen.
 */
import {
  SHOOTER_X, SHOOTER_Y, MAX_ANGLE, COLORS,
  AIM_SENSITIVITY, AIM_FINE_GAIN, AIM_SLOW_SPEED, AIM_FAST_SPEED,
  AIM_DEADZONE, AIM_SMOOTH_TAU,
} from './config.js';
import { makeStone } from './grid.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Empfindlichkeitsfaktor aus der Fingergeschwindigkeit: unter AIM_SLOW_SPEED
 * voll untersetzt, über AIM_FAST_SPEED die vollen 0,18°/px, dazwischen weich
 * geblendet (Smoothstep, damit der Übergang nicht zu spüren ist).
 */
function gainFor(speed) {
  if (speed <= AIM_SLOW_SPEED) return AIM_FINE_GAIN;
  if (speed >= AIM_FAST_SPEED) return 1;
  const u = (speed - AIM_SLOW_SPEED) / (AIM_FAST_SPEED - AIM_SLOW_SPEED);
  const s = u * u * (3 - 2 * u);
  return AIM_FINE_GAIN + (1 - AIM_FINE_GAIN) * s;
}

export class Shooter {
  constructor(rng = Math.random) {
    this.x = SHOOTER_X;
    this.y = SHOOTER_Y;
    this.rng = rng;

    this.angle = 0;          // ausgegebener Winkel, Grad von der Senkrechten
    this.targetAngle = 0;    // Ziel der Glättung
    this.frozenAngle = 0;
    this.aiming = false;
    this._lastDx = 0;        // zuletzt verrechnete Ziehstrecke
    this._armed = false;     // Totzone überwunden?

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
    this.targetAngle = this.angle;
    this._lastDx = 0;
    this._armed = false;
  }

  /**
   * @param {number} dx Verschiebung seit dem Aufsetzen, in virtuellen px
   * @param {number} dtMs Zeit seit dem vorherigen Zeigerereignis
   */
  dragTo(dx, dtMs = 16) {
    // Totzone: erst jenseits der Tipp-Schwelle wird gezielt. Der Startpunkt
    // wird auf den Rand der Totzone gesetzt, damit es beim Überschreiten
    // keinen Sprung gibt.
    if (!this._armed) {
      if (Math.abs(dx) < AIM_DEADZONE) return;
      this._armed = true;
      this._lastDx = Math.sign(dx) * AIM_DEADZONE;
    }

    const delta = dx - this._lastDx;
    this._lastDx = dx;
    if (delta === 0) return;

    const speed = Math.abs(delta) / Math.max(dtMs, 1) * 1000;   // px/s
    this.targetAngle = clamp(
      this.targetAngle + delta * AIM_SENSITIVITY * gainFor(speed),
      -MAX_ANGLE, MAX_ANGLE,
    );
  }

  /**
   * Direkt auf einen Punkt zielen (kurzer Tipp in die obere Bildschirmhälfte).
   * Hier wird nicht geglättet — es wird sofort geschossen.
   */
  aimAt(x, y) {
    const dx = x - this.x;
    const dy = this.y - y;                 // nach oben positiv
    const deg = Math.atan2(dx, Math.max(dy, 1e-3)) * 180 / Math.PI;
    this.angle = this.targetAngle = clamp(deg, -MAX_ANGLE, MAX_ANGLE);
  }

  endAim() { this.aiming = false; }

  /** Zielen verwerfen und auf den eingefrorenen Winkel zurückgehen. */
  abortAim() {
    this.aiming = false;
    this.targetAngle = this.frozenAngle;
    this._armed = false;
  }

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
    this.targetAngle = 0;
    this.frozenAngle = 0;
    this.aiming = false;
    this._lastDx = 0;
    this._armed = false;
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

    // Winkelglättung: exponentiell, damit sie bei jeder Bildrate gleich wirkt.
    const diff = this.targetAngle - this.angle;
    if (Math.abs(diff) < 1e-4) {
      this.angle = this.targetAngle;
    } else {
      this.angle += diff * (1 - Math.exp(-dt / AIM_SMOOTH_TAU));
    }
  }

  get colorInfo() {
    return this.current ? COLORS[this.current.color] : COLORS[0];
  }
}
